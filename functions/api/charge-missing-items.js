// functions/api/charge-missing-items.js
// v1.0 — Beskyttet endepunkt: belast lagret kort for manglende/ødelagt utstyr.
// Kalles fra admin-appen (Fase 4b). Auth: delt hemmelighet i X-Admin-Secret.
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
    // Idempotens: stabil nøkkel per (booking, item-sett) hindrer dobbel-belastning
    // ved retry/dobbeltklikk; et genuint annet item-sett får ny nøkkel.
    const idempotencyKey = `missing-${bookingRef}-${[...items].sort().join("_")}`;
    await stripe.chargeSavedCard({
      customerId: row.stripeCustomerId,
      paymentMethodId: row.stripePaymentMethodId,
      amountKr: sum.amount,
      description: `Manglende utstyr — ${bookingRef} (${items.join(", ")})`,
      bookingRef,
      idempotencyKey,
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
