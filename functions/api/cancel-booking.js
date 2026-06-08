// functions/api/cancel-booking.js
// v1.0 - Kunde-initiert kansellering av en IKKE-STARTET booking.
//        Bare bookinger med Status=Upcoming kan kanselleres selvbetjent —
//        en aktiv booking har gjesten allerede sjekket inn på, og å sette
//        Cancelled ville fjerne fakturerbare netter (de må gå via admin /
//        "Avslutt leien"). Setter Status=Cancelled umiddelbart, appender et
//        notat, sender bekreftelse til kunden og varsel til admin.
//
// POST /api/cancel-booking
// Body: { token, bookingRef }
// Returnerer: { ok: true } | { ok: false, error: "..." }

import { findToken, getBookingsForCompany, updateBookingFields } from "../_utils/sharepoint.js";
import { sendEmail } from "../_utils/email.js";

const NOTIFY_EMAIL = "frank@2gm.no";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingId, bookingRef } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    // v3.14.15: bookingId primær, bookingRef fallback. Se end-booking.js for kontekst.
    const hasId = bookingId && typeof bookingId === "string";
    const hasRef = bookingRef && typeof bookingRef === "string";
    if (!hasId && !hasRef) {
      return jsonResponse({ ok: false, error: "missing_ref" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = tokenRow.fields.Firma || "";
    if (!company) {
      return jsonResponse({ ok: false, error: "not_your_booking" }, 403);
    }

    // v1.x: ID-først, ref-fallback. KRITISK for cancel-flowen — tidligere
    // OR-find kunne kansellere FEIL rad ved gruppe-bookinger (flere gjester
    // deler samme Ref → 2GM-UGEURM). Se extend-booking.js v1.4 for kontekst.
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
    const refForDisplay = (f.Title || "").trim() ||
      [f.Person_Name, f.Property_Name].filter(Boolean).join(" – ") ||
      `id:${match.id}`;

    if (f.Status === "Cancelled") {
      // Allerede kansellert — idempotent, ikke en feil.
      return jsonResponse({ ok: true, mode: "already" });
    }
    // Kun ikke-startede bookinger kan selvbetjent-kanselleres. En aktiv
    // booking har gjesten sjekket inn på; å sette Cancelled ville fjerne
    // fakturerbare netter — den må gå via admin ("Avslutt leien").
    if (f.Status !== "Upcoming") {
      return jsonResponse({ ok: false, error: "not_cancellable" }, 409);
    }

    const todayISO = new Date().toISOString().slice(0, 10);
    const noteLine = `[Kansellert av kunde ${todayISO}]`;
    const existingNotes = (f.Notes || "").trim();
    const newNotes = existingNotes ? `${existingNotes}\n${noteLine}` : noteLine;

    await updateBookingFields(env, match.id, {
      Status: "Cancelled",
      Pending_Confirmation: false,
      Notes: newNotes,
    });

    // Bekreftelse til kunden + varsel til admin. sendEmail feiler stille,
    // så en e-postfeil blokkerer ikke selve kanselleringen.
    await sendCancelEmails(env, { bookingRef: refForDisplay, tokenRow, booking: f });

    return jsonResponse({ ok: true });

  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("cancel-booking error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function sendCancelEmails(env, { bookingRef, tokenRow, booking }) {
  const customer  = tokenRow.fields.Firma || "";
  const contact   = tokenRow.fields.Kontaktperson || "";
  const phone     = tokenRow.fields.Telefon || "(ukjent)";
  const custEmail = (tokenRow.fields.Epost || "").trim();

  const guest    = booking.Person_Name || "(ukjent gjest)";
  const property = booking.Property_Name || "(ukjent lokasjon)";
  const checkIn  = booking.Check_In ? booking.Check_In.slice(0, 10) : "(ukjent)";

  // 1) Bekreftelse til kunden — "kanselleringen er gjort".
  if (custEmail) {
    const subject = `Bestilling kansellert — ${bookingRef}`;
    const html =
      `<p>Hei${contact ? " " + escapeHtml(contact) : ""},</p>` +
      `<p>Bestillingen din er nå kansellert.</p>` +
      `<p><strong>Referanse:</strong> ${escapeHtml(bookingRef)}<br>` +
      `<strong>Gjest:</strong> ${escapeHtml(guest)}<br>` +
      `<strong>Lokasjon:</strong> ${escapeHtml(property)}<br>` +
      `<strong>Planlagt innsjekk:</strong> ${escapeHtml(checkIn)}</p>` +
      `<p>Trenger du rommet likevel, kan du sende en ny bestilling i portalen.</p>` +
      `<p>Vennlig hilsen<br>2GM Eiendom</p>`;
    const text =
      `Hei${contact ? " " + contact : ""},\n\n` +
      `Bestillingen din er nå kansellert.\n\n` +
      `Referanse: ${bookingRef}\n` +
      `Gjest: ${guest}\n` +
      `Lokasjon: ${property}\n` +
      `Planlagt innsjekk: ${checkIn}\n\n` +
      `Trenger du rommet likevel, kan du sende en ny bestilling i portalen.\n\n` +
      `Vennlig hilsen\n2GM Eiendom`;
    await sendEmail(env, { to: custEmail, subject, html, text });
  }

  // 2) Varsel til admin.
  const adminSubject = `[2GM] Booking kansellert av kunde — ${bookingRef} (${customer})`;
  const adminText = [
    `Kunden har selv kansellert en ikke-startet booking i portalen.`,
    ``,
    `Referanse:   ${bookingRef}`,
    `Kunde:       ${customer}`,
    `Kontakt:     ${contact || "(ukjent)"}`,
    `Telefon:     ${phone}`,
    `Gjest:       ${guest}`,
    `Lokasjon:    ${property}`,
    `Innsjekk:    ${checkIn}`,
    ``,
    `Status er satt til Cancelled. Ingen handling nødvendig.`,
    ``,
    `--`,
    `2GM Booking Portal`,
  ].join("\n");
  await sendEmail(env, { to: NOTIFY_EMAIL, subject: adminSubject, text: adminText });
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
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
