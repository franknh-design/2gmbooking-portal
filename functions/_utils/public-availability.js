// functions/_utils/public-availability.js
// v1.0 — Env-bundet wrapper rundt computePublicAvailability. Henter rom og
// bookinger via eksisterende SharePoint-helpere og mapper til den rene
// funksjonens input. Rør IKKE calculateAvailability (bedriftslogikk).

import {
  getPropertyMetaMap,
  getRoomsForProperty,
  getBookingsForProperty,
} from "./sharepoint.js";
import { computePublicAvailability, parseDateUtcMs } from "./availability-math.js";

export async function calculatePublicAvailability(env, propertyName, fromISO, toISO) {
  // Bygg id->title-map (samme oppskrift som calculateAvailability bruker).
  const propertyMeta = await getPropertyMetaMap(env);
  const propertyMap = {};
  for (const [id, m] of Object.entries(propertyMeta)) {
    if (m.title) propertyMap[id] = m.title;
  }

  const [roomItems, bookingItems] = await Promise.all([
    getRoomsForProperty(env, propertyName, propertyMap),
    getBookingsForProperty(env, propertyName),
  ]);

  const rooms = roomItems.map((it) => {
    const f = it.fields || {};
    return {
      id: String(it.id),
      // PublicBookable default = true. Kun eksplisitt No (false) tar rommet
      // ut av privat-poolen. Manglende felt => fortsatt bookbart for privat.
      publicBookable: f.PublicBookable !== false,
      longTermStartMs: parseDateUtcMs(f.LongTerm_StartDate),
      longTermEndMs: parseDateUtcMs(f.LongTerm_EndDate),
    };
  });

  const bookings = bookingItems
    .map((it) => {
      const f = it.fields || {};
      return {
        checkInMs: parseDateUtcMs(f.Check_In),
        checkOutMs: parseDateUtcMs(f.Check_Out),
        isPublic: String(f.Source || "") === "Public",
      };
    })
    .filter((b) => b.checkInMs !== null);

  const { days } = computePublicAvailability({
    rooms,
    bookings,
    fromMs: parseDateUtcMs(fromISO),
    toMs: parseDateUtcMs(toISO),
  });

  return { property: propertyName, days };
}
