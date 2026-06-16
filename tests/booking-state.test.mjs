import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_WINDOW_MS,
  CODE_WINDOW_MS,
  isHoldExpired,
  isCodeWindowExpired,
  onPaid,
  onCodesOk,
  onCodesFailedFinal,
  onCancelled,
} from "../functions/_utils/booking-state.js";

const T = Date.UTC(2026, 5, 14, 12, 0, 0);

function holdBooking(over = {}) {
  return {
    id: "1", bookingRef: "2GM-AAAAAA", roomId: "10",
    checkInMs: Date.UTC(2026, 5, 20), checkOutMs: Date.UTC(2026, 5, 22),
    status: "Upcoming", paymentStatus: "pending",
    holdExpiryMs: T + HOLD_WINDOW_MS, paidAtMs: null,
    codesGenerated: false, source: "Private",
    ...over,
  };
}

test("constants are 15 and 30 minutes", () => {
  assert.equal(HOLD_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(CODE_WINDOW_MS, 30 * 60 * 1000);
});

test("isHoldExpired: unpaid public hold past expiry -> true", () => {
  assert.equal(isHoldExpired(holdBooking({ holdExpiryMs: T - 1 }), T), true);
});

test("isHoldExpired: not yet past expiry -> false", () => {
  assert.equal(isHoldExpired(holdBooking({ holdExpiryMs: T + 1 }), T), false);
});

test("isHoldExpired: paid hold never expires on hold window", () => {
  assert.equal(isHoldExpired(holdBooking({ paymentStatus: "paid", holdExpiryMs: T - 1000 }), T), false);
});

test("isHoldExpired: cancelled never expires", () => {
  assert.equal(isHoldExpired(holdBooking({ status: "Cancelled", holdExpiryMs: T - 1000 }), T), false);
});

test("isHoldExpired: non-public ignored", () => {
  assert.equal(isHoldExpired(holdBooking({ source: "Portal", holdExpiryMs: T - 1000 }), T), false);
});

test("isCodeWindowExpired: paid, no codes, past window -> true", () => {
  assert.equal(isCodeWindowExpired(holdBooking({ paymentStatus: "paid", paidAtMs: T - CODE_WINDOW_MS - 1, codesGenerated: false }), T), true);
});

test("isCodeWindowExpired: within window -> false", () => {
  assert.equal(isCodeWindowExpired(holdBooking({ paymentStatus: "paid", paidAtMs: T - 1000, codesGenerated: false }), T), false);
});

test("isCodeWindowExpired: codes already generated -> false", () => {
  assert.equal(isCodeWindowExpired(holdBooking({ paymentStatus: "paid", paidAtMs: T - CODE_WINDOW_MS - 1, codesGenerated: true }), T), false);
});

test("isCodeWindowExpired: unpaid -> false", () => {
  assert.equal(isCodeWindowExpired(holdBooking({ paymentStatus: "pending", paidAtMs: null }), T), false);
});

test("onPaid patch sets paid + paidAt", () => {
  assert.deepEqual(onPaid(T), { paymentStatus: "paid", paidAtMs: T });
});

test("onCodesOk patch marks codesGenerated + roomCode", () => {
  assert.deepEqual(onCodesOk("4711"), { codesGenerated: true, roomCode: "4711" });
});

test("onCodesFailedFinal patch refunds + cancels", () => {
  assert.deepEqual(onCodesFailedFinal(), { paymentStatus: "refunded", status: "Cancelled" });
});

test("onCancelled patch cancels", () => {
  assert.deepEqual(onCancelled(), { status: "Cancelled" });
});
