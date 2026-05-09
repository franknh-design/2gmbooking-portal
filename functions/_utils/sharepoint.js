// functions/_utils/sharepoint.js
// v1.3 - SharePoint operations via Microsoft Graph
// Endringer fra v1.2:
//   - Property er en LOOKUP: bruker PropertyLookupId i Rooms, og henter
//     Properties-listen dynamisk for å bygge ID -> navn-mapping
//   - Filtrerer bort "tomme" Rooms-rader (uten Title)
//   - LongTerm: SharePoint har ikke LongTerm_EndDate - antar open-ended
//   - Property_Name i Booking er fortsatt tekst (ikke lookup)

import { graphRequest } from "./graph.js";

// ----------------------------------------------------------------------------
// SharePoint site og liste-IDer (UUID-er - permanente, robuste)
// ----------------------------------------------------------------------------

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";

const LIST_IDS = {
  TOKENS:     "73f113fe-76b0-48b2-9105-243a45166420", // Customer_Tokens
  ROOMS:      "bfa962a0-5eb2-416c-abe8-adba06558c11", // Rooms
  BOOKINGS:   "fe1dfe34-23df-4864-b0b1-b01bf60bfb75", // Booking (entall)
  PROPERTIES: "d842d574-f238-442a-be3d-77334727e89f", // "Eiendommer..."
};

// ----------------------------------------------------------------------------
// Property-mapping: teknisk ID (i Customer_Tokens.TillatteLokasjoner og frontend)
// til displaynavn slik det står i SharePoint Properties.Title
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
// Properties (Eiendommer-listen)
// ============================================================================

/**
 * Henter alle properties og bygger en mapping:
 *   { 1: "Rigg 44", 2: "Rigg 24", 3: "Rigg Botnhågen", ... }
 *
 * Brukes til å oversette Rooms.PropertyLookupId til menneskelig navn.
 */
async function getPropertyLookupMap(env) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.PROPERTIES}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  const map = {};
  for (const item of (data.value || [])) {
    // SharePoint-rader har 'id' øverst og 'Title' i fields
    const lookupId = item.id;
    const title = item.fields?.Title;
    if (lookupId && title) {
      map[lookupId] = title;
    }
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
    if (expiry < new Date()) {
      return null;
    }
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

/**
 * Henter alle aktive rom for en property (via PropertyLookupId).
 * Filtrerer bort "tomme" rader (uten Title) som finnes i listen.
 */
export async function getRoomsForProperty(env, propertyName, propertyLookupMap) {
  // Finn lookupId som tilsvarer dette property-navnet
  const lookupIdForProperty = Object.entries(propertyLookupMap)
    .find(([id, name]) => name === propertyName)?.[0];

  if (!lookupIdForProperty) {
    return []; // Ukjent property - returner tom liste
  }

  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.ROOMS}/items?expand=fields&$top=999`;
  const data = await graphRequest(env, path);

  return data.value.filter(item => {
    const f = item.fields;
    // PropertyLookupId kommer som streng ("1", "2", ...) i Graph API
    const matches = String(f.PropertyLookupId) === String(lookupIdForProperty);
    const hasTitle = !!f.Title;        // filtrerer bort tomme rader
    const isActive = f.Active === true;
    return matches && hasTitle && isActive;
  });
}

// ============================================================================
// Booking (entall i SharePoint!)
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

// ============================================================================
// Tilgjengelighet
// ============================================================================

function parseDateUTC(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * D er i [start, end] inklusive. end=null betyr open-ended (alltid true for D >= start).
 */
function isDateInRangeInclusive(D, start, end) {
  if (!start) return false;
  if (D < start) return false;
  if (!end) return true;
  return D <= end;
}

/**
 * Beregner tilgjengelighet for én property over en datoperiode.
 *
 * Regelsett:
 *   - Rom telles kun hvis Active=true og har Title (filtrer bort tomme rader)
 *   - Rom på langtidsleie (LongTerm_StartDate <= D, alltid open-ended siden
 *     LongTerm_EndDate-felt ikke eksisterer i Rooms-listen) trekkes fra totalen
 *   - Bookinger med Status in {Active, Upcoming} og Check_In <= D <= Check_Out
 *     teller som opptatt. Manglende Check_Out = open-ended -> opptatt for alltid.
 *
 * Inklusive ender per 2GMs forretningsregel:
 *   "Check_Out-dagen er rengjøringsdag, rommet er fortsatt opptatt".
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

  // Hent property-mapping FØRST, så bruker vi den i parallel rom/booking-spørring
  const propertyMap = await getPropertyLookupMap(env);

  const [rooms, bookings] = await Promise.all([
    getRoomsForProperty(env, propertyName, propertyMap),
    getBookingsForProperty(env, propertyName),
  ]);

  // Pre-parse longterm-perioder per rom. LongTerm_EndDate finnes ikke,
  // så vi behandler alle som open-ended (-> rommet utilgjengelig fra start).
  const roomLongTerm = rooms.map(r => ({
    id: r.id,
    title: r.fields.Title,
    longTermStart: parseDateUTC(r.fields.LongTerm_StartDate),
    longTermEnd:   null, // open-ended - feltet finnes ikke
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

  return {
    property: propertyName,
    days,
  };
}
  
