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
