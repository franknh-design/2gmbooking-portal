// functions/api/extend-booking.js
// v1.0 - Forespørsel om å forlenge oppholdet på en aktiv booking.
//        Skriver INGENTING til SharePoint — sender kun e-postvarsel
//        til admin som tar avgjørelsen manuelt i admin-appen.
//
// POST /api/extend-booking
// Body: {
//   token: "test-abc123-xyz789",
//   bookingRef: "2GM-AB12CD",
//   requestedCheckOut: "2026-06-05",   // YYYY-MM-DD, må være > current
// }
//
// Returnerer:
//   { ok: true, mode: "sent" | "logged" }
//
// Feilkoder:
//   missing_token, invalid_token, missing_ref, invalid_date,
//   booking_not_found, not_your_booking, internal_error

import { findToken, getBookingsForCompany } from "../_utils/sharepoint.js";
import { sendEmail } from "../_utils/email.js";

const NOTIFY_EMAIL = "frank@2gm.no";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingRef, requestedCheckOut } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    if (!bookingRef || typeof bookingRef !== "string") {
      return jsonResponse({ ok: false, error: "missing_ref" }, 400);
    }
    if (!requestedCheckOut || isNaN(new Date(requestedCheckOut).getTime())) {
      return jsonResponse({ ok: false, error: "invalid_date" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = tokenRow.fields.Firma || "";
    if (!company) {
      return jsonResponse({ ok: false, error: "not_your_booking" }, 403);
    }

    // Finn alle bookinger som tilhører kundens firma og let opp den med
    // matching ref. Reuser eksisterende helper så vi slipper egen liste-spørring.
    const items = await getBookingsForCompany(env, company);
    const match = items.find(it => (it.fields?.Title || "").trim() === bookingRef.trim());

    if (!match) {
      return jsonResponse({ ok: false, error: "booking_not_found" }, 404);
    }

    const f = match.fields || {};
    const currentCheckOut = f.Check_Out || null;

    // Sanity: ny utflytting må være etter current (hvis current finnes)
    if (currentCheckOut) {
      const cur = new Date(currentCheckOut);
      const req = new Date(requestedCheckOut);
      if (req <= cur) {
        return jsonResponse({ ok: false, error: "invalid_date" }, 400);
      }
    }

    // Send e-post til admin — ingen SharePoint-skriv her, admin gjør
    // selve oppdateringen i admin-appen så det blir registrert i historikken.
    const emailResult = await sendExtensionRequest(env, {
      bookingRef,
      tokenRow,
      booking: f,
      requestedCheckOut,
    });

    return jsonResponse({ ok: true, mode: emailResult.mode || "sent" });

  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("extend-booking error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function sendExtensionRequest(env, data) {
  const { bookingRef, tokenRow, booking, requestedCheckOut } = data;

  const customer = tokenRow.fields.Firma || "Ukjent kunde";
  const contact  = tokenRow.fields.Kontaktperson || "(ukjent)";
  const phone    = tokenRow.fields.Telefon || "(ukjent)";
  const email    = tokenRow.fields.Epost || "(ukjent)";

  const guest    = booking.Person_Name || "(ukjent gjest)";
  const property = booking.Property_Name || "(ukjent lokasjon)";
  const checkIn  = booking.Check_In ? booking.Check_In.slice(0, 10) : "(ukjent)";
  const current  = booking.Check_Out ? booking.Check_Out.slice(0, 10) : "open-ended";
  const requested = String(requestedCheckOut).slice(0, 10);

  const subject = `[2GM] Forespørsel om forlengelse — ${bookingRef} (${customer})`;

  const lines = [
    `Kunden ber om å forlenge oppholdet på en aktiv booking.`,
    ``,
    `Referanse:        ${bookingRef}`,
    `Kunde:            ${customer}`,
    `Kontakt:          ${contact}`,
    `Telefon:          ${phone}`,
    `E-post:           ${email}`,
    `Lokasjon:         ${property}`,
    `Gjest:            ${guest}`,
    `Innsjekk:         ${checkIn}`,
    `Nåværende utflytting:  ${current}`,
    `Ønsket ny utflytting:  ${requested}`,
    ``,
    `Avgjør i admin-appen — sjekk at rommet ikke er booket av andre i den nye perioden,`,
    `oppdater Check_Out på bookingen og gi kunden beskjed.`,
    ``,
    `--`,
    `2GM Booking Portal`,
  ];

  return sendEmail(env, {
    to: NOTIFY_EMAIL,
    subject,
    text: lines.join("\n"),
  });
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
