# Andslimoen offentlig booking — Fase 4c: Redigerbare løsøre-priser (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gjøre løsøre-prislisten redigerbar fra admin (global `Deposit_Prices`-liste) i stedet for hardkodet, lest autoritativt av portalens charge-endepunkt.

**Architecture:** Portal: ny `getDepositPrices(env)` leser `Deposit_Prices`-lista; `sumMissingItems(items, priceMap)` blir rent-med-injisert-prismap; charge-endepunktet henter prisene og sender dem inn. Admin: Portal-booking-fanen får en redigerbar «Løsøre-priser»-seksjon (skriver til `Deposit_Prices`), og charge-dialogen leser live priser.

**Tech Stack:** Portal — Cloudflare Functions (ESM, `node --test`). Admin — vanilla JS + Graph (ingen build/test-rigg).

---

## To repo / working-dirs
- Portal-tasks (C1–C4): `C:/dev/2gmbooking-portal`. Admin-tasks (C5–C7): `C:/dev/2gmbooking`. Fetch + sjekk remote FØR start i begge. Implementører committer lokalt; controller pusher begge til slutt (C7).

## Nå-tilstand (verifisert)
- `functions/_utils/deposit.js` (Fase 4a): eksporterer `PRICE_LIST` (hardkodet 5 priser), `MAX_DEPOSIT=1750`, `sumMissingItems(items)` (slår opp i PRICE_LIST, kapper til MAX_DEPOSIT). `tests/deposit.test.mjs` tester disse.
- `functions/api/charge-missing-items.js` kaller `sumMissingItems(items)`.
- `functions/_utils/sharepoint.js`: `fetchAllItems(env, listId, {select})` (privat), `LIST_IDS`-objekt (~linje 19).
- Admin `js/invoicing.js`: `renderPortalPricing()` (~2564) rendrer rigg-tabell inn i `#portalPricingList`; `updatePublicNightlyRate(propId,val)` → `updateListItem('Properties',...)`; eksponert på `window` (~2616). Global `properties`-array. `_toast(msg)` for kvittering. `getListItems(name)` + `updateListItem(name, id, fields)` finnes globalt.
- Admin `js/deposit_charge.js` (Fase 4b): hardkodet `DEPOSIT_PRICE_LIST`; `openDepositChargeModal` bygger dialogen fra den.
- `Deposit_Prices`-liste opprettet (GUID `2790650c-bbdb-448b-b1e4-548146a229d8`), `Title`(nøkkel)+`Price`(tall), 5 rader.

---

# DEL 1 — PORTAL (`C:/dev/2gmbooking-portal`)

## Task C1: `deposit.js` — injisert pris-map + tester

**Files:** Modify `functions/_utils/deposit.js`, `tests/deposit.test.mjs`

- [ ] **Step 1: Rewrite the test** `tests/deposit.test.mjs`:
```javascript
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
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/deposit.test.mjs` → FAIL (ITEM_KEYS/new signature missing).

- [ ] **Step 3: Rewrite `functions/_utils/deposit.js`:**
```javascript
// functions/_utils/deposit.js
// v2.0 — Ren summering for depositum/manglende utstyr. INGEN I/O.
// Prisene er nå redigerbare og leses fra Deposit_Prices (se getDepositPrices i
// sharepoint.js); de injiseres som priceMap. Beløpet er server-autoritativt.

// De kjente vare-nøklene (brukes til validering/label-referanse i UI).
export const ITEM_KEYS = ["liten_handduk", "stor_handduk", "pute", "dyne", "sengesett"];

// items: string[] av vare-nøkler. priceMap: { <nøkkel>: <pris kr> } (fra SharePoint).
// En vare må ha en POSITIV pris i mappet, ellers avvises den (unknown_item).
// Returnerer { ok:true, amount } eller { ok:false, error, item? }.
export function sumMissingItems(items, priceMap) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "no_items" };
  }
  const map = priceMap || {};
  let amount = 0;
  for (const it of items) {
    const price = map[it];
    if (!(typeof price === "number" && price > 0)) {
      return { ok: false, error: "unknown_item", item: it };
    }
    amount += price;
  }
  return { ok: true, amount };
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/deposit.test.mjs` → PASS (5 tester).

- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add functions/_utils/deposit.js tests/deposit.test.mjs && git commit -m "refactor: sumMissingItems takes an injected price map (editable prices)"`

## Task C2: `getDepositPrices` + LIST_IDS

**Files:** Modify `functions/_utils/sharepoint.js`

- [ ] **Step 1:** I `LIST_IDS`-objektet (~linje 19), legg til en linje:
```javascript
  DEPOSIT_PRICES: "2790650c-bbdb-448b-b1e4-548146a229d8",
```
- [ ] **Step 2:** Legg til en eksportert leser (plasser ved siden av `getPublicConfig`, etter den):
```javascript
// Leser den globale løsøre-prislista (Deposit_Prices) → { <vare-nøkkel>: <pris kr> }.
// Kun rader med positiv pris tas med. Tom/feil => tomt map (fail-closed: charge avvises).
export async function getDepositPrices(env) {
  const items = await fetchAllItems(env, LIST_IDS.DEPOSIT_PRICES, { select: "Title,Price" });
  const map = {};
  for (const it of items) {
    const f = it.fields || {};
    const key = String(f.Title || "").trim();
    const price = Number(f.Price);
    if (key && price > 0) map[key] = price;
  }
  return map;
}
```
- [ ] **Step 3:** Verifiser import: `node -e "import('./functions/_utils/sharepoint.js').then(m=>console.log(typeof m.getDepositPrices))"` → `function`. Full suite grønn.
- [ ] **Step 4: Commit (LOCAL ONLY)** — `git add functions/_utils/sharepoint.js && git commit -m "feat: getDepositPrices reads the global Deposit_Prices list"`

## Task C3: charge-missing-items bruker live priser

**Files:** Modify `functions/api/charge-missing-items.js`

- [ ] **Step 1:** Legg til import: endre `import { sumMissingItems } from "../_utils/deposit.js";` slik at `getDepositPrices` også importeres fra sharepoint.js (legg til i den eksisterende sharepoint-importen eller en ny linje):
```javascript
import { getDepositPrices } from "../_utils/sharepoint.js";
```
- [ ] **Step 2:** Hent prisene og send dem inn. Finn:
```javascript
    const sum = sumMissingItems(items);
    if (!sum.ok) return jsonResponse({ ok: false, error: sum.error, item: sum.item }, 400);
```
Erstatt med:
```javascript
    const priceMap = await getDepositPrices(env);
    const sum = sumMissingItems(items, priceMap);
    if (!sum.ok) return jsonResponse({ ok: false, error: sum.error, item: sum.item }, 400);
```
- [ ] **Step 3:** Verifiser import: `node -e "import('./functions/api/charge-missing-items.js').then(m=>console.log(typeof m.onRequestPost))"` → `function`.
- [ ] **Step 4: Commit (LOCAL ONLY)** — `git add functions/api/charge-missing-items.js && git commit -m "feat: charge-missing-items uses editable Deposit_Prices"`

## Task C4: Vilkårsside → «per gjeldende prisliste»

**Files:** Modify `andslimoen-vilkar.html`

- [ ] **Step 1:** I `andslimoen-vilkar.html`, erstatt den norske depositum-linja (punkt 3) sin prisliste-tekst. Finn setningen som lister «liten håndduk 100 kr, stor håndduk 150 kr, pute 400 kr, dyne 700 kr, sengesett 400 kr — inntil 1750 kr.» og erstatt med: «Manglende eller ødelagt utstyr ved utsjekk belastes per gjeldende prisliste.»
- [ ] **Step 2:** Tilsvarende i den engelske blokken: erstatt «...per price list: small towel NOK 100, ... up to NOK 1750.» med «Missing or damaged items at checkout are charged per the current price list.»
- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add andslimoen-vilkar.html && git commit -m "docs: terms reference current price list (prices now editable)"`

---

# DEL 2 — ADMIN (`C:/dev/2gmbooking`)

## Task C5: Redigerbar «Løsøre-priser»-seksjon i Portal-booking-fanen

**Files:** Modify `js/invoicing.js`, `index.html`

- [ ] **Step 1: Read** `js/invoicing.js` rundt `renderPortalPricing` (~2564) og `window`-eksporten (~2616), og finn `id="portalPricingList"` i `index.html` (Portal-booking-fanens innhold).
- [ ] **Step 2:** I `index.html`, rett etter `<div id="portalPricingList">…</div>` (rigg-tabellen), legg til en container:
```html
<div id="depositPricesSection" style="margin-top:24px"></div>
```
- [ ] **Step 3:** I `js/invoicing.js`, legg til en async render-funksjon + en lagre-funksjon, og kall render fra `renderPortalPricing` (eller fra tab-åpningen). Legg til etter `renderPortalPricing`-funksjonen:
```javascript
const _DEPOSIT_ITEM_ORDER = ['liten_handduk', 'stor_handduk', 'pute', 'dyne', 'sengesett'];
const _DEPOSIT_ITEM_LABELS = { liten_handduk: 'Liten håndduk', stor_handduk: 'Stor håndduk', pute: 'Pute', dyne: 'Dyne', sengesett: 'Sengesett' };

async function renderDepositPrices() {
  const box = document.getElementById('depositPricesSection');
  if (!box) return;
  box.innerHTML = '<div class="muted" style="padding:8px">Laster løsøre-priser…</div>';
  let rows;
  try { rows = await getListItems('Deposit_Prices'); }
  catch (e) { box.innerHTML = '<div class="muted" style="padding:8px">Kunne ikke laste løsøre-priser.</div>'; return; }
  const byKey = {};
  (rows || []).forEach(function (r) { const k = String(r.Title || '').trim(); if (k) byKey[k] = r; });
  box.innerHTML = '<h3 style="margin:0 0 8px;font-size:16px">Løsøre-priser (belastes ved manglende/ødelagt utstyr)</h3>'
    + '<table style="width:100%;font-size:15px;max-width:420px"><tbody>'
    + _DEPOSIT_ITEM_ORDER.map(function (k) {
        const r = byKey[k];
        const price = (r && r.Price != null && r.Price !== '') ? r.Price : '';
        const idAttr = r ? r.id : '';
        const disabled = r ? '' : ' disabled title="Mangler rad i Deposit_Prices"';
        return '<tr style="border-top:.5px solid var(--border-tertiary)">'
          + '<td style="padding:6px 8px">' + _DEPOSIT_ITEM_LABELS[k] + '</td>'
          + '<td style="padding:6px 8px;text-align:right"><input type="number" min="0" step="10" value="' + price + '"' + disabled
          + ' onchange="updateDepositPrice(\'' + idAttr + '\',this.value)" style="width:110px;padding:4px 6px;border:1px solid var(--border-tertiary);border-radius:4px;font-size:15px;text-align:right" placeholder="0"> kr</td>'
          + '</tr>';
      }).join('')
    + '</tbody></table>';
}

async function updateDepositPrice(rowId, val) {
  if (!rowId) return;
  const num = (val === '' || val == null) ? null : Number(val);
  if (num == null || isNaN(num) || num < 0) { alert('Ugyldig pris'); renderDepositPrices(); return; }
  try {
    await updateListItem('Deposit_Prices', rowId, { Price: num });
    if (typeof _toast === 'function') _toast('✓ Løsøre-pris lagret: ' + num + ' kr');
  } catch (e) { console.error('[DepositPrices] lagring feilet:', e); alert('Kunne ikke lagre: ' + (e && e.message || e)); }
}
```
- [ ] **Step 4:** Kall `renderDepositPrices()` når Portal-booking-fanen vises. Inni `renderPortalPricing()`, helt på slutten (etter at `#portalPricingList` er fylt), legg til:
```javascript
  renderDepositPrices();
```
- [ ] **Step 5:** Eksponer globalt. Endre `window`-eksport-linja (~2616) til også å inkludere de nye:
```javascript
if(typeof window!=='undefined'){window.renderPortalPricing=renderPortalPricing;window.updatePublicNightlyRate=updatePublicNightlyRate;window.togglePublicBooking=togglePublicBooking;window.renderDepositPrices=renderDepositPrices;window.updateDepositPrice=updateDepositPrice;}
```
- [ ] **Step 6:** Syntaks: `node --check js/invoicing.js`. Manuell verifisering i C7.
- [ ] **Step 7: Commit (LOCAL ONLY)** — `git add js/invoicing.js index.html && git commit -m "feat: editable Løsøre-priser section in Portal-booking tab"`

## Task C6: Charge-dialogen leser live priser

**Files:** Modify `js/deposit_charge.js`

- [ ] **Step 1: Read** `js/deposit_charge.js`. `openDepositChargeModal` bruker i dag den hardkodede `DEPOSIT_PRICE_LIST`. Endre den til å hente live priser via `getListItems('Deposit_Prices')` før dialogen bygges, og bygge en `prices`-map som `_depSum`/visningen bruker. Behold `DEPOSIT_ITEM_LABELS` (visningsnavn) og `DEPOSIT_PRICE_LIST` som **fallback** hvis henting feiler.
- [ ] **Step 2:** Konkret: gjør `openDepositChargeModal` async, hent prisene først, lagre i en modul-variabel `let _livePrices = null;` og bruk `(_livePrices || DEPOSIT_PRICE_LIST)` i `_depSum` og rad-byggingen. Eksempel-endring i `openDepositChargeModal`:
```javascript
  async function openDepositChargeModal(bookingRef) {
    try {
      const rows = await getListItems('Deposit_Prices');
      const map = {};
      (rows || []).forEach(function (r) { const k = String(r.Title || '').trim(); const p = Number(r.Price); if (k && p > 0) map[k] = p; });
      if (Object.keys(map).length) _livePrices = map;
    } catch (e) { /* fallback til DEPOSIT_PRICE_LIST */ }
    const PRICES = _livePrices || DEPOSIT_PRICE_LIST;
    // ... bygg rows fra PRICES + DEPOSIT_ITEM_LABELS (Object.keys(DEPOSIT_ITEM_LABELS) som rekkefølge)
```
Og `_depSum` bruker `(_livePrices || DEPOSIT_PRICE_LIST)` i stedet for `DEPOSIT_PRICE_LIST`. (Beløpet er server-autoritativt; dette er kun for visning.)
- [ ] **Step 3:** Syntaks: `node --check js/deposit_charge.js`. Manuell verifisering i C7.
- [ ] **Step 4: Commit (LOCAL ONLY)** — `git add js/deposit_charge.js && git commit -m "feat: charge dialog reads live deposit prices"`

## Task C7: Versjonsbump + push + (live-test utsatt)

- [ ] **Step 1 (admin):** Bump versjon `22.19.0 → 22.19.1` i `index.html` (begge forekomster av versjonsstrengen) + `version.txt`. Commit: `git commit -am "v22.19.1 — editable løsøre-priser (Deposit_Prices)"`.
- [ ] **Step 2 (controller pusher begge repo):** full portal-suite `node --test tests/*.test.mjs` → 0 fail; push `2gmbooking-portal` + `2gmbooking`.
- [ ] **Step 3 (utsatt — del av samlet live-test):** I admin → Priser & Kontrakter → Portal-booking: endre en løsøre-pris (f.eks. dyne 700→750) → lagres. Verifiser at charge-dialogen viser ny pris, og at en faktisk charge belaster ny pris (Stripe testmodus). Krever Stripe-oppsett (ditt siste steg).

---

## Self-review-notater (utført ved planskriving)
- **Spec-dekning:** Deposit_Prices-liste (C2 LIST_IDS + getDepositPrices), sumMissingItems(items, priceMap) rent (C1), charge bruker live priser (C3), admin-redigering (C5), dialog leser live (C6), vilkår «per gjeldende prisliste» (C4). Dynamisk «tak» = items ⊆ priceMap (ingen MAX_DEPOSIT-konstant). Alle spec-punkter dekket.
- **Type-konsistens:** `sumMissingItems(items, priceMap)` ny signatur brukt i C1 (test), C3 (endepunkt). `getDepositPrices(env)` → `{key:price}` brukt i C3. Admin nøkler `liten_handduk/stor_handduk/pute/dyne/sengesett` matcher Deposit_Prices `Title` + portalens validering.
- **Bevisst:** `MAX_DEPOSIT` fjernet (taket er naturlig summen av valgte items, som er ⊆ prislista). Admin-dialogen har fallback til hardkodet liste hvis Graph-henting feiler (kun visning; server autoritativ).

## Forutsetninger
- `Deposit_Prices`-lista (GUID over) har `Price`-tallkolonne + 5 rader (liten_handduk 100, stor_handduk 150, pute 400, dyne 700, sengesett 400).
- Live-test krever Stripe-oppsett (utsatt til slutt).
