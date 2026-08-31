import { test } from "node:test";
import assert from "node:assert/strict";
import { maxGuestRoomMatching } from "../functions/_utils/availability-math.js";

test("tom input gir 0", () => {
  assert.equal(maxGuestRoomMatching([]).matched, 0);
  assert.equal(maxGuestRoomMatching(null).matched, 0);
});

test("gjest uten ledige rom hele perioden kan ikke plasseres", () => {
  // Botnhågen-tilfellet: kalenderen viser ledige rom hver dag, men ingen ett
  // rom dekker hele oppholdet → snittet er tomt.
  assert.equal(maxGuestRoomMatching([[]]).matched, 0);
});

test("én gjest, ett rom", () => {
  assert.equal(maxGuestRoomMatching([["805"]]).matched, 1);
});

test("to gjester kan ikke dele samme eneste rom", () => {
  const r = maxGuestRoomMatching([["805"], ["805"]]);
  assert.equal(r.matched, 1);
});

test("grådig ville feilet her — augmenting path finner begge", () => {
  // A har bare 805. B har 805 og 708. Grådig gir A→805, så B→708 = 2.
  // Motsatt rekkefølge: B→805 først, så må B flyttes til 708 for at A får 805.
  const r = maxGuestRoomMatching([["805", "708"], ["805"]]);
  assert.equal(r.matched, 2);
});

test("kjede som krever flere omplasseringer", () => {
  const r = maxGuestRoomMatching([
    ["r1", "r2", "r3"],
    ["r1", "r2"],
    ["r1"],
  ]);
  assert.equal(r.matched, 3);
});

test("assignment peker rom til gjest, og hvert rom brukes én gang", () => {
  const r = maxGuestRoomMatching([["a", "b"], ["a"], ["c"]]);
  assert.equal(r.matched, 3);
  assert.equal(new Set(r.assignment.values()).size, 3);
  assert.equal(r.assignment.size, 3);
});

test("flere gjester enn rom", () => {
  const r = maxGuestRoomMatching([["a"], ["a"], ["a"], ["a"]]);
  assert.equal(r.matched, 1);
});
