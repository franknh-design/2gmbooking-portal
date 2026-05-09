// functions/_utils/sharepoint.js
// v1.1 - SharePoint operations via Microsoft Graph
// Endringer fra v1.0:
//   - Lagt til PROPERTY_MAP og hjelpere for tilgjengelighetssjekk
//   - Lagt til getRooms() og getBookings() for property-spesifikke spørringer
//   - Lagt til calculateAvailability() med fullt regelsett (se README/kommentar nedenfor)

import { graphRequest } from "./graph.js";

// ----------------------------------------------------------------------------
// SharePoint site og liste-IDer
// ----------------------------------------------------------------------------

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";

const LISTS = {
  TOKENS:   "Customer_Tokens",
  ROOMS:    "Rooms",
  BOOKINGS: "Bookings",
};

// ----------------------------------------------------------------------------
// Property-mapping: teknisk ID (i Customer_Tokens.TillatteLokasjoner og frontend)
// til displaynavn (slik det står i SharePoint Bookings.Property_Name og
// Rooms.Property).
// ----------------------------------------------------------------------------

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
// Customer_Tokens
// ============================================================================

/**
 * Slår opp en token i Customer_Tokens-listen.
 * Returnerer raden hvis funnet og aktiv, ellers null.
 */
export async function findToken(env, token) {
  const path = `/sites/${SITE_ID}/lists/${LISTS.TOKENS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const match = data.value.find(item =>
    item.fields.Token === token && item.fields.Aktiv === true
  );

  if (!match) return null;

  if (match.fields.Utlopsdato) {
    const expiry = new Date(match.fields.Utlopsdato);
    if (expiry < new Date()) {
      return null; // Utløpt
    }
  }

  return { id: match.id, fields: match.fields };
}

/**
 * Oppdaterer SistBrukt og inkrementerer AntallBestillinger.
 */
export async function logTokenUsage(env, itemId, currentCount) {
  const path = `/sites/${SITE_ID}/lists/${LISTS.TOKENS}/items/${itemId}/fields`;

  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({
      SistBrukt: new Date().toISOString(),
      AntallBestillinger: (currentCount || 0) + 1,
    }),
  });
}

/**
 * Maskerer telefonnummer for visning. +4791234567 -> +47 ••• •• 567
 */
export function maskPhone(phone) {
  if (!phone || phone.length < 4) return "";
  const last3 = phone.slice(-3);
  return `+47 ••• •• ${last3}`;
}

// ============================================================================
// Rooms
// ============================================================================

/**
 * Henter alle aktive rom for en property.
 * Returnerer rå rader fra SharePoint - kalleren parser fields.
 */
export async function getRoomsForProperty(env, propertyName) {
  // Vi henter alle rom og filtrerer i kode for å unngå
  // SharePoint Graph filter-begrensninger på custom-kolonner.
  const path = `/sites/${SITE_ID}/lists/${LISTS.ROOMS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  return data.value.filter(item => {
    const f = item.fields;
    // SharePoint lookup-felt (Property) leveres som Property og PropertyLookupId.
    // Vi bruker tekst-verdien, da vi sammenligner mot menneskelig navn.
    const property = f.Property || f.Property0 || "";
    const isActive = f.Active === true;
    return property === propertyName && isActive;
  });
}

// ============================================================================
// Bookings
// ============================================================================

/**
 * Henter alle bookinger for en property med Status Active eller Upcoming.
 * Returnerer rå rader.
 */
export async function getBookingsForProperty(env, propertyName) {
  const path = `/sites/${SITE_ID}/lists/${LISTS.BOOKINGS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const ACTIVE_STATUSES = new Set(["Active", "Upcoming"]);

  return data.value.filter(item => {
    const f = item.fields;
    return f.Property_Name === propertyName
      && ACTIVE_STATUSES.has(f.Status);
  });
}

// ============================================================================
// Tilgjengelighet
// ============================================================================

/**
 * Hjelpefunksjon: parser ISO-dato til Date på UTC midnatt.
 * Bruker UTC for å unngå tidssoneglidning når vi sammenligner dager.
 */
function parseDateUTC(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Sjekker om en gitt dag D ligger innenfor [start, end], hvor end kan være
 * null/undefined (open-ended -> alltid TRUE for D >= start).
 *
 * Begge ender INKLUSIVE - matcher 2GMs forretningsregel:
 *   "Check_Out-dagen er rengjøringsdag, rommet er fortsatt opptatt".
 */
function isDateInRangeInclusive(D, start, end) {
  if (!start) return false;
  if (D < start) return false;
  if (!end) return true;        // open-ended
  return D <= end;
}

/**
 * Beregner tilgjengelighet for én property over en datoperiode.
 *
 * Input:
 *   propertyName: "Rigg 24" (display-navn slik det står i SharePoint)
 *   fromDate, toDate: ISO-strenger, inklusive endepunkter
 *
 * Output:
 *   {
 *     property: "Rigg 24",
 *     totalActiveRooms: 8,
 *     days: [
 *       { date: "2026-05-01", available: 7, occupied: 1 },
 *       ...
 *     ]
 *   }
 *
 * Regelsett:
 *   - Rom telles kun hvis Active=true
 *   - Rom på langtidsleie (LongTerm_StartDate <= D <= LongTerm_EndDate, end open-ended)
 *     trekkes fra både total og opptatt (de er ute av portalen for perioden)
 *   - Bookinger med Status in {Active, Upcoming} og Check_In <= D <= Check_Out
 *     teller som opptatt. Manglende Check_Out = open-ended -> opptatt for alltid.
 */
export async function calculateAvailability(env, propertyName, fromISO, toISO) {
  const fromDate = parseDateUTC(fromISO);
  const toDate   = parseDateUTC(toISO);

  if (!fromDate || !toDate) {
    throw new Error("Invalid date range");
  }
  if (toDate < fromDate) {
    throw new Error("toDate before fromDate");
  }

  // Hent rom og bookinger parallelt for ytelse
  const [rooms, bookings] = await Promise.all([
    getRoomsForProperty(env, propertyName),
    getBookingsForProperty(env, propertyName),
  ]);

  // Pre-parse longterm-perioder per rom
  const roomLongTerm = rooms.map(r => ({
    id: r.id,
    longTermStart: parseDateUTC(r.fields.LongTerm_StartDate),
    longTermEnd:   parseDateUTC(r.fields.LongTerm_EndDate),
  }));

  // Pre-parse booking-perioder
  const bookingPeriods = bookings.map(b => ({
    checkIn:  parseDateUTC(b.fields.Check_In),
    checkOut: parseDateUTC(b.fields.Check_Out),  // kan være null = open-ended
  })).filter(b => b.checkIn !== null);

  // Iterer over hver dag i perioden
  const days = [];
  const oneDay = 24 * 60 * 60 * 1000;

  for (let t = fromDate.getTime(); t <= toDate.getTime(); t += oneDay) {
    const D = new Date(t);

    // Hvor mange rom er fysisk i drift OG ikke på langtidsleie denne dagen?
    let activeRoomsToday = 0;
    for (const r of roomLongTerm) {
      const onLongTerm = isDateInRangeInclusive(D, r.longTermStart, r.longTermEnd);
      if (!onLongTerm) activeRoomsToday++;
    }

    // Hvor mange bookinger overlapper denne dagen?
    let occupiedToday = 0;
    for (const b of bookingPeriods) {
      if (isDateInRangeInclusive(D, b.checkIn, b.checkOut)) {
        occupiedToday++;
      }
    }

    // Sikkerhetsnett mot rare data: hvis bookinger > rom (kan skje hvis et
    // langtidsleid rom også har en feilregistrert booking), klipp til 0.
    const available = Math.max(0, activeRoomsToday - occupiedToday);

    days.push({
      date: D.toISOString().slice(0, 10),
      available,
      occupied: occupiedToday,
      totalActive: activeRoomsToday,
    });
  }

  return {
    property: propertyName,
    days,
  };
}
