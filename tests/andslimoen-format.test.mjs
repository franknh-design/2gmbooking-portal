import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidNoPhone,
  isValidEmail,
} from "../assets/js/andslimoen-format.mjs";

test("nightsBetween counts nights (checkout - checkin)", () => {
  assert.equal(nightsBetween("2026-06-16", "2026-06-18"), 2);
  assert.equal(nightsBetween("2026-06-16", "2026-06-17"), 1);
});

test("nightsBetween: same day or reversed -> 0", () => {
  assert.equal(nightsBetween("2026-06-16", "2026-06-16"), 0);
  assert.equal(nightsBetween("2026-06-18", "2026-06-16"), 0);
  assert.equal(nightsBetween("", "2026-06-18"), 0);
  assert.equal(nightsBetween("bad", "2026-06-18"), 0);
});

test("totalPrice = rate * nights", () => {
  assert.equal(totalPrice(650, "2026-06-16", "2026-06-18"), 1300);
  assert.equal(totalPrice(650, "2026-06-16", "2026-06-16"), 0);
});

test("formatKr groups thousands with space, rounds", () => {
  assert.equal(formatKr(650), "650");
  assert.equal(formatKr(1300), "1 300");
  assert.equal(formatKr(12000), "12 000");
  assert.equal(formatKr(1299.6), "1 300");
});

test("minAvailableForStay: min over occupied dates incl. checkout", () => {
  const days = [
    { date: "2026-06-16", available: 5 },
    { date: "2026-06-17", available: 3 },
    { date: "2026-06-18", available: 4 },
  ];
  assert.equal(minAvailableForStay(days, "2026-06-16", "2026-06-18"), 3);
});

test("minAvailableForStay: a missing date counts as 0 (not available)", () => {
  const days = [
    { date: "2026-06-16", available: 5 },
    { date: "2026-06-18", available: 4 },
  ];
  assert.equal(minAvailableForStay(days, "2026-06-16", "2026-06-18"), 0);
});

test("minAvailableForStay: reversed/empty -> 0", () => {
  assert.equal(minAvailableForStay([], "2026-06-18", "2026-06-16"), 0);
  assert.equal(minAvailableForStay([], "", ""), 0);
});

test("isValidNoPhone matches backend rule", () => {
  assert.equal(isValidNoPhone("99112233"), true);
  assert.equal(isValidNoPhone("+47 991 12 233"), true);
  assert.equal(isValidNoPhone("004799112233"), true);
  assert.equal(isValidNoPhone("12345678"), false);
  assert.equal(isValidNoPhone("999"), false);
  assert.equal(isValidNoPhone(""), false);
});

test("isValidEmail basic check", () => {
  assert.equal(isValidEmail("ola@example.no"), true);
  assert.equal(isValidEmail("feil"), false);
  assert.equal(isValidEmail(""), false);
});
