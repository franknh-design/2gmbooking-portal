// functions/api/end-booking.js
// v1.0 - Forespørsel om å avslutte / forkorte et opphold (motsatt av
//        extend-booking). PATCHer bookingen med Pending_Confirmation=true
//        og appender "[Avslutning forespurt YYYY-MM-DD: ny utflytting
//        YYYY-MM-DD]" til Notes så admin ser konteksten i Awaiting-panelet.
//        E-post sendes til admin som backup-varsel.
//
// POST /api/end-booking
// Body: {
//   token: "...",
//   bookingRef: "2GM-AB12CD",
//   requestedCheckOut: "2026-05-15"  // YYYY-MM-DD; må være >= i dag
// }
//
// Returnerer: { ok: true } | { ok: false, error: "..." }

import { findToken, getBookingsForCompany, updateBookingFields } from "../_utils/sharepoint.js";
import { sendEmail } from "../_utils/email.js";

const NOTIFY_EMAIL = "frank@2gm.no";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingId, bookingRef, requestedCheckOut } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    // v3.14.15: bookingId (SharePoint item.id) er primær identifier. bookingRef
    // (Title) beholdes som fallback for bakoverkompat og for bookinger der
    // admin-appen ennå ikke har satt Title.
    const hasId = bookingId && typeof bookingId === "string";
    const hasRef = bookingRef && typeof bookingRef === "string";
    if (!hasId && !hasRef) {
      return jsonResponse({ ok: false, error: "missing_ref" }, 400);
    }
    if (!requestedCheckOut || isNaN(new Date(requestedCheckOut).getTime())) {
      return jsonResponse({ ok: false, error: "invalid_date" }, 400);
    }

    // Må være i dag eller fremtidig. Tidligere datoer gir ingen mening
    // (gjesten kan ikke "ha sjekket ut for to uker siden").
    const todayISO = new Date().toISOString().slice(0, 10);
    const reqISO = String(requestedCheckOut).slice(0, 10);
    if (reqISO < todayISO) {
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

    // v1.x: ID-først, ref-fallback. Tidligere OR-find feilmatchet på Title
    // ved gruppe-bookinger (flere gjester deler samme Ref → 2GM-UGEURM).
    // Se extend-booking.js v1.4 for full kontekst — samme rot-årsak.
    const items = await getBookingsForCompany(env, company);
    let match = null;
    if (hasId) {
      const idStr = String(bookingId).trim();
      match = items.find(it => String(it.id) === idStr) || null;
    }
    if (!match && hasRef) {
      const refStr = bookingRef.trim();
      match = items.find(it => (it.fields?.Title || "").trim() === refStr) || null;
    }
    if (!match) {
      return jsonResponse({ ok: false, error: "booking_not_found" }, 404);
    }

    const f = match.fields || {};
    // v3.14.15: Bruk faktisk Title fra match'en til alle utgående meldinger;
    // hvis Title er tom, bruk gjestens navn + rom som identifier.
    const refForDisplay = (f.Title || "").trim() ||
      [f.Person_Name, f.Property_Name].filter(Boolean).join(" – ") ||
      `id:${match.id}`;

    // PATCH: marker som Pending_Confirmation, append notat med ønsket dato.
    const noteLine = `[Avslutning forespurt ${todayISO}: ny utflytting ${reqISO}]`;
    const existingNotes = (f.Notes || "").trim();
    const newNotes = existingNotes ? `${existingNotes}\n${noteLine}` : noteLine;
    try {
      await updateBookingFields(env, match.id, {
        Pending_Confirmation: true,
        Notes: newNotes,
      });
    } catch (patchErr) {
      // eslint-disable-next-line no-console
      console.warn("[end-booking] PATCH failed, falling back to email-only:", patchErr?.message || patchErr);
    }

    const emailResult = await sendEndRequest(env, {
      bookingRef: refForDisplay,
      tokenRow,
      booking: f,
      requestedCheckOut: reqISO,
    });

    return jsonResponse({ ok: true, mode: emailResult.mode || "sent" });

  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("end-booking error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function sendEndRequest(env, data) {
  const { bookingRef, tokenRow, booking, requestedCheckOut } = data;

  const customer = tokenRow.fields.Firma || "Ukjent kunde";
  const contact  = tokenRow.fields.Kontaktperson || "(ukjent)";
  const phone    = tokenRow.fields.Telefon || "(ukjent)";
  const email    = tokenRow.fields.Epost || "(ukjent)";

  const guest    = booking.Person_Name || "(ukjent gjest)";
  const property = booking.Property_Name || "(ukjent lokasjon)";
  const checkIn  = booking.Check_In ? booking.Check_In.slice(0, 10) : "(ukjent)";
  const current  = booking.Check_Out ? booking.Check_Out.slice(0, 10) : "open-ended";

  const subject = `[2GM] Forespørsel om avslutning — ${bookingRef} (${customer})`;

  const lines = [
    `Kunden ber om å avslutte / forkorte oppholdet på en aktiv booking.`,
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
    `Ønsket ny utflytting:  ${requestedCheckOut}`,
    ``,
    `Avgjør i admin-appen — oppdater Check_Out og bekreft mot kunden.`,
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
