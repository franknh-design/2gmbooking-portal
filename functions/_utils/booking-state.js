// functions/_utils/booking-state.js
// v1.0 — Rene tilstandsfunksjoner for privat-bookingens livssyklus. INGEN I/O.
// confirmed <=> paymentStatus==='paid' && codesGenerated.
// Overgangsfunksjonene returnerer en felt-PATCH (rent objekt) — de skriver ingenting.

export const HOLD_WINDOW_MS = 15 * 60 * 1000;
export const CODE_WINDOW_MS = 30 * 60 * 1000;

// Et ubetalt offentlig hold som har passert holdvinduet.
export function isHoldExpired(b, nowMs) {
  return (
    b.source === "Private" &&
    b.status !== "Cancelled" &&
    b.paymentStatus === "pending" &&
    b.holdExpiryMs != null &&
    b.holdExpiryMs < nowMs
  );
}

// En betalt booking som mangler koder og har passert kodevinduet (-> auto-refund).
export function isCodeWindowExpired(b, nowMs) {
  return (
    b.source === "Private" &&
    b.status !== "Cancelled" &&
    b.paymentStatus === "paid" &&
    !b.codesGenerated &&
    b.paidAtMs != null &&
    b.paidAtMs + CODE_WINDOW_MS < nowMs
  );
}

export function onPaid(nowMs) {
  return { paymentStatus: "paid", paidAtMs: nowMs };
}

export function onCodesOk(roomCode) {
  return { codesGenerated: true, roomCode };
}

export function onCodesFailedFinal() {
  return { paymentStatus: "refunded", status: "Cancelled" };
}

export function onCancelled() {
  return { status: "Cancelled" };
}
