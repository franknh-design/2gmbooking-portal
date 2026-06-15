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

import { getPublicConfig, generateBookingRef } from "../_utils/sharepoint.js";
import { createSharePointStore } from "../_utils/booking-store.js";
import { mockPayment, mockLock } from "../_utils/providers-mock.js";
import { createHold } from "../_utils/booking-orchestrator.js";
import { sendEmail } from "../_utils/email.js";

const PROPERTY_NAME = "Rigg Andslimoen";
const MAX_NIGHTS = 90; // øvre grense på opphold — hindrer absurde hold (anonymt skrive-endepunkt)

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }
    const { fromDate, toDate, guest, lang } = body || {};

    if (!fromDate || !toDate) return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    // Normaliser til YYYY-MM-DD (UTC) så et tidssone-kvalifisert input ikke gir
    // en ikke-midnatt Check_In i SharePoint.
    const fromISO = from.toISOString().slice(0, 10);
    const toISO = to.toISOString().slice(0, 10);
    const nights = Math.round((Date.parse(toISO) - Date.parse(fromISO)) / (24 * 60 * 60 * 1000));
    if (nights > MAX_NIGHTS) {
      return jsonResponse({ ok: false, error: "invalid_dates", maxNights: MAX_NIGHTS }, 400);
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
      fromISO,
      toISO,
      guest: { name: guest.name.trim(), phone: guest.phone, email: guest.email || null },
    });

    if (!result.ok) {
      const status = result.error === "sold_out" ? 409 : 400;
      return jsonResponse(result, status);
    }

    // Kvittering til gjest med pris + reservasjonssum (fail-soft — kun hvis
    // e-post er oppgitt; e-post er valgfritt på den offentlige siden). sendEmail
    // kaster aldri, men vi pakker inn defensivt så en feil aldri bryter svaret.
    if (guest.email) {
      try {
        const sum = nights * (config.nightlyRate || 0);
        const en = String(lang || "").toLowerCase() === "en";
        const fd = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
        const subject = `${en ? "Reservation" : "Reservasjon"} ${result.bookingRef} — Rigg Andslimoen`;
        const text = en
          ? `Hi ${guest.name.trim()},\n\nYour reservation at Rigg Andslimoen is created.\n\nReference: ${result.bookingRef}\nCheck-in: ${fd(fromISO)}\nCheck-out: ${fd(toISO)}\nPrice: ${config.nightlyRate} kr/night × ${nights} ${nights === 1 ? "night" : "nights"} = ${sum} kr\n\nThe room is held for 15 minutes — payment coming soon.\n\nKind regards,\n2GM Eiendom`
          : `Hei ${guest.name.trim()},\n\nReservasjonen din på Rigg Andslimoen er opprettet.\n\nReferanse: ${result.bookingRef}\nInnsjekk: ${fd(fromISO)}\nUtsjekk: ${fd(toISO)}\nPris: ${config.nightlyRate} kr/natt × ${nights} ${nights === 1 ? "natt" : "netter"} = ${sum} kr\n\nDu holder rommet i 15 minutter — betaling kommer snart.\n\nVennlig hilsen\n2GM Eiendom`;
        await sendEmail(env, { to: guest.email, subject, text });
      } catch (e) {
        console.error("[public-booking] kvittering feilet (ignorert):", e);
      }
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
