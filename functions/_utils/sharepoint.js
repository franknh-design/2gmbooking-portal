// functions/_utils/sharepoint.js
// v1.5 - SharePoint operations via Microsoft Graph
// Endringer fra v1.4:
//   - Lagt til fetchAllItems() som håndterer @odata.nextLink-paginering
//   - Alle list-spørringer går nå gjennom fetchAllItems
//   - Default page size 999 (Graph API maks)

import { graphRequest } from "./graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";

const LIST_IDS = {
  TOKENS:     "73f113fe-76b0-48b2-9105-243a45166420",
  ROOMS:      "bfa962a0-5eb2-416c-abe8-adba06558c11",
  BOOKINGS:   "fe1dfe34-23df-4864-b0b1-b01bf60bfb75",
  PROPERTIES: "d842d574-f238-442a-be3d-77334727e89f",
};

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
 * MÅ vi følge nextLink. Booking-listen har 656 rader og vil vokse,
 * så uten paginering ville vi savne data uten feilmelding.
 */
async function fetchAllItems(env, listId, query = "$expand=fields&$top=999") {
  const MAX_PAGES = 50; // 50 * 999 = 49 950 rader. Mer enn nok.
  const startPath = `/sites/${SITE_ID}/lists/${listId}/items?${query}`;

  const allItems = [];
  let nextUrl = null;
  let pages = 0;

  do {
    const data = nextUrl
      ? await graphRequest(env, nextUrl)         // absolutt URL fra nextLink
      : await graphRequest(env, startPath);      // relativ sti første gang

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

// ============================================================================
// Properties (Eiendommer-listen)
// ============================================================================

async function getPropertyLookupMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES);

  const map = {};
  for (const item of items) {
    const lookupId = item.id;
    const title = item.fields?.Title;
    if (lookupId && title) map[lookupId] = title;
  }
  return map;
}

// ============================================================================
// Customer_Tokens
// ============================================================================

export async function findToken(env, token) {
  const items = await fetchAllItems(env, LIST_IDS.TOKENS);

  const match = items.find(item =>
    item.fields.Token === token && item.fields.Aktiv === true
  );

  if (!match) return null;

  if (match.fields.Utlopsdato) {
    const expiry = new Date(match.fields.Utlopsdato);
    if (expiry < new Date()) return null;
  }

  return { id: match.id, fields: match.fields };
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

export function maskPhone(phone) {
  if (!phone || phone.length < 4) return "";
  const last3 = phone.slice(-3);
  return `+47 ••• •• ${last3}`;
}

// ============================================================================
// Rooms
// ============================================================================

export async function getRoomsForProperty(env, propertyName, propertyLookupMap) {
  const lookupIdForProperty = Object.entries(propertyLookupMap)
    .find(([id, name]) => name === propertyName)?.[0];

  if (!lookupIdForProperty) return [];

  const items = await fetchAllItems(env, LIST_IDS.ROOMS);

  return items.filter(item => {
    const f = item.fields;
    const matches = String(f.PropertyLookupId) === String(lookupIdForProperty);
    const hasTitle = !!f.Title;
    const isActive = f.Active === true;
    return matches && hasTitle && isActive;
  });
}

// Map fra Rooms-rad-id → { title, doorCode, cleaningStatus }. Brukes til å berike
// booking-svar og til auto-checkin (vi trenger Cleaning_Status for å sjekke om
// rommet er klart før vi flipper Upcoming → Active).
export async function getRoomsByIdMap(env) {
  const items = await fetchAllItems(env, LIST_IDS.ROOMS);
  const map = {};
  for (const item of items) {
    if (!item.id) continue;
    const f = item.fields || {};
    map[String(item.id)] = {
      title: f.Title || null,
      doorCode: f.Door_Code || null,
      cleaningStatus: f.Cleaning_Status || null,
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
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS);

  const ACTIVE_STATUSES = new Set(["Active", "Upcoming"]);

  return items.filter(item => {
    const f = item.fields;
    return f.Property_Name === propertyName
      && ACTIVE_STATUSES.has(f.Status);
  });
}

export async function getBookingsForCompany(env, companyName) {
  const items = await fetchAllItems(env, LIST_IDS.BOOKINGS);

  const ACTIVE_STATUSES = new Set(["Active", "Upcoming"]);
  const target = String(companyName || "").trim().toLowerCase();
  if (!target) return [];

  return items.filter(item => {
    const f = item.fields;
    const company = String(f.Company || "").trim().toLowerCase();
    return company === target && ACTIVE_STATUSES.has(f.Status);
  });
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

export async function calculateAvailability(env, propertyName, fromISO, toISO) {
  const fromDate = parseDateUTC(fromISO);
  const toDate   = parseDateUTC(toISO);

  if (!fromDate || !toDate) throw new Error("Invalid date range");
  if (toDate < fromDate)    throw new Error("toDate before fromDate");

  const propertyMap = await getPropertyLookupMap(env);

  const [rooms, bookings] = await Promise.all([
    getRoomsForProperty(env, propertyName, propertyMap),
    getBookingsForProperty(env, propertyName),
  ]);

  const roomLongTerm = rooms.map(r => ({
    id: r.id,
    longTermStart: parseDateUTC(r.fields.LongTerm_StartDate),
    longTermEnd:   null,
  }));

  const bookingPeriods = bookings.map(b => ({
    checkIn:  parseDateUTC(b.fields.Check_In),
    checkOut: parseDateUTC(b.fields.Check_Out),
  })).filter(b => b.checkIn !== null);

  const days = [];
  const oneDay = 24 * 60 * 60 * 1000;

  for (let t = fromDate.getTime(); t <= toDate.getTime(); t += oneDay) {
    const D = new Date(t);

    let activeRoomsToday = 0;
    for (const r of roomLongTerm) {
      const onLongTerm = isDateInRangeInclusive(D, r.longTermStart, r.longTermEnd);
      if (!onLongTerm) activeRoomsToday++;
    }

    let occupiedToday = 0;
    for (const b of bookingPeriods) {
      if (isDateInRangeInclusive(D, b.checkIn, b.checkOut)) {
        occupiedToday++;
      }
    }

    const available = Math.max(0, activeRoomsToday - occupiedToday);

    days.push({
      date: D.toISOString().slice(0, 10),
      available,
      occupied: occupiedToday,
      totalActive: activeRoomsToday,
    });
  }

  return { property: propertyName, days };
}

export async function checkCapacityConflict(env, propertyName, fromISO, toISO, roomCount) {
  const result = await calculateAvailability(env, propertyName, fromISO, toISO);

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
