# Andslimoen offentlig booking — Fase 1: Ledighets-fundament

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Et offentlig, anonymt ledighets-endepunkt for Rigg Andslimoen som teller konservativt (også ikke-tildelte bookinger), kapper til en `PublicBookable`-underpool, og respekterer en global av/på-bryter — uten å røre eksisterende bedriftslogikk.

**Architecture:** Ren tellematematikk isoleres i `availability-math.js` (ingen I/O → enhetstestbar med `node --test`). En tynn env-bundet wrapper (`public-availability.js`) henter rom/bookinger via eksisterende SharePoint-helpere og delegerer til den rene funksjonen. Et nytt endepunkt (`/api/public-availability`) leser global config fra Properties-raden for Andslimoen og returnerer dager + nattpris. Alt er additivt; `calculateAvailability` og `submit-booking.js` røres ikke.

**Tech Stack:** Cloudflare Pages Functions (ESM JavaScript), Microsoft Graph (SharePoint), Node innebygd test-runner (`node --test`, `.mjs`). Ingen build, ingen nye avhengigheter (matcher CLAUDE.md: «vanilla JS, ingen frameworks»).

---

## Bakgrunn implementøren må kjenne

- **Ledighet teller bare tildelte rom i dag.** `calculateAvailability` hopper over bookinger uten `RoomLookupId` ([sharepoint.js:1006](../../../functions/_utils/sharepoint.js)). Nye bookinger får ikke romtildeling automatisk ([createBookingRow:712](../../../functions/_utils/sharepoint.js) setter aldri `RoomLookupId`) — Frank tildeler manuelt i admin. Privat-siden kan derfor IKKE stole på den; den må telle konservativt (alle aktive/upcoming rader, tildelt eller ikke).
- **`getRoomsForProperty(env, propertyName, propertyMap)`** ([sharepoint.js:361](../../../functions/_utils/sharepoint.js)) returnerer rå SharePoint-items (`{ id, fields }`) filtrert til Active, ikke-kjøkken, riktig property. Den bruker `fetchAllItems` UTEN `$select`, så `item.fields` inneholder ALLE kolonner — inkludert den nye `PublicBookable`.
- **`getBookingsForProperty(env, propertyName)`** ([sharepoint.js:482](../../../functions/_utils/sharepoint.js)) returnerer aktive/upcoming booking-items for property-en.
- **`getPropertyMetaMap(env)`** ([sharepoint.js:182](../../../functions/_utils/sharepoint.js)) gir `{ [lookupId]: { title, fullTenantCompany } }` — brukes til å bygge id→title-map som `getRoomsForProperty` trenger.
- **Property:** Andslimoen heter `"Rigg Andslimoen"` (SharePoint Title), teknisk id `andslimoen`, `PropertyLookupId 4`.
- **Source-felt:** Portalens bedriftsbookinger settes med `Source: "Portal"` ([createBookingRow:734](../../../functions/_utils/sharepoint.js)). Privat-bookinger (senere fase) vil bruke `Source: "Public"`. Ledighetsberegningen skiller privat fra resten på `Source === "Public"`.

## Filstruktur

| Fil | Ansvar |
|-----|--------|
| `functions/_utils/availability-math.js` (ny) | Ren tellematematikk, ingen I/O. Eksporterer `parseDateUtcMs`, `isInRangeInclusive`, `computePublicAvailability`. |
| `functions/_utils/public-availability.js` (ny) | Env-bundet wrapper `calculatePublicAvailability(env, propertyName, fromISO, toISO)` — henter data, mapper, delegerer til den rene funksjonen. |
| `functions/_utils/sharepoint.js` (endre) | Legg til eksportert `getPublicConfig(env, propertyName)` + `SELECT_PUBLIC_CONFIG`. Additivt. |
| `functions/api/public-availability.js` (ny) | POST-endepunkt: validerer datoer, leser global config, returnerer `{ enabled, nightlyRate, days }`. |
| `tests/availability-math.test.mjs` (ny) | Enhetstester for den rene matematikken via `node --test`. |
| SharePoint (manuelt) | `Rooms.PublicBookable` (Yes/No, default Yes); `Properties.PublicBookingEnabled` (Yes/No), `Properties.PublicNightlyRate` (Number) på Andslimoen-raden. |

---

## Task 1: Ren tellematematikk + tester

**Files:**
- Create: `functions/_utils/availability-math.js`
- Test: `tests/availability-math.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/availability-math.test.mjs`:

```javascript
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
  // Firmabooking UTEN romtildeling — teller likevel som etterspørsel etter 1 rom.
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
  // 2 rom, begge public; 2 ikke-tildelte firmabookinger fyller fysisk kapasitet.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/availability-math.test.mjs`
Expected: FAIL — `Cannot find module '.../functions/_utils/availability-math.js'`

- [ ] **Step 3: Write the implementation**

Create `functions/_utils/availability-math.js`:

```javascript
// functions/_utils/availability-math.js
// v1.0 — Ren tellematematikk for privat-sidens ledighet. INGEN I/O, INGEN env.
// Enhetstestbar med `node --test`. Konservativ: teller alle aktive/upcoming
// booking-rader (tildelt eller ikke) som etterspørsel etter ett rom, fordi
// nye bookinger ligger uten RoomLookupId til admin tildeler manuelt.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Parser 'YYYY-MM-DD' (eller ISO med tid) til UTC-midnatt i ms. null på ugyldig.
export function parseDateUtcMs(input) {
  if (!input) return null;
  const s = String(input).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

// Inklusiv på begge ender. endMs=null => open-ended (opptatt for alltid fra start).
export function isInRangeInclusive(dMs, startMs, endMs) {
  if (startMs == null) return false;
  if (dMs < startMs) return false;
  if (endMs == null) return true;
  return dMs <= endMs;
}

// rooms:    [{ id, publicBookable:bool, longTermStartMs:number|null, longTermEndMs:number|null }]
//           (kalleren har allerede filtrert til Active, ikke-kjøkken, riktig property)
// bookings: [{ checkInMs:number, checkOutMs:number|null, isPublic:bool }]
//           (kalleren har allerede filtrert til Active/Upcoming på property-en,
//            og droppet rader uten checkIn)
// fromMs/toMs: UTC-midnatt i ms, inklusivt.
// Returnerer { days: [{ date, available, physicalRooms, occupied, publicPoolSize, publicOccupied }] }
export function computePublicAvailability({ rooms, bookings, fromMs, toMs }) {
  if (fromMs == null || toMs == null) throw new Error("Invalid date range");
  if (toMs < fromMs) throw new Error("toMs before fromMs");

  const days = [];
  for (let t = fromMs; t <= toMs; t += ONE_DAY_MS) {
    let physicalRooms = 0;
    let publicPoolSize = 0;
    for (const r of rooms) {
      if (isInRangeInclusive(t, r.longTermStartMs, r.longTermEndMs)) continue;
      physicalRooms++;
      if (r.publicBookable) publicPoolSize++;
    }

    let occupied = 0;
    let publicOccupied = 0;
    for (const b of bookings) {
      if (!isInRangeInclusive(t, b.checkInMs, b.checkOutMs)) continue;
      occupied++;
      if (b.isPublic) publicOccupied++;
    }

    const physicalAvailable = Math.max(0, physicalRooms - occupied);
    const publicPoolAvailable = Math.max(0, publicPoolSize - publicOccupied);
    const available = Math.min(physicalAvailable, publicPoolAvailable);

    days.push({
      date: new Date(t).toISOString().slice(0, 10),
      available,
      physicalRooms,
      occupied,
      publicPoolSize,
      publicOccupied,
    });
  }
  return { days };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/availability-math.test.mjs`
Expected: PASS — alle tester grønne.

- [ ] **Step 5: Commit**

```bash
git add functions/_utils/availability-math.js tests/availability-math.test.mjs
git commit -m "feat: pure public-availability math with conservative occupancy"
```

---

## Task 2: Env-bundet ledighets-wrapper

**Files:**
- Create: `functions/_utils/public-availability.js`

Ingen automatisk enhetstest her (krever Graph-mock som prosjektet ikke har rigget). Wrapperen er bevisst tynn — all logikk er testet i Task 1. Verifiseres live i Task 5.

- [ ] **Step 1: Write the implementation**

Create `functions/_utils/public-availability.js`:

```javascript
// functions/_utils/public-availability.js
// v1.0 — Env-bundet wrapper rundt computePublicAvailability. Henter rom og
// bookinger via eksisterende SharePoint-helpere og mapper til den rene
// funksjonens input. Rør IKKE calculateAvailability (bedriftslogikk).

import {
  getPropertyMetaMap,
  getRoomsForProperty,
  getBookingsForProperty,
} from "./sharepoint.js";
import { computePublicAvailability, parseDateUtcMs } from "./availability-math.js";

export async function calculatePublicAvailability(env, propertyName, fromISO, toISO) {
  // Bygg id->title-map (samme oppskrift som calculateAvailability bruker).
  const propertyMeta = await getPropertyMetaMap(env);
  const propertyMap = {};
  for (const [id, m] of Object.entries(propertyMeta)) {
    if (m.title) propertyMap[id] = m.title;
  }

  const [roomItems, bookingItems] = await Promise.all([
    getRoomsForProperty(env, propertyName, propertyMap),
    getBookingsForProperty(env, propertyName),
  ]);

  const rooms = roomItems.map((it) => {
    const f = it.fields || {};
    return {
      id: String(it.id),
      // PublicBookable default = true. Kun eksplisitt No (false) tar rommet
      // ut av privat-poolen. Manglende felt => fortsatt bookbart for privat.
      publicBookable: f.PublicBookable !== false,
      longTermStartMs: parseDateUtcMs(f.LongTerm_StartDate),
      longTermEndMs: parseDateUtcMs(f.LongTerm_EndDate),
    };
  });

  const bookings = bookingItems
    .map((it) => {
      const f = it.fields || {};
      return {
        checkInMs: parseDateUtcMs(f.Check_In),
        checkOutMs: parseDateUtcMs(f.Check_Out),
        isPublic: String(f.Source || "") === "Public",
      };
    })
    .filter((b) => b.checkInMs !== null);

  const { days } = computePublicAvailability({
    rooms,
    bookings,
    fromMs: parseDateUtcMs(fromISO),
    toMs: parseDateUtcMs(toISO),
  });

  return { property: propertyName, days };
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/_utils/public-availability.js').then(m => console.log(typeof m.calculatePublicAvailability))"`
Expected: prints `function`

- [ ] **Step 3: Commit**

```bash
git add functions/_utils/public-availability.js
git commit -m "feat: env-bound public availability wrapper"
```

---

## Task 3: Global config-leser i sharepoint.js

**Files:**
- Modify: `functions/_utils/sharepoint.js` (legg til ved siden av de andre `SELECT_*`-konstantene og eksporterte gettere)

- [ ] **Step 1: Add the SELECT constant**

I `functions/_utils/sharepoint.js`, rett etter `SELECT_RATE`-linjen ([sharepoint.js:157](../../../functions/_utils/sharepoint.js)), legg til:

```javascript
const SELECT_PUBLIC_CONFIG = "Title,PublicBookingEnabled,PublicNightlyRate";
```

- [ ] **Step 2: Add the exported reader**

I `functions/_utils/sharepoint.js`, rett etter `getPropertyMetaMap` ([sharepoint.js:193](../../../functions/_utils/sharepoint.js)), legg til:

```javascript
// Leser privat-bookingens globale config fra Properties-raden for en gitt
// property. enabled = master av/på for publikum-siden; nightlyRate = felles
// privatmarked-nattsats. Manglende rad/felt => deaktivert (fail closed).
export async function getPublicConfig(env, propertyName) {
  const items = await fetchAllItems(env, LIST_IDS.PROPERTIES, { select: SELECT_PUBLIC_CONFIG });
  const row = items.find((it) => (it.fields?.Title || "") === propertyName);
  if (!row) return { enabled: false, nightlyRate: 0 };
  const f = row.fields || {};
  return {
    enabled: f.PublicBookingEnabled === true,
    nightlyRate: Number(f.PublicNightlyRate) || 0,
  };
}
```

- [ ] **Step 3: Verify it imports cleanly**

Run: `node -e "import('./functions/_utils/sharepoint.js').then(m => console.log(typeof m.getPublicConfig))"`
Expected: prints `function`

- [ ] **Step 4: Commit**

```bash
git add functions/_utils/sharepoint.js
git commit -m "feat: getPublicConfig reads public toggle + nightly rate from Properties"
```

---

## Task 4: Offentlig ledighets-endepunkt

**Files:**
- Create: `functions/api/public-availability.js`

- [ ] **Step 1: Write the implementation**

Create `functions/api/public-availability.js` (speiler mønsteret i [availability.js](../../../functions/api/availability.js) — CORS, validering, fail-soft):

```javascript
// functions/api/public-availability.js
// v1.0 — Anonymt ledighets-endepunkt for den offentlige bookingsiden.
//
// POST /api/public-availability
// Body: { fromDate: "2026-06-13", toDate: "2026-07-13" }
//
// Returnerer:
//   { enabled: true, nightlyRate: 895, days: [{ date, available, ... }] }
//   { enabled: false }                                  (global bryter av)
//   { error: "invalid_dates" | "range_too_large" | "internal_error" }
//
// Bundet til Rigg Andslimoen. Ingen token — dette er publikum-siden.

import { getPublicConfig } from "../_utils/sharepoint.js";
import { calculatePublicAvailability } from "../_utils/public-availability.js";

const PROPERTY_NAME = "Rigg Andslimoen";
const MAX_DAYS = 92;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { fromDate, toDate } = body || {};

    if (!fromDate || !toDate) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    const dayCount = Math.floor((to - from) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_DAYS) {
      return jsonResponse({ error: "range_too_large", maxDays: MAX_DAYS }, 400);
    }

    const config = await getPublicConfig(env, PROPERTY_NAME);
    if (!config.enabled) {
      return jsonResponse({ enabled: false });
    }

    const result = await calculatePublicAvailability(env, PROPERTY_NAME, fromDate, toDate);
    return jsonResponse({
      enabled: true,
      nightlyRate: config.nightlyRate,
      days: result.days,
    });
  } catch (err) {
    console.error("public-availability error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/api/public-availability.js').then(m => console.log(typeof m.onRequestPost))"`
Expected: prints `function`

- [ ] **Step 3: Commit**

```bash
git add functions/api/public-availability.js
git commit -m "feat: /api/public-availability endpoint (Andslimoen, anonymous)"
```

---

## Task 5: SharePoint-felt + live-verifisering

Dette er en manuell SharePoint-oppgave pluss en ende-til-ende-sjekk mot deployet endepunkt. Det finnes ingen Graph-mock i prosjektet, så live-curl ER integrasjonstesten (samme mønster som CLAUDE.md beskriver for portalen).

- [ ] **Step 1: Legg til kolonner i SharePoint**

I `https://2gmeiendom.sharepoint.com/sites/2GMBooking`:

1. **Rooms-lista** (`bfa962a0-5eb2-416c-abe8-adba06558c11`): ny kolonne `PublicBookable`, type **Ja/nei (Yes/No)**, standardverdi **Ja**. (Standard Ja => alle eksisterende Andslimoen-rom er privat-bookbare; Frank slår av enkeltrom ved behov.)
2. **Properties-lista** (`d842d574-f238-442a-be3d-77334727e89f`): to nye kolonner:
   - `PublicBookingEnabled`, type **Ja/nei**, standardverdi **Nei** (publikum-siden er av til Frank skrur den på).
   - `PublicNightlyRate`, type **Tall (Number)**, ingen desimaler.
3. På Andslimoen-raden (`Rigg Andslimoen`): sett `PublicNightlyRate` til ønsket sats, og `PublicBookingEnabled = Ja` når du vil teste live.

- [ ] **Step 2: Deploy**

```bash
git push
```
Cloudflare auto-deployer (~30 sek).

- [ ] **Step 3: Verifiser «av»-tilstand (før du skrur på)**

Med `PublicBookingEnabled = Nei`:

```powershell
$body = @{ fromDate = "2026-06-13"; toDate = "2026-06-20" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://2gmbooking-portal.pages.dev/api/public-availability" -Method Post -Body $body -ContentType "application/json"
```
Expected: `enabled` er `False`, ingen `days`.

- [ ] **Step 4: Verifiser «på»-tilstand**

Sett `PublicBookingEnabled = Ja` på Andslimoen-raden i SharePoint, vent ~30 sek, kjør samme curl.
Expected: `enabled = True`, `nightlyRate` matcher satsen du satte, `days` har én rad per dato med `available`/`physicalRooms`/`occupied`/`publicPoolSize`/`publicOccupied`.

- [ ] **Step 5: Kryssjekk mot bedrifts-endepunktet**

Kjør eksisterende `/api/availability` for Andslimoen samme periode:

```powershell
$body = @{ property = "andslimoen"; fromDate = "2026-06-13"; toDate = "2026-06-20" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://2gmbooking-portal.pages.dev/api/availability" -Method Post -Body $body -ContentType "application/json"
```
Expected: `physicalRooms` fra public-endepunktet ≥ `totalActive` minus eventuelle ikke-tellbare; `public available` ≤ bedrifts-`available` på dager der det finnes ikke-tildelte bookinger (privat teller konservativt). Bekreft at `calculateAvailability`-svaret er UENDRET fra før (bedriftslogikk urørt).

- [ ] **Step 6: Sett tilbake ønsket driftstilstand**

La `PublicBookingEnabled` stå slik Frank vil ha den (sannsynligvis `Nei` til frontend i senere fase er klar).

---

## Self-review-notater (utført ved planskriving)

- **Spec-dekning Fase 1:** datakilde (SharePoint), delt pool, segment-pris (`PublicNightlyRate`), per-rom `PublicBookable`, global `PublicBookingEnabled`, konservativ ledighetsformel, isolasjon (bedriftslogikk urørt) — alle dekket. Betaling, lås, auto-tildeling, tilstandsmaskin og frontend er bevisst UTENFOR Fase 1 (egne planer).
- **Bevisste forenklinger i Fase 1:** «dirty-rom blokkerer i dag»-regelen fra `calculateAvailability` er IKKE tatt med — privat-bookinger er typisk fremtidsdaterte, og samme-dag-vaskelogikk håndteres i en senere fase. Notert her så det ikke leses som en glipp.
- **Type-konsistens:** `computePublicAvailability` tar `{ rooms, bookings, fromMs, toMs }` i både test (Task 1) og wrapper (Task 2). `getPublicConfig` returnerer `{ enabled, nightlyRate }` brukt likt i endepunktet (Task 4). `Source === "Public"` brukt konsistent.

## Neste faser (ikke i denne planen)

- **Fase 2:** Booking-opprettelse + rom-reservasjon/hold (kort timeout) + auto-tildeling av konkret `PublicBookable`-rom + tilstandsmaskin (`pending → confirmed/cancelled`), med mockede betalings- og lås-lag.
- **Fase 3:** Offentlig frontend-side (galleri + datovelger-først + ledighetsvisning + gjesteskjema), retning B.
- **Fase 4:** Vipps-integrasjon bak betalingsabstraksjonen (krever Vipps test+prod-nøkler).
- **Fase 5:** Lås-lag — Yale Access (ytterdør) + Tuya/Flask (rom), per-gjest tidsbegrensede koder (krever bekreftet Yale Connect-bro).
