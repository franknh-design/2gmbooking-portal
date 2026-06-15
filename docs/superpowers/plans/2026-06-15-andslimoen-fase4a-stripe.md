# Andslimoen offentlig booking — Fase 4a: Stripe (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erstatte mock-betalingen med ekte Stripe: gjest betaler oppholdet via Stripe Checkout (redirect), kortet lagres, webhook bekrefter bookingen, og et beskyttet endepunkt kan belaste for manglende utstyr off-session. Lås forblir mock (Fase 5).

**Architecture:** Stripe via **REST (fetch)** — ingen SDK/build, samme mønster som `email.js`/`graph.js`. Ren signatur-verifisering (Web Crypto) og prisliste-summering er enhetstestet med `node --test`; fetch-wrappere og endepunkter verifiseres live i Stripe testmodus. Stripe-provideren plugges inn bak Fase 2-betalingsabstraksjonen (`payment.initiate/refund` + ny `chargeSavedCard`).

**Tech Stack:** Cloudflare Pages Functions (ESM JS, ingen build), Stripe REST API (`api.stripe.com/v1`), Web Crypto (`crypto.subtle` HMAC), `node --test`. Bygger på Fase 1–3 + Franks jobb-merge (pris-krav + kvitterings-e-post finnes alt).

---

## Bakgrunn implementøren MÅ kjenne (nå-tilstand etter merge)

- **Ingen build.** Functions er plain ESM som kaller eksterne API-er via `fetch` (se `functions/_utils/email.js`, `graph.js`). Stripe gjøres likt — REST + `env`-secrets. IKKE introduser `stripe`-npm eller en build.
- **Secrets** leses fra `env.X` (Cloudflare Worker Secrets). Vi legger til `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_CHARGE_SECRET`, og `PUBLIC_BASE_URL` (f.eks. `https://2gmbooking-portal.pages.dev`).
- **Betalingsabstraksjon (Fase 2):** `createHold(deps, {fromISO,toISO,guest})` ([booking-orchestrator.js:28](../../../functions/_utils/booking-orchestrator.js)) kaller `deps.payment.initiate({bookingRef, amount})` og forventer `{paymentRef}`. `confirmPayment(deps, bookingRef)` markerer betalt + genererer (mock-)koder. `deps.payment` er i dag `mockPayment` ([providers-mock.js](../../../functions/_utils/providers-mock.js)).
- **Store:** `booking-store.js` `patchToSpFields` mapper normaliserte felt → SP. `getBookings()` returnerer normaliserte bookinger. Begge må utvides med Stripe-/vilkår-/depositum-felt.
- **`getPublicConfig`** ([sharepoint.js:199](../../../functions/_utils/sharepoint.js)) returnerer nå `enabled = PublicBookingEnabled===true && rate>0`. Uendret her.
- **`public-booking.js`** (nå-tilstand): validerer dato/gjest (internasjonal telefon), MAX_NIGHTS=90, kaller `createHold` med `mockPayment`, og sender en **kvitterings-e-post ved hold-opprettelse**. **Reconciliation:** med Stripe-redirect skjer betaling ETTER redirect, så hold-tidspunkt-e-posten flyttes til webhooken (post-betaling). Denne planen FJERNER e-post-blokken fra `public-booking.js` og sender bekreftelse fra `stripe-webhook.js` i stedet (unngår dobbel/for-tidlig e-post).
- **`sendEmail(env, {to, subject, text, html, from})`** ([email.js:37](../../../functions/_utils/email.js)) — fetch til Resend, kaster aldri, fail-soft.
- **SharePoint-felt** (opprettet av Frank): `StripeCustomerId`, `StripePaymentMethodId`, `TermsAcceptedAt`, `TermsVersion`, `DepositChargedAt`, `DepositChargeAmount`, `DepositChargeItems`. Pluss eksisterende `PaymentRef`/`PaymentStatus`/`Source`/`HoldExpiry`/`PaidAt`.
- **Frontend:** `andslimoen.mjs` (`onSubmit` viser i dag bekreftelse direkte). Med Stripe skal `onSubmit` redirecte til Checkout-URL; bekreftelse vises ved retur (`?ok=<ref>`).
- **Tester:** `node --test tests/*.test.mjs` (IKKE `tests/`). Node 24 har global `crypto.subtle`.

## Stripe REST — eksakte former (referanse for alle tasks)

- **Checkout Session:** `POST https://api.stripe.com/v1/checkout/sessions`, header `Authorization: Bearer <sk>`, `Content-Type: application/x-www-form-urlencoded`. Felt (form, brackets):
  `mode=payment`, `success_url=<base>/andslimoen?ok=<ref>`, `cancel_url=<base>/andslimoen?avbrutt=1`, valgfritt `customer_email=<e>`, `line_items[0][price_data][currency]=nok`, `line_items[0][price_data][product_data][name]=<navn>`, `line_items[0][price_data][unit_amount]=<øre>`, `line_items[0][quantity]=1`, `payment_intent_data[setup_future_usage]=off_session`, `metadata[bookingRef]=<ref>`, `payment_intent_data[metadata][bookingRef]=<ref>`. Svar: `{ id:"cs_…", url:"https://checkout.stripe.com/…" }`. (NOK-beløp i **øre** = kr×100.)
- **Hent PaymentIntent:** `GET /v1/payment_intents/<pi>` → `{ payment_method:"pm_…", … }`.
- **Off-session-belastning:** `POST /v1/payment_intents` med `amount=<øre>`, `currency=nok`, `customer=<cus>`, `payment_method=<pm>`, `off_session=true`, `confirm=true`, `description=<tekst>`, `metadata[bookingRef]=<ref>`.
- **Refusjon:** `POST /v1/refunds` med `payment_intent=<pi>` (+ valgfritt `amount=<øre>`).
- **Webhook-signatur:** header `Stripe-Signature: t=<unix>,v1=<hex>`. `signedPayload = "<t>.<rawBody>"`; forventet = HMAC-SHA256(secret, signedPayload) hex; sammenlign med v1; avvis hvis `|now - t| > 300s`.

## Filstruktur

| Fil | Ansvar |
|-----|--------|
| `functions/_utils/deposit.js` (ny) | Ren `sumMissingItems(items)` — prisliste + validering. |
| `functions/_utils/stripe.js` (ny) | Stripe REST: ren `verifyWebhookSignature` + `buildSessionForm`; fetch-wrappere `createCheckoutSession`, `retrievePaymentIntent`, `chargeSavedCard`, `refund`. |
| `functions/_utils/payment-stripe.js` (ny) | `stripePayment`-provider (Fase 2-grensesnitt): `initiate`, `refund`, `chargeSavedCard`. |
| `functions/_utils/booking-orchestrator.js` (endre) | `createHold` returnerer `checkoutUrl`; sender `guest`+URLer til `initiate`. |
| `functions/_utils/booking-store.js` (endre) | `patchToSpFields` + `getBookings` utvidet med Stripe-/vilkår-/depositum-felt. |
| `functions/api/public-booking.js` (endre) | Krev vilkår; bruk `stripePayment`; returner `checkoutUrl`; flytt e-post til webhook. |
| `functions/api/stripe-webhook.js` (ny) | Verifiser signatur; `checkout.session.completed` → lagre kort-id-er → `confirmPayment` → bekreftelses-e-post. |
| `functions/api/charge-missing-items.js` (ny) | Beskyttet (delt hemmelighet); `sumMissingItems` → `chargeSavedCard` → skriv depositum-felt. |
| `andslimoen.html` + `assets/js/andslimoen.mjs` + `andslimoen-i18n.mjs` (endre) | Vilkår-avkrysning + lenke; redirect til Checkout; retur-håndtering (`?ok`/`?avbrutt`). |
| `andslimoen-vilkar.html` (ny) | Vilkårsside NO/EN. |
| `tests/deposit.test.mjs`, `tests/stripe.test.mjs` (nye) | Enhetstester for de rene delene. |

Implementører committer LOKALT (ikke push). Push + secrets + live-test i siste task. **Fetch + sjekk remote FØR start** (Frank pusher fra jobb).

---

## Task 1: Prisliste-summering (ren) + tester

**Files:** Create `functions/_utils/deposit.js`, `tests/deposit.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/deposit.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICE_LIST, MAX_DEPOSIT, sumMissingItems } from "../functions/_utils/deposit.js";

test("price list matches agreed amounts", () => {
  assert.equal(PRICE_LIST.liten_handduk, 100);
  assert.equal(PRICE_LIST.stor_handduk, 150);
  assert.equal(PRICE_LIST.pute, 400);
  assert.equal(PRICE_LIST.dyne, 700);
  assert.equal(PRICE_LIST.sengesett, 400);
  assert.equal(MAX_DEPOSIT, 1750);
});

test("sumMissingItems sums known items", () => {
  assert.deepEqual(sumMissingItems(["liten_handduk"]), { ok: true, amount: 100 });
  assert.deepEqual(sumMissingItems(["dyne", "pute"]), { ok: true, amount: 1100 });
  assert.deepEqual(sumMissingItems(["liten_handduk", "stor_handduk", "pute", "dyne", "sengesett"]), { ok: true, amount: 1750 });
});

test("sumMissingItems rejects empty / unknown / non-array", () => {
  assert.equal(sumMissingItems([]).ok, false);
  assert.equal(sumMissingItems(["banan"]).ok, false);
  assert.equal(sumMissingItems("dyne").ok, false);
  assert.equal(sumMissingItems(null).ok, false);
});

test("sumMissingItems never exceeds MAX_DEPOSIT", () => {
  // duplikater skal ikke kunne sprenge taket
  const r = sumMissingItems(["dyne", "dyne", "dyne"]);
  assert.equal(r.ok, true);
  assert.ok(r.amount <= MAX_DEPOSIT);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/deposit.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Write `functions/_utils/deposit.js`:**

```javascript
// functions/_utils/deposit.js
// v1.0 — Ren prisliste + summering for depositum/manglende utstyr. INGEN I/O.
// Belastes off-session på det lagrede kortet (se charge-missing-items).

export const PRICE_LIST = {
  liten_handduk: 100,
  stor_handduk: 150,
  pute: 400,
  dyne: 700,
  sengesett: 400,
};

// Maks som kan belastes (alt borte) — oppgis i vilkårene.
export const MAX_DEPOSIT = 1750;

// items: string[] av nøkler fra PRICE_LIST. Returnerer { ok, amount } eller { ok:false, error }.
export function sumMissingItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "no_items" };
  }
  let amount = 0;
  for (const it of items) {
    const price = PRICE_LIST[it];
    if (price == null) return { ok: false, error: "unknown_item", item: it };
    amount += price;
  }
  if (amount > MAX_DEPOSIT) amount = MAX_DEPOSIT;
  return { ok: true, amount };
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/deposit.test.mjs` → PASS (4 tester).

- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add functions/_utils/deposit.js tests/deposit.test.mjs && git commit -m "feat: pure missing-items price list + sum"`

---

## Task 2: Stripe REST-klient (signatur + form pure + fetch-wrappere)

**Files:** Create `functions/_utils/stripe.js`, `tests/stripe.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/stripe.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSessionForm, verifyWebhookSignature, _hmacHex } from "../functions/_utils/stripe.js";

test("buildSessionForm encodes the required Checkout fields", () => {
  const form = buildSessionForm({
    bookingRef: "2GM-ABC123",
    amountKr: 1300,
    productName: "Rigg Andslimoen — 2 netter",
    email: "ola@example.no",
    successUrl: "https://x.dev/andslimoen?ok=2GM-ABC123",
    cancelUrl: "https://x.dev/andslimoen?avbrutt=1",
  });
  const s = form.toString();
  assert.match(s, /mode=payment/);
  assert.match(s, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=130000/); // 1300 kr = 130000 øre
  assert.match(s, /line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=nok/);
  assert.match(s, /payment_intent_data%5Bsetup_future_usage%5D=off_session/);
  assert.match(s, /metadata%5BbookingRef%5D=2GM-ABC123/);
  assert.match(s, /customer_email=ola%40example.no/);
});

test("buildSessionForm omits customer_email when not given", () => {
  const s = buildSessionForm({ bookingRef: "R", amountKr: 650, productName: "x", successUrl: "a", cancelUrl: "b" }).toString();
  assert.ok(!s.includes("customer_email"));
});

test("verifyWebhookSignature accepts a correctly signed payload", async () => {
  const secret = "whsec_test";
  const body = '{"hello":"world"}';
  const t = 1750000000;
  const sig = await _hmacHex(secret, `${t}.${body}`);
  const header = `t=${t},v1=${sig}`;
  assert.equal(await verifyWebhookSignature(body, header, secret, t + 10), true);
});

test("verifyWebhookSignature rejects bad signature / stale timestamp", async () => {
  const secret = "whsec_test";
  const body = '{"hello":"world"}';
  const t = 1750000000;
  const sig = await _hmacHex(secret, `${t}.${body}`);
  assert.equal(await verifyWebhookSignature(body, `t=${t},v1=deadbeef`, secret, t + 10), false);
  assert.equal(await verifyWebhookSignature(body, `t=${t},v1=${sig}`, secret, t + 10000), false); // > 300s
  assert.equal(await verifyWebhookSignature(body, "garbage", secret, t), false);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/stripe.test.mjs` → FAIL.

- [ ] **Step 3: Write `functions/_utils/stripe.js`:**

```javascript
// functions/_utils/stripe.js
// v1.0 — Stripe via REST (fetch), ingen SDK/build. Rene deler (buildSessionForm,
// verifyWebhookSignature) er enhetstestbare; fetch-wrappere verifiseres live.

const STRIPE_API = "https://api.stripe.com/v1";
const SIG_TOLERANCE_SEC = 300;

// ---- Rene hjelpere -------------------------------------------------------

// HMAC-SHA256(secret, payload) som hex. Web Crypto (finnes i Workers + Node 24).
export async function _hmacHex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Bygg form-body for Checkout Session. amountKr i kroner → øre. Returnerer URLSearchParams.
export function buildSessionForm({ bookingRef, amountKr, productName, email, successUrl, cancelUrl }) {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("success_url", successUrl);
  f.set("cancel_url", cancelUrl);
  if (email) f.set("customer_email", email);
  f.set("line_items[0][price_data][currency]", "nok");
  f.set("line_items[0][price_data][product_data][name]", productName);
  f.set("line_items[0][price_data][unit_amount]", String(Math.round((Number(amountKr) || 0) * 100)));
  f.set("line_items[0][quantity]", "1");
  f.set("payment_intent_data[setup_future_usage]", "off_session");
  f.set("metadata[bookingRef]", bookingRef);
  f.set("payment_intent_data[metadata][bookingRef]", bookingRef);
  return f;
}

// Verifiser Stripe-Signature-headeren mot rå body. nowSec injiseres for testbarhet.
export async function verifyWebhookSignature(rawBody, sigHeader, secret, nowSec) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    String(sigHeader).split(",").map((kv) => kv.split("=")).filter((a) => a.length === 2)
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs((nowSec ?? Math.floor(Date.now() / 1000)) - t) > SIG_TOLERANCE_SEC) return false;
  const expected = await _hmacHex(secret, `${t}.${rawBody}`);
  // konstant-tid-ish sammenligning
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// ---- Fetch-wrappere (live) ----------------------------------------------

async function stripePost(env, path, form) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`stripe ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function createCheckoutSession(env, opts) {
  const data = await stripePost(env, "/checkout/sessions", buildSessionForm(opts));
  return { id: data.id, url: data.url };
}

export async function retrievePaymentIntent(env, id) {
  const res = await fetch(`${STRIPE_API}/payment_intents/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`stripe retrieve PI ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function chargeSavedCard(env, { customerId, paymentMethodId, amountKr, description, bookingRef }) {
  const f = new URLSearchParams();
  f.set("amount", String(Math.round((Number(amountKr) || 0) * 100)));
  f.set("currency", "nok");
  f.set("customer", customerId);
  f.set("payment_method", paymentMethodId);
  f.set("off_session", "true");
  f.set("confirm", "true");
  if (description) f.set("description", description);
  if (bookingRef) f.set("metadata[bookingRef]", bookingRef);
  return stripePost(env, "/payment_intents", f);
}

export async function refund(env, { paymentIntentId, amountKr }) {
  const f = new URLSearchParams();
  f.set("payment_intent", paymentIntentId);
  if (amountKr != null) f.set("amount", String(Math.round(Number(amountKr) * 100)));
  return stripePost(env, "/refunds", f);
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/stripe.test.mjs` → PASS (4 tester).

- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add functions/_utils/stripe.js tests/stripe.test.mjs && git commit -m "feat: Stripe REST client (signature verify, session form, charge/refund)"`

---

## Task 3: Stripe-provider (Fase 2-abstraksjon)

**Files:** Create `functions/_utils/payment-stripe.js`

- [ ] **Step 1: Write the implementation:**

```javascript
// functions/_utils/payment-stripe.js
// v1.0 — Ekte Stripe-provider bak Fase 2-betalingsabstraksjonen. initiate()
// oppretter en Checkout Session og returnerer { paymentRef, checkoutUrl }.
// Lukker over env + URL-er via createStripePayment(env, baseUrl).
import { createCheckoutSession, chargeSavedCard as stripeCharge, refund as stripeRefund } from "./stripe.js";

export function createStripePayment(env, baseUrl) {
  return {
    async initiate({ bookingRef, amount, email, productName }) {
      const session = await createCheckoutSession(env, {
        bookingRef,
        amountKr: amount,
        productName: productName || `Rigg Andslimoen (${bookingRef})`,
        email: email || undefined,
        successUrl: `${baseUrl}/andslimoen?ok=${encodeURIComponent(bookingRef)}`,
        cancelUrl: `${baseUrl}/andslimoen?avbrutt=1`,
      });
      return { paymentRef: session.id, checkoutUrl: session.url, status: "pending" };
    },
    async refund({ paymentRef, amountKr }) {
      // paymentRef her er Checkout Session-id i hold-fasen; refusjon krever
      // PaymentIntent-id. Avbestilling håndteres manuelt i v1 (Stripe-dashboard),
      // så denne brukes først når selvbetjent avbestilling bygges. No-op-trygg.
      if (!paymentRef) return;
      return stripeRefund(env, { paymentIntentId: paymentRef, amountKr });
    },
    async chargeSavedCard(args) {
      return stripeCharge(env, args);
    },
  };
}
```

- [ ] **Step 2: Verify import** — `node -e "import('./functions/_utils/payment-stripe.js').then(m=>console.log(typeof m.createStripePayment))"` → `function`.

- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/_utils/payment-stripe.js && git commit -m "feat: Stripe payment provider behind the Fase 2 abstraction"`

---

## Task 4: Orkestrator — checkoutUrl + gjest/URL til initiate

**Files:** Modify `functions/_utils/booking-orchestrator.js` (kun `createHold`)

- [ ] **Step 1: Replace the `payment.initiate` block in `createHold`.** Finn:

```javascript
  const amount = nightsBetween(fromMs, toMs) * (deps.nightlyRate || 0);
  const pay = await deps.payment.initiate({ bookingRef, amount });
  await deps.store.update(created.id, { paymentRef: pay.paymentRef });

  return { ok: true, bookingRef, paymentRef: pay.paymentRef };
```

Erstatt med:

```javascript
  const nights = nightsBetween(fromMs, toMs);
  const amount = nights * (deps.nightlyRate || 0);
  const pay = await deps.payment.initiate({
    bookingRef,
    amount,
    email: guest.email || undefined,
    productName: `Rigg Andslimoen — ${nights} ${nights === 1 ? "natt" : "netter"}`,
  });
  await deps.store.update(created.id, { paymentRef: pay.paymentRef });

  return { ok: true, bookingRef, paymentRef: pay.paymentRef, checkoutUrl: pay.checkoutUrl };
```

(Mock-provideren ignorerer de nye feltene og returnerer ingen `checkoutUrl` — derfor er `checkoutUrl` `undefined` i orkestrator-testene; de eksisterende testene består fortsatt. Verifiser.)

- [ ] **Step 2: Run orchestrator tests** — `node --test tests/booking-orchestrator.test.mjs` → PASS (uendret antall). De asserter ikke på `checkoutUrl`, så de er grønne.

- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/_utils/booking-orchestrator.js && git commit -m "feat: createHold passes guest/urls to initiate and returns checkoutUrl"`

---

## Task 5: Store — Stripe-/vilkår-/depositum-felt

**Files:** Modify `functions/_utils/booking-store.js`

- [ ] **Step 1: Extend `patchToSpFields`.** Etter `if ("roomId" in patch) ...`-linja, FØR `codesGenerated`-blokken, legg til:

```javascript
  if ("stripeCustomerId" in patch) sp.StripeCustomerId = patch.stripeCustomerId;
  if ("stripePaymentMethodId" in patch) sp.StripePaymentMethodId = patch.stripePaymentMethodId;
  if ("termsAcceptedAtMs" in patch) sp.TermsAcceptedAt = msToISODateTime(patch.termsAcceptedAtMs);
  if ("termsVersion" in patch) sp.TermsVersion = patch.termsVersion;
  if ("depositChargedAtMs" in patch) sp.DepositChargedAt = msToISODateTime(patch.depositChargedAtMs);
  if ("depositChargeAmount" in patch) sp.DepositChargeAmount = patch.depositChargeAmount;
  if ("depositChargeItems" in patch) sp.DepositChargeItems = patch.depositChargeItems;
```

- [ ] **Step 2: Extend `getBookings` mapping.** I objektet som returneres per booking, legg til (etter `source`):

```javascript
          guestEmail: f.Email || null,
          stripeCustomerId: f.StripeCustomerId || null,
          stripePaymentMethodId: f.StripePaymentMethodId || null,
          paymentRef: f.PaymentRef || null,
```

- [ ] **Step 3: Verify import** — `node -e "import('./functions/_utils/booking-store.js').then(m=>console.log(typeof m.createSharePointStore))"` → `function`.

- [ ] **Step 4: Run full suite** — `node --test tests/*.test.mjs` → alle grønne (store har ingen egen test; orkestrator-testene bruker in-memory store og er upåvirket).

- [ ] **Step 5: Commit (LOCAL ONLY)** — `git add functions/_utils/booking-store.js && git commit -m "feat: store maps Stripe/terms/deposit fields + reads card ids"`

---

## Task 6: public-booking.js — vilkår + Stripe + checkoutUrl

**Files:** Modify `functions/api/public-booking.js`

- [ ] **Step 1: Krev vilkår + bytt provider + returner checkoutUrl + flytt e-post.** Konkret:
  1. Importer Stripe-provideren i toppen, fjern mock-import:
     ```javascript
     import { createStripePayment } from "../_utils/booking-store.js"; // FEIL — se under
     ```
     Riktig: `import { createStripePayment } from "../_utils/payment-stripe.js";` og behold `mockLock` fra providers-mock (lås er fortsatt mock). Fjern `mockPayment` fra import.
  2. Etter gjest/e-post-validering, krev vilkår fra body:
     ```javascript
     if (body.termsAccepted !== true) {
       return jsonResponse({ ok: false, error: "terms_not_accepted" }, 400);
     }
     ```
  3. Bygg `deps` med Stripe-provider + base-URL:
     ```javascript
     const baseUrl = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
     const deps = {
       store: createSharePointStore(env, PROPERTY_NAME),
       payment: createStripePayment(env, baseUrl),
       lock: mockLock,
       now: () => Date.now(),
       generateRef: generateBookingRef,
       propertyName: PROPERTY_NAME,
       nightlyRate: config.nightlyRate,
     };
     ```
  4. Etter `createHold` (ved `result.ok`), lagre vilkår-aksept og returner `checkoutUrl`:
     ```javascript
     // marker vilkår godtatt på raden (best-effort)
     try {
       const store = deps.store;
       const all = await store.getBookings();
       const row = all.find((b) => b.bookingRef === result.bookingRef);
       if (row) await store.update(row.id, { termsAcceptedAtMs: Date.now(), termsVersion: "2026-06-15" });
     } catch (e) { console.error("[public-booking] terms-stamp feilet (ignorert):", e); }
     return jsonResponse({ ok: true, bookingRef: result.bookingRef, checkoutUrl: result.checkoutUrl }, 200);
     ```
  5. **FJERN hele kvitterings-e-post-blokken** (`if (guest.email) { ... sendEmail ... }`) og `sendEmail`-importen — bekreftelse sendes nå fra webhooken etter betaling. (Behold `lang`-uthentingen kun hvis den fortsatt brukes; ellers fjern.)

  Den oppdaterte handleren skal: validere → krev vilkår → `getPublicConfig` (stengt hvis !enabled) → `createHold` med Stripe → stemple vilkår → returnere `{ ok, bookingRef, checkoutUrl }`. Behold `sold_out`→409.

- [ ] **Step 2: Verify import** — `node -e "import('./functions/api/public-booking.js').then(m=>console.log(typeof m.onRequestPost))"` → `function`.

- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/api/public-booking.js && git commit -m "feat: public-booking requires terms, uses Stripe, returns checkoutUrl"`

---

## Task 7: stripe-webhook.js — bekreft betaling

**Files:** Create `functions/api/stripe-webhook.js`

- [ ] **Step 1: Write the implementation:**

```javascript
// functions/api/stripe-webhook.js
// v1.0 — Stripe webhook. checkout.session.completed → lagre kort-id-er →
// confirmPayment → bekreftelses-e-post. Signatur verifiseres mot STRIPE_WEBHOOK_SECRET.
import { verifyWebhookSignature, retrievePaymentIntent } from "../_utils/stripe.js";
import { createSharePointStore } from "../_utils/booking-store.js";
import { mockLock } from "../_utils/providers-mock.js";
import { confirmPayment } from "../_utils/booking-orchestrator.js";
import { sendEmail } from "../_utils/email.js";

const PROPERTY_NAME = "Rigg Andslimoen";

export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text(); // RÅ body kreves for signatur
  const sig = request.headers.get("stripe-signature");
  const ok = await verifyWebhookSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!ok) return new Response("bad signature", { status: 400 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (event.type !== "checkout.session.completed") {
    return new Response("ignored", { status: 200 }); // kvitter ut andre eventer
  }

  try {
    const session = event.data.object;
    const bookingRef = session.metadata && session.metadata.bookingRef;
    if (!bookingRef) return new Response("no ref", { status: 200 });

    const store = createSharePointStore(env, PROPERTY_NAME);
    const all = await store.getBookings();
    const row = all.find((b) => b.bookingRef === bookingRef);
    if (!row) return new Response("unknown booking", { status: 200 });

    // Lagre kort-id-er for senere off-session depositum-belastning.
    let paymentMethodId = null;
    try {
      const pi = await retrievePaymentIntent(env, session.payment_intent);
      paymentMethodId = pi.payment_method || null;
    } catch (e) { console.error("[webhook] retrieve PI feilet:", e); }
    await store.update(row.id, {
      stripeCustomerId: session.customer || null,
      stripePaymentMethodId: paymentMethodId,
      paymentRef: session.payment_intent || row.paymentRef, // bytt session-id → PI-id for refusjon
    });

    // Marker betalt + generer (mock-)koder. Idempotent (Stripe retryr webhooks).
    const deps = { store, lock: mockLock, now: () => Date.now() };
    await confirmPayment(deps, bookingRef);

    // Bekreftelses-e-post (fail-soft). Gjenoppfrisk raden for datoer/e-post.
    try {
      const fresh = (await store.getBookings()).find((b) => b.bookingRef === bookingRef) || row;
      if (fresh.guestEmail) {
        const subject = `Booking bekreftet ${bookingRef} — Rigg Andslimoen`;
        const text = `Hei,\n\nBetalingen er mottatt og bookingen din på Rigg Andslimoen er bekreftet.\n\nReferanse: ${bookingRef}\n\nTilgangskoder kommer før innsjekk.\n\nVennlig hilsen\n2GM Eiendom`;
        await sendEmail(env, { to: fresh.guestEmail, subject, text });
      }
    } catch (e) { console.error("[webhook] bekreftelses-e-post feilet (ignorert):", e); }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response("error", { status: 500 }); // Stripe retryr → idempotent confirmPayment tåler det
  }
}
```

- [ ] **Step 2: Verify import** — `node -e "import('./functions/api/stripe-webhook.js').then(m=>console.log(typeof m.onRequestPost))"` → `function`.

- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/api/stripe-webhook.js && git commit -m "feat: Stripe webhook confirms payment + saves card ids + sends receipt"`

---

## Task 8: charge-missing-items.js — off-session depositum

**Files:** Create `functions/api/charge-missing-items.js`

- [ ] **Step 1: Write the implementation:**

```javascript
// functions/api/charge-missing-items.js
// v1.0 — Beskyttet endepunkt: belast lagret kort for manglende/ødelagt utstyr.
// Kalles fra admin-appen (Fase 4b). Auth: delt hemmelighet i X-Admin-Secret-header.
//
// POST /api/charge-missing-items
// Body: { bookingRef, items: ["dyne", "liten_handduk", ...] }
import { createSharePointStore } from "../_utils/booking-store.js";
import { createStripePayment } from "../_utils/payment-stripe.js";
import { sumMissingItems } from "../_utils/deposit.js";

const PROPERTY_NAME = "Rigg Andslimoen";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.ADMIN_CHARGE_SECRET || request.headers.get("x-admin-secret") !== env.ADMIN_CHARGE_SECRET) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: "invalid_request" }, 400); }
    const { bookingRef, items } = body || {};
    if (!bookingRef) return jsonResponse({ ok: false, error: "invalid_request" }, 400);

    const sum = sumMissingItems(items);
    if (!sum.ok) return jsonResponse({ ok: false, error: sum.error, item: sum.item }, 400);

    const store = createSharePointStore(env, PROPERTY_NAME);
    const row = (await store.getBookings()).find((b) => b.bookingRef === bookingRef);
    if (!row) return jsonResponse({ ok: false, error: "not_found" }, 404);
    if (!row.stripeCustomerId || !row.stripePaymentMethodId) {
      return jsonResponse({ ok: false, error: "no_saved_card" }, 409);
    }

    const stripe = createStripePayment(env, env.PUBLIC_BASE_URL || "");
    await stripe.chargeSavedCard({
      customerId: row.stripeCustomerId,
      paymentMethodId: row.stripePaymentMethodId,
      amountKr: sum.amount,
      description: `Manglende utstyr — ${bookingRef} (${items.join(", ")})`,
      bookingRef,
    });

    await store.update(row.id, {
      depositChargedAtMs: Date.now(),
      depositChargeAmount: sum.amount,
      depositChargeItems: items.join(", "),
    });

    return jsonResponse({ ok: true, amount: sum.amount }, 200);
  } catch (err) {
    console.error("charge-missing-items error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret" };
}
```

- [ ] **Step 2: Verify import** — `node -e "import('./functions/api/charge-missing-items.js').then(m=>console.log(typeof m.onRequestPost))"` → `function`.

- [ ] **Step 3: Commit (LOCAL ONLY)** — `git add functions/api/charge-missing-items.js && git commit -m "feat: charge-missing-items off-session deposit endpoint"`

---

## Task 9: Vilkårsside + frontend (avkrysning + redirect + retur)

**Files:** Create `andslimoen-vilkar.html`; Modify `andslimoen.html`, `assets/js/andslimoen.mjs`, `assets/js/andslimoen-i18n.mjs`

- [ ] **Step 1: Lag vilkårsside `andslimoen-vilkar.html`** — enkel statisk side med vilkårene NO+EN (kopier teksten fra Fase 4-spec'en, punkt 1–6, begge språk, under hver sin overskrift). Bruk samme `<link rel="stylesheet" href="assets/css/andslimoen.css">` + 2GM-header. (Ingen JS nødvendig; én side med begge språk under hverandre er greit for v1.)

- [ ] **Step 2: Legg til vilkår-avkrysning i `andslimoen.html`** — i `<form class="guest" id="guest-form">`, FØR submit-knappen, legg til:

```html
        <label class="terms"><input type="checkbox" id="terms-check" />
          <span data-i18n="termsLabel">Jeg godtar </span><a href="andslimoen-vilkar.html" target="_blank" data-i18n="termsLink">vilkårene</a></label>
```

- [ ] **Step 3: i18n-nøkler i `andslimoen-i18n.mjs`** (begge språk):
  - `nb`: `termsLabel: "Jeg godtar "`, `termsLink: "vilkårene"`, `redirecting: "Sender deg til betaling…"`, `paidConfirmed: "Takk! Betalingen er mottatt og bookingen er bekreftet."`, `cancelled: "Betaling avbrutt — rommet er ikke reservert."`
  - `en`: `termsLabel: "I accept the "`, `termsLink: "terms"`, `redirecting: "Sending you to payment…"`, `paidConfirmed: "Thank you! Payment received and your booking is confirmed."`, `cancelled: "Payment cancelled — the room is not reserved."`
  (Paritetstesten krever samme nøkler i nb/en — legg til i begge.)

- [ ] **Step 4: `andslimoen.mjs` — krev avkrysning, redirect, retur-håndtering.**
  1. I `guestValid()`: legg til `&& $("terms-check").checked`. Wire `$("terms-check").addEventListener("change", refreshButton)` i `init()` (ved siden av name/phone-listenerne).
  2. I `onSubmit`, send `termsAccepted` + `lang` i body, og ved `data.ok` **redirect** i stedet for å vise bekreftelse:
     ```javascript
     data = await postJSON("/api/public-booking", {
       fromDate: lastStay.from, toDate: lastStay.to,
       termsAccepted: $("terms-check").checked,
       lang,
       guest: { name: $("guest-name").value.trim(), phone: $("guest-phone").value, email: email || undefined },
     });
     ...
     if (data && data.ok && data.checkoutUrl) {
       btn.textContent = t("redirecting");
       window.location.href = data.checkoutUrl;
       return;
     }
     ```
     (Behold feil-grenen; legg `terms_not_accepted` → vis en feil ved avkrysningen.)
  3. I `init()`, FØR config-kallet, håndter retur fra Stripe via query-param:
     ```javascript
     const params = new URLSearchParams(location.search);
     if (params.get("ok")) {
       $("booking-state").hidden = true;
       $("confirmation-ref").textContent = params.get("ok");
       const cs = $("confirmation-sum"); if (cs) cs.textContent = "";
       $("confirmation").hidden = false;
       // erstatt confMsg med betalt-bekreftelse
       const cm = document.querySelector('#confirmation [data-i18n="confMsg"]');
       return; // ikke last booking-shell
     }
     if (params.get("avbrutt")) { /* vis en diskret melding, fortsett til vanlig side */ }
     ```
     (Tilpass så bekreftelsesteksten bruker `t("paidConfirmed")`. Hold det enkelt — ved `?ok` vises bekreftelse med ref.)

- [ ] **Step 5: Run unit tests + syntax** — `node --check assets/js/andslimoen.mjs && node --test tests/*.test.mjs` → grønt (i18n-paritet inkluderer de nye nøklene).

- [ ] **Step 6: Commit (LOCAL ONLY)** — `git add andslimoen.html andslimoen-vilkar.html assets/js/andslimoen.mjs assets/js/andslimoen-i18n.mjs && git commit -m "feat: terms checkbox + Stripe redirect + return handling + terms page"`

---

## Task 10: Secrets, full suite, push + live-test (Stripe testmodus)

- [ ] **Step 1: Full suite** — `node --test tests/*.test.mjs` → 0 fail (deposit + stripe + eksisterende).

- [ ] **Step 2: Sett Cloudflare-secrets** (Dashboard → portal-prosjektet → Settings → Environment variables / Secrets, Production):
  - `STRIPE_SECRET_KEY` = `sk_test_…`
  - `STRIPE_WEBHOOK_SECRET` = `whsec_…` (fra Stripe webhook-oppsettet, steg 5)
  - `ADMIN_CHARGE_SECRET` = en lang tilfeldig streng (brukes av admin-appen i Fase 4b)
  - `PUBLIC_BASE_URL` = `https://2gmbooking-portal.pages.dev`

- [ ] **Step 3: Push (deploy)** — `git push` (Cloudflare ~30–60s).

- [ ] **Step 4: Registrer webhook i Stripe** — Stripe Dashboard (testmodus) → Developers → Webhooks → Add endpoint: URL `https://2gmbooking-portal.pages.dev/api/stripe-webhook`, event `checkout.session.completed`. Kopier signing secret → sett som `STRIPE_WEBHOOK_SECRET` (steg 2) og redeploy hvis nødvendig.

- [ ] **Step 5: Live-test (testmodus)** — sett `PublicBookingEnabled=Ja` midlertidig:
  1. Åpne `/andslimoen`, velg datoer, fyll skjema, **huk av vilkår** → «Reserver» → redirect til Stripe.
  2. Betal med testkort `4242 4242 4242 4242`, utløp i fremtiden, CVC valgfri.
  3. Stripe redirecter til `/andslimoen?ok=2GM-XXXXXX` → bekreftelse vises.
  4. Verifiser i SharePoint: raden har `PaymentStatus=paid`, `StripeCustomerId`, `StripePaymentMethodId`, `TermsAcceptedAt`, `Door_Code` (mock-kode), `PaidAt`.
  5. Verifiser bekreftelses-e-post (Resend) hvis e-post ble oppgitt.
  6. **charge-missing-items:** `curl` mot endepunktet med `X-Admin-Secret`-header + `{bookingRef, items:["dyne"]}` → Stripe belaster testkortet 700 kr off-session; verifiser `DepositChargedAt`/`DepositChargeAmount=700`/`DepositChargeItems` i SP.
  7. **Rydd opp:** sett testradene `Status=Cancelled`, og `PublicBookingEnabled=Nei` igjen.

---

## Self-review-notater (utført ved planskriving)

- **Spec-dekning:** Stripe Checkout (Task 2/3/6), webhook + bekreft (Task 7), kort-lagring (Task 5/7), off-session depositum + prisliste (Task 1/8), vilkår-aksept (Task 6/9), bekreftelses-e-post flyttet til webhook (Task 6 fjerner / Task 7 sender), frontend redirect + retur + vilkårsside (Task 9), secrets + live-test (Task 10). Avbestillings-refusjon = manuell i v1 (refund-wrapper finnes, Task 2/3). Alle spec-punkter dekket.
- **Type-konsistens:** `payment.initiate` returnerer nå `{paymentRef, checkoutUrl}` (Task 3) som `createHold` propagerer (Task 4) og `public-booking` returnerer (Task 6) og frontend redirecter på (Task 9). Patch-nøkler i Task 5 (`stripeCustomerId`/`stripePaymentMethodId`/`termsAcceptedAtMs`/`termsVersion`/`depositChargedAtMs`/`depositChargeAmount`/`depositChargeItems`) brukes likt i webhook (Task 7), public-booking (Task 6) og charge-missing-items (Task 8). `getBookings` eksponerer `stripeCustomerId`/`stripePaymentMethodId`/`guestEmail`/`paymentRef` (Task 5) som Task 7/8 leser.
- **Reconciliation:** Franks hold-tidspunkt-e-post fjernes (Task 6) og erstattes av post-betaling-e-post i webhooken (Task 7) — unngår for-tidlig/dobbel e-post.
- **Lås mock:** webhookens `deps` har kun `{store, lock: mockLock, now}` — `confirmPayment` trenger ikke `payment` (den kaller bare lock). Verifiser at `confirmPayment`/`_generateCodesForBooking` ikke rører `deps.payment` (det gjør de ikke i nå-koden).

## Utenfor Fase 4a

- **Fase 4b (admin-app `2gmbooking`):** «belast manglende utstyr»-UI (kaller `/api/charge-missing-items` med `X-Admin-Secret`) + Gjester `Firma|Privat`-filter + privat-gjest inn i Persons ved bekreftelse.
- Selvbetjent avbestilling (manuell refusjon i v1).
- Vipps som provider nr. 2.
- Ekte Yale/Tuya (Fase 5).
