import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, fmt, pickLang } from "../assets/js/private-i18n.mjs";

test("nb and en have exactly the same keys (no missing translations)", () => {
  const nb = Object.keys(STRINGS.nb).sort();
  const en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(nb, en);
});

test("no string value is empty", () => {
  for (const lang of ["nb", "en"]) {
    for (const [k, v] of Object.entries(STRINGS[lang])) {
      assert.ok(typeof v === "string" && v.length > 0, `${lang}.${k} is empty`);
    }
  }
});

test("fmt fills placeholders", () => {
  assert.equal(fmt("{n} rom ledige", { n: 3 }), "3 rom ledige");
  assert.equal(fmt("Reserve — {p} kr", { p: 1300 }), "Reserve — 1300 kr");
  assert.equal(fmt("{p} kr for {n} {unit}", { p: 1300, n: 2, unit: "netter" }), "1300 kr for 2 netter");
});

test("fmt: missing var -> empty, no crash", () => {
  assert.equal(fmt("hei {x}", {}), "hei ");
  assert.equal(fmt("", { x: 1 }), "");
});

test("pickLang: stored choice wins", () => {
  assert.equal(pickLang("en", "nb-NO"), "en");
  assert.equal(pickLang("nb", "en-US"), "nb");
});

test("pickLang: Norwegian browser -> nb, otherwise en (fallback English)", () => {
  assert.equal(pickLang(null, "nb-NO"), "nb");
  assert.equal(pickLang(null, "no"), "nb");
  assert.equal(pickLang(null, "nn-NO"), "nb");
  assert.equal(pickLang(null, "en-US"), "en");
  assert.equal(pickLang(null, "de-DE"), "en");
  assert.equal(pickLang(null, ""), "en");
  assert.equal(pickLang(undefined, undefined), "en");
});
