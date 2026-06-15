# Andslimoen offentlig booking — Fase 4b: Admin (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gi admin et «belast manglende utstyr»-grep for privat-bookinger, og skille firma/privat-gjester i gjestelista (privat lagt inn automatisk ved bekreftet booking).

**Architecture:** To repo. PORTAL (`2gmbooking-portal`): eksponer gjest-navn/telefon i store, skriv `GuestType` i `upsertPersonForBooking`, og kall den fra Stripe-webhooken ved bekreftet privat booking. ADMIN (`2gmbooking`, vanilla JS + MSAL + Graph, ingen build): en selvstendig `deposit_charge.js` (localStorage-hemmelighet + fetch til portalens `/api/charge-missing-items`), en «belast»-knapp i booking-detalj-panelet for privat-bookinger, og et `Alle/Firma/Privat`-filter i gjestelista.

**Tech Stack:** Portal — Cloudflare Functions (ESM, `node --test`). Admin — vanilla JS (ingen build/test-rigg, manuelt/live), Microsoft Graph, hand-bygde modaler.

---

## VIKTIG — to repo, to working-directories

Hver task sier hvilket repo den er i. Implementøren `cd`-er til riktig repo, committer der, og pusher IKKE (controller pusher hvert repo til slutt). **Fetch + sjekk remote FØR start i BEGGE repo** (Frank pusher fra jobb).

- Portal-tasks (P1–P3): `C:/dev/2gmbooking-portal`
- Admin-tasks (A1–A4): `C:/dev/2gmbooking`

## Forutsetninger (nå-tilstand, verifisert)

- Portal: `booking-store.js` `getBookings()` returnerer ikke gjest-navn/telefon enda. `upsertPersonForBooking(env, {name, phone, email, company})` ([sharepoint.js:783](../../../functions/_utils/sharepoint.js)) oppretter Person `{Title, Mobile, Email, Company}`; `SELECT_PERSON` = `Title,Person_Name,Name,Mobile,Phone,Telefon,Email,Company`. `stripe-webhook.js` kaller IKKE upsert i dag.
- Admin: booking-objektet i detalj-panelet har alle SP-felt (ufiltrert lesing) — `Source`, `StripeCustomerId`, `DepositChargedAt`, `DepositChargeAmount` er tilgjengelige siden Frank har opprettet kolonnene. `PORTAL_BASE_URL = 'https://2gmbooking-portal.pages.dev'` finnes i `js/portal_access.js:15` (global). Persons leses ufiltrert → `GuestType` kommer automatisk med. Detalj-panel: `showDetail()` i `js/render.js`, knapper bygges i `aBtns`-arrayet (~render.js:1511). Gjeste-liste: `renderPersons()` i `js/persons.js:101`, global `allPersons`, fritekst-søk `personsSearch`, list bygges ~persons.js:192 (merk `_virtual`-rader uten egne felt). Modal-mønster: `div.modal-overlay > div.modal` + `.classList.add('open')` + `_registerModalCloseHandler` (se `tuya.js:653`). SharePoint: `Persons.GuestType` (Valg Firma/Privat) opprettet av Frank.

---

# DEL 1 — PORTAL (`C:/dev/2gmbooking-portal`)

## Task P1: Eksponer gjest-navn/telefon i store

**Files:** Modify `functions/_utils/booking-store.js` (getBookings-mappingen)

- [ ] **Step 1:** I `getBookings()`, i objektet som returneres per booking, etter `paymentRef: f.PaymentRef || null,` legg til:
```javascript
          guestName: f.Person_Name || null,
          guestPhone: f.Mobile || null,
```
- [ ] **Step 2:** Verifiser: `node -e "import('./functions/_utils/booking-store.js').then(m=>console.log(typeof m.createSharePointStore))"` → `function`. `node --test tests/*.test.mjs` → 0 fail.
- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/_utils/booking-store.js && git commit -m "feat: expose guestName/guestPhone in booking store"`

## Task P2: upsertPersonForBooking skriver GuestType

**Files:** Modify `functions/_utils/sharepoint.js`

- [ ] **Step 1:** Utvid `SELECT_PERSON` til å inkludere `GuestType` (så vi kan se om eksisterende rad mangler den). Finn `const SELECT_PERSON = "Title,Person_Name,Name,Mobile,Phone,Telefon,Email,Company";` og endre til:
```javascript
const SELECT_PERSON = "Title,Person_Name,Name,Mobile,Phone,Telefon,Email,Company,GuestType";
```
- [ ] **Step 2:** Endre `upsertPersonForBooking`-signaturen og skriv `GuestType`. Finn `export async function upsertPersonForBooking(env, { name, phone, email, company }) {` → endre til `{ name, phone, email, company, guestType }`. I **eksisterende-match**-grenen (der `patch` bygges), etter `if (email && !curEmail) patch.Email = email;` legg til:
```javascript
      const curType = String(f.GuestType || "").trim();
      if (guestType && !curType) patch.GuestType = guestType;
```
I **ny-person**-grenen (der `fields` bygges), etter `if (company) fields.Company = company;` legg til:
```javascript
  if (guestType) fields.GuestType = guestType;
```
- [ ] **Step 3:** Verifiser import: `node -e "import('./functions/_utils/sharepoint.js').then(m=>console.log(typeof m.upsertPersonForBooking))"` → `function`. Full suite grønn.
- [ ] **Step 4:** Bekreft additivt (ingen eksisterende linjer fjernet utover de tre redigerte): `git diff -- functions/_utils/sharepoint.js`.
- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add functions/_utils/sharepoint.js && git commit -m "feat: upsertPersonForBooking writes GuestType (fills only when empty)"`

## Task P3: Webhook legger privat-gjest i Persons ved bekreftelse

**Files:** Modify `functions/api/stripe-webhook.js`

- [ ] **Step 1:** Legg til import øverst (ved siden av de andre `../_utils/`-importene):
```javascript
import { upsertPersonForBooking } from "../_utils/sharepoint.js";
```
- [ ] **Step 2:** I bekreftelses-e-post-blokken (der `fresh` allerede hentes), legg til en best-effort Persons-upsert. Finn blokken som starter `try { const fresh = (await store.getBookings())...` og legg til, INNI samme try (eller en egen try rett etter), FØR/ETTER e-posten:
```javascript
    // Legg privat-gjesten i gjestelista (Persons) — kun ved bekreftet booking,
    // tom Company = privat, GuestType=Privat. Best-effort (bryter aldri webhooken).
    try {
      const g = (await store.getBookings()).find((b) => b.bookingRef === bookingRef);
      if (g && g.guestName) {
        await upsertPersonForBooking(env, {
          name: g.guestName,
          phone: g.guestPhone || null,
          email: g.guestEmail || null,
          company: "",
          guestType: "Privat",
        });
      }
    } catch (e) { console.error("[webhook] Persons-upsert feilet (ignorert):", e); }
```
(Krever P1 — `getBookings()` eksponerer nå `guestName`/`guestPhone`. Det er greit at dette gjør ett ekstra `getBookings()`-kall; webhooken er lav-frekvent og fail-soft.)
- [ ] **Step 3:** Verifiser import: `node -e "import('./functions/api/stripe-webhook.js').then(m=>console.log(typeof m.onRequestPost))"` → `function`.
- [ ] **Step 4: Commit (LOCAL ONLY)** — `git add functions/api/stripe-webhook.js && git commit -m "feat: webhook upserts confirmed private guest into Persons (GuestType=Privat)"`

---

# DEL 2 — ADMIN (`C:/dev/2gmbooking`)

> Admin-appen har ingen test-rigg. Disse tasks er implement + manuell/live-verifisering. Følg admin-CLAUDE.md sine konvensjoner (engelsk UI-tekst der appen ellers er engelsk; norsk her er OK siden gjest-vendt tekst i resten av Andslimoen er norsk — men kontroll-labels kan være korte). Bump versjon til slutt (Task A4).

## Task A1: `deposit_charge.js` — hemmelighet + API-kall

**Files:** Create `js/deposit_charge.js`; Modify `index.html` (script-include)

- [ ] **Step 1:** Create `js/deposit_charge.js`:
```javascript
// js/deposit_charge.js — v1.0
// Belast manglende/ødelagt utstyr på en privat-booking via portalens
// off-session-endepunkt. Hemmeligheten (ADMIN_CHARGE_SECRET) limes inn én gang
// og lagres i localStorage (aldri i committet kode). Beløp bestemmes server-side
// av portalens prisliste; her er prislisten KUN for visning av løpende sum.
(function () {
  'use strict';

  // MÅ matche nøklene i portalens functions/_utils/deposit.js (PRICE_LIST).
  const DEPOSIT_PRICE_LIST = { liten_handduk: 100, stor_handduk: 150, pute: 400, dyne: 700, sengesett: 400 };
  const DEPOSIT_ITEM_LABELS = { liten_handduk: 'Liten håndduk', stor_handduk: 'Stor håndduk', pute: 'Pute', dyne: 'Dyne', sengesett: 'Sengesett' };
  const PORTAL_BASE = (typeof PORTAL_BASE_URL !== 'undefined') ? PORTAL_BASE_URL : 'https://2gmbooking-portal.pages.dev';
  const SECRET_KEY = 'admin_charge_secret';

  function getChargeSecret() {
    let s = localStorage.getItem(SECRET_KEY);
    if (!s) {
      s = (window.prompt('Lim inn ADMIN_CHARGE_SECRET (lagres lokalt i denne nettleseren):', '') || '').trim();
      if (s) localStorage.setItem(SECRET_KEY, s);
    }
    return s;
  }

  async function chargeMissingItems(bookingRef, items) {
    const secret = getChargeSecret();
    if (!secret) return { ok: false, error: 'no_secret' };
    let res, data;
    try {
      res = await fetch(PORTAL_BASE + '/api/charge-missing-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({ bookingRef: bookingRef, items: items }),
      });
      data = await res.json().catch(function () { return {}; });
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    if (res.status === 401) { localStorage.removeItem(SECRET_KEY); return { ok: false, error: 'unauthorized' }; }
    return data;
  }

  window.Deposit = { PRICE_LIST: DEPOSIT_PRICE_LIST, ITEM_LABELS: DEPOSIT_ITEM_LABELS, charge: chargeMissingItems, getSecret: getChargeSecret };
})();
```
- [ ] **Step 2:** I `index.html`, legg til `<script src="js/deposit_charge.js"></script>` blant de andre `js/*.js`-inkluderingene (samme sted som f.eks. `js/tuya.js` lastes). Plasser etter `portal_access.js` så `PORTAL_BASE_URL` er definert.
- [ ] **Step 3:** Verifiser i nettleser-konsoll (etter deploy/lokalt): `typeof window.Deposit.charge === 'function'`.
- [ ] **Step 4: Commit (LOCAL ONLY)** — `git add js/deposit_charge.js index.html && git commit -m "feat: deposit_charge.js — charge missing items via portal endpoint"`

## Task A2: «Belast manglende utstyr»-knapp + dialog i detalj-panelet

**Files:** Modify `js/render.js` (legg til knapp i `aBtns` + en modal-funksjon)

- [ ] **Step 1: Read `js/render.js`** rundt `showDetail()` booked-grenen (~1253) og `aBtns`-bygging (~1511) for å se eksakt hvordan knapper legges til og hvilken variabel som holder booking-objektet (her kalt `b`).
- [ ] **Step 2:** I `aBtns`-byggingen (booked-grenen), legg til en betinget knapp KUN for privat med lagret kort. Bruk samme knapp-stil som de andre `aBtns`-knappene (kopier klasser fra en eksisterende). Legg til:
```javascript
    if (String(b.Source || '') === 'Public' && b.StripeCustomerId) {
      const charged = b.DepositChargedAt
        ? ' (belastet ' + (Number(b.DepositChargeAmount) || 0) + ' kr)'
        : '';
      aBtns.push('<button class="btn-secondary" onclick="openDepositChargeModal(\'' + String(b.Title || '').replace(/'/g, "\\'") + '\')">Belast manglende utstyr' + charged + '</button>');
    }
```
(Tilpass `class="btn-secondary"` til den faktiske knapp-klassen som brukes av nabo-knappene i `aBtns`.)
- [ ] **Step 3:** Legg til modal-funksjonen `openDepositChargeModal(bookingRef)` (global, på samme nivå som andre `window`-eksponerte funksjoner i render.js, f.eks. nær andre `function open...`). Den bygger en modal med avkrysning per prislinje, viser løpende sum, og kaller `window.Deposit.charge`:
```javascript
function openDepositChargeModal(bookingRef) {
  const PL = window.Deposit.PRICE_LIST, LB = window.Deposit.ITEM_LABELS;
  let modal = document.getElementById('depositChargeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'depositChargeModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }
  const rows = Object.keys(PL).map(function (k) {
    return '<label style="display:flex;justify-content:space-between;padding:6px 0">'
      + '<span><input type="checkbox" class="dep-item" value="' + k + '" onchange="_depSum()"> ' + LB[k] + '</span>'
      + '<span>' + PL[k] + ' kr</span></label>';
  }).join('');
  modal.innerHTML = '<div class="modal" style="max-width:420px">'
    + '<div class="modal-header"><h2>Belast manglende utstyr</h2><button onclick="document.getElementById(\'depositChargeModal\').classList.remove(\'open\')">✕</button></div>'
    + '<div class="modal-body">'
    + '<p style="color:#666;font-size:13px">Booking ' + bookingRef + '. Kortet belastes for det du huker av (server-pris).</p>'
    + rows
    + '<p style="font-weight:600;margin-top:8px">Sum: <span id="depSum">0</span> kr</p>'
    + '<p id="depMsg" style="font-size:13px"></p>'
    + '<button id="depChargeBtn" class="btn-primary" style="width:100%;margin-top:8px" onclick="_depCharge(\'' + bookingRef + '\')">Belast</button>'
    + '</div></div>';
  if (typeof _registerModalCloseHandler === 'function') {
    _registerModalCloseHandler('depositChargeModal', function () { modal.classList.remove('open'); });
  }
  modal.classList.add('open');
  _depSum();
}

function _depSelectedItems() {
  return Array.prototype.slice.call(document.querySelectorAll('#depositChargeModal .dep-item:checked')).map(function (c) { return c.value; });
}
function _depSum() {
  const PL = window.Deposit.PRICE_LIST;
  const sum = _depSelectedItems().reduce(function (a, k) { return a + (PL[k] || 0); }, 0);
  const el = document.getElementById('depSum'); if (el) el.textContent = sum;
}
async function _depCharge(bookingRef) {
  const items = _depSelectedItems();
  const msg = document.getElementById('depMsg');
  const btn = document.getElementById('depChargeBtn');
  if (!items.length) { msg.textContent = 'Velg minst én ting.'; return; }
  btn.disabled = true; msg.textContent = 'Belaster…';
  const r = await window.Deposit.charge(bookingRef, items);
  if (r && r.ok) {
    msg.textContent = 'Belastet ' + r.amount + ' kr. Last siden på nytt for å se oppdatert status.';
  } else {
    const map = { unauthorized: 'Feil hemmelighet — prøv igjen.', no_saved_card: 'Ingen lagret kort på bookingen.', not_found: 'Fant ikke bookingen.', no_secret: 'Avbrutt — ingen hemmelighet.', network: 'Nettverksfeil — prøv igjen.' };
    msg.textContent = (r && (map[r.error] || r.error)) || 'Noe gikk galt.';
    btn.disabled = false;
  }
}
```
Eksponer de globale funksjonene slik render.js ellers gjør (de er global-scope `function`-deklarasjoner, kalt via inline `onclick` — ingen ekstra eksport nødvendig i denne appen).
- [ ] **Step 4:** Manuell verifisering noteres for Task A4 (live). Syntaks-sjekk: `node --check js/render.js` (ren parsing, ingen DOM).
- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add js/render.js && git commit -m "feat: charge-missing-items button + dialog on private booking detail"`

## Task A3: `Alle/Firma/Privat`-filter i gjestelista

**Files:** Modify `js/persons.js`

- [ ] **Step 1: Read `js/persons.js`** rundt `renderPersons()` (~101) og list-byggingen (~192). Finn `personsSearch`-elementet (søkefeltet) i markup/render for å plassere filteret ved siden av det.
- [ ] **Step 2:** Legg til et filter-`<select>` ved søkefeltet. Hvis søkefeltet rendres i JS, legg `<select id="personsTypeFilter" onchange="renderPersons()"><option value="">Alle</option><option value="Firma">Firma</option><option value="Privat">Privat</option></select>` rett ved `personsSearch`. Hvis det er statisk i `index.html`, legg det der i samme container.
- [ ] **Step 3:** I `renderPersons()`, etter at fritekst-`q` leses, les filteret og filtrer lista. Etter linja som leser `q`:
```javascript
  const typeFilter = (document.getElementById('personsTypeFilter') || {}).value || '';
```
Og i filtreringen av `list` (før `.map`), legg til et filter-steg som behandler tom/`_virtual` som Firma:
```javascript
  if (typeFilter) {
    list = list.filter(function (p) {
      const gt = String(p.GuestType || '').trim() || 'Firma'; // tom + virtuelle = Firma
      return gt === typeFilter;
    });
  }
```
(Tilpass til hvordan `list` faktisk er deklarert — hvis `const`, endre til `let`, eller bruk et nytt filtrert array i map-kallet.)
- [ ] **Step 4:** Syntaks: `node --check js/persons.js`. Manuell verifisering i Task A4.
- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add js/persons.js index.html && git commit -m "feat: Alle/Firma/Privat filter in guest list"`

## Task A4: Versjonsbump + full live-verifisering (begge repo)

- [ ] **Step 1 (admin):** Bump versjon. I `index.html` (begge forekomster av versjonsstrengen) og `version.txt`: `22.18.10 → 22.19.0` (rollover-regel). Commit: `git commit -am "v22.19.0 — Andslimoen: charge missing items + Firma/Privat guest filter"` (admin-repo).
- [ ] **Step 2 (controller pusher begge repo):** push `2gmbooking-portal` (P1–P3) og `2gmbooking` (A1–A4). Cloudflare deployer portalen; admin-appen deployer via sitt eget oppsett (GitHub Pages — push til main).
- [ ] **Step 3 (live, Stripe testmodus — krever Fase 4a-secrets satt + `PublicBookingEnabled=Ja`):**
  1. Lag en betalt test-booking (kort `4242…`) så raden har `StripeCustomerId` + `Source=Public`.
  2. I admin: åpne den bookingens detalj-panel → «Belast manglende utstyr»-knappen vises. (Bekreft at den IKKE vises på en bedrifts-booking.)
  3. Klikk → huk av f.eks. «Dyne» (700) → Sum 700 → «Belast». Første gang spør den om `ADMIN_CHARGE_SECRET` (lim inn verdien du satte i Cloudflare). → «Belastet 700 kr». Verifiser i Stripe-dashboard (testmodus) + `DepositChargedAt`/`DepositChargeAmount=700` i SP.
  4. Bekreft at den private gjesten dukket opp i Gjester-lista med `GuestType=Privat`; test `Alle/Firma/Privat`-filteret.
  5. **Rydd opp:** kanseller testrader, `PublicBookingEnabled=Nei`.

---

## Self-review-notater (utført ved planskriving)

- **Spec-dekning:** Del A charge-knapp (A1 API/secret, A2 knapp+dialog), localStorage-hemmelighet + 401-reprompt (A1), kun privat m/ lagret kort (A2 `Source==='Public' && StripeCustomerId`), server-side beløp (A1 sender kun items). Del B: GuestType-markør (P2 + SP-kolonne), privat→Persons ved bekreftelse (P3), Firma/Privat-filter (A3). Alle spec-punkter dekket.
- **Item-nøkler konsistente:** `liten_handduk/stor_handduk/pute/dyne/sengesett` i admin `DEPOSIT_PRICE_LIST` (A1) matcher portalens `deposit.js` PRICE_LIST (Fase 4a) — endepunktet validerer mot sin egen liste, admin-lista er kun for sum-visning.
- **Cross-repo:** P1 (guestName/guestPhone i store) kreves av P3 (webhook-upsert). A2 avhenger av A1 (`window.Deposit`). A3 er uavhengig (filter tåler tom GuestType).
- **Bevisst:** admin har ingen enhetstester (manuelt/live, Task A4); portal-endringene er additive og dekkes av eksisterende suite + import-check. `node --check` brukes for ren syntaks-validering av admin-JS.

## Forutsetninger

- Fase 4a deployet + Cloudflare-secrets satt (`ADMIN_CHARGE_SECRET` m.fl.).
- `Persons.GuestType` (Valg Firma/Privat) opprettet i SharePoint (gjort).
- Live-charge-test krever en betalt test-booking med lagret kort (Stripe testmodus).
