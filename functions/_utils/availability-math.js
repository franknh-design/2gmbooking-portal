// functions/_utils/availability-math.js
// v1.0 — Ren tellematematikk for privat-sidens ledighet. INGEN I/O, INGEN env.
// Enhetstestbar med `node --test`. Konservativ: teller alle aktive/upcoming
// booking-rader (tildelt eller ikke) som etterspørsel etter ett rom, fordi
// nye bookinger ligger uten RoomLookupId til admin tildeler manuelt.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Parser 'YYYY-MM-DD' (eller ISO med tid) til UTC-midnatt i ms. null på ugyldig.
export function parseDateUtcMs(input) {
  if (!input) return null;
  const s = String(input).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

// Inklusiv på begge ender. endMs=null => open-ended (opptatt for alltid fra start).
export function isInRangeInclusive(dMs, startMs, endMs) {
  if (startMs == null) return false;
  if (dMs < startMs) return false;
  if (endMs == null) return true;
  return dMs <= endMs;
}

// rooms:    [{ id, publicBookable:bool, longTermStartMs:number|null, longTermEndMs:number|null }]
//           (kalleren har allerede filtrert til Active, ikke-kjøkken, riktig property)
// bookings: [{ checkInMs:number, checkOutMs:number|null, isPrivate:bool }]
//           (kalleren har allerede filtrert til Active/Upcoming på property-en,
//            og droppet rader uten checkIn)
// fromMs/toMs: UTC-midnatt i ms, inklusivt.
// Returnerer { days: [{ date, available, physicalRooms, occupied, privatePoolSize, privateOccupied }] }
export function computePrivateAvailability({ rooms, bookings, fromMs, toMs }) {
  if (fromMs == null || toMs == null) throw new Error("Invalid date range");
  if (toMs < fromMs) throw new Error("toMs before fromMs");

  const days = [];
  for (let t = fromMs; t <= toMs; t += ONE_DAY_MS) {
    let physicalRooms = 0;
    let privatePoolSize = 0;
    for (const r of rooms) {
      if (isInRangeInclusive(t, r.longTermStartMs, r.longTermEndMs)) continue;
      physicalRooms++;
      if (r.publicBookable) privatePoolSize++;
    }

    let occupied = 0;
    let privateOccupied = 0;
    for (const b of bookings) {
      if (!isInRangeInclusive(t, b.checkInMs, b.checkOutMs)) continue;
      occupied++;
      if (b.isPrivate) privateOccupied++;
    }

    const physicalAvailable = Math.max(0, physicalRooms - occupied);
    const publicPoolAvailable = Math.max(0, privatePoolSize - privateOccupied);
    const available = Math.min(physicalAvailable, publicPoolAvailable);

    days.push({
      date: new Date(t).toISOString().slice(0, 10),
      available,
      physicalRooms,
      occupied,
      privatePoolSize,
      privateOccupied,
    });
  }
  return { days };
}
