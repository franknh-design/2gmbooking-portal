# Andslimoen offentlig booking — Fase 2: Booking-orkestrator (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygge logikken som tar en privat gjest fra «velg datoer» til en `confirmed` booking med tildelt rom — hold/reservasjon, auto-tildeling, og tilstandsmaskinen for betaling + kode-generering — med mockede betalings-/lås-lag.

**Architecture:** Samme mønster som Fase 1: rene moduler (ingen I/O, TDD med `node --test`) for tildeling, tilstandsoverganger og hold-utløp, pluss en tynn orkestrator med injiserte avhengigheter (store, payment-provider, lock-provider, klokke). Orkestratoren testes med in-memory store + mock-providere + injisert klokke. Ett deployerbart endepunkt (`/api/public-booking`) wirer prod-store + mock-providere.

**Tech Stack:** Cloudflare Pages Functions (ESM JS, ingen build/framework), Microsoft Graph (SharePoint), `node --test` med `.mjs` (ingen test-framework). Bygger på Fase 1 (`availability-math.js`, `public-availability.js`).

---

## Bakgrunn implementøren må kjenne

- Fase 1 leverte `functions/_utils/availability-math.js` (eksporterer `parseDateUtcMs`, `isInRangeInclusive`, `computePublicAvailability`) og `functions/_utils/public-availability.js` (`calculatePublicAvailability`). Disse er på `main` og verifisert live.
- `functions/_utils/sharepoint.js` har: `updateBookingFields(env, itemId, fields)` (PATCH vilkårlige felt på en booking-rad, ~linje 485), `getRoomsForProperty(env, propertyName, propertyMap)` (~361), `getBookingsForProperty(env, propertyName)` (~482), `getPropertyMetaMap(env)` (~182), `generateBookingRef()` (~703, returnerer `2GM-XXXXXX`). `LIST_IDS.BOOKINGS` og `SITE_ID` er modul-private konstanter.
- `createBookingRow` (~712) er BEDRIFTS-spesifikk (`Source: "Portal"`, `Pending_Confirmation: true`). Den røres IKKE. Vi legger til en egen `createPublicHoldRow`.
- Norsk telefon/e-post-validering finnes i `functions/api/submit-booking.js` som `_isValidNoPhone` / `_isValidEmail` (nederst i fila). Vi dupliserer reglene i det nye endepunktet (defense-in-depth, samme som submit-booking gjør).
- SharePoint-felt som FINNES (opprettet av Frank): på `Booking`: `HoldExpiry` (dato/tid), `PaidAt` (dato/tid), `PaymentStatus` (valg: pending/paid/refunded), `PaymentRef` (tekst). Eksisterende relevante felt: `Status` (Upcoming/Cancelled), `Pending_Confirmation` (bool), `Source` (tekst, tar `"Public"`), `RoomLookupId`, `Door_Code`, `Check_In`, `Check_Out`, `Person_Name`, `Mobile`, `Email`, `Title`.

## Domene-shapes & grensesnitt (felles for alle tasks)

**Normalisert rom** (det `pickRoomForPeriod` og store bruker):
```
{ id: string, publicBookable: boolean, longTermStartMs: number|null, longTermEndMs: number|null }
```

**Normalisert booking** (det orkestrator/store/rene funksjoner bruker):
```
{
  id: string,            // SP item-id (null før opprettelse)
  bookingRef: string,    // Title, "2GM-XXXXXX"
  roomId: string|null,   // RoomLookupId
  checkInMs: number,
  checkOutMs: number|null,
  status: string,        // SP Status: 'Upcoming' | 'Cancelled'
  paymentStatus: string, // 'pending' | 'paid' | 'refunded'
  holdExpiryMs: number|null,
  paidAtMs: number|null,
  codesGenerated: boolean,// store mapper dette <-> Door_Code ikke-tom
  source: string         // 'Public' | 'Portal' | 'In-house' | ...
}
```

**Tilstandsbegreper:** `confirmed ⇔ paymentStatus==='paid' && codesGenerated`. `hold (pending) ⇔ source==='Public' && status!=='Cancelled' && paymentStatus==='pending'`.

**Store-grensesnitt** (prod = SharePoint-basert; test = in-memory):
```
getRooms(propertyName) -> Promise<NormalizedRoom[]>
getBookings(propertyName) -> Promise<NormalizedBooking[]>
createHold({ bookingRef, roomId, checkInISO, checkOutISO, guest, holdExpiryMs, paymentRef }) -> Promise<{ id, bookingRef }>
update(id, patch) -> Promise<void>   // patch = delmengde av normaliserte felt
```

**Provider-grensesnitt:**
```
payment.initiate({ bookingRef, amount }) -> Promise<{ paymentRef, status }>
payment.refund({ paymentRef }) -> Promise<void>
lock.generateGuestCodes({ booking }) -> Promise<{ entranceCode, roomCode }>   // kaster ved feil
```

**Klokke:** `now() -> number` (ms). Injiseres så tester er deterministiske.

**Konstanter:** `HOLD_WINDOW_MS = 15*60*1000`, `CODE_WINDOW_MS = 30*60*1000`.

## Filstruktur

| Fil | Ansvar |
|-----|--------|
| `functions/_utils/booking-state.js` (ny) | Rene tilstandsfunksjoner + konstanter: `isHoldExpired`, `isCodeWindowExpired`, `onPaid`, `onCodesOk`, `onCodesFailedFinal`, `onCancelled`. |
| `functions/_utils/booking-allocation.js` (ny) | Ren `pickRoomForPeriod`. |
| `functions/_utils/booking-holds.js` (ny) | Ren `filterExpiredHolds`. |
| `functions/_utils/sharepoint.js` (endre) | Legg til `createPublicHoldRow` (additivt). |
| `functions/_utils/booking-store.js` (ny) | Prod-store over sharepoint.js + SP↔normalisert-mapping. |
| `functions/_utils/providers-mock.js` (ny) | `mockPayment`, `mockLock` (Fase 2). |
| `functions/_utils/booking-orchestrator.js` (ny) | `createHold`, `confirmPayment`, `tryGenerateCodes`, `releaseExpiredHolds`, `expireCodeWindows` (deps-injisert). |
| `functions/_utils/public-availability.js` (endre) | Kjør `filterExpiredHolds` før telling. |
| `functions/api/public-booking.js` (ny) | POST create-hold-endepunkt. |
| `tests/booking-state.test.mjs`, `tests/booking-allocation.test.mjs`, `tests/booking-holds.test.mjs`, `tests/booking-orchestrator.test.mjs` (nye) | Enhetstester. |

Implementører committer LOKALT (ikke push). Push/deploy gjøres samlet til slutt (egen verifiseringstask), som i Fase 1.

---

## Task 1: Tilstandsfunksjoner (rene) + tester

**Files:**
- Create: `functions/_utils/booking-state.js`
- Test: `tests/booking-state.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/booking-state.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_WINDOW_MS,
  CODE_WINDOW_MS,
  isHoldExpired,
  isCodeWindowExpired,
  onPaid,
  onCodesOk,
  onCodesFailedFinal,
  onCancelled,
} from "../functions/_utils/booking-state.js";

const T = Date.UTC(2026, 5, 14, 12, 0, 0);

function holdBooking(over = {}) {
  return {
    id: "1", bookingRef: "2GM-AAAAAA", roomId: "10",
    checkInMs: Date.UTC(2026, 5, 20), checkOutMs: Date.UTC(2026, 5, 22),
    status: "Upcoming", paymentStatus: "pending",
    holdExpiryMs: T + HOLD_WINDOW_MS, paidAtMs: null,
    codesGenerated: false, source: "Public",
    ...over,
  };
}

test("constants are 15 and 30 minutes", () => {
  assert.equal(HOLD_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(CODE_WINDOW_MS, 30 * 60 * 1000);
});

test("isHoldExpired: unpaid public hold past expiry -> true", () => {
  const b = holdBooking({ holdExpiryMs: T - 1 });
  assert.equal(isHoldExpired(b, T), true);
});

test("isHoldExpired: not yet past expiry -> false", () => {
  const b = holdBooking({ holdExpiryMs: T + 1 });
  assert.equal(isHoldExpired(b, T), false);
});

test("isHoldExpired: paid hold never expires on hold window", () => {
  const b = holdBooking({ paymentStatus: "paid", holdExpiryMs: T - 1000 });
  assert.equal(isHoldExpired(b, T), false);
});

test("isHoldExpired: cancelled never expires", () => {
  const b = holdBooking({ status: "Cancelled", holdExpiryMs: T - 1000 });
  assert.equal(isHoldExpired(b, T), false);
});

test("isHoldExpired: non-public ignored", () => {
  const b = holdBooking({ source: "Portal", holdExpiryMs: T - 1000 });
  assert.equal(isHoldExpired(b, T), false);
});

test("isCodeWindowExpired: paid, no codes, past window -> true", () => {
  const b = holdBooking({ paymentStatus: "paid", paidAtMs: T - CODE_WINDOW_MS - 1, codesGenerated: false });
  assert.equal(isCodeWindowExpired(b, T), true);
});

test("isCodeWindowExpired: within window -> false", () => {
  const b = holdBooking({ paymentStatus: "paid", paidAtMs: T - 1000, codesGenerated: false });
  assert.equal(isCodeWindowExpired(b, T), false);
});

test("isCodeWindowExpired: codes already generated -> false", () => {
  const b = holdBooking({ paymentStatus: "paid", paidAtMs: T - CODE_WINDOW_MS - 1, codesGenerated: true });
  assert.equal(isCodeWindowExpired(b, T), false);
});

test("isCodeWindowExpired: unpaid -> false", () => {
  const b = holdBooking({ paymentStatus: "pending", paidAtMs: null });
  assert.equal(isCodeWindowExpired(b, T), false);
});

test("onPaid patch sets paid + paidAt", () => {
  assert.deepEqual(onPaid(T), { paymentStatus: "paid", paidAtMs: T });
});

test("onCodesOk patch marks codesGenerated + roomCode", () => {
  assert.deepEqual(onCodesOk("4711"), { codesGenerated: true, roomCode: "4711" });
});

test("onCodesFailedFinal patch refunds + cancels", () => {
  assert.deepEqual(onCodesFailedFinal(), { paymentStatus: "refunded", status: "Cancelled" });
});

test("onCancelled patch cancels", () => {
  assert.deepEqual(onCancelled(), { status: "Cancelled" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/booking-state.test.mjs`
Expected: FAIL — cannot find module `booking-state.js`.

- [ ] **Step 3: Write the implementation**

Create `functions/_utils/booking-state.js`:

```javascript
// functions/_utils/booking-state.js
// v1.0 — Rene tilstandsfunksjoner for privat-bookingens livssyklus. INGEN I/O.
// confirmed <=> paymentStatus==='paid' && codesGenerated.
// Overgangsfunksjonene returnerer en felt-PATCH (rent objekt) — de skriver ingenting.

export const HOLD_WINDOW_MS = 15 * 60 * 1000;
export const CODE_WINDOW_MS = 30 * 60 * 1000;

// Et ubetalt offentlig hold som har passert holdvinduet.
export function isHoldExpired(b, nowMs) {
  return (
    b.source === "Public" &&
    b.status !== "Cancelled" &&
    b.paymentStatus === "pending" &&
    b.holdExpiryMs != null &&
    b.holdExpiryMs < nowMs
  );
}

// En betalt booking som mangler koder og har passert kodevinduet (-> auto-refund).
export function isCodeWindowExpired(b, nowMs) {
  return (
    b.source === "Public" &&
    b.status !== "Cancelled" &&
    b.paymentStatus === "paid" &&
    !b.codesGenerated &&
    b.paidAtMs != null &&
    b.paidAtMs + CODE_WINDOW_MS < nowMs
  );
}

export function onPaid(nowMs) {
  return { paymentStatus: "paid", paidAtMs: nowMs };
}

export function onCodesOk(roomCode) {
  return { codesGenerated: true, roomCode };
}

export function onCodesFailedFinal() {
  return { paymentStatus: "refunded", status: "Cancelled" };
}

export function onCancelled() {
  return { status: "Cancelled" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/booking-state.test.mjs`
Expected: PASS (14 tester).

- [ ] **Step 5: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/booking-state.js tests/booking-state.test.mjs
git commit -m "feat: pure booking state transitions + windows"
```

---

## Task 2: Rom-tildeling (ren) + tester

**Files:**
- Create: `functions/_utils/booking-allocation.js`
- Test: `tests/booking-allocation.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/booking-allocation.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRoomForPeriod } from "../functions/_utils/booking-allocation.js";

const from = Date.UTC(2026, 5, 20);
const to = Date.UTC(2026, 5, 22);

function room(id, over = {}) {
  return { id, publicBookable: true, longTermStartMs: null, longTermEndMs: null, ...over };
}

test("picks lowest-id free public room", () => {
  const rooms = [room("12"), room("3"), room("7")];
  const got = pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to });
  assert.equal(got, "3");
});

test("skips a room with an overlapping assigned booking", () => {
  const rooms = [room("3"), room("7")];
  const bookings = [
    { roomId: "3", checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23) },
  ];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "7");
});

test("ignores unassigned bookings (roomId null/empty) when picking", () => {
  const rooms = [room("3")];
  const bookings = [
    { roomId: "", checkInMs: from, checkOutMs: to },
    { roomId: null, checkInMs: from, checkOutMs: to },
  ];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "3");
});

test("skips non-publicBookable rooms", () => {
  const rooms = [room("3", { publicBookable: false }), room("7")];
  assert.equal(pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to }), "7");
});

test("skips a room on long-term overlapping the period", () => {
  const rooms = [
    room("3", { longTermStartMs: Date.UTC(2026, 0, 1), longTermEndMs: null }),
    room("7"),
  ];
  assert.equal(pickRoomForPeriod({ rooms, bookings: [], fromMs: from, toMs: to }), "7");
});

test("returns null when nothing free", () => {
  const rooms = [room("3")];
  const bookings = [{ roomId: "3", checkInMs: from, checkOutMs: to }];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), null);
});

test("non-overlapping assigned booking does not block", () => {
  const rooms = [room("3")];
  const bookings = [
    { roomId: "3", checkInMs: Date.UTC(2026, 5, 1), checkOutMs: Date.UTC(2026, 5, 3) },
  ];
  assert.equal(pickRoomForPeriod({ rooms, bookings, fromMs: from, toMs: to }), "3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/booking-allocation.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `functions/_utils/booking-allocation.js`:

```javascript
// functions/_utils/booking-allocation.js
// v1.0 — Ren rom-tildeling. INGEN I/O. Velger et konkret PublicBookable-rom som er
// ledig i hele perioden, deterministisk (laveste rom-id numerisk).

// Inklusiv overlapp mellom [aStart,aEnd] og [bStart,bEnd]. bEnd=null => open-ended.
function periodsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  if (bStartMs == null) return false;
  const aEnd = aEndMs == null ? Infinity : aEndMs;
  const bEnd = bEndMs == null ? Infinity : bEndMs;
  return aStartMs <= bEnd && bStartMs <= aEnd;
}

// rooms: NormalizedRoom[]; bookings: [{ roomId, checkInMs, checkOutMs }] (alle bookinger
// som kan oppta rom — kalleren har allerede filtrert til aktive/upcoming + droppet utløpte hold).
// Returnerer rom-id (string) eller null.
export function pickRoomForPeriod({ rooms, bookings, fromMs, toMs }) {
  const assignedOverlap = new Set();
  for (const b of bookings) {
    const rid = b.roomId == null ? "" : String(b.roomId);
    if (!rid) continue; // ikke-tildelt booking holder ikke et konkret rom
    if (periodsOverlap(fromMs, toMs, b.checkInMs, b.checkOutMs)) {
      assignedOverlap.add(rid);
    }
  }

  const candidates = rooms.filter((r) => {
    if (!r.publicBookable) return false;
    if (periodsOverlap(fromMs, toMs, r.longTermStartMs, r.longTermEndMs)) return false;
    if (assignedOverlap.has(String(r.id))) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
  return String(candidates[0].id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/booking-allocation.test.mjs`
Expected: PASS (7 tester).

- [ ] **Step 5: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/booking-allocation.js tests/booking-allocation.test.mjs
git commit -m "feat: pure room allocation for public bookings"
```

---

## Task 3: Hold-utløpsfilter (rent) + tester

**Files:**
- Create: `functions/_utils/booking-holds.js`
- Test: `tests/booking-holds.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/booking-holds.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterExpiredHolds } from "../functions/_utils/booking-holds.js";
import { HOLD_WINDOW_MS } from "../functions/_utils/booking-state.js";

const T = Date.UTC(2026, 5, 14, 12, 0, 0);

function b(over) {
  return {
    id: "1", source: "Public", status: "Upcoming", paymentStatus: "pending",
    holdExpiryMs: T + HOLD_WINDOW_MS, paidAtMs: null, codesGenerated: false,
    ...over,
  };
}

test("drops expired unpaid public holds", () => {
  const list = [b({ id: "a", holdExpiryMs: T - 1 }), b({ id: "b", holdExpiryMs: T + 1 })];
  const kept = filterExpiredHolds(list, T);
  assert.deepEqual(kept.map((x) => x.id), ["b"]);
});

test("keeps paid holds even past hold window", () => {
  const list = [b({ id: "a", paymentStatus: "paid", holdExpiryMs: T - 1000 })];
  assert.equal(filterExpiredHolds(list, T).length, 1);
});

test("keeps non-public bookings regardless of expiry", () => {
  const list = [b({ id: "a", source: "Portal", holdExpiryMs: T - 1000 })];
  assert.equal(filterExpiredHolds(list, T).length, 1);
});

test("empty list returns empty", () => {
  assert.deepEqual(filterExpiredHolds([], T), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/booking-holds.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `functions/_utils/booking-holds.js`:

```javascript
// functions/_utils/booking-holds.js
// v1.0 — Ren hjelpe-funksjon: fjern utløpte ubetalte offentlige hold fra en
// booking-liste. Brukes av ledighetsberegningen og av hold-opprettelsen så et
// abandonert hold ikke blokkerer nye gjester. INGEN I/O.

import { isHoldExpired } from "./booking-state.js";

export function filterExpiredHolds(bookings, nowMs) {
  return bookings.filter((b) => !isHoldExpired(b, nowMs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/booking-holds.test.mjs`
Expected: PASS (4 tester).

- [ ] **Step 5: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/booking-holds.js tests/booking-holds.test.mjs
git commit -m "feat: filterExpiredHolds pure helper"
```

---

## Task 4: `createPublicHoldRow` i sharepoint.js

**Files:**
- Modify: `functions/_utils/sharepoint.js` (additivt — ny eksportert funksjon etter `createBookingRows`, ~linje 769)

- [ ] **Step 1: Add the function**

Etter slutten av `createBookingRows` (~linje 769) i `functions/_utils/sharepoint.js`, legg til:

```javascript

// Oppretter en PRIVAT (publikum) hold-rad. Skiller seg fra createBookingRow ved:
// Source="Public", Pending_Confirmation=false (auto-tildelt, aldri i admins
// manuelle kø), konkret RoomLookupId, HoldExpiry + PaymentStatus=pending satt.
// Datoer er ISO 'YYYY-MM-DD'; holdExpiryISO er full ISO-tid. Returnerer Graph-raden.
export async function createPublicHoldRow(env, fields) {
  const path = `/sites/${SITE_ID}/lists/${LIST_IDS.BOOKINGS}/items`;
  const spFields = {
    Title: fields.bookingRef,
    Property_Name: fields.propertyName,
    Person_Name: fields.guestName,
    Mobile: fields.guestPhone || null,
    Email: fields.guestEmail || null,
    Check_In: fields.checkIn,
    Check_Out: fields.checkOut || null,
    RoomLookupId: fields.roomId,
    Status: "Upcoming",
    Pending_Confirmation: false,
    Source: "Public",
    PaymentStatus: "pending",
    HoldExpiry: fields.holdExpiryISO,
    PaymentRef: fields.paymentRef || null,
  };
  for (const k of Object.keys(spFields)) {
    if (spFields[k] === null || spFields[k] === undefined) delete spFields[k];
  }
  return graphRequest(env, path, {
    method: "POST",
    body: JSON.stringify({ fields: spFields }),
  });
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/_utils/sharepoint.js').then(m => console.log(typeof m.createPublicHoldRow))"`
Expected: prints `function`

- [ ] **Step 3: Confirm additive-only**

Run: `git diff -- functions/_utils/sharepoint.js`
Expected: additions only (no `-` lines beyond context).

- [ ] **Step 4: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/sharepoint.js
git commit -m "feat: createPublicHoldRow for public hold rows"
```

---

## Task 5: Prod-store (`booking-store.js`)

**Files:**
- Create: `functions/_utils/booking-store.js`

Ingen automatisk test (krever Graph). Verifiseres via orkestrator-testene (in-memory store) + import-sjekk; live senere. Holdes tynn — kun mapping SP↔normalisert.

- [ ] **Step 1: Write the implementation**

Create `functions/_utils/booking-store.js`:

```javascript
// functions/_utils/booking-store.js
// v1.0 — SharePoint-basert store for privat-bookingflyten. Mapper mellom SP-felt
// og den normaliserte booking/rom-shapen orkestratoren bruker. Tynn — ingen
// forretningslogikk. Door_Code-tilstedeværelse <=> codesGenerated.

import {
  getPropertyMetaMap,
  getRoomsForProperty,
  getBookingsForProperty,
  createPublicHoldRow,
  updateBookingFields,
} from "./sharepoint.js";
import { parseDateUtcMs } from "./availability-math.js";

function msToISODateTime(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

// Mapper en normalisert patch til SP-feltnavn.
function patchToSpFields(patch) {
  const sp = {};
  if ("status" in patch) sp.Status = patch.status;
  if ("paymentStatus" in patch) sp.PaymentStatus = patch.paymentStatus;
  if ("paidAtMs" in patch) sp.PaidAt = msToISODateTime(patch.paidAtMs);
  if ("paymentRef" in patch) sp.PaymentRef = patch.paymentRef;
  if ("roomId" in patch) sp.RoomLookupId = patch.roomId;
  if ("codesGenerated" in patch && patch.codesGenerated) {
    sp.Door_Code = patch.roomCode != null ? String(patch.roomCode) : "GENERATED";
  }
  return sp;
}

export function createSharePointStore(env, propertyName) {
  return {
    async getRooms() {
      const meta = await getPropertyMetaMap(env);
      const propertyMap = {};
      for (const [id, m] of Object.entries(meta)) if (m.title) propertyMap[id] = m.title;
      const items = await getRoomsForProperty(env, propertyName, propertyMap);
      return items.map((it) => {
        const f = it.fields || {};
        return {
          id: String(it.id),
          publicBookable: f.PublicBookable !== false,
          longTermStartMs: parseDateUtcMs(f.LongTerm_StartDate),
          longTermEndMs: parseDateUtcMs(f.LongTerm_EndDate),
        };
      });
    },

    async getBookings() {
      const items = await getBookingsForProperty(env, propertyName);
      return items.map((it) => {
        const f = it.fields || {};
        return {
          id: String(it.id),
          bookingRef: f.Title || "",
          roomId: f.RoomLookupId != null ? String(f.RoomLookupId) : null,
          checkInMs: parseDateUtcMs(f.Check_In),
          checkOutMs: parseDateUtcMs(f.Check_Out),
          status: f.Status || "",
          paymentStatus: f.PaymentStatus || "pending",
          holdExpiryMs: parseDateUtcMs(f.HoldExpiry),
          paidAtMs: parseDateUtcMs(f.PaidAt),
          codesGenerated: !!(f.Door_Code && String(f.Door_Code).trim()),
          source: f.Source || "",
        };
      });
    },

    async createHold({ bookingRef, roomId, checkInISO, checkOutISO, guest, holdExpiryMs, paymentRef }) {
      const res = await createPublicHoldRow(env, {
        bookingRef,
        propertyName,
        guestName: guest.name,
        guestPhone: guest.phone || null,
        guestEmail: guest.email || null,
        checkIn: checkInISO,
        checkOut: checkOutISO || null,
        roomId,
        holdExpiryISO: msToISODateTime(holdExpiryMs),
        paymentRef: paymentRef || null,
      });
      return { id: res && res.id ? String(res.id) : null, bookingRef };
    },

    async update(id, patch) {
      await updateBookingFields(env, id, patchToSpFields(patch));
    },
  };
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/_utils/booking-store.js').then(m => console.log(typeof m.createSharePointStore))"`
Expected: prints `function`

- [ ] **Step 3: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/booking-store.js
git commit -m "feat: SharePoint-backed store for public booking flow"
```

---

## Task 6: Mock-providere (`providers-mock.js`)

**Files:**
- Create: `functions/_utils/providers-mock.js`

- [ ] **Step 1: Write the implementation**

Create `functions/_utils/providers-mock.js`:

```javascript
// functions/_utils/providers-mock.js
// v1.0 — Mock betalings- og lås-providere for Fase 2. Ekte Vipps (Fase 4) og
// Yale/Tuya (Fase 5) implementerer samme grensesnitt. Mocken er deterministisk:
// betaling "initieres" som pending med en placeholder-ref; kode-generering
// lykkes og returnerer placeholder-koder.

export const mockPayment = {
  async initiate({ bookingRef }) {
    return { paymentRef: `MOCK-${bookingRef}`, status: "pending" };
  },
  async refund(_args) {
    return;
  },
};

export const mockLock = {
  async generateGuestCodes({ booking }) {
    // Deterministisk placeholder; ekte koder kommer i Fase 5.
    const suffix = String(booking.roomId || "0").padStart(4, "0").slice(-4);
    return { entranceCode: `1${suffix}`, roomCode: `2${suffix}` };
  },
};
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/_utils/providers-mock.js').then(m => console.log(typeof m.mockPayment.initiate, typeof m.mockLock.generateGuestCodes))"`
Expected: prints `function function`

- [ ] **Step 3: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/providers-mock.js
git commit -m "feat: mock payment + lock providers for Fase 2"
```

---

## Task 7: Orkestrator + tester

**Files:**
- Create: `functions/_utils/booking-orchestrator.js`
- Test: `tests/booking-orchestrator.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/booking-orchestrator.test.mjs` (in-memory store + drivbare mock-providere + injisert klokke):

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHold,
  confirmPayment,
  tryGenerateCodes,
  releaseExpiredHolds,
  expireCodeWindows,
} from "../functions/_utils/booking-orchestrator.js";
import { HOLD_WINDOW_MS, CODE_WINDOW_MS } from "../functions/_utils/booking-state.js";

const FROM = "2026-06-20";
const TO = "2026-06-22";
const T0 = Date.UTC(2026, 5, 14, 12, 0, 0);

// In-memory store implementing the store-grensesnittet.
function makeStore(rooms) {
  const bookings = [];
  let seq = 0;
  return {
    _bookings: bookings,
    async getRooms() { return rooms.map((r) => ({ ...r })); },
    async getBookings() { return bookings.map((b) => ({ ...b })); },
    async createHold({ bookingRef, roomId, checkInISO, checkOutISO, guest, holdExpiryMs, paymentRef }) {
      const id = String(++seq);
      bookings.push({
        id, bookingRef, roomId,
        checkInMs: Date.UTC(2026, 5, 20), checkOutMs: Date.UTC(2026, 5, 22),
        status: "Upcoming", paymentStatus: "pending",
        holdExpiryMs, paidAtMs: null, codesGenerated: false, source: "Public",
        paymentRef: paymentRef || null, guest,
      });
      return { id, bookingRef };
    },
    async update(id, patch) {
      const b = bookings.find((x) => x.id === id);
      Object.assign(b, patch);
    },
  };
}

function room(id, over = {}) {
  return { id, publicBookable: true, longTermStartMs: null, longTermEndMs: null, ...over };
}

function makeDeps(store, { lockFails = false, clock } = {}) {
  let refSeq = 0;
  return {
    store,
    now: clock || (() => T0),
    generateRef: () => `2GM-TEST${++refSeq}`,
    payment: {
      initiate: async ({ bookingRef }) => ({ paymentRef: `PAY-${bookingRef}`, status: "pending" }),
      refund: async () => {},
    },
    lock: {
      generateGuestCodes: async () => {
        if (lockFails) throw new Error("lock down");
        return { entranceCode: "1000", roomCode: "2000" };
      },
    },
    propertyName: "Rigg Andslimoen",
    nightlyRate: 650,
  };
}

test("createHold: assigns room, creates pending hold, returns refs", async () => {
  const store = makeStore([room("3"), room("7")]);
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  assert.equal(res.ok, true);
  assert.match(res.bookingRef, /^2GM-TEST/);
  assert.equal(res.paymentRef, `PAY-${res.bookingRef}`);
  assert.equal(store._bookings.length, 1);
  const b = store._bookings[0];
  assert.equal(b.roomId, "3");
  assert.equal(b.status, "Upcoming");
  assert.equal(b.paymentStatus, "pending");
  assert.equal(b.holdExpiryMs, T0 + HOLD_WINDOW_MS);
});

test("createHold: sold_out when no room free", async () => {
  const store = makeStore([room("3")]);
  // Forhåndsfyll med en overlappende tildelt booking.
  store._bookings.push({
    id: "x", bookingRef: "2GM-OLD", roomId: "3",
    checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23),
    status: "Upcoming", paymentStatus: "paid", holdExpiryMs: null, paidAtMs: T0,
    codesGenerated: true, source: "Public",
  });
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Kari", phone: "99112233" } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "sold_out");
  assert.equal(store._bookings.length, 1); // ingen ny rad
});

test("createHold: an expired unpaid hold frees the room", async () => {
  const store = makeStore([room("3")]);
  store._bookings.push({
    id: "x", bookingRef: "2GM-OLD", roomId: "3",
    checkInMs: Date.UTC(2026, 5, 21), checkOutMs: Date.UTC(2026, 5, 23),
    status: "Upcoming", paymentStatus: "pending", holdExpiryMs: T0 - 1, paidAtMs: null,
    codesGenerated: false, source: "Public",
  });
  const deps = makeDeps(store);
  const res = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Per", phone: "99112233" } });
  assert.equal(res.ok, true);
  assert.equal(res.bookingRef.startsWith("2GM-TEST"), true);
  // Det utløpte holdet skal være kansellert av opprydningen.
  assert.equal(store._bookings.find((b) => b.id === "x").status, "Cancelled");
});

test("happy path: confirmPayment -> codes ok -> confirmed", async () => {
  const store = makeStore([room("3")]);
  const deps = makeDeps(store);
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef);
  const b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "paid");
  assert.equal(b.paidAtMs, T0);
  assert.equal(b.codesGenerated, true);
  assert.equal(b.roomCode, "2000");
  assert.equal(b.status, "Upcoming"); // confirmed = paid+codes, ikke en Status-endring
});

test("code failure leaves booking paid+pending-codes for retry, then succeeds", async () => {
  const store = makeStore([room("3")]);
  const deps = makeDeps(store, { lockFails: true });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef);
  let b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "paid");
  assert.equal(b.codesGenerated, false);
  // Lås kommer tilbake; retry lykkes.
  deps.lock.generateGuestCodes = async () => ({ entranceCode: "1000", roomCode: "2000" });
  await tryGenerateCodes(deps, bookingRef);
  b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.codesGenerated, true);
});

test("expireCodeWindows refunds + cancels a paid booking stuck without codes", async () => {
  const store = makeStore([room("3")]);
  let nowMs = T0;
  const deps = makeDeps(store, { lockFails: true, clock: () => nowMs });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  await confirmPayment(deps, bookingRef); // paid, men koder feilet
  nowMs = T0 + CODE_WINDOW_MS + 1;        // forbi kodevinduet
  const n = await expireCodeWindows(deps);
  assert.equal(n, 1);
  const b = store._bookings.find((x) => x.bookingRef === bookingRef);
  assert.equal(b.paymentStatus, "refunded");
  assert.equal(b.status, "Cancelled");
});

test("releaseExpiredHolds cancels expired unpaid holds", async () => {
  const store = makeStore([room("3")]);
  let nowMs = T0;
  const deps = makeDeps(store, { clock: () => nowMs });
  const { bookingRef } = await createHold(deps, { fromISO: FROM, toISO: TO, guest: { name: "Ola", phone: "99112233" } });
  nowMs = T0 + HOLD_WINDOW_MS + 1; // forbi holdvinduet, fortsatt ubetalt
  const n = await releaseExpiredHolds(deps);
  assert.equal(n, 1);
  assert.equal(store._bookings.find((x) => x.bookingRef === bookingRef).status, "Cancelled");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/booking-orchestrator.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `functions/_utils/booking-orchestrator.js`:

```javascript
// functions/_utils/booking-orchestrator.js
// v1.0 — Orkestrerer privat-bookingflyten over injiserte avhengigheter
// (deps = { store, payment, lock, now, generateRef, propertyName, nightlyRate }).
// All telling/tilstandslogikk ligger i de rene modulene; dette laget wirer dem
// til store + providere + klokke.

import { parseDateUtcMs } from "./availability-math.js";
import { pickRoomForPeriod } from "./booking-allocation.js";
import { filterExpiredHolds } from "./booking-holds.js";
import {
  HOLD_WINDOW_MS,
  isHoldExpired,
  isCodeWindowExpired,
  onPaid,
  onCodesOk,
  onCodesFailedFinal,
  onCancelled,
} from "./booking-state.js";

function nightsBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) return 0;
  const n = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
  return n > 0 ? n : 0;
}

// Oppretter et hold: rydder utløpte hold, velger rom, oppretter pending-rad,
// starter betaling. Returnerer { ok, bookingRef, paymentRef } eller { ok:false, error }.
export async function createHold(deps, { fromISO, toISO, guest }) {
  const now = deps.now();
  const fromMs = parseDateUtcMs(fromISO);
  const toMs = parseDateUtcMs(toISO);
  if (fromMs == null || toMs == null || toMs < fromMs) {
    return { ok: false, error: "invalid_dates" };
  }

  const [rooms, allBookings] = await Promise.all([deps.store.getRooms(), deps.store.getBookings()]);

  // Opportunistisk opprydding: kanseller utløpte ubetalte hold før vi tildeler.
  for (const b of allBookings) {
    if (isHoldExpired(b, now)) await deps.store.update(b.id, onCancelled());
  }
  const active = filterExpiredHolds(allBookings, now);

  const roomId = pickRoomForPeriod({ rooms, bookings: active, fromMs, toMs });
  if (roomId == null) return { ok: false, error: "sold_out" };

  const bookingRef = deps.generateRef();
  const holdExpiryMs = now + HOLD_WINDOW_MS;
  const created = await deps.store.createHold({
    bookingRef, roomId, checkInISO: fromISO, checkOutISO: toISO, guest, holdExpiryMs,
  });

  const amount = nightsBetween(fromMs, toMs) * (deps.nightlyRate || 0);
  const pay = await deps.payment.initiate({ bookingRef, amount });
  await deps.store.update(created.id, { paymentRef: pay.paymentRef });

  return { ok: true, bookingRef, paymentRef: pay.paymentRef };
}

async function findByRef(deps, bookingRef) {
  const all = await deps.store.getBookings();
  return all.find((b) => b.bookingRef === bookingRef) || null;
}

// Markerer betaling som mottatt og forsøker straks å generere koder.
export async function confirmPayment(deps, bookingRef) {
  const b = await findByRef(deps, bookingRef);
  if (!b) return { ok: false, error: "not_found" };
  if (b.status === "Cancelled") return { ok: false, error: "cancelled" };
  if (b.paymentStatus !== "paid") {
    await deps.store.update(b.id, onPaid(deps.now()));
  }
  return tryGenerateCodes(deps, bookingRef);
}

// Forsøker kode-generering for en betalt booking. Ved feil lar den raden stå
// (paid, uten koder) for senere retry. Idempotent: noop hvis allerede generert.
export async function tryGenerateCodes(deps, bookingRef) {
  const b = await findByRef(deps, bookingRef);
  if (!b) return { ok: false, error: "not_found" };
  if (b.status === "Cancelled") return { ok: false, error: "cancelled" };
  if (b.paymentStatus !== "paid") return { ok: false, error: "not_paid" };
  if (b.codesGenerated) return { ok: true, alreadyDone: true };
  try {
    const codes = await deps.lock.generateGuestCodes({ booking: b });
    await deps.store.update(b.id, onCodesOk(codes.roomCode));
    return { ok: true };
  } catch (_e) {
    return { ok: false, error: "code_generation_failed" };
  }
}

// Kanseller utløpte ubetalte hold (opprydding). Returnerer antall frigjort.
export async function releaseExpiredHolds(deps) {
  const now = deps.now();
  const all = await deps.store.getBookings();
  let n = 0;
  for (const b of all) {
    if (isHoldExpired(b, now)) {
      await deps.store.update(b.id, onCancelled());
      n++;
    }
  }
  return n;
}

// Refunder + kanseller betalte bookinger som har passert kodevinduet uten koder.
// Returnerer antall behandlet.
export async function expireCodeWindows(deps) {
  const now = deps.now();
  const all = await deps.store.getBookings();
  let n = 0;
  for (const b of all) {
    if (isCodeWindowExpired(b, now)) {
      if (b.paymentRef) await deps.payment.refund({ paymentRef: b.paymentRef });
      await deps.store.update(b.id, onCodesFailedFinal());
      n++;
    }
  }
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/booking-orchestrator.test.mjs`
Expected: PASS (7 tester).

- [ ] **Step 5: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/booking-orchestrator.js tests/booking-orchestrator.test.mjs
git commit -m "feat: public booking orchestrator (hold/confirm/codes/expiry)"
```

---

## Task 8: Anvend hold-utløp i Fase 1-ledigheten

**Files:**
- Modify: `functions/_utils/public-availability.js`

Utløpte ubetalte hold skal ikke telle som opptatt. `calculatePublicAvailability` skal kjøre booking-listen gjennom `filterExpiredHolds` før telling. Den rene `computePublicAvailability` er UENDRET.

- [ ] **Step 1: Update the wrapper**

I `functions/_utils/public-availability.js`:

1. Legg til imports øverst (etter de eksisterende importene):
```javascript
import { filterExpiredHolds } from "./booking-holds.js";
```

2. Bygg en rikere booking-liste, filtrer utløpte hold, og map så til mattens shape. Erstatt det eksisterende `const bookings = bookingItems...`-blokket med:

```javascript
  const now = Date.now();
  const richBookings = bookingItems
    .map((it) => {
      const f = it.fields || {};
      return {
        checkInMs: parseDateUtcMs(f.Check_In),
        checkOutMs: parseDateUtcMs(f.Check_Out),
        source: String(f.Source || ""),
        status: f.Status || "",
        paymentStatus: f.PaymentStatus || "pending",
        holdExpiryMs: parseDateUtcMs(f.HoldExpiry),
      };
    })
    .filter((b) => b.checkInMs !== null);

  const bookings = filterExpiredHolds(richBookings, now).map((b) => ({
    checkInMs: b.checkInMs,
    checkOutMs: b.checkOutMs,
    isPublic: b.source === "Public",
  }));
```

(Behold resten av funksjonen — `computePublicAvailability({ rooms, bookings, fromMs, toMs })` og returen — uendret.)

- [ ] **Step 2: Verify imports + existing unit tests still pass**

Run: `node -e "import('./functions/_utils/public-availability.js').then(m => console.log(typeof m.calculatePublicAvailability))"`
Expected: prints `function`

Run: `node --test tests/availability-math.test.mjs`
Expected: PASS (de rene mattetestene er uendret og skal fortsatt passere — vi rørte ikke `availability-math.js`).

- [ ] **Step 3: Confirm the pure math file is untouched**

Run: `git diff --name-only HEAD`
Expected: only `functions/_utils/public-availability.js` listed (ikke `availability-math.js`).

- [ ] **Step 4: Commit (LOCAL ONLY — no push)**

```bash
git add functions/_utils/public-availability.js
git commit -m "feat: drop expired unpaid holds from public availability count"
```

---

## Task 9: `/api/public-booking`-endepunkt

**Files:**
- Create: `functions/api/public-booking.js`

- [ ] **Step 1: Write the implementation**

Create `functions/api/public-booking.js` (speiler CORS/feil-mønsteret fra `availability.js` og `public-availability.js`; bruker prod-store + mock-providere):

```javascript
// functions/api/public-booking.js
// v1.0 — Anonymt create-hold-endepunkt for den offentlige bookingsiden.
//
// POST /api/public-booking
// Body: { fromDate, toDate, guest: { name, phone, email? } }
// Returnerer:
//   { ok: true, bookingRef, paymentRef }
//   { ok: false, error: "public_booking_disabled" | "invalid_request" |
//                        "invalid_dates" | "invalid_guest" | "sold_out" | "internal_error" }
//
// Bundet til Rigg Andslimoen. Ingen token. Betaling/lås er mock i Fase 2 — den
// ekte Vipps-callbacken (som kaller confirmPayment) wires i Fase 4.

import { getPublicConfig } from "../_utils/sharepoint.js";
import { createSharePointStore } from "../_utils/booking-store.js";
import { mockPayment, mockLock } from "../_utils/providers-mock.js";
import { generateBookingRef } from "../_utils/sharepoint.js";
import { createHold } from "../_utils/booking-orchestrator.js";

const PROPERTY_NAME = "Rigg Andslimoen";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }
    const { fromDate, toDate, guest } = body || {};

    if (!fromDate || !toDate) return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    if (!guest || typeof guest.name !== "string" || !guest.name.trim() || !_isValidNoPhone(guest.phone)) {
      return jsonResponse({ ok: false, error: "invalid_guest" }, 400);
    }
    if (guest.email != null && guest.email !== "" && !_isValidEmail(guest.email)) {
      return jsonResponse({ ok: false, error: "invalid_guest" }, 400);
    }

    const config = await getPublicConfig(env, PROPERTY_NAME);
    if (!config.enabled) return jsonResponse({ ok: false, error: "public_booking_disabled" }, 403);

    const deps = {
      store: createSharePointStore(env, PROPERTY_NAME),
      payment: mockPayment,
      lock: mockLock,
      now: () => Date.now(),
      generateRef: generateBookingRef,
      propertyName: PROPERTY_NAME,
      nightlyRate: config.nightlyRate,
    };

    const result = await createHold(deps, {
      fromISO: fromDate,
      toISO: toDate,
      guest: { name: guest.name.trim(), phone: guest.phone, email: guest.email || null },
    });

    if (!result.ok) {
      const status = result.error === "sold_out" ? 409 : 400;
      return jsonResponse(result, status);
    }
    return jsonResponse(result, 200);
  } catch (err) {
    console.error("public-booking error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
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

// Norsk telefon — duplikat av regelen i submit-booking.js (defense-in-depth).
function _isValidNoPhone(s) {
  const cleaned = String(s || "").replace(/[\s\-()./]/g, "").replace(/^(\+47|0047|47)/, "");
  return /^[2-9]\d{7}$/.test(cleaned);
}

// E-post — speiler isValidEmail i booking.js / submit-booking.js.
function _isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `node -e "import('./functions/api/public-booking.js').then(m => console.log(typeof m.onRequestPost, typeof m.onRequestOptions))"`
Expected: prints `function function`

- [ ] **Step 3: Commit (LOCAL ONLY — no push)**

```bash
git add functions/api/public-booking.js
git commit -m "feat: /api/public-booking create-hold endpoint (mock payment/lock)"
```

---

## Task 10: Full suite + push + live røyktest

- [ ] **Step 1: Run the whole test suite**

Run: `node --test tests/`
Expected: alle test-filer passerer (availability-math, booking-state, booking-allocation, booking-holds, booking-orchestrator) — 0 fail.

- [ ] **Step 2: Verify the full import chain**

Run:
```
node -e "Promise.all(['./functions/api/public-booking.js','./functions/_utils/booking-orchestrator.js','./functions/_utils/booking-store.js','./functions/_utils/providers-mock.js'].map(p=>import(p))).then(()=>console.log('chain ok')).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: prints `chain ok`

- [ ] **Step 3: Push (deploy)**

```bash
git push
```
Cloudflare auto-deployer (~30 sek). Endepunktet er inert med mindre `PublicBookingEnabled=Ja`.

- [ ] **Step 4: Live røyktest — disabled-tilstand**

Hvis `PublicBookingEnabled=Nei`:
```powershell
$body = @{ fromDate = "2026-07-01"; toDate = "2026-07-03"; guest = @{ name = "Test Testesen"; phone = "99112233" } } | ConvertTo-Json
Invoke-RestMethod -Uri "https://2gmbooking-portal.pages.dev/api/public-booking" -Method Post -Body $body -ContentType "application/json"
```
Expected: `ok=false`, `error=public_booking_disabled` (403).

- [ ] **Step 5: Live røyktest — enabled-tilstand (valgfritt, skriver en ekte rad)**

Sett `PublicBookingEnabled=Ja`, kjør samme curl. Expected: `ok=true`, `bookingRef` (`2GM-XXXXXX`), `paymentRef` (`MOCK-2GM-XXXXXX`). Verifiser i SharePoint at en `Booking`-rad ble opprettet med `Source=Public`, `Status=Upcoming`, `Pending_Confirmation=false`, `PaymentStatus=pending`, et `RoomLookupId`, og `HoldExpiry` ~15 min frem. **Rydd opp:** sett raden til `Status=Cancelled` (det var en test), og sett `PublicBookingEnabled` tilbake til ønsket driftstilstand.

---

## Self-review-notater (utført ved planskriving)

- **Spec-dekning:** hold=pending-rad (Task 4/5/7), lazy utløp (Task 3/7/8), rom-tildeling ved opprettelse (Task 2/7), to statuser + mapping (Task 1/5), de fem orkestrator-operasjonene (Task 7), filterExpiredHolds i ledighet (Task 8), endepunkt + validering + toggle (Task 9), mock-providere (Task 6). Alle spec-seksjoner har en task.
- **Bevisst utenfor Fase 2:** ekte Vipps-callback (Fase 4), ekte Yale/Tuya (Fase 5), frontend (Fase 3), cron-sweep, gjeste-e-post. `confirmPayment`/`tryGenerateCodes`/`expireCodeWindows` har ingen live-endepunkt i Fase 2 — de testes via orkestratoren; Fase 4 wirer dem til Vipps-callbacken.
- **Type-konsistens:** normalisert booking-shape (id/bookingRef/roomId/checkInMs/checkOutMs/status/paymentStatus/holdExpiryMs/paidAtMs/codesGenerated/source) brukt likt i store (Task 5), rene funksjoner (Task 1/2/3) og orkestrator (Task 7). Patch-objektene fra `booking-state.js` (`paymentStatus`/`paidAtMs`/`codesGenerated`/`roomCode`/`status`/`paymentRef`) mappes av `patchToSpFields` i Task 5. `deps`-objektet (store/payment/lock/now/generateRef/propertyName/nightlyRate) er likt i Task 7-testene og Task 9-endepunktet.
- **Door_Code som codesGenerated-markør:** besluttet i spec; Task 5 mapper begge veier; mock-lock (Task 6) gir placeholder-koder.

## Forutsetninger

- SharePoint-felt `HoldExpiry`/`PaidAt`/`PaymentStatus`/`PaymentRef` er opprettet (gjort). `Source` tar `"Public"` (verifiser i kolonne-innstillinger hvis usikker).
- Live-røyktest (Task 10 steg 5) skriver en ekte rad — husk opprydding.
