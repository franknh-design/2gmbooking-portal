import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidPhone,
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

test("isValidPhone accepts Norwegian and international numbers", () => {
  assert.equal(isValidPhone("99112233"), true);          // norsk 8-siffer
  assert.equal(isValidPhone("+47 991 12 233"), true);    // norsk m/ landkode
  assert.equal(isValidPhone("+46 70 123 45 67"), true);  // svensk
  assert.equal(isValidPhone("+1 (415) 555-0172"), true); // amerikansk
  assert.equal(isValidPhone("+44 20 7946 0958"), true);  // britisk
});

test("isValidPhone rejects too short / non-numeric / empty", () => {
  assert.equal(isValidPhone("999"), false);              // for kort
  assert.equal(isValidPhone("abc"), false);
  assert.equal(isValidPhone(""), false);
  assert.equal(isValidPhone("+1234567890123456"), false); // > 15 siffer
});

test("isValidEmail basic check", () => {
  assert.equal(isValidEmail("ola@example.no"), true);
  assert.equal(isValidEmail("feil"), false);
  assert.equal(isValidEmail(""), false);
});
