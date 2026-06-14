// functions/_utils/booking-allocation.js
// v1.0 — Ren rom-tildeling. INGEN I/O. Velger et konkret PublicBookable-rom som er
// ledig i hele perioden, deterministisk (laveste rom-id numerisk).

// Inklusiv overlapp mellom [aStart,aEnd] og [bStart,bEnd]. bEnd=null => open-ended.
function periodsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  if (bStartMs == null) return false;
  const aEnd = aEndMs == null ? Infinity : aEndMs;
  const bEnd = bEndMs == null ? Infinity : bEndMs;
  return aStartMs <= bEnd && bStartMs <= aEnd;
}

// rooms: NormalizedRoom[]; bookings: [{ roomId, checkInMs, checkOutMs }] (alle bookinger
// som kan oppta rom — kalleren har allerede filtrert til aktive/upcoming + droppet utløpte hold).
// Returnerer rom-id (string) eller null.
export function pickRoomForPeriod({ rooms, bookings, fromMs, toMs }) {
  const assignedOverlap = new Set();
  for (const b of bookings) {
    const rid = b.roomId == null ? "" : String(b.roomId);
    if (!rid) continue; // ikke-tildelt booking holder ikke et konkret rom
    if (periodsOverlap(fromMs, toMs, b.checkInMs, b.checkOutMs)) {
      assignedOverlap.add(rid);
    }
  }

  const candidates = rooms.filter((r) => {
    if (!r.publicBookable) return false;
    if (periodsOverlap(fromMs, toMs, r.longTermStartMs, r.longTermEndMs)) return false;
    if (assignedOverlap.has(String(r.id))) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
  return String(candidates[0].id);
}
