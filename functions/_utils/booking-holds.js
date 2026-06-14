// functions/_utils/booking-holds.js
// v1.0 — Ren hjelpe-funksjon: fjern utløpte ubetalte offentlige hold fra en
// booking-liste. Brukes av ledighetsberegningen og av hold-opprettelsen så et
// abandonert hold ikke blokkerer nye gjester. INGEN I/O.

import { isHoldExpired } from "./booking-state.js";

export function filterExpiredHolds(bookings, nowMs) {
  return bookings.filter((b) => !isHoldExpired(b, nowMs));
}
