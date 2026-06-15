import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEM_KEYS, sumMissingItems } from "../functions/_utils/deposit.js";

const PM = { liten_handduk: 100, stor_handduk: 150, pute: 400, dyne: 700, sengesett: 400 };

test("ITEM_KEYS lists the five known items", () => {
  assert.deepEqual([...ITEM_KEYS].sort(), ["dyne", "liten_handduk", "pute", "sengesett", "stor_handduk"]);
});

test("sumMissingItems sums using the injected price map", () => {
  assert.deepEqual(sumMissingItems(["liten_handduk"], PM), { ok: true, amount: 100 });
  assert.deepEqual(sumMissingItems(["dyne", "pute"], PM), { ok: true, amount: 1100 });
});

test("sumMissingItems rejects empty / non-array", () => {
  assert.equal(sumMissingItems([], PM).ok, false);
  assert.equal(sumMissingItems("dyne", PM).ok, false);
  assert.equal(sumMissingItems(null, PM).ok, false);
});

test("sumMissingItems rejects item missing from the price map", () => {
  assert.equal(sumMissingItems(["banan"], PM).ok, false);
  assert.equal(sumMissingItems(["dyne"], {}).ok, false);
});

test("sumMissingItems rejects a zero/negative price (treated as unknown)", () => {
  assert.equal(sumMissingItems(["dyne"], { dyne: 0 }).ok, false);
  assert.equal(sumMissingItems(["dyne"], { dyne: -5 }).ok, false);
});
