// functions/_utils/sharepoint.js
// v1.4 - SharePoint operations via Microsoft Graph
// Endringer fra v1.3:
//   - Lagt til createBookingRows() for å opprette bookinger i Booking-listen
//   - Lagt til generateBookingRef() for unik referanse-generering

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

export function propertyIdToName(id) {
  return PROPERTY_MAP[String(id || "").toLowerCase()] || null;
}

// ============================================================================
// Properties (Eiendommer-listen)
// ============================================================================

async function getPropertyLookupMap(env) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.PROPERTIES}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const map = {};
  for (const item of (data.value || [])) {
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
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.TOKENS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const match = data.value.find(item =>
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

  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.ROOMS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  return data.value.filter(item => {
    const f = item.fields;
    const matches = String(f.PropertyLookupId) === String(lookupIdForProperty);
    const hasTitle = !!f.Title;
    const isActive = f.Active === true;
    return matches && hasTitle && isActive;
  });
}

// ============================================================================
// Booking
// ============================================================================

export async function getBookingsForProperty(env, propertyName) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const ACTIVE_STATUSES = new Set(["Active", "Upcoming"]);

  return data.value.filter(item => {
    const f = item.fields;
    return f.Property_Name === propertyName
      && ACTIVE_STATUSES.has(f.Status);
  });
}

/**
 * Genererer en unik booking-referanse i format "2GM-AB12CD".
 * Kollisjon er praktisk talt umulig (36^6 = 2.2 milliarder kombinasjoner).
 */
export function generateBookingRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // utelater forvirrende I, O, 0, 1
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `2GM-${suffix}`;
}

/**
 * Oppretter én rad i Booking-listen.
 *
 * Felt som settes:
 *   - Title (Booking_Ref) - felles referanse for hele bestillingen
 *   - Property_Name - tekst (matcher våre tilgjengelighetssjekker)
 *   - Person_Name, Company - hvem som kommer
 *   - Check_In, Check_Out (kan være null = open-ended)
 *   - Status = "Upcoming"
 *   - Pending_Confirmation = true (signaliserer "venter på Frank")
 *   - Notes - referanse + kapasitetsadvarsel hvis aktuelt
 *   - Room - IKKE satt (du tildeler manuelt)
 */
export async function createBookingRow(env, fields) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items`;

  const sharepointFields = {
    Title: fields.bookingRef,
    Property_Name: fields.propertyName,
    Person_Name: fields.guestName,
    Company: fields.companyName,
    Check_In: fields.checkIn,            // ISO string eller null
    Check_Out: fields.checkOut || null,  // null = open-ended
    Status: "Upcoming",
    Pending_Confirmation: true,
    Notes: fields.notes || "",
  };

  // Fjern null/undefined-verdier slik at SharePoint bruker default
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

/**
 * Oppretter flere booking-rader i parallell og returnerer resultatene.
 */
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

/**
 * Hjelpefunksjon: gitt et booking-payload, identifiser hvilke datoer
 * som har for få ledige rom for det antallet bestillingen krever.
 *
 * Brukes til å flagge kapasitetskonflikt i Notes ved innsending.
 */
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
