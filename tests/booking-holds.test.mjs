import { test } from "node:test";
import assert from "node:assert/strict";
import { filterExpiredHolds } from "../functions/_utils/booking-holds.js";
import { HOLD_WINDOW_MS } from "../functions/_utils/booking-state.js";

const T = Date.UTC(2026, 5, 14, 12, 0, 0);

function b(over) {
  return {
    id: "1", source: "Public", status: "Upcoming", paymentStatus: "pending",
    holdExpiryMs: T + HOLD_WINDOW_MS, paidAtMs: null, codesGenerated: false,
    ...over,
  };
}

test("drops expired unpaid public holds", () => {
  const list = [b({ id: "a", holdExpiryMs: T - 1 }), b({ id: "b", holdExpiryMs: T + 1 })];
  assert.deepEqual(filterExpiredHolds(list, T).map((x) => x.id), ["b"]);
});

test("keeps paid holds even past hold window", () => {
  const list = [b({ id: "a", paymentStatus: "paid", holdExpiryMs: T - 1000 })];
  assert.equal(filterExpiredHolds(list, T).length, 1);
});

test("keeps non-public bookings regardless of expiry", () => {
  const list = [b({ id: "a", source: "Portal", holdExpiryMs: T - 1000 })];
  assert.equal(filterExpiredHolds(list, T).length, 1);
});

test("empty list returns empty", () => {
  assert.deepEqual(filterExpiredHolds([], T), []);
});
