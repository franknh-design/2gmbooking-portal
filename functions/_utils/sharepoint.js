// functions/_utils/sharepoint.js
// v1.6 - SharePoint operations via Microsoft Graph
// Endringer fra v1.5 (portal v3.10.32, "Trinn 2"):
//   - fetchAllItems aksepterer nå {filter, select, prefer, top} i tillegg til
//     legacy raw query-streng
//   - Hot-path-fetchere bruker server-side $filter (Status/PropertyLookupId/
//     Active/Title) for å redusere antall rader som returneres + parses
//   - Alle list-fetches bruker $select på spesifikke felter — kutter payload-
//     størrelse betydelig (~60-80% mindre JSON per side)
//   - HONOR_NONINDEXED-header settes når vi filtrerer på ikke-nødvendigvis-
//     indekserte tekstkolonner (Title, Token, Property_Name, Room.Title)
//   - findBookingByIdForCompany går nå direkte mot /items/{id} i stedet for
//     å skanne hele lista
// Sammen kutter dette CPU-bruken på de tunge endepunktene (my-bookings,
// invoice-archive, customer-free-rooms, availability) merkbart — målet er
// å holde dem trygt under Cloudflare Workers' CPU-limit.

import { graphRequest } from "./graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";

const LIST_IDS = {
  TOKENS:     "73f113fe-76b0-48b2-9105-243a45166420",
  ROOMS:      "bfa962a0-5eb2-416c-abe8-adba06558c11",
  BOOKINGS:   "fe1dfe34-23df-4864-b0b1-b01bf60bfb75",
  PROPERTIES: "d842d574-f238-442a-be3d-77334727e89f",
  RATES:      "a604493f-e879-48a0-bcab-cdeb9ae2195e",
  PERSONS:    "ebbe517d-83f8-4169-9423-70c63a3f8c07",
  // v1.7: PIN-rate-limit. Sett til SharePoint-list-GUID for 'Pin_Attempts'
  // når listen er opprettet. Tom streng = rate-limiting deaktivert (graceful
  // degradation). Kolonner som forventes:
  //   - Title           (Tekst, default — token-strengen brukes som key)
  //   - FailedCount     (Tall)
  //   - LockedUntil     (Dato og klokkeslett)
  //   - LastAttempt     (Dato og klokkeslett)
  PIN_ATTEMPTS: "9808abe5-8f13-4305-8840-e84c5721953b",
};

// v1.7: PIN-rate-limit-konfigurasjon. 5 mislykkede forsøk per token utløser
// 1 times lockout. Justér her hvis admin ber om strammere/løsere policy.
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60 * 60 * 1000;

const PROPERTY_MAP = {
  rigg44:         "Rigg 44",
  rigg24:         "Rigg 24",
  riggbotnhagen:  "Rigg Botnhågen",
  andslimoen:     "Rigg Andslimoen",
  strandveien112: "Strandveien 112",
};

// Adresser per bygg. Vises i portalens "Mine bookinger" så kunder vet hvor
// de skal kjøre. Hardkodet siden adressene er statiske; fyll inn de tomme
// strengene etter hvert som de blir bekreftet og push på nytt.
const PROPERTY_ADDRESSES = {
  "Rigg 24":         "Aspeveien 2, 9300 Finnsnes",
  "Rigg 44":         "Strandveien 108, 9300 Finnsnes",
  "Rigg Botnhågen":  "Industriveien 4, 9300 Finnsnes",
  "Rigg Andslimoen": "",
  "Strandveien 112": "Strandveien 112, 9300 Finnsnes",
};

export function propertyIdToName(id) {
  return PROPERTY_MAP[String(id || "").toLowerCase()] || null;
}

export function propertyAddress(propertyName) {
  return PROPERTY_ADDRESSES[propertyName] || null;
}

// ============================================================================
// Felles paginering
// ============================================================================

/**
 * Henter ALLE rader fra en SharePoint-liste, med automatisk paginering
 * via @odata.nextLink. Stopper etter MAX_PAGES for sikkerhets skyld
 * (forhindrer uendelig løkke ved feil).
 *
 * Graph API begrenser ofte til 200 per side selv med $top=999, derfor
 * MÅ vi følge nextLink.
 *
 * v3.10.32 (Trinn 2): Aksepterer enten en ren query-streng (legacy) eller
 * et structured options-objekt med {filter, select, top, prefer}.
 * Server-side $filter + $select reduserer payload + JSON.parse-CPU
 * betydelig — gjør at endepunktene unngår Cloudflare ExceededCpu.
 *
 *   filter: f.eks. "fields/Status eq 'Active' or fields/Status eq 'Upcoming'"
 *   select: f.eks. "Title,Status,Company,Check_In,Check_Out,RoomLookupId"
 *           (uten 'id' — id er alltid med)
 *   prefer: når $filter brukes på ikke-indekserte tekstkolonner, sett
 *           "HonorNonIndexedQueriesWarningMayFailRandomly" så SharePoint
 *           ikke avviser query'en med "field not indexed"-feil.
 */
async function fetchAllItems(env, listId, options = {}) {
  const MAX_PAGES = 50; // 50 * 999 = 49 950 rader. Mer enn nok.

  let queryString;
  let extraHeaders;

  if (typeof options === "string") {
    // Legacy: rå query-streng
    queryString = options;
  } else {
    const parts = [];
    parts.push(options.select ? `$expand=fields($select=${options.select})` : "$expand=fields");
    parts.push(`$top=${options.top || 999}`);
    if (options.filter) parts.push(`$filter=${encodeURIComponent(options.filter)}`);
    queryString = parts.join("&");
    if (options.prefer) {
      extraHeaders = { Prefer: options.prefer };
    }
  }

  const startPath = `/sites/${SITE_ID}/lists/${listId}/items?${queryString}`;
  const fetchOpts = extraHeaders ? { headers: extraHeaders } : {};

  const allItems = [];
  let nextUrl = null;
  let pages = 0;

  do {
    const data = nextUrl
      ? await graphRequest(env, nextUrl, fetchOpts)
      : await graphRequest(env, startPath, fetchOpts);

    if (Array.isArray(data.value)) {
      allItems.push(...data.value);
    }

    nextUrl = data["@odata.nextLink"] || null;
    pages++;

    if (pages >= MAX_PAGES) {
      // eslint-disable-next-line no-console
      console.warn(`[SP] fetchAllItems hit MAX_PAGES (${MAX_PAGES}) for list ${listId}. Truncating.`);
      break;
    }
  } while (nextUrl);

  return allItems;
}

// v3.10.32: Felles Prefer-header når vi filtrerer på tekstkolonner som ikke
// nødvendigvis er indekserte. Får SharePoint til å akseptere $filter selv om
// kolonnen mangler indeks (med advarsel om at ytelsen kan variere). Trygt for
// bookings-lista vår (656 rader) — SharePoints harde 5000-grense slår ikke
// inn før mye senere.
const HONOR_NONINDEXED = "HonorNonIndexedQueriesWarningMayFailRandomly";

// v3.10.32: Felles $select-felter pr. liste. Kun feltene noen kode-sti faktisk
// leser. Holdes her sentralt så vi ikke glemmer å oppdatere alle kallesteder
// når nye felter brukes.
const SELECT_BOOKING_FIELDS = "Title,Person_Name,Company,Billing_Company,Property_Name,Check_In,Check_Out,Status,Pending_Confirmation,RoomLookupId,Door_Code,Notes";
const SELECT_ROOM_FIELDS = "Title,Door_Code,Cleaning_Status,DailyRate,PropertyLookupId,Floor,Active,LongTerm_Company,LongTerm_Price,LongTerm_StartDate,LongTerm_EndDate";
const SELECT_PROPERTY_FIELDS = "Title,FullTenant_Company,DailyRate,SMS_Template,WiFi_SSID,WiFi_Password,Welcome_Message,Floor1_Info,Floor2_Info";
const SELECT_TOKEN_FIELDS = "Title,Token,Pin,Aktiv,Firma,Kontaktperson,Telefon,Epost,Utlopsdato,TillatteLokasjoner,MaksRomPerBestilling,AntallBestillinger,SistBrukt,LastSeen,Sprak";

// ============================================================================
// Properties (Eiendommer-listen)
// ============================================================================

async function getPropertyLookupMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: "Title" });

  const map = {};
  for (const item of items) {
    const lookupId = item.id;
    const title = item.fields?.Title;
    if (lookupId && title) map[lookupId] = title;
  }
  return map;
}

// v1.7: Properties-meta inkl. FullTenant_Company, brukt av availability
// for å gi customer-eide bygg ledighet til kunden selv.
export async function getPropertyMetaMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: "Title,FullTenant_Company" });
  const map = {};
  for (const item of items) {
    if (!item.id) continue;
    map[item.id] = {
      title: item.fields?.Title || null,
      fullTenantCompany: item.fields?.FullTenant_Company || null,
    };
  }
  return map;
}

// ============================================================================
// Customer_Tokens
// ============================================================================

export async function findToken(env, token) {
  // v3.10.32: Server-side $filter på Token + Aktiv. Token-listen er ikke
  // svær (~50 rader), men findToken kalles av HVERT endepunkt så å spare
  // 50 → 1 rad JSON.parse på hvert kall summerer seg.
  // Token er en GUID-streng (case-sensitive), så eq-match er presist.
  const escapedToken = String(token).replace(/'/g, "''");
  const items = await fetchAllItems(env, LIST_IDS.TOKENS, {
    select: SELECT_TOKEN_FIELDS,
    filter: `fields/Token eq '${escapedToken}' and fields/Aktiv eq true`,
    prefer: HONOR_NONINDEXED,
  });

  const match = items[0];
  if (!match) return null;

  if (match.fields.Utlopsdato) {
    const expiry = new Date(match.fields.Utlopsdato);
    if (expiry < new Date()) return null;
  }

  return {
    id: match.id,
    fields: match.fields,
  };
}

// v1.6: Stempel som klienten lagrer i sesjonen for å oppdage at admin
// har endret PIN/token/Aktiv/lokasjoner siden sist innlogging. Bygges av
// kun de sikkerhets-relevante feltene — IKKE SistBrukt/AntallBestillinger
// (som logTokenUsage bumper hver gang) så stempelet er stabilt mellom
// innlogginger inntil admin faktisk endrer noe.
//
// Sikkerhet: hashen er trunkert SHA-256 av {Pin|Aktiv|Token|Lokasjoner}.
// Den eksponeres i validate-token-respons. En angriper med URL'en kan i
// teori brute-force PIN ved å regne hash for hver av 10⁶ verdier, så
// validate-pin bør rate-limites separat (TODO).
export async function computeTokenStamp(fields) {
  const parts = [
    String(fields.Pin || ""),
    fields.Aktiv === true ? "1" : "0",
    String(fields.Token || ""),
    String(fields.TillatteLokasjoner || ""),
    String(fields.MaksRomPerBestilling || ""),
  ].join("|");
  const buf = new TextEncoder().encode(parts);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function logTokenUsage(env, itemId, currentCount) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.TOKENS}/items/${itemId}/fields`;

  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({
      SistBrukt: new Date().toISOString(),
      AntallBestillinger: (currentCount || 0) + 1,
    }),
  });
}

// v3.10.11: Lett heartbeat-oppdatering. Kalles av portalen ~hvert minutt så
// admin kan se hvem som er aktive akkurat nå. Skiller mellom SistBrukt
// (innlogging/bestilling) og LastSeen (siste aktivitet, inkl. heartbeat).
// Hvis kolonnen LastSeen ikke finnes i SharePoint enda, stripper
// _stripUnknownFieldsAsync feltet og PATCH lykkes uten effekt — admin må
// legge til kolonnen for at funksjonaliteten skal virke.
export async function updateTokenHeartbeat(env, itemId) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.TOKENS}/items/${itemId}/fields`;
  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({
      LastSeen: new Date().toISOString(),
    }),
  });
}

export function maskPhone(phone) {
  if (!phone || phone.length < 4) return "";
  const last3 = phone.slice(-3);
  return `+47 ••• •• ${last3}`;
}

// ============================================================================
// PIN-rate-limit (v1.7)
// ============================================================================
//
// Begrenser brute-force mot validate-pin. Per token:
//   - Telleren økes for hvert mislykket PIN-forsøk
//   - Når telleren når PIN_MAX_ATTEMPTS settes LockedUntil = now + 1t,
//     telleren nullstilles
//   - Suksess nullstiller telleren + LockedUntil umiddelbart
//
// Designvalg:
//   - Egen liste (Pin_Attempts) heller enn kolonner på Customer_Tokens —
//     holder sikkerhetsstate adskilt fra forretnings-data, lettere å rotere.
//   - Title-kolonnen brukes som primærnøkkel (token-strengen). Færre rader
//     enn tokens (kun de som har feilet noen gang), så fetchAllItems-skanning
//     er rask.
//   - Når PIN_ATTEMPTS-GUID-en mangler degraderer alle helpers stille til
//     "ingen rate-limit" — gjør at koden kan deployes før admin har opprettet
//     listen i SharePoint.

async function _findPinAttemptRow(env, token) {
  if (!LIST_IDS.PIN_ATTEMPTS) return null;
  const items = await fetchAllItems(env, LIST_IDS.PIN_ATTEMPTS);
  return items.find(it => it.fields && it.fields.Title === token) || null;
}

export async function isPinTokenLocked(env, token) {
  if (!LIST_IDS.PIN_ATTEMPTS) return false;
  const row = await _findPinAttemptRow(env, token);
  if (!row || !row.fields.LockedUntil) return false;
  const until = new Date(row.fields.LockedUntil);
  return until.getTime() > Date.now();
}

export async function recordFailedPinAttempt(env, token) {
  if (!LIST_IDS.PIN_ATTEMPTS) return { locked: false };
  const row = await _findPinAttemptRow(env, token);
  const now = new Date();
  const prevCount = (row && row.fields.FailedCount) || 0;
  const newCount = prevCount + 1;
  const willLock = newCount >= PIN_MAX_ATTEMPTS;
  const fields = {
    Title: token,
    FailedCount: willLock ? 0 : newCount,
    LastAttempt: now.toISOString(),
    LockedUntil: willLock ? new Date(now.getTime() + PIN_LOCKOUT_MS).toISOString() : null,
  };
  if (row) {
    const path = `/sites/${SITE_ID}/lists/${LIST_IDS.PIN_ATTEMPTS}/items/${row.id}/fields`;
    await graphRequest(env, path, { method: "PATCH", body: JSON.stringify(fields) });
  } else {
    const path = `/sites/${SITE_ID}/lists/${LIST_IDS.PIN_ATTEMPTS}/items`;
    await graphRequest(env, path, { method: "POST", body: JSON.stringify({ fields }) });
  }
  return {
    locked: willLock,
    attemptsRemaining: willLock ? 0 : (PIN_MAX_ATTEMPTS - newCount),
  };
}

export async function clearPinAttempts(env, token) {
  if (!LIST_IDS.PIN_ATTEMPTS) return;
  const row = await _findPinAttemptRow(env, token);
  if (!row) return;
  // Skip skrivekall hvis det ikke er noe å fjerne
  if (!row.fields.FailedCount && !row.fields.LockedUntil) return;
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.PIN_ATTEMPTS}/items/${row.id}/fields`;
  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({ FailedCount: 0, LockedUntil: null }),
  });
}

// ============================================================================
// Rooms
// ============================================================================

export async function getRoomsForProperty(env, propertyName, propertyLookupMap) {
  const lookupIdForProperty = Object.entries(propertyLookupMap)
    .find(([id, name]) => name === propertyName)?.[0];

  if (!lookupIdForProperty) return [];

  // v3.10.32: filter på PropertyLookupId + Active. PropertyLookupId er
  // numerisk → presis match uten case-sensitivity-bekymring.
  const items = await fetchAllItems(env, LIST_IDS.ROOMS, {
    select: SELECT_ROOM_FIELDS,
    filter: `fields/PropertyLookupId eq ${Number(lookupIdForProperty)} and fields/Active eq true`,
    prefer: HONOR_NONINDEXED,
  });

  return items.filter(item => {
    const f = item.fields;
    return !!f.Title; // siste sjekk — filter har allerede dekket resten
  });
}

// Map fra Rooms-rad-id → { title, doorCode, cleaningStatus }. Brukes til å berike
// booking-svar og til auto-checkin (vi trenger Cleaning_Status for å sjekke om
// rommet er klart før vi flipper Upcoming → Active).
export async function getRoomsByIdMap(env) {
  // v3.10.32: bare $select — vi trenger ALLE rom her (id → meta-map), så
  // ingen filter. Kutter likevel betydelig payload-størrelse.
  const items = await fetchAllItems(env, LIST_IDS.ROOMS, { select: SELECT_ROOM_FIELDS });
  const map = {};
  for (const item of items) {
    if (!item.id) continue;
    const f = item.fields || {};
    map[String(item.id)] = {
      title: f.Title || null,
      doorCode: f.Door_Code || null,
      cleaningStatus: f.Cleaning_Status || null,
      dailyRate: Number(f.DailyRate) || 0,
      propertyLookupId: f.PropertyLookupId ? String(f.PropertyLookupId) : null,
      // v3.10.18: Floor brukes til å plukke riktig Floor1/Floor2_Info i
      // SMS-template-rendering (samme regel som admin-appen).
      floor: f.Floor != null ? String(f.Floor) : null,
      longTermCompany: f.LongTerm_Company || null,
      longTermPrice: Number(f.LongTerm_Price) || 0,
      longTermStartDate: f.LongTerm_StartDate || null,
      longTermEndDate: f.LongTerm_EndDate || null,
    };
  }
  return map;
}

// v3.10.18: Full property-meta-map med templates og WiFi-info — brukes av
// send-doorcode for å rendre samme SMS-template som admin-appen.
export async function getPropertiesFullByIdMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: SELECT_PROPERTY_FIELDS });
  const map = {};
  for (const item of items) {
    if (!item.id) continue;
    const f = item.fields || {};
    map[String(item.id)] = {
      title:           f.Title || "",
      smsTemplate:     f.SMS_Template || "",
      wifiSsid:        f.WiFi_SSID || "",
      wifiPassword:    f.WiFi_Password || "",
      welcomeMessage:  f.Welcome_Message || "",
      floor1Info:      f.Floor1_Info || "",
      floor2Info:      f.Floor2_Info || "",
    };
  }
  return map;
}

// v3.10.4: Hent hele Rates-lista — brukes til pris-oppslag i fakturaarkivet.
export async function getAllRates(env) {
  // v3.10.32: $select bare feltene rates.js faktisk leser.
  const items = await fetchAllItems(env, LIST_IDS.RATES, {
    select: "Person_Name,Company,Property,DailyRate,FeeType",
  });
  return items.map(it => it.fields || {}).filter(Boolean);
}

// v3.10.4: Hent Properties som id → { title, dailyRate, fullTenantCompany }.
// Brukes som fallback-rate-kilde og for å gjenkjenne full-tenant-eiendommer.
export async function getPropertiesByIdMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: "Title,DailyRate,FullTenant_Company" });
  const map = {};
  for (const item of items) {
    if (!item.id) continue;
    const f = item.fields || {};
    map[String(item.id)] = {
      title: f.Title || null,
      dailyRate: Number(f.DailyRate) || 0,
      fullTenantCompany: f.FullTenant_Company || null,
    };
  }
  return map;
}

// PATCH Status på en booking-rad. Brukes av auto-checkin i my-bookings.js.
export async function updateBookingStatus(env, itemId, status) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items/${itemId}/fields`;
  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({ Status: status }),
  });
}

// Generic PATCH av valgte felter på en booking-rad. Brukes av extend-booking.js
// for å markere Pending_Confirmation + appende notat når kunden ber om forlengelse.
export async function updateBookingFields(env, itemId, fields) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items/${itemId}/fields`;
  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

// ============================================================================
// Booking
// ============================================================================

export async function getBookingsForProperty(env, propertyName) {
  // v3.10.32: Server-side filter på Property_Name + Status. Property_Name er
  // exact-match-streng styrt av admin (riggene har faste navn), så ingen
  // case-sensitivity-overraskelser å bekymre seg for.
  const escapedProp = String(propertyName).replace(/'/g, "''");
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING_FIELDS,
    filter: `fields/Property_Name eq '${escapedProp}' and (fields/Status eq 'Active' or fields/Status eq 'Upcoming')`,
    prefer: HONOR_NONINDEXED,
  });

  // Filter er alt server-side; ingen ekstra JS-filtrering nødvendig.
  return items;
}

// v3.10.13: Matcher på Billing_Company ELLER Company. Admin-appen bruker
// getEffectiveCompany(b) (Billing_Company → Company fallback) til fakturering,
// så portalen må følge samme regel — ellers ser ikke betalende kunde sine
// egne bookinger der Company er satt til noe annet enn token-firmaet.
function _bookingMatchesCompany(fields, target) {
  const billing = String(fields.Billing_Company || "").trim().toLowerCase();
  const company = String(fields.Company || "").trim().toLowerCase();
  return billing === target || company === target;
}

// v3.10.15: Slå opp én booking på Title/booking-ref og verifiser at den
// tilhører kundens firma (Billing_Company eller Company). Brukes av
// send-doorcode for å unngå at en kunde kan trigge SMS for en annen kundes
// booking ved å gjette ref'en.
export async function findBookingByRefForCompany(env, bookingRef, companyName) {
  const refTarget = String(bookingRef || "").trim();
  const coTarget  = String(companyName || "").trim().toLowerCase();
  if (!refTarget || !coTarget) return null;
  // v3.10.32: Server-filter på Title (booking-ref). Booking-ref er en 2GM-XXXXXX
  // streng generert av oss → presis match uten case-quirks.
  const escapedRef = refTarget.replace(/'/g, "''");
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING_FIELDS,
    filter: `fields/Title eq '${escapedRef}'`,
    prefer: HONOR_NONINDEXED,
  });
  for (const item of items) {
    const f = item.fields || {};
    if (!_bookingMatchesCompany(f, coTarget)) return null;
    return item;
  }
  return null;
}

// v3.10.24: Slå opp ALLE aktive/kommende bookinger på et romnummer som
// tilhører kundens firma. Brukes av "Send dørkode"-knappen i banneret —
// hvis flere gjester deler rom (sjelden, men forekommer ved overlapp) skal
// kunden få velge hvilken som skal motta SMS.
//
// Returnerer { rooms: [room1, room2, ...], bookings: [b1, b2, ...] }
// sortert: Active først, deretter tidligste Check_In. Tom bookings-liste
// hvis ingen match (gjør at frontend kan skille mellom "fant rom, men ingen
// booking" og "fant ikke rommet").
export async function findBookingsByRoomForCompany(env, roomNumber, companyName) {
  const roomTarget = String(roomNumber || "").trim().toLowerCase();
  const coTarget = String(companyName || "").trim().toLowerCase();
  if (!roomTarget || !coTarget) return { rooms: [], bookings: [] };

  // v3.10.32: Server-filter på begge. Rooms.Title er ofte caps-stabilt
  // (romnumre er typisk rene tall/tall+bokstav), men vi gjør JS lowercase
  // som backup hvis admin har inkonsekvent skriving.
  const escapedRoom = String(roomNumber).trim().replace(/'/g, "''");
  const [rooms, items] = await Promise.all([
    fetchAllItems(env, LIST_IDS.ROOMS, {
      select: SELECT_ROOM_FIELDS,
      filter: `fields/Title eq '${escapedRoom}'`,
      prefer: HONOR_NONINDEXED,
    }),
    fetchAllItems(env, LIST_IDS.BOOKINGS, {
      select: SELECT_BOOKING_FIELDS,
      filter: `fields/Status eq 'Active' or fields/Status eq 'Upcoming'`,
      prefer: HONOR_NONINDEXED,
    }),
  ]);

  const matchingRooms = rooms.filter(r => {
    const title = String(r.fields?.Title || "").trim().toLowerCase();
    return title === roomTarget && r.id;
  });
  if (!matchingRooms.length) return { rooms: [], bookings: [] };

  const matchingRoomIds = new Set(matchingRooms.map(r => String(r.id)));

  const candidates = items.filter(item => {
    const f = item.fields || {};
    if (!f.RoomLookupId) return false;
    if (!matchingRoomIds.has(String(f.RoomLookupId))) return false;
    return _bookingMatchesCompany(f, coTarget);
  });

  candidates.sort((a, b) => {
    const sa = a.fields.Status === "Active" ? 0 : 1;
    const sb = b.fields.Status === "Active" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ca = new Date(a.fields.Check_In || 0).getTime() || Number.MAX_SAFE_INTEGER;
    const cb = new Date(b.fields.Check_In || 0).getTime() || Number.MAX_SAFE_INTEGER;
    return ca - cb;
  });

  return { rooms: matchingRooms, bookings: candidates };
}

// Slå opp booking på rad-id og verifiser at den tilhører kundens firma.
// Brukes av send-doorcode-by-room når kunden allerede har valgt en spesifikk
// booking i lookup-resultatet.
export async function findBookingByIdForCompany(env, bookingId, companyName) {
  const idTarget = String(bookingId || "").trim();
  const coTarget = String(companyName || "").trim().toLowerCase();
  if (!idTarget || !coTarget) return null;
  // v3.10.32: Hent ett spesifikt item direkte i stedet for full skanning.
  // ID er numerisk og presist, så vi kan slå opp direkte med Graph.
  try {
    const data = await graphRequest(
      env,
      `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items/${encodeURIComponent(idTarget)}?$expand=fields($select=${SELECT_BOOKING_FIELDS})`,
    );
    if (!data || !_bookingMatchesCompany(data.fields || {}, coTarget)) return null;
    return data;
  } catch (e) {
    // 404 / annet → ikke funnet
    return null;
  }
}

// v3.10.25: Batch-versjon — last Persons-lista én gang og returner et lookup-
// objekt så my-bookings kan slå opp telefon for hver booking uten nye Graph-
// kall. fetchAllItems pagineres (Persons har 300+ rader), så vi unngår N rundturer.
export async function getPersonsLookup(env) {
  // v3.10.32: $select bare navn + telefonkolonnene. Persons-lista har 300+
  // rader; payload-kutt er nyttig her selv om vi fortsatt henter alt.
  const items = await fetchAllItems(env, LIST_IDS.PERSONS, {
    select: "Title,Person_Name,Name,Mobile,Phone,Telefon",
  });
  const records = items.map(item => {
    const f = item.fields || {};
    return {
      name: String(f.Title || f.Person_Name || f.Name || "").trim().toLowerCase(),
      phone: String(f.Mobile || f.Phone || f.Telefon || "").trim(),
    };
  }).filter(p => p.name);
  return {
    findPhone(rawName) {
      const target = String(rawName || "").trim().toLowerCase();
      if (!target) return "";
      for (const p of records) {
        if (p.name === target && p.phone) return p.phone;
      }
      const words = target.split(/[\s,]+/).filter(w => w.length > 1);
      if (words.length < 2) return "";
      for (const p of records) {
        const pwords = p.name.split(/[\s,]+/).filter(w => w.length > 1);
        if (pwords.length < 2) continue;
        if (words.every(w => p.name.indexOf(w) >= 0) || pwords.every(w => target.indexOf(w) >= 0)) {
          if (p.phone) return p.phone;
        }
      }
      return "";
    },
  };
}

// v3.10.15: Persons-lookup for SMS-doorcode. Fuzzy-match etter samme regel
// som admin-appens person-historikk: eksakt match eller alle ord finnes i
// motsatt navn (håndterer "Ola N. Hansen" vs "Ola Hansen" osv.). Returnerer
// første person med ikke-tomt Mobile/Phone/Telefon-felt, eller null.
export async function findPersonPhoneByName(env, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  const items = await fetchAllItems(env, LIST_IDS.PERSONS, {
    select: "Title,Person_Name,Name,Mobile,Phone,Telefon",
  });
  const words = target.split(/[\s,]+/).filter(w => w.length > 1);

  const candidates = items.filter(item => {
    const f = item.fields || {};
    const pn = String(f.Title || f.Person_Name || f.Name || "").trim().toLowerCase();
    if (!pn) return false;
    if (pn === target) return true;
    if (words.length < 2) return false;
    const pwords = pn.split(/[\s,]+/).filter(w => w.length > 1);
    if (pwords.length < 2) return false;
    return words.every(w => pn.indexOf(w) >= 0) || pwords.every(w => target.indexOf(w) >= 0);
  });

  for (const c of candidates) {
    const f = c.fields || {};
    const phone = String(f.Mobile || f.Phone || f.Telefon || "").trim();
    if (phone) return { phone, name: f.Title || f.Person_Name || f.Name || "" };
  }
  return null;
}

export async function getBookingsForCompany(env, companyName) {
  // v3.10.32: Server-side filter på Status. Vi filtrerer IKKE på Company på
  // server-side fordi tekstkolonner i SharePoint har case-sensitivity- og
  // whitespace-fallgruver — risiko for at en kunde plutselig ikke ser sine
  // bookinger. JS-filteret _bookingMatchesCompany er allerede robust og
  // kjører billig på det Status-reduserte datasettet.
  const target = String(companyName || "").trim().toLowerCase();
  if (!target) return [];

  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING_FIELDS,
    filter: `fields/Status eq 'Active' or fields/Status eq 'Upcoming'`,
    prefer: HONOR_NONINDEXED,
  });

  return items.filter(item => _bookingMatchesCompany(item.fields, target));
}

// v3.10.0: All-status variant — brukes av fakturaarkivet i portalen så
// kunden ser tidligere (Completed) opphold gruppert per måned.
// Active og Upcoming inkluderes ikke automatisk — kalleren bestemmer
// hvilke statuser den vil ha med via inkluderingsfilter.
export async function getAllBookingsForCompany(env, companyName, includeStatuses) {
  const target = String(companyName || "").trim().toLowerCase();
  if (!target) return [];

  // v3.10.32: Server-side Status-filter. For fakturaarkivet vil vi typisk ha
  // alt UNNTATT Cancelled. Hvis kalleren sender includeStatuses, bygg filter
  // på de spesifikke statusene; ellers bruk "ne 'Cancelled'".
  let filter;
  if (includeStatuses && includeStatuses.length) {
    const clauses = includeStatuses
      .map(s => `fields/Status eq '${String(s).replace(/'/g, "''")}'`)
      .join(" or ");
    filter = `(${clauses})`;
  } else {
    filter = `fields/Status ne 'Cancelled'`;
  }

  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING_FIELDS,
    filter,
    prefer: HONOR_NONINDEXED,
  });

  // Server gjorde Status-filtreringen; vi gjør bare Company-matchen i JS.
  return items.filter(item => _bookingMatchesCompany(item.fields, target));
}

export function generateBookingRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `2GM-${suffix}`;
}

export async function createBookingRow(env, fields) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items`;

  const sharepointFields = {
    Title: fields.bookingRef,
    Property_Name: fields.propertyName,
    Person_Name: fields.guestName,
    Company: fields.companyName,
    Check_In: fields.checkIn,
    Check_Out: fields.checkOut || null,
    Status: "Upcoming",
    Pending_Confirmation: true,
    Notes: fields.notes || "",
  };

  for (const key of Object.keys(sharepointFields)) {
    if (sharepointFields[key] === null || sharepointFields[key] === undefined) {
      delete sharepointFields[key];
    }
  }

  const result = await graphRequest(env, path, {
    method: "POST",
    body: JSON.stringify({ fields: sharepointFields }),
  });

  return result;
}

export async function createBookingRows(env, rows) {
  const results = await Promise.allSettled(
    rows.map(row => createBookingRow(env, row))
  );

  const succeeded = [];
  const failed = [];

  results.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      succeeded.push({ index: idx, id: result.value.id });
    } else {
      failed.push({ index: idx, error: String(result.reason) });
    }
  });

  return { succeeded, failed };
}

// ============================================================================
// Tilgjengelighet
// ============================================================================

function parseDateUTC(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isDateInRangeInclusive(D, start, end) {
  if (!start) return false;
  if (D < start) return false;
  if (!end) return true;
  return D <= end;
}

export async function calculateAvailability(env, propertyName, fromISO, toISO, customerCompany) {
  const fromDate = parseDateUTC(fromISO);
  const toDate   = parseDateUTC(toISO);

  if (!fromDate || !toDate) throw new Error("Invalid date range");
  if (toDate < fromDate)    throw new Error("toDate before fromDate");

  const propertyMeta = await getPropertyMetaMap(env);
  // Bakoverkompat: enkel id→title-map for getRoomsForProperty.
  const propertyMap = {};
  for (const [id, m] of Object.entries(propertyMeta)) {
    if (m.title) propertyMap[id] = m.title;
  }

  const [rooms, bookings] = await Promise.all([
    getRoomsForProperty(env, propertyName, propertyMap),
    getBookingsForProperty(env, propertyName),
  ]);

  // v1.7: hvis kunden SELV er long-term-tenanten på et rom (LongTerm_Company
  // matcher Customer_Tokens.Firma), behandle rommet som vanlig — kunden ser
  // ledighet basert på sine egne bookinger. Eksempel: SalMar leier alle
  // leiligheter på Strandveien 112; uten denne sjekken viste portalen "fullt"
  // selv om alle leilighetene var tomme av SalMars egne ansatte.
  // v1.8: utvidet til også å sjekke Property.FullTenant_Company. Hvis bygget
  // er full-tenant til kunden, gjelder det alle rom i bygget — selv om det
  // enkelte rom mangler LongTerm_Company-feltet.
  const customerLower = String(customerCompany || "").trim().toLowerCase();
  // v1.10: vis konkrete rom-navn på ledige dager — kun for kunder som er
  // sole tenant på bygget (SalMar AS på Strandveien 112). Begrenser så vi
  // ikke lekker rom-info på blandede properties (Rigg 24 osv.).
  const showFreeRooms = customerLower === "salmar as" && propertyName === "Strandveien 112";
  const roomTitleById = {};
  const roomLongTerm = rooms.map(r => {
    const ltStart = parseDateUTC(r.fields.LongTerm_StartDate);
    const ltCompany = String(r.fields.LongTerm_Company || "").trim().toLowerCase();
    const propMeta = propertyMeta[r.fields.PropertyLookupId] || {};
    const ftCompany = String(propMeta.fullTenantCompany || "").trim().toLowerCase();
    const isOwnLongTerm = !!customerLower && (
      (!!ltCompany && ltCompany === customerLower) ||
      (!!ftCompany && ftCompany === customerLower)
    );
    const id = String(r.id);
    roomTitleById[id] = r.fields.Title || id;
    return {
      id,
      longTermStart: isOwnLongTerm ? null : ltStart,
      longTermEnd:   null,
    };
  });

  // v1.9: ta med roomLookupId i hver booking-periode så occupiedToday kan
  // filtreres til kun bookinger på rom som er i den tellbare poolen. Tidligere
  // ble alle bookinger på property-en talt med — også de på rom som var
  // ekskludert fra activeRoomsToday (f.eks. Senja Kommunes leiligheter på
  // Strandveien 112). Det gjorde at SalMar-bookingene "lekket" inn og pushet
  // available til 0 selv når deres egne rom var tomme.
  const bookingPeriods = bookings.map(b => ({
    checkIn:  parseDateUTC(b.fields.Check_In),
    checkOut: parseDateUTC(b.fields.Check_Out),
    roomId:   String(b.fields.RoomLookupId || ""),
  })).filter(b => b.checkIn !== null);

  const days = [];
  const oneDay = 24 * 60 * 60 * 1000;

  for (let t = fromDate.getTime(); t <= toDate.getTime(); t += oneDay) {
    const D = new Date(t);

    const countableRoomIds = new Set();
    for (const r of roomLongTerm) {
      const onLongTerm = isDateInRangeInclusive(D, r.longTermStart, r.longTermEnd);
      if (!onLongTerm) countableRoomIds.add(r.id);
    }
    const activeRoomsToday = countableRoomIds.size;

    const occupiedRoomIds = new Set();
    for (const b of bookingPeriods) {
      if (!countableRoomIds.has(b.roomId)) continue;
      if (isDateInRangeInclusive(D, b.checkIn, b.checkOut)) {
        occupiedRoomIds.add(b.roomId);
      }
    }
    const occupiedToday = occupiedRoomIds.size;

    const available = Math.max(0, activeRoomsToday - occupiedToday);

    const dayObj = {
      date: D.toISOString().slice(0, 10),
      available,
      occupied: occupiedToday,
      totalActive: activeRoomsToday,
    };
    if (showFreeRooms && available > 0) {
      const freeRooms = [];
      for (const id of countableRoomIds) {
        if (!occupiedRoomIds.has(id)) freeRooms.push(roomTitleById[id] || id);
      }
      freeRooms.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      dayObj.freeRooms = freeRooms;
    }
    days.push(dayObj);
  }

  return { property: propertyName, days };
}

// v1.10: returnerer alle rom som tilhører kunden (LongTerm_Company eller
// Property.FullTenant_Company matcher), på tvers av alle properties, med
// "ledig fra"-dato. Brukt av portalens "Ledige rom"-seksjon under kalenderen.
export async function getCustomerOwnedFreeRooms(env, customerCompany) {
  const customerLower = String(customerCompany || "").trim().toLowerCase();
  if (!customerLower) return [];

  const todayUTC = new Date();
  const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()));

  // v3.10.32: $select for begge + Status-filter på Bookings. ROOMS-lista er
  // liten (~50-100 rader); vi henter alle aktive rom her siden vi trenger
  // ownership-check (LongTerm_Company/PropertyMeta.FullTenant_Company) — vi
  // vet ikke ID-ene før vi har lest dem.
  const [propertyMeta, allRooms, allBookings] = await Promise.all([
    getPropertyMetaMap(env),
    fetchAllItems(env, LIST_IDS.ROOMS, {
      select: SELECT_ROOM_FIELDS,
      filter: `fields/Active eq true`,
      prefer: HONOR_NONINDEXED,
    }),
    fetchAllItems(env, LIST_IDS.BOOKINGS, {
      select: SELECT_BOOKING_FIELDS,
      filter: `fields/Status eq 'Active' or fields/Status eq 'Upcoming'`,
      prefer: HONOR_NONINDEXED,
    }),
  ]);

  // 1. Filter rom kunden eier
  const ownedRooms = [];
  for (const r of allRooms) {
    const f = r.fields || {};
    if (f.Active === false) continue;
    const ltCo = String(f.LongTerm_Company || "").trim().toLowerCase();
    const propMeta = propertyMeta[f.PropertyLookupId] || {};
    const ftCo = String(propMeta.fullTenantCompany || "").trim().toLowerCase();
    if (ltCo !== customerLower && ftCo !== customerLower) continue;
    ownedRooms.push({
      id: String(r.id),
      title: f.Title || String(r.id),
      propertyName: propMeta.title || "",
    });
  }
  if (!ownedRooms.length) return [];

  // 2. Indekser bookinger per rom (kun Active/Upcoming, sortert på Check_In)
  const bookingsByRoom = {};
  const ACTIVE = new Set(["Active", "Upcoming"]);
  for (const b of allBookings) {
    const f = b.fields || {};
    if (!ACTIVE.has(f.Status)) continue;
    const rid = String(f.RoomLookupId || "");
    if (!rid) continue;
    if (!bookingsByRoom[rid]) bookingsByRoom[rid] = [];
    bookingsByRoom[rid].push({
      checkIn: parseDateUTC(f.Check_In),
      checkOut: parseDateUTC(f.Check_Out),
      personName: f.Person_Name || "",
      company:    f.Company    || "",
    });
  }
  for (const rid of Object.keys(bookingsByRoom)) {
    bookingsByRoom[rid].sort((a, b) => (a.checkIn?.getTime() || 0) - (b.checkIn?.getTime() || 0));
  }

  // 3. For hvert eid rom: finn neste ledig dato
  const result = [];
  for (const room of ownedRooms) {
    const bs = bookingsByRoom[room.id] || [];
    // Sjekk om rom er okkupert nå (booking dekker today)
    const currentBooking = bs.find(b => {
      if (!b.checkIn) return false;
      if (b.checkIn > today) return false;
      if (!b.checkOut) return true; // open-ended
      return today <= b.checkOut;
    });
    let freeFrom, currentGuest = null, currentGuestCompany = null;
    let nextBookingCheckIn = null, nextGuest = null, nextGuestCompany = null;
    if (currentBooking) {
      if (!currentBooking.checkOut) {
        // Open-ended og pågår — aldri ledig
        continue;
      }
      // Ledig fra dagen ETTER checkOut (Check_Out = utflyttingsdag, rommet er
      // tilgjengelig fra neste dag)
      freeFrom = new Date(currentBooking.checkOut.getTime() + 24 * 60 * 60 * 1000);
      currentGuest        = currentBooking.personName || null;
      currentGuestCompany = currentBooking.company    || null;
    } else {
      // Ledig nå
      freeFrom = today;
    }
    // Finn neste booking som starter etter freeFrom
    const nextBooking = bs.find(b => b.checkIn && b.checkIn >= freeFrom);
    if (nextBooking && nextBooking.checkIn) {
      // Hvis neste booking starter samme dag som freeFrom, rommet er ikke ledig
      if (nextBooking.checkIn <= freeFrom) continue;
      nextBookingCheckIn = nextBooking.checkIn.toISOString().slice(0, 10);
      nextGuest          = nextBooking.personName || null;
      nextGuestCompany   = nextBooking.company    || null;
    }
    result.push({
      title: room.title,
      property: room.propertyName,
      currentlyFree: !currentBooking,
      freeFrom: freeFrom.toISOString().slice(0, 10),
      nextBookingCheckIn,
      currentGuest,
      currentGuestCompany,
      nextGuest,
      nextGuestCompany,
    });
  }

  // Sort: currently free first, deretter på freeFrom
  result.sort((a, b) => {
    if (a.currentlyFree !== b.currentlyFree) return a.currentlyFree ? -1 : 1;
    return a.freeFrom.localeCompare(b.freeFrom);
  });
  return result;
}

export async function checkCapacityConflict(env, propertyName, fromISO, toISO, roomCount, customerCompany) {
  const result = await calculateAvailability(env, propertyName, fromISO, toISO, customerCompany);

  const conflicts = [];
  for (const day of result.days) {
    if (day.available < roomCount) {
      conflicts.push({
        date: day.date,
        available: day.available,
        needed: roomCount,
      });
    }
  }

  return conflicts;
}
