// functions/_utils/sharepoint.js
// v1.6 - SharePoint operations via Microsoft Graph
// Endringer fra v1.5 (portal v3.11.0, "Trinn 2 — trygt subset"):
//   - fetchAllItems aksepterer {filter, select, prefer, top} i tillegg til
//     legacy raw query-streng
//   - $select på ALLE list-fetches — kun feltene koden faktisk leser. Kutter
//     JSON-payload med ~60-80% per side → mindre JSON.parse-CPU
//   - $filter på Bookings.Status (Choice — pålitelig) og Rooms.Active (Yes/No)
//     for å redusere antall rader server-side
//   - IKKE filter på Token/Title/Property_Name — vi prøvde det i v3.10.32 og
//     det brakk validate-token (Token-kolonnen støtter trolig ikke $filter,
//     antagelig fordi den er Multiline Text). Holder JS-side oppslag for
//     disse, men payload-en de jobber på er mye mindre nå pga $select.

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
  "Rigg 24":         "Aspeveien 2",
  "Rigg 44":         "Strandveien 108",
  "Rigg Botnhågen":  "Industriveien 4",
  "Rigg Andslimoen": "",
  "Strandveien 112": "",
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
 * v3.11.0 (Trinn 2 — trygt subset): Aksepterer enten en ren query-streng
 * (legacy) eller et structured options-objekt med {filter, select, top, prefer}.
 *
 *   filter: f.eks. "fields/Status eq 'Active'" — pålitelig på Choice/Yes-No,
 *           IKKE bruk på Multiline Text (Token, evt. lange Title-felt)
 *   select: f.eks. "Title,Status,Company" — kun felt vi leser. (id er alltid med.)
 *   prefer: når $filter brukes på ikke-indekserte tekstkolonner, sett
 *           "HonorNonIndexedQueriesWarningMayFailRandomly".
 */
async function fetchAllItems(env, listId, options = {}) {
  const MAX_PAGES = 50; // 50 * 999 = 49 950 rader. Mer enn nok.

  let queryString;
  let extraHeaders;

  if (typeof options === "string") {
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

// v3.11.0: HonorNonIndexed-header for $filter på ikke-indekserte kolonner.
// Trygt for våre datamengder (Bookings ~656, Rooms ~80) — langt under SharePoints
// 5000-rad-grense som ellers ville avvist non-indexed queries.
const HONOR_NONINDEXED = "HonorNonIndexedQueriesWarningMayFailRandomly";

// v3.11.0: $select-konstanter per liste. Kun felt koden faktisk leser.
const SELECT_BOOKING = "Title,Person_Name,Company,Billing_Company,Property_Name,Check_In,Check_Out,Status,Pending_Confirmation,RoomLookupId,Door_Code,Notes";
const SELECT_ROOM = "Title,Door_Code,Cleaning_Status,DailyRate,PropertyLookupId,Floor,Active,LongTerm_Company,LongTerm_Price,LongTerm_StartDate,LongTerm_EndDate";
const SELECT_PROPERTY_FULL = "Title,FullTenant_Company,DailyRate,SMS_Template,WiFi_SSID,WiFi_Password,Welcome_Message,Floor1_Info,Floor2_Info";
const SELECT_TOKEN = "Title,Token,Pin,Aktiv,Firma,Kontaktperson,Telefon,Epost,Utlopsdato,TillatteLokasjoner,MaksRomPerBestilling,AntallBestillinger,SistBrukt,LastSeen,Sprak";
const SELECT_PERSON = "Title,Person_Name,Name,Mobile,Phone,Telefon";
const SELECT_RATE = "Person_Name,Company,Property,DailyRate,FeeType";

// v3.11.0: Status-klauseler vi gjenbruker. Bookings.Status er Choice-felt —
// $filter på Choice er pålitelig og indeksert i SharePoint-default.
const FILTER_ACTIVE_OR_UPCOMING = "fields/Status eq 'Active' or fields/Status eq 'Upcoming'";
const FILTER_NOT_CANCELLED = "fields/Status ne 'Cancelled'";

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
  // v3.11.0: $select reduserer payload. Vi gjør IKKE $filter på Token-kolonnen
  // — det brakk validate-token i v3.10.32, antagelig fordi Token er Multiline
  // Text (ikke filtrerbar via Graph). JS-side find er billig på ~50 rader.
  const items = await fetchAllItems(env, LIST_IDS.TOKENS, { select: SELECT_TOKEN });

  const match = items.find(item =>
    item.fields.Token === token && item.fields.Aktiv === true
  );

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
  const items = await fetchAllItems(env, LIST_IDS.PIN_ATTEMPTS, {
    select: "Title,FailedCount,LockedUntil,LastAttempt",
  });
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

  // v3.11.9: $filter på Active fjernet — viste seg at filteret gir tom
  // respons (eller mister felt) selv om det «burde» være pålitelig. Det
  // tipper alle dager på Rigg 24/Botnhågen til «Fullt» fordi 0 rom kom
  // tilbake. Reverterer til pre-v3.11.0-oppførsel: hent alle rom og
  // filtrer på Active=true JS-side.
  const items = await fetchAllItems(env, LIST_IDS.ROOMS);

  return items.filter(item => {
    const f = item.fields;
    const matches = String(f.PropertyLookupId) === String(lookupIdForProperty);
    const hasTitle = !!f.Title;
    const isActive = f.Active === true;
    // v3.12.15: ekskluder Kjøkken-rom fra bookable inventory. De er rom-rader
    // i SharePoint for vasker-logging (Cleaning_Status, lock-event-historikk),
    // men skal ikke vises som ledige rom kunder kan bestille i portalen.
    const isKitchen = /^kj(ø|o)kken\b/i.test(String(f.Title || "").trim());
    return matches && hasTitle && isActive && !isKitchen;
  });
}

// Map fra Rooms-rad-id → { title, doorCode, cleaningStatus }. Brukes til å berike
// booking-svar og til auto-checkin (vi trenger Cleaning_Status for å sjekke om
// rommet er klart før vi flipper Upcoming → Active).
export async function getRoomsByIdMap(env) {
  // v3.11.0: $select. Ingen filter — kalleren forventer alle rom (også inactive).
  const items = await fetchAllItems(env, LIST_IDS.ROOMS, { select: SELECT_ROOM });
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
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: SELECT_PROPERTY_FULL });
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
  const items = await fetchAllItems(env, LIST_IDS.RATES, { select: SELECT_RATE });
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
  // v3.11.9: $filter fjernet — reverter til v3.10.25-oppførsel for
  // availability-flyten siden samme klasse bug (filter dropper rader)
  // ramt Rooms-fetchen. Filtrerer på Property_Name + Status JS-side.
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS);
  return items.filter(item => {
    const f = item.fields;
    if (f.Property_Name !== propertyName) return false;
    return f.Status === "Active" || f.Status === "Upcoming";
  });
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
  const refTarget = String(bookingRef || "").trim().toLowerCase();
  const coTarget  = String(companyName || "").trim().toLowerCase();
  if (!refTarget || !coTarget) return null;
  // v3.11.0: $select. Ingen Title-filter — Title kan være Multiline Text-aktig
  // og ble droppet etter validate-token-bruddet i v3.10.32.
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, { select: SELECT_BOOKING });
  for (const item of items) {
    const f = item.fields || {};
    const t = String(f.Title || "").trim().toLowerCase();
    if (t !== refTarget) continue;
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

  // v3.11.0: $select på begge + Status-filter på Bookings (trygt). Romnummer-
  // og firma-matching gjøres på JS-side.
  const [rooms, items] = await Promise.all([
    fetchAllItems(env, LIST_IDS.ROOMS, { select: SELECT_ROOM }),
    fetchAllItems(env, LIST_IDS.BOOKINGS, {
      select: SELECT_BOOKING,
      filter: FILTER_ACTIVE_OR_UPCOMING,
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
    if (f.Status !== "Active" && f.Status !== "Upcoming") return false;
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
  // v3.11.0: $select. Full-skanning beholdes — direkte /items/{id}-GET ble
  // droppet etter v3.10.32-bruddet inntil vi har testet det isolert.
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, { select: SELECT_BOOKING });
  for (const item of items) {
    if (String(item.id) !== idTarget) continue;
    if (!_bookingMatchesCompany(item.fields || {}, coTarget)) return null;
    return item;
  }
  return null;
}

// v3.10.25: Batch-versjon — last Persons-lista én gang og returner et lookup-
// objekt så my-bookings kan slå opp telefon for hver booking uten nye Graph-
// kall. fetchAllItems pagineres (Persons har 300+ rader), så vi unngår N rundturer.
export async function getPersonsLookup(env) {
  // v3.11.0: $select. Persons har 300+ rader, payload-kutt er betydelig.
  const items = await fetchAllItems(env, LIST_IDS.PERSONS, { select: SELECT_PERSON });
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
  const items = await fetchAllItems(env, LIST_IDS.PERSONS, { select: SELECT_PERSON });
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
  const target = String(companyName || "").trim().toLowerCase();
  if (!target) return [];

  // v3.11.0: $select + Status-filter (server-side). Company-matching i JS
  // for å unngå case/whitespace-fallgruver på tekstkolonner.
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING,
    filter: FILTER_ACTIVE_OR_UPCOMING,
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

  // v3.11.0: $select + Status-filter. Hvis kalleren spesifiserer
  // includeStatuses bygger vi tilsvarende OR-klausul; ellers "ne Cancelled".
  let filter;
  if (includeStatuses && includeStatuses.length) {
    const clauses = includeStatuses
      .map(s => `fields/Status eq '${String(s).replace(/'/g, "''")}'`)
      .join(" or ");
    filter = `(${clauses})`;
  } else {
    filter = FILTER_NOT_CANCELLED;
  }

  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS, {
    select: SELECT_BOOKING,
    filter,
    prefer: HONOR_NONINDEXED,
  });

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

// v3.12.13: Norske helligdager + working-day-logikk for Dirty-rom.
// Porter Gauss' påske-algoritme + isNonWorkingDay fra admin-appens utils.js,
// men UTC-trygt (parseDateUTC bruker UTC-midnight, så vi må matche).
const _DAY_MS = 24 * 60 * 60 * 1000;
const _holidayCacheUtc = {};

function _easterSundayUtcMs(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function _norwegianHolidaysUtc(year) {
  if (_holidayCacheUtc[year]) return _holidayCacheUtc[year];
  const set = new Set();
  const easter = _easterSundayUtcMs(year);
  // Bevegelige (relative til 1. påskedag)
  for (const offset of [-3, -2, 0, 1, 39, 49, 50]) set.add(easter + offset * _DAY_MS);
  // Faste
  set.add(Date.UTC(year, 0, 1));   // Nyttårsdag
  set.add(Date.UTC(year, 4, 1));   // Arbeidernes dag
  set.add(Date.UTC(year, 4, 17));  // Grunnlovsdag
  set.add(Date.UTC(year, 11, 25)); // 1. juledag
  set.add(Date.UTC(year, 11, 26)); // 2. juledag
  _holidayCacheUtc[year] = set;
  return set;
}

function _isNonWorkingDayUtc(utcMs) {
  const d = new Date(utcMs);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return true; // søn=0, lør=6
  return _norwegianHolidaysUtc(d.getUTCFullYear()).has(utcMs);
}

// Returnerer ms for første working-day på eller etter utcMs. Max 14 dagers
// lookahead (påsken kan ha 4 påfølgende helligdager + helg).
function _firstWorkingDayUtcMs(utcMs) {
  let t = utcMs;
  for (let i = 0; i < 14; i++) {
    if (!_isNonWorkingDayUtc(t)) return t;
    t += _DAY_MS;
  }
  return t;
}

export async function calculateAvailability(env, propertyName, fromISO, toISO, customerCompany, options) {
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
  // v1.12: spor hvilke rom som er Dirty per i dag — disse skal ikke telles
  // som ledige FOR i dag (kan ikke gjøres klar samme dag). Future-datoer
  // ignorerer Cleaning_Status siden rommet kan vaskes innen den datoen.
  const dirtyRoomIds = new Set();
  const roomLongTerm = rooms.map(r => {
    const ltStart = parseDateUTC(r.fields.LongTerm_StartDate);
    // v1.11: respekter LongTerm_EndDate. Tidligere ble end satt til null
    // uansett, så rom med en gammel/avsluttet long-term-periode ble regnet
    // som permanent opptatt — kalenderen viste «Fullt» selv om rommet i
    // realiteten var ledig (eks: Ulmo AS på Rigg 24/Rigg Botnhågen, der
    // gamle rigg-leieforhold lå igjen med EndDate i fortid).
    const ltEnd = parseDateUTC(r.fields.LongTerm_EndDate);
    const ltCompany = String(r.fields.LongTerm_Company || "").trim().toLowerCase();
    const propMeta = propertyMeta[r.fields.PropertyLookupId] || {};
    const ftCompany = String(propMeta.fullTenantCompany || "").trim().toLowerCase();
    const isOwnLongTerm = !!customerLower && (
      (!!ltCompany && ltCompany === customerLower) ||
      (!!ftCompany && ftCompany === customerLower)
    );
    const id = String(r.id);
    roomTitleById[id] = r.fields.Title || id;
    if (String(r.fields.Cleaning_Status || "").trim() === "Dirty") {
      dirtyRoomIds.add(id);
    }
    return {
      id,
      longTermStart: isOwnLongTerm ? null : ltStart,
      longTermEnd:   isOwnLongTerm ? null : ltEnd,
    };
  });

  // I dag i UTC + første working-day fra i dag. Dirty-rom forblir "opptatt"
  // til og med første working-day (vaskere jobber kun hverdager). Hvis i dag
  // er en hverdag = blokkerer kun i dag (som v3.12.5). Hvis i dag er lør/søn
  // /helligdag = blokkerer alle ikke-arbeidsdager + neste hverdag, så ledig
  // først fra dagen etter at vasker har rukket å vaske.
  const _todayUtc = new Date();
  const todayUtcMs = Date.UTC(_todayUtc.getUTCFullYear(), _todayUtc.getUTCMonth(), _todayUtc.getUTCDate());
  const firstWorkingDayUtcMs = _firstWorkingDayUtcMs(todayUtcMs);

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
    // v3.12.13: Skitne rom telles som opptatt frem til og med første
    // working-day fra i dag. Vaskere jobber kun mandag-fredag (eks helligdager),
    // så en booking laget lørdag/søndag/helligdag kan IKKE forvente at rommet
    // blir vasket før mandag morgen — det vaskes mandag, blir klart for
    // innsjekk tirsdag. Tidligere v1.12-regel ("kun i dag") feilet i helger.
    if (D.getTime() <= firstWorkingDayUtcMs) {
      for (const rid of dirtyRoomIds) {
        if (countableRoomIds.has(rid)) occupiedRoomIds.add(rid);
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
    // v3.12.14: admin-debug — når options.details=true, returner rom-titler
    // for ledige, skitne (per dag-policy), og opptatte rom. Gjør at admin
    // kan verifisere hvilke rom portalen mener er ledige uten å lese kode.
    if (options && options.details === true) {
      const detail = { free: [], dirty: [], booked: [] };
      const sortNumeric = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
      for (const id of countableRoomIds) {
        if (occupiedRoomIds.has(id)) continue;
        detail.free.push(roomTitleById[id] || id);
      }
      // Skitne rom som faktisk blokkerer denne dagen (per working-day-regelen):
      if (D.getTime() <= firstWorkingDayUtcMs) {
        for (const id of dirtyRoomIds) {
          if (countableRoomIds.has(id)) detail.dirty.push(roomTitleById[id] || id);
        }
      }
      for (const b of bookingPeriods) {
        if (!countableRoomIds.has(b.roomId)) continue;
        if (isDateInRangeInclusive(D, b.checkIn, b.checkOut)) {
          detail.booked.push(roomTitleById[b.roomId] || b.roomId);
        }
      }
      detail.free.sort(sortNumeric);
      detail.dirty.sort(sortNumeric);
      detail.booked.sort(sortNumeric);
      dayObj.detail = detail;
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

  // v3.11.0: $select på begge + Status-filter på Bookings.
  // Active-filter på Rooms IKKE her — vi vil inkludere alle rom i ownership-
  // sjekken; "Active eq false" filtreres i JS-kontrollen rett under (samme
  // adferd som før).
  const [propertyMeta, allRooms, allBookings] = await Promise.all([
    getPropertyMetaMap(env),
    fetchAllItems(env, LIST_IDS.ROOMS, { select: SELECT_ROOM }),
    fetchAllItems(env, LIST_IDS.BOOKINGS, {
      select: SELECT_BOOKING,
      filter: FILTER_ACTIVE_OR_UPCOMING,
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
