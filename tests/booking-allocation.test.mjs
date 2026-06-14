import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRoomForPeriod } from "../functions/_utils/booking-allocation.js";

const from = Date.UTC(2026, 5, 20);
const to = Date.UTC(2026, 5, 22);

function room(id, over = {}) {
  return { id, publicBookable: true, longTermStartMs: null, longTermEndMs: null, ...over };
}

test("picks lowest-id free public room", () => {
  const rooms = [room("12"), room("3"), room("7")];
  assert.equal(pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to }), "3");
});

test("skips a room with an overlapping assigned booking", () => {
  const rooms = [room("3"), room("7")];
  const bookings = [{ roomId: "3", checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23) }];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "7");
});

test("ignores unassigned bookings (roomId null/empty) when picking", () => {
  const rooms = [room("3")];
  const bookings = [
    { roomId: "", checkInMs: from, checkOutMs: to },
    { roomId: null, checkInMs: from, checkOutMs: to },
  ];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "3");
});

test("skips non-publicBookable rooms", () => {
  const rooms = [room("3", { publicBookable: false }), room("7")];
  assert.equal(pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to }), "7");
});

test("skips a room on long-term overlapping the period", () => {
  const rooms = [room("3", { longTermStartMs: Date.UTC(2026, 0, 1), longTermEndMs: null }), room("7")];
  assert.equal(pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to }), "7");
});

test("returns null when nothing free", () => {
  const rooms = [room("3")];
  const bookings = [{ roomId: "3", checkInMs: from, checkOutMs: to }];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), null);
});

test("non-overlapping assigned booking does not block", () => {
  const rooms = [room("3")];
  const bookings = [{ roomId: "3", checkInMs: Date.UTC(2026, 5, 1), checkOutMs: Date.UTC(2026, 5, 3) }];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "3");
});
