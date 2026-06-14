import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDateUtcMs,
  isInRangeInclusive,
  computePublicAvailability,
} from "../functions/_utils/availability-math.js";

const DAY = 24 * 60 * 60 * 1000;

test("parseDateUtcMs parses YYYY-MM-DD to UTC midnight ms", () => {
  assert.equal(parseDateUtcMs("2026-06-13"), Date.UTC(2026, 5, 13));
  assert.equal(parseDateUtcMs("2026-06-13T09:30:00Z"), Date.UTC(2026, 5, 13));
});

test("parseDateUtcMs returns null on bad input", () => {
  assert.equal(parseDateUtcMs(""), null);
  assert.equal(parseDateUtcMs(null), null);
  assert.equal(parseDateUtcMs("ikke-en-dato"), null);
});

test("isInRangeInclusive: inclusive both ends, open-ended end", () => {
  const start = Date.UTC(2026, 5, 10);
  const end = Date.UTC(2026, 5, 12);
  assert.equal(isInRangeInclusive(start, start, end), true);
  assert.equal(isInRangeInclusive(end, start, end), true);
  assert.equal(isInRangeInclusive(start - DAY, start, end), false);
  assert.equal(isInRangeInclusive(end + DAY, start, end), false);
  assert.equal(isInRangeInclusive(end + 100 * DAY, start, null), true);
});

test("all rooms public, no bookings -> full availability", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "2", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "3", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings: [],
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days.length, 1);
  assert.equal(days[0].available, 3);
  assert.equal(days[0].physicalRooms, 3);
  assert.equal(days[0].publicPoolSize, 3);
});

test("unassigned corporate booking reduces public availability (conservative)", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "2", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
  ];
  const bookings = [
    { checkInMs: Date.UTC(2026, 5, 13), checkOutMs: Date.UTC(2026, 5, 13), isPublic: false },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings,
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days[0].occupied, 1);
  assert.equal(days[0].available, 1);
});

test("PublicBookable=false shrinks the public pool but not physical capacity", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "2", publicBookable: false, longTermStartMs: null, longTermEndMs: null },
    { id: "3", publicBookable: false, longTermStartMs: null, longTermEndMs: null },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings: [],
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days[0].physicalRooms, 3);
  assert.equal(days[0].publicPoolSize, 1);
  assert.equal(days[0].available, 1);
});

test("public booking consumes both physical and public pool", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "2", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
  ];
  const bookings = [
    { checkInMs: Date.UTC(2026, 5, 13), checkOutMs: Date.UTC(2026, 5, 14), isPublic: true },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings,
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days[0].occupied, 1);
  assert.equal(days[0].publicOccupied, 1);
  assert.equal(days[0].available, 1);
});

test("physical capacity is the binding constraint via min()", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
    { id: "2", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
  ];
  const bookings = [
    { checkInMs: Date.UTC(2026, 5, 13), checkOutMs: Date.UTC(2026, 5, 13), isPublic: false },
    { checkInMs: Date.UTC(2026, 5, 13), checkOutMs: Date.UTC(2026, 5, 13), isPublic: false },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings,
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days[0].available, 0);
});

test("long-term room is excluded from countable rooms on covered days", () => {
  const rooms = [
    { id: "1", publicBookable: true, longTermStartMs: Date.UTC(2026, 0, 1), longTermEndMs: null },
    { id: "2", publicBookable: true, longTermStartMs: null, longTermEndMs: null },
  ];
  const { days } = computePublicAvailability({
    rooms, bookings: [],
    fromMs: Date.UTC(2026, 5, 13), toMs: Date.UTC(2026, 5, 13),
  });
  assert.equal(days[0].physicalRooms, 1);
  assert.equal(days[0].publicPoolSize, 1);
  assert.equal(days[0].available, 1);
});

test("rejects reversed date range", () => {
  assert.throws(() => computePublicAvailability({
    rooms: [], bookings: [],
    fromMs: Date.UTC(2026, 5, 14), toMs: Date.UTC(2026, 5, 13),
  }), /toMs before fromMs/);
});
