// functions/api/public-booking.js
// v1.1 — Anonymt create-hold-endepunkt for den offentlige bookingsiden (Stripe).
//
// POST /api/public-booking
// Body: { fromDate, toDate, termsAccepted: true, guest: { name, phone, email? } }
// Returnerer:
//   { ok: true, bookingRef, checkoutUrl }   (redirect gjesten til checkoutUrl)
//   { ok: false, error: "public_booking_disabled" | "invalid_request" |
//                        "invalid_dates" | "invalid_guest" | "terms_not_accepted" |
//                        "sold_out" | "internal_error" }
//
// Bundet til Rigg Andslimoen. Ingen token. Betaling via Stripe Checkout; webhook
// (stripe-webhook.js) bekrefter. Lås er mock i Fase 4 (ekte Yale/Tuya = Fase 5).

import { getPrivateConfig, generateBookingRef } from "../_utils/sharepoint.js";
import { createSharePointStore } from "../_utils/booking-store.js";
import { mockLock } from "../_utils/providers-mock.js";
import { createStripePayment } from "../_utils/payment-stripe.js";
import { createHold } from "../_utils/booking-orchestrator.js";

const PROPERTY_NAME = "Rigg Andslimoen";
const MAX_NIGHTS = 90; // øvre grense på opphold — hindrer absurde hold (anonymt skrive-endepunkt)
const TERMS_VERSION = "2026-06-15";

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
    const fromISO = from.toISOString().slice(0, 10);
    const toISO = to.toISOString().slice(0, 10);
    const nights = Math.round((Date.parse(toISO) - Date.parse(fromISO)) / (24 * 60 * 60 * 1000));
    if (nights > MAX_NIGHTS) {
      return jsonResponse({ ok: false, error: "invalid_dates", maxNights: MAX_NIGHTS }, 400);
    }
    if (nights < 1) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    if (
      !guest ||
      typeof guest.name !== "string" ||
      !guest.name.trim() ||
      guest.name.trim().length > 200 ||
      !_isValidPhone(guest.phone)
    ) {
      return jsonResponse({ ok: false, error: "invalid_guest" }, 400);
    }
    if (guest.email != null && guest.email !== "" && !_isValidEmail(guest.email)) {
      return jsonResponse({ ok: false, error: "invalid_guest" }, 400);
    }
    if (body.termsAccepted !== true) {
      return jsonResponse({ ok: false, error: "terms_not_accepted" }, 400);
    }

    const config = await getPrivateConfig(env, PROPERTY_NAME);
    if (!config.enabled) return jsonResponse({ ok: false, error: "public_booking_disabled" }, 403);

    const baseUrl = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const store = createSharePointStore(env, PROPERTY_NAME);
    const deps = {
      store,
      payment: createStripePayment(env, baseUrl),
      lock: mockLock,
      now: () => Date.now(),
      generateRef: generateBookingRef,
      propertyName: PROPERTY_NAME,
      nightlyRate: config.nightlyRate,
    };

    const result = await createHold(deps, {
      fromISO,
      toISO,
      guest: { name: guest.name.trim(), phone: guest.phone, email: guest.email || null },
    });

    if (!result.ok) {
      const status = result.error === "sold_out" ? 409 : 400;
      return jsonResponse(result, status);
    }

    // Stempel vilkår-aksept på raden (best-effort — bryter aldri svaret).
    // createHold returnerer rowId, så vi slipper en ny getBookings()-rundtur.
    try {
      if (result.rowId) {
        await store.update(result.rowId, { termsAcceptedAtMs: Date.now(), termsVersion: TERMS_VERSION });
      }
    } catch (e) {
      console.error("[public-booking] terms-stamp feilet (ignorert):", e);
    }

    return jsonResponse({ ok: true, bookingRef: result.bookingRef, checkoutUrl: result.checkoutUrl }, 200);
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

// Telefon — internasjonalt vennlig (privat-siden kan ha utenlandske gjester).
// Speiler isValidPhone i andslimoen-format.mjs. Valgfri +, 6–15 siffer.
function _isValidPhone(s) {
  const cleaned = String(s || "").replace(/[\s\-()./]/g, "");
  return /^\+?\d{6,15}$/.test(cleaned);
}

// E-post — speiler isValidEmail i booking.js / submit-booking.js.
function _isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
