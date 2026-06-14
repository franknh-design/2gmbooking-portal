// functions/_utils/booking-orchestrator.js
// v1.0 — Orkestrerer privat-bookingflyten over injiserte avhengigheter
// (deps = { store, payment, lock, now, generateRef, propertyName, nightlyRate }).
// All telling/tilstandslogikk ligger i de rene modulene; dette laget wirer dem
// til store + providere + klokke.

import { parseDateUtcMs } from "./availability-math.js";
import { pickRoomForPeriod } from "./booking-allocation.js";
import { filterExpiredHolds } from "./booking-holds.js";
import {
  HOLD_WINDOW_MS,
  isHoldExpired,
  isCodeWindowExpired,
  onPaid,
  onCodesOk,
  onCodesFailedFinal,
  onCancelled,
} from "./booking-state.js";

function nightsBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) return 0;
  const n = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
  return n > 0 ? n : 0;
}

// Oppretter et hold: rydder utløpte hold, velger rom, oppretter pending-rad,
// starter betaling. Returnerer { ok, bookingRef, paymentRef } eller { ok:false, error }.
export async function createHold(deps, { fromISO, toISO, guest }) {
  const now = deps.now();
  const fromMs = parseDateUtcMs(fromISO);
  const toMs = parseDateUtcMs(toISO);
  if (fromMs == null || toMs == null || toMs < fromMs) {
    return { ok: false, error: "invalid_dates" };
  }

  const [rooms, allBookings] = await Promise.all([deps.store.getRooms(), deps.store.getBookings()]);

  for (const b of allBookings) {
    if (isHoldExpired(b, now)) await deps.store.update(b.id, onCancelled());
  }
  const active = filterExpiredHolds(allBookings, now);

  const roomId = pickRoomForPeriod({ rooms, bookings: active, fromMs, toMs });
  if (roomId == null) return { ok: false, error: "sold_out" };

  const bookingRef = deps.generateRef();
  const holdExpiryMs = now + HOLD_WINDOW_MS;
  const created = await deps.store.createHold({
    bookingRef, roomId, checkInISO: fromISO, checkOutISO: toISO, guest, holdExpiryMs,
  });

  const amount = nightsBetween(fromMs, toMs) * (deps.nightlyRate || 0);
  const pay = await deps.payment.initiate({ bookingRef, amount });
  await deps.store.update(created.id, { paymentRef: pay.paymentRef });

  return { ok: true, bookingRef, paymentRef: pay.paymentRef };
}

async function findByRef(deps, bookingRef) {
  const all = await deps.store.getBookings();
  return all.find((b) => b.bookingRef === bookingRef) || null;
}

// Markerer betaling som mottatt og forsøker straks å generere koder.
export async function confirmPayment(deps, bookingRef) {
  const b = await findByRef(deps, bookingRef);
  if (!b) return { ok: false, error: "not_found" };
  if (b.status === "Cancelled") return { ok: false, error: "cancelled" };
  if (b.paymentStatus !== "paid") {
    await deps.store.update(b.id, onPaid(deps.now()));
  }
  return tryGenerateCodes(deps, bookingRef);
}

// Forsøker kode-generering for en betalt booking. Ved feil lar den raden stå
// (paid, uten koder) for senere retry. Idempotent: noop hvis allerede generert.
export async function tryGenerateCodes(deps, bookingRef) {
  const b = await findByRef(deps, bookingRef);
  if (!b) return { ok: false, error: "not_found" };
  if (b.status === "Cancelled") return { ok: false, error: "cancelled" };
  if (b.paymentStatus !== "paid") return { ok: false, error: "not_paid" };
  if (b.codesGenerated) return { ok: true, alreadyDone: true };
  try {
    const codes = await deps.lock.generateGuestCodes({ booking: b });
    await deps.store.update(b.id, onCodesOk(codes.roomCode));
    return { ok: true };
  } catch (_e) {
    return { ok: false, error: "code_generation_failed" };
  }
}

// Kanseller utløpte ubetalte hold (opprydding). Returnerer antall frigjort.
export async function releaseExpiredHolds(deps) {
  const now = deps.now();
  const all = await deps.store.getBookings();
  let n = 0;
  for (const b of all) {
    if (isHoldExpired(b, now)) {
      await deps.store.update(b.id, onCancelled());
      n++;
    }
  }
  return n;
}

// Refunder + kanseller betalte bookinger som har passert kodevinduet uten koder.
// Returnerer antall behandlet.
export async function expireCodeWindows(deps) {
  const now = deps.now();
  const all = await deps.store.getBookings();
  let n = 0;
  for (const b of all) {
    if (isCodeWindowExpired(b, now)) {
      if (b.paymentRef) await deps.payment.refund({ paymentRef: b.paymentRef });
      await deps.store.update(b.id, onCodesFailedFinal());
      n++;
    }
  }
  return n;
}
