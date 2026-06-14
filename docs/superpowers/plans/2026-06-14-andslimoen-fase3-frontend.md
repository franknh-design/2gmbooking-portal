# Andslimoen offentlig booking — Fase 3: Frontend (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En frittstående, mobil-først offentlig bookingside for Rigg Andslimoen (galleri → datovelger → ledighet → gjesteskjema → «hold opprettet»-bekreftelse) som bruker Fase 1/2-endepunktene.

**Architecture:** Egen HTML-side med `<script type="module">`. Ren, node-testbar format-/logikk-modul (`andslimoen-format.mjs`) skilt fra DOM-orkestreringen (`andslimoen.mjs`). Egen CSS, rører ikke portalens `styles.css`. Ingen nye backend-endepunkter.

**Tech Stack:** Vanilla JS ES-moduler (ingen build), native `<input type="date">` (ingen datepicker-bibliotek), `node --test` for de rene hjelperne. Bygger på `/api/public-availability` og `/api/public-booking` (levert i Fase 1/2).

---

## Bakgrunn implementøren må kjenne

- Portalen er Cloudflare Pages, ingen build. `index.html` ligger i repo-rot, bruker `lang="nb"`, 2GM-blå `#1B4F72`, og lenker `assets/css/styles.css`. Den nye siden er HELT separat fra `index.html` (ingen token, ingen deling av JS/CSS).
- `_redirects` finnes i rot og bruker `200`-rewrites (eks: `/c /api/qr 200`).
- Endepunkter (samme origin):
  - `POST /api/public-availability` body `{ fromDate, toDate }` → `{ enabled, nightlyRate, days:[{date, available, ...}] }` eller `{ enabled:false }`. Datoer `YYYY-MM-DD`. `days[i].date` er `YYYY-MM-DD`, `days[i].available` er et tall.
  - `POST /api/public-booking` body `{ fromDate, toDate, guest:{ name, phone, email? } }` → `{ ok:true, bookingRef, paymentRef }` eller `{ ok:false, error }` (error ∈ `public_booking_disabled`, `invalid_request`, `invalid_dates`, `invalid_guest`, `sold_out`, `internal_error`).
- Ledighet for et opphold: et rom må være ledig på ALLE datoer oppholdet opptar = innsjekk t.o.m. utsjekk INKLUSIV (utsjekk-dagen er vaskedag/opptatt i modellen). «Netter» for pris = utsjekk − innsjekk.
- `PublicBookingEnabled` kan stå `Nei` — da svarer availability `{ enabled:false }` og siden skal vise en rolig stengt-tilstand.
- Frontend-testing i prosjektet er ellers manuell/live (ingen test-rigg). Vi enhetstester KUN den rene `andslimoen-format.mjs` med `node --test`; DOM-glue verifiseres i nettleser.

## Filstruktur

| Fil | Ansvar |
|-----|--------|
| `assets/js/andslimoen-format.mjs` (ny) | Rene hjelpere: `nightsBetween`, `totalPrice`, `formatKr`, `minAvailableForStay`, `isValidNoPhone`, `isValidEmail`. Ingen DOM. |
| `tests/andslimoen-format.test.mjs` (ny) | Enhetstester for hjelperne. |
| `andslimoen.html` (ny, repo-rot) | Markup + seksjoner med id-kroker + `<script type="module" src="assets/js/andslimoen.mjs">`. |
| `assets/css/andslimoen.css` (ny) | Eget mobil-først forbruker-uttrykk. |
| `assets/js/andslimoen.mjs` (ny) | DOM-orkestrering: galleri, datovelger, fetch, tilstands-rendering. Importerer format-modulen. |
| `assets/img/andslimoen/` (ny) | 5 placeholder-bilder: `rom.jpg`, `bad.jpg`, `vaskerom.jpg`, `kjokken.jpg`, `rigg.jpg`. |
| `_redirects` (endre) | Legg til `/andslimoen /andslimoen.html 200`. |

Implementører committer LOKALT (ikke push). Push/deploy + live-verifisering gjøres i siste task.

---

## Task 1: Rene format-/logikk-hjelpere + tester

**Files:**
- Create: `assets/js/andslimoen-format.mjs`
- Test: `tests/andslimoen-format.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/andslimoen-format.test.mjs`:

```javascript
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
  // Opphold 16->18 opptar 16,17,18 -> min(5,3,4)=3
  assert.equal(minAvailableForStay(days, "2026-06-16", "2026-06-18"), 3);
});

test("minAvailableForStay: a missing date counts as 0 (not available)", () => {
  const days = [
    { date: "2026-06-16", available: 5 },
    { date: "2026-06-18", available: 4 },
  ];
  // 17. juni mangler -> 0
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
  assert.equal(isValidNoPhone("12345678"), false); // ledende 1
  assert.equal(isValidNoPhone("999"), false);
  assert.equal(isValidNoPhone(""), false);
});

test("isValidEmail basic check", () => {
  assert.equal(isValidEmail("ola@example.no"), true);
  assert.equal(isValidEmail("feil"), false);
  assert.equal(isValidEmail(""), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/andslimoen-format.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `assets/js/andslimoen-format.mjs`:

```javascript
// assets/js/andslimoen-format.mjs
// v1.0 — Rene format-/logikk-hjelpere for den offentlige bookingsiden. INGEN DOM,
// så de kan enhetstestes med `node --test` (og importeres i nettleseren som ES-modul).

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcMs(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

// Antall netter gjesten sover = utsjekk - innsjekk. 0 ved ugyldig/reversert.
export function nightsBetween(fromISO, toISO) {
  const a = parseUtcMs(fromISO);
  const b = parseUtcMs(toISO);
  if (a == null || b == null) return 0;
  const n = Math.round((b - a) / ONE_DAY_MS);
  return n > 0 ? n : 0;
}

export function totalPrice(nightlyRate, fromISO, toISO) {
  return (Number(nightlyRate) || 0) * nightsBetween(fromISO, toISO);
}

// Heltall med mellomrom som tusenskille (nb-NO-stil), avrundet. Deterministisk
// (ikke avhengig av Intl/ICU-versjon).
export function formatKr(amount) {
  return String(Math.round(Number(amount) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Minimum ledige rom over datoene oppholdet OPPTAR (innsjekk t.o.m. utsjekk,
// inklusiv). En manglende dato i `days` regnes som 0 (ikke ledig). 0 ved
// ugyldig/reversert periode.
export function minAvailableForStay(days, fromISO, toISO) {
  const a = parseUtcMs(fromISO);
  const b = parseUtcMs(toISO);
  if (a == null || b == null || b < a) return 0;
  const byDate = new Map();
  for (const d of days || []) byDate.set(d.date, Number(d.available) || 0);
  let min = Infinity;
  for (let t = a; t <= b; t += ONE_DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const avail = byDate.has(iso) ? byDate.get(iso) : 0;
    if (avail < min) min = avail;
  }
  return min === Infinity ? 0 : min;
}

// Norsk telefon — speiler regelen i submit-booking.js / public-booking.js.
export function isValidNoPhone(s) {
  const cleaned = String(s || "").replace(/[\s\-()./]/g, "").replace(/^(\+47|0047|47)/, "");
  return /^[2-9]\d{7}$/.test(cleaned);
}

// E-post — speiler backend-regelen.
export function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/andslimoen-format.test.mjs`
Expected: PASS (8 tester).

- [ ] **Step 5: Commit (LOCAL ONLY — no push)**

```bash
git add assets/js/andslimoen-format.mjs tests/andslimoen-format.test.mjs
git commit -m "feat: pure format/logic helpers for public booking page"
```

---

## Task 2: Side-skall (HTML + CSS)

**Files:**
- Create: `andslimoen.html`
- Create: `assets/css/andslimoen.css`

Ingen automatisk test (markup/styling) — verifiseres live i siste task. Den utførende agenten KAN bruke frontend-design-skillen til å heve den visuelle poleringen, men MÅ beholde alle element-id-er nedenfor (DOM-glue i Task 3 er avhengig av dem) og format-modulens API.

- [ ] **Step 1: Write the HTML**

Create `andslimoen.html`:

```html
<!DOCTYPE html>
<!-- v1.0 -->
<html lang="nb">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#1B4F72" />
  <meta name="color-scheme" content="light" />
  <title>Rigg Andslimoen — book rom</title>
  <link rel="stylesheet" href="assets/css/andslimoen.css" />
</head>
<body>
  <header class="site-header">
    <span class="brand">2GM EIENDOM</span>
    <span class="site-title">Rigg Andslimoen</span>
  </header>

  <main class="page" id="page">
    <!-- Stengt-tilstand -->
    <section class="state-closed" id="closed-state" hidden>
      <h1>Booking er midlertidig stengt</h1>
      <p>Ta gjerne kontakt med 2GM Eiendom for forespørsler.</p>
    </section>

    <!-- Booking-tilstand -->
    <section class="booking" id="booking-state" hidden>
      <div class="gallery">
        <img class="gallery-main" id="gallery-main" src="assets/img/andslimoen/rom.jpg" alt="Rom på Rigg Andslimoen" />
        <div class="gallery-thumbs" id="gallery-thumbs"></div>
      </div>

      <div class="intro">
        <h1>Rom på Rigg Andslimoen</h1>
        <p>Enkle, rene rom med felles kjøkken, bad og vaskerom.</p>
        <p class="price"><strong id="nightly-rate">–</strong> kr / natt</p>
      </div>

      <div class="card">
        <div class="dates">
          <label>Innsjekk<input type="date" id="checkin" /></label>
          <label>Utsjekk<input type="date" id="checkout" /></label>
        </div>
        <p class="availability" id="availability-result"></p>
        <p class="price-summary" id="price-summary"></p>
      </div>

      <form class="guest" id="guest-form">
        <input type="text" id="guest-name" placeholder="Navn" autocomplete="name" />
        <input type="tel" id="guest-phone" placeholder="Telefon (8 siffer)" autocomplete="tel" />
        <input type="email" id="guest-email" placeholder="E-post (valgfritt)" autocomplete="email" />
        <p class="field-error" id="form-error" hidden></p>
        <button type="submit" id="reserve-btn" disabled>Reserver</button>
        <p class="hint">Betaling via Vipps (kommer). Du holder rommet i 15 minutter.</p>
      </form>
    </section>

    <!-- Bekreftelse -->
    <section class="confirmation" id="confirmation" hidden>
      <div class="check">✓</div>
      <h1>Reservasjon opprettet</h1>
      <p>Referanse <strong id="confirmation-ref"></strong></p>
      <p>Betaling kommer snart — du holder rommet i 15 minutter.</p>
    </section>
  </main>

  <script type="module" src="assets/js/andslimoen.mjs"></script>
</body>
</html>
```

- [ ] **Step 2: Write the CSS**

Create `assets/css/andslimoen.css`:

```css
/* assets/css/andslimoen.css — v1.0. Mobil-først forbruker-uttrykk for den
   offentlige Andslimoen-bookingsiden. Uavhengig av portalens styles.css. */
:root {
  --brand: #1B4F72;
  --ink: #1c2733;
  --muted: #5f6b78;
  --line: #e4e8ec;
  --bg: #f7f9fb;
  --ok: #1d7a4d;
  --err: #b3261e;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background: var(--bg);
  line-height: 1.5;
}
.site-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--line);
}
.brand { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; color: var(--brand); }
.site-title { font-size: 13px; color: var(--muted); }
.page { max-width: 480px; margin: 0 auto; padding: 16px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.gallery-main {
  width: 100%; height: 200px; object-fit: cover; border-radius: var(--radius);
  background: #dde3e8; display: block;
}
.gallery-thumbs { display: flex; gap: 6px; margin-top: 6px; }
.gallery-thumbs img {
  flex: 1; height: 48px; object-fit: cover; border-radius: 6px; background: #dde3e8;
  cursor: pointer; border: 2px solid transparent;
}
.gallery-thumbs img.active { border-color: var(--brand); }
.intro { margin: 16px 0; }
.intro p { margin: 4px 0; color: var(--muted); }
.price { color: var(--ink) !important; font-size: 16px; }
.price strong { font-size: 18px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
.dates { display: flex; gap: 10px; }
.dates label { flex: 1; display: flex; flex-direction: column; font-size: 12px; color: var(--muted); gap: 4px; }
input[type="date"], .guest input {
  font-size: 16px; padding: 10px; border: 1px solid var(--line); border-radius: 8px;
  width: 100%; background: #fff; color: var(--ink);
}
.availability { margin: 12px 0 0; font-size: 14px; font-weight: 500; }
.availability.ok { color: var(--ok); }
.availability.full { color: var(--err); }
.price-summary { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
.guest { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.field-error { color: var(--err); font-size: 13px; margin: 0; }
#reserve-btn {
  background: var(--brand); color: #fff; border: none; border-radius: 8px;
  padding: 13px; font-size: 16px; font-weight: 500; cursor: pointer;
}
#reserve-btn:disabled { background: #9bb0c2; cursor: not-allowed; }
.hint { font-size: 12px; color: var(--muted); text-align: center; margin: 2px 0 0; }
.confirmation { text-align: center; padding: 32px 16px; }
.confirmation .check {
  width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%;
  background: var(--ok); color: #fff; font-size: 30px; line-height: 56px;
}
.state-closed { text-align: center; padding: 48px 16px; color: var(--muted); }
```

- [ ] **Step 3: Verify the page loads (no JS yet)**

Open `andslimoen.html` in a browser (or note for the live task). The structure renders; both `#booking-state` and `#confirmation` start `hidden` (JS reveals the right one). This step is a visual sanity check; no automated assertion.

- [ ] **Step 4: Commit (LOCAL ONLY — no push)**

```bash
git add andslimoen.html assets/css/andslimoen.css
git commit -m "feat: public Andslimoen page shell (HTML + CSS)"
```

---

## Task 3: DOM-orkestrering (`andslimoen.mjs`)

**Files:**
- Create: `assets/js/andslimoen.mjs`

- [ ] **Step 1: Write the implementation**

Create `assets/js/andslimoen.mjs`:

```javascript
// assets/js/andslimoen.mjs — v1.0. DOM-orkestrering for den offentlige
// bookingsiden. Laster config, håndterer datovelger + ledighet, sender
// reservasjon. All ren logikk ligger i andslimoen-format.mjs.
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidNoPhone,
  isValidEmail,
} from "./andslimoen-format.mjs";

const $ = (id) => document.getElementById(id);
const GALLERY = [
  { src: "assets/img/andslimoen/rom.jpg", alt: "Rom" },
  { src: "assets/img/andslimoen/bad.jpg", alt: "Bad og dusj" },
  { src: "assets/img/andslimoen/vaskerom.jpg", alt: "Vaskerom" },
  { src: "assets/img/andslimoen/kjokken.jpg", alt: "Kjøkken" },
  { src: "assets/img/andslimoen/rigg.jpg", alt: "Riggen" },
];

let nightlyRate = 0;

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildGallery() {
  const thumbs = $("gallery-thumbs");
  GALLERY.forEach((g, i) => {
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = g.alt;
    if (i === 0) img.classList.add("active");
    img.addEventListener("click", () => {
      $("gallery-main").src = g.src;
      $("gallery-main").alt = g.alt;
      thumbs.querySelectorAll("img").forEach((t) => t.classList.remove("active"));
      img.classList.add("active");
    });
    thumbs.appendChild(img);
  });
}

async function init() {
  buildGallery();
  // Hent config (enabled + nightlyRate) med et lite vindu.
  const t = todayISO();
  let config;
  try {
    config = await postJSON("/api/public-availability", { fromDate: t, toDate: t });
  } catch {
    config = { enabled: false };
  }
  if (!config || !config.enabled) {
    $("closed-state").hidden = false;
    return;
  }
  nightlyRate = Number(config.nightlyRate) || 0;
  $("nightly-rate").textContent = formatKr(nightlyRate);
  $("booking-state").hidden = false;

  // Datofelt: min = i dag.
  $("checkin").min = t;
  $("checkout").min = t;
  $("checkin").addEventListener("change", onDatesChanged);
  $("checkout").addEventListener("change", onDatesChanged);
  ["guest-name", "guest-phone"].forEach((id) => $(id).addEventListener("input", refreshButton));
  $("guest-form").addEventListener("submit", onSubmit);
}

let lastStay = { from: "", to: "", available: 0 };

async function onDatesChanged() {
  const from = $("checkin").value;
  const to = $("checkout").value;
  const av = $("availability-result");
  const ps = $("price-summary");
  lastStay = { from, to, available: 0 };
  const nights = nightsBetween(from, to);
  if (!from || !to || nights <= 0) {
    av.textContent = ""; av.className = "availability";
    ps.textContent = "";
    refreshButton();
    return;
  }
  av.textContent = "Sjekker ledighet…"; av.className = "availability";
  let data;
  try {
    data = await postJSON("/api/public-availability", { fromDate: from, toDate: to });
  } catch {
    av.textContent = "Kunne ikke sjekke ledighet — prøv igjen."; av.className = "availability full";
    refreshButton();
    return;
  }
  if (!data || !data.enabled) {
    $("booking-state").hidden = true; $("closed-state").hidden = false;
    return;
  }
  const avail = minAvailableForStay(data.days || [], from, to);
  lastStay.available = avail;
  if (avail > 0) {
    av.textContent = `${avail} rom ledige`; av.className = "availability ok";
    ps.textContent = `${formatKr(totalPrice(nightlyRate, from, to))} kr for ${nights} ${nights === 1 ? "natt" : "netter"}`;
  } else {
    av.textContent = "Ingen ledige rom disse datoene"; av.className = "availability full";
    ps.textContent = "";
  }
  refreshButton();
}

function guestValid() {
  return (
    $("guest-name").value.trim().length > 0 &&
    isValidNoPhone($("guest-phone").value)
  );
}

function refreshButton() {
  const ok = lastStay.available > 0 && nightsBetween(lastStay.from, lastStay.to) > 0 && guestValid();
  const btn = $("reserve-btn");
  btn.disabled = !ok;
  btn.textContent =
    lastStay.available > 0 && nightsBetween(lastStay.from, lastStay.to) > 0
      ? `Reserver — ${formatKr(totalPrice(nightlyRate, lastStay.from, lastStay.to))} kr`
      : "Reserver";
}

const ERROR_TEXT = {
  sold_out: "Noen var raskere — prøv andre datoer.",
  public_booking_disabled: "Booking er midlertidig stengt.",
  invalid_guest: "Sjekk navn og telefonnummer.",
  invalid_dates: "Sjekk datoene.",
  invalid_request: "Noe gikk galt, prøv igjen.",
  internal_error: "Noe gikk galt, prøv igjen.",
};

async function onSubmit(e) {
  e.preventDefault();
  const err = $("form-error");
  err.hidden = true;
  const email = $("guest-email").value.trim();
  if (email && !isValidEmail(email)) {
    err.textContent = "Ugyldig e-postadresse."; err.hidden = false;
    return;
  }
  const btn = $("reserve-btn");
  btn.disabled = true;
  btn.textContent = "Reserverer…";
  let data;
  try {
    data = await postJSON("/api/public-booking", {
      fromDate: lastStay.from,
      toDate: lastStay.to,
      guest: { name: $("guest-name").value.trim(), phone: $("guest-phone").value, email: email || undefined },
    });
  } catch {
    data = { ok: false, error: "internal_error" };
  }
  if (data && data.ok) {
    $("booking-state").hidden = true;
    $("confirmation-ref").textContent = data.bookingRef;
    $("confirmation").hidden = false;
    return;
  }
  err.textContent = ERROR_TEXT[data && data.error] || "Noe gikk galt, prøv igjen.";
  err.hidden = false;
  refreshButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
```

- [ ] **Step 2: Verify it parses as a module**

Run: `node --check assets/js/andslimoen.mjs`
Expected: no output (syntax OK). (It imports `./andslimoen-format.mjs`; `node --check` only parses, it won't run the DOM code.)

- [ ] **Step 3: Commit (LOCAL ONLY — no push)**

```bash
git add assets/js/andslimoen.mjs
git commit -m "feat: public booking page DOM orchestration"
```

---

## Task 4: Placeholder-bilder, _redirects, full suite, push + live-verifisering

**Files:**
- Create: `assets/img/andslimoen/rom.jpg`, `bad.jpg`, `vaskerom.jpg`, `kjokken.jpg`, `rigg.jpg`
- Modify: `_redirects`

- [ ] **Step 1: Add placeholder images**

Lag 5 enkle placeholder-JPG-er i `assets/img/andslimoen/` med filnavnene `rom.jpg`, `bad.jpg`, `vaskerom.jpg`, `kjokken.jpg`, `rigg.jpg`. Hver kan være et lite ensfarget bilde (f.eks. 1200×800, 2GM-blå `#1B4F72` med lys tekst som sier motivet). Eksempel med ImageMagick hvis tilgjengelig:

```bash
for n in rom bad vaskerom kjokken rigg; do \
  magick -size 1200x800 xc:#1B4F72 -gravity center -pointsize 60 -fill white \
  -annotate 0 "$n" "assets/img/andslimoen/$n.jpg"; done
```

Hvis ImageMagick ikke finnes: lag/kopier hvilke som helst 5 små JPG-er med de eksakte filnavnene (innholdet er irrelevant — byttes ut med ekte foto senere). Det viktige er at filene finnes så `<img>`-ene ikke gir 404.

- [ ] **Step 2: Add the clean-URL rewrite**

I `_redirects`, legg til en linje (behold den eksisterende `/c /api/qr 200`):

```
/andslimoen /andslimoen.html 200
```

- [ ] **Step 3: Run the full unit-test suite**

Run: `node --test tests/*.test.mjs`
Expected: alle tester passerer (Fase 1 + Fase 2 + den nye `andslimoen-format` — 0 fail).

- [ ] **Step 4: Commit + push (deploy)**

```bash
git add assets/img/andslimoen _redirects
git commit -m "feat: placeholder gallery images + /andslimoen clean URL"
git push
```
Cloudflare auto-deployer (~30 sek).

- [ ] **Step 5: Live-verifisering**

Forutsetning: sett `PublicBookingEnabled=Ja` på Andslimoen-raden i SharePoint for å teste booking-flyten (sett tilbake etterpå).

1. Åpne `https://2gmbooking-portal.pages.dev/andslimoen` på mobilbredde. Verifiser: galleri (5 thumbnails, klikk bytter hovedbilde), pris vises (`650 kr / natt` e.l.), header med 2GM-logo.
2. Velg innsjekk + utsjekk → «X rom ledige» (grønt) + totalpris vises. Velg en periode som er full (om mulig) → «Ingen ledige rom disse datoene» (rødt).
3. Fyll navn + gyldig telefon → «Reserver»-knappen aktiveres og viser totalpris. Ugyldig telefon → knappen forblir disabled.
4. Klikk «Reserver» → bekreftelsesskjerm med `2GM-XXXXXX`. **Dette skriver en ekte hold-rad** — verifiser i SharePoint (Source=Public, RoomLookupId, HoldExpiry ~15 min), og sett raden `Status=Cancelled` etterpå (testrad).
5. Sett `PublicBookingEnabled=Nei` → last siden på nytt → «Booking er midlertidig stengt» vises (ingen skjema).
6. Sett `PublicBookingEnabled` tilbake til ønsket driftstilstand.

---

## Self-review-notater (utført ved planskriving)

- **Spec-dekning:** full UI → hold-bekreftelse (Task 2/3), frittstående side (Task 2), eget uttrykk + 2GM-logo (Task 2 CSS), placeholder-bilder swappable (Task 2/4), ES-modul + node-testbar format-modul (Task 1/3), de to endepunktene (Task 3), tilstander/feil (Task 3: stengt/fullt/feil/disabled-knapp), ren URL (Task 4), testing (Task 1 enhet + Task 4 manuell). Alle spec-seksjoner dekket.
- **Type-konsistens:** format-modulens API (`nightsBetween`, `totalPrice`, `formatKr`, `minAvailableForStay`, `isValidNoPhone`, `isValidEmail`) brukt likt i tester (Task 1) og DOM-glue (Task 3). Element-id-er i HTML (Task 2) matcher `$()`-oppslagene i Task 3 (`checkin`, `checkout`, `availability-result`, `price-summary`, `guest-name`, `guest-phone`, `guest-email`, `form-error`, `reserve-btn`, `nightly-rate`, `gallery-main`, `gallery-thumbs`, `closed-state`, `booking-state`, `confirmation`, `confirmation-ref`). Bildefilnavn i `GALLERY` (Task 3) matcher filene i Task 4 og `<img src>` i Task 2.
- **Ledighet:** `minAvailableForStay` bruker innsjekk t.o.m. utsjekk inklusiv (matcher backend-modellen der utsjekk-dagen er opptatt).
- **Bevisst:** DOM-glue er ikke enhetstestet (ingen frontend-rigg i prosjektet) — verifiseres live i Task 4. Den utførende agenten kan bruke frontend-design for visuell polering så lenge id-er + format-API beholdes.

## Forutsetninger

- Fase 1/2-endepunktene er live (de er det).
- For live booking-test: `PublicBookingEnabled=Ja` midlertidig (skriver en testrad som må kanselleres).
- ImageMagick er valgfritt for placeholderne — hvilke som helst 5 JPG-er med riktige filnavn duger.
