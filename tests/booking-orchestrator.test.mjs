import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHold,
  confirmPayment,
  tryGenerateCodes,
  releaseExpiredHolds,
  expireCodeWindows,
} from "../functions/_utils/booking-orchestrator.js";
import { HOLD_WINDOW_MS, CODE_WINDOW_MS } from "../functions/_utils/booking-state.js";

const FROM = "2026-06-20";
const TO = "2026-06-22";
const T0 = Date.UTC(2026, 5, 14, 12, 0, 0);

function makeStore(rooms) {
  const bookings = [];
  let seq = 0;
  return {
    _bookings: bookings,
    async getRooms() { return rooms.map((r) => ({ ...r })); },
    async getBookings() { return bookings.map((b) => ({ ...b })); },
    async createHold({ bookingRef, roomId, checkInISO, checkOutISO, guest, holdExpiryMs, paymentRef }) {
      const id = String(++seq);
      bookings.push({
        id, bookingRef, roomId,
        checkInMs: Date.UTC(2026, 5, 20), checkOutMs: Date.UTC(2026, 5, 22),
        status: "Upcoming", paymentStatus: "pending",
        holdExpiryMs, paidAtMs: null, codesGenerated: false, source: "Public",
        paymentRef: paymentRef || null, guest,
      });
      return { id, bookingRef };
    },
    async update(id, patch) {
      const b = bookings.find((x) => x.id === id);
      Object.assign(b, patch);
    },
  };
}

function room(id, over = {}) {
  return { id, publicBookable: true, longTermStartMs: null, longTermEndMs: null, ...over };
}

function makeDeps(store, { lockFails = false, clock } = {}) {
  let refSeq = 0;
  return {
    store,
    now: clock || (() => T0),
    generateRef: () => `2GM-TEST${++refSeq}`,
    payment: {
      initiate: async ({ bookingRef }) => ({ paymentRef: `PAY-${bookingRef}`, status: "pending" }),
      refund: async () => {},
    },
    lock: {
      generateGuestCodes: async () => {
        if (lockFails) throw new Error("lock down");
        return { entranceCode: "1000", roomCode: "2000" };
      },
    },
    propertyName: "Rigg Andslimoen",
    nightlyRate: 650,
  };
}

test("createHold: assigns room, creates pending hold, returns refs", async () => {
  const store = makeStore([room("3"), room("7")]);
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  assert.equal(res.ok, true);
  assert.match(res.bookingRef, /^2GM-TEST/);
  assert.equal(res.paymentRef, `PAY-${res.bookingRef}`);
  assert.equal(store._bookings.length, 1);
  const b = store._bookings[0];
  assert.equal(b.roomId, "3");
  assert.equal(b.status, "Upcoming");
  assert.equal(b.paymentStatus, "pending");
  assert.equal(b.holdExpiryMs, T0 + HOLD_WINDOW_MS);
});

test("createHold: sold_out when no room free", async () => {
  const store = makeStore([room("3")]);
  store._bookings.push({
    id: "x", bookingRef: "2GM-OLD", roomId: "3",
    checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23),
    status: "Upcoming", paymentStatus: "paid", holdExpiryMs: null, paidAtMs: T0,
    codesGenerated: true, source: "Public",
  });
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Kari", phone: "99112233" } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "sold_out");
  assert.equal(store._bookings.length, 1);
});

test("createHold: an expired unpaid hold frees the room", async () => {
  const store = makeStore([room("3")]);
  store._bookings.push({
    id: "x", bookingRef: "2GM-OLD", roomId: "3",
    checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23),
    status: "Upcoming", paymentStatus: "pending", holdExpiryMs: T0 - 1, paidAtMs: null,
    codesGenerated: false, source: "Public",
  });
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Per", phone: "99112233" } });
  assert.equal(res.ok, true);
  assert.equal(res.bookingRef.startsWith("2GM-TEST"), true);
  assert.equal(store._bookings.find((b) => b.id === "x").status, "Cancelled");
});

test("happy path: confirmPayment -> codes ok -> confirmed", async () => {
  const store = makeStore([room("3")]);
  const deps = makeDeps(store);
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef);
  const b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "paid");
  assert.equal(b.paidAtMs, T0);
  assert.equal(b.codesGenerated, true);
  assert.equal(b.roomCode, "2000");
  assert.equal(b.status, "Upcoming");
});

test("code failure leaves booking paid+pending-codes for retry, then succeeds", async () => {
  const store = makeStore([room("3")]);
  const deps = makeDeps(store, { lockFails: true });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef);
  let b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "paid");
  assert.equal(b.codesGenerated, false);
  deps.lock.generateGuestCodes = async () => ({ entranceCode: "1000", roomCode: "2000" });
  await tryGenerateCodes(deps, bookingRef);
  b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.codesGenerated, true);
});

test("expireCodeWindows refunds + cancels a paid booking stuck without codes", async () => {
  const store = makeStore([room("3")]);
  let nowMs = T0;
  const deps = makeDeps(store, { lockFails: true, clock: () => nowMs });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef);
  nowMs = T0 + CODE_WINDOW_MS + 1;
  const n = await expireCodeWindows(deps);
  assert.equal(n, 1);
  const b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "refunded");
  assert.equal(b.status, "Cancelled");
});

test("releaseExpiredHolds cancels expired unpaid holds", async () => {
  const store = makeStore([room("3")]);
  let nowMs = T0;
  const deps = makeDeps(store, { clock: () => nowMs });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  nowMs = T0 + HOLD_WINDOW_MS + 1;
  const n = await releaseExpiredHolds(deps);
  assert.equal(n, 1);
  assert.equal(store._bookings.find((x) => x.bookingRef === bookingRef).status, "Cancelled");
});
