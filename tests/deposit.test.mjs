import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICE_LIST, MAX_DEPOSIT, sumMissingItems } from "../functions/_utils/deposit.js";

test("price list matches agreed amounts", () => {
  assert.equal(PRICE_LIST.liten_handduk, 100);
  assert.equal(PRICE_LIST.stor_handduk, 150);
  assert.equal(PRICE_LIST.pute, 400);
  assert.equal(PRICE_LIST.dyne, 700);
  assert.equal(PRICE_LIST.sengesett, 400);
  assert.equal(MAX_DEPOSIT, 1750);
});

test("sumMissingItems sums known items", () => {
  assert.deepEqual(sumMissingItems(["liten_handduk"]), { ok: true, amount: 100 });
  assert.deepEqual(sumMissingItems(["dyne", "pute"]), { ok: true, amount: 1100 });
  assert.deepEqual(sumMissingItems(["liten_handduk", "stor_handduk", "pute", "dyne", "sengesett"]), { ok: true, amount: 1750 });
});

test("sumMissingItems rejects empty / unknown / non-array", () => {
  assert.equal(sumMissingItems([]).ok, false);
  assert.equal(sumMissingItems(["banan"]).ok, false);
  assert.equal(sumMissingItems("dyne").ok, false);
  assert.equal(sumMissingItems(null).ok, false);
});

test("sumMissingItems never exceeds MAX_DEPOSIT", () => {
  const r = sumMissingItems(["dyne", "dyne", "dyne"]);
  assert.equal(r.ok, true);
  assert.ok(r.amount <= MAX_DEPOSIT);
});
