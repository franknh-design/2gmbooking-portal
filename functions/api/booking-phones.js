// functions/api/booking-phones.js
// v1.0 — Slår opp telefonnr per booking via Persons-lista. Brukes kun av
// sendcode-modalen (banner-knappen) for å pre-fylle telefon-input pr. rad.
//
// Vi splittet dette ut fra /api/my-bookings i v3.10.31 fordi my-bookings
// pollet hver 60-90s og dro Persons-lista (300+ rader, 2 sider) på hvert
// kall — som tippet Cloudflare Workers over ExceededCpu. Sendcode-modalen
// åpnes manuelt, så her er kostnaden akseptabel.
//
// POST /api/booking-phones
// Body: { token: "..." }
//
// Returnerer:
//   { ok: true, phones: { "2GM-AB12CD": "+4799887766", ... } }
//
// Object → enkel oppslag i klienten uten å traversere array. Tomt nummer
// utelates fra map.

import {
  findToken,
  getBookingsForCompany,
  getPersonsLookup,
} from "../_utils/sharepoint.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = tokenRow.fields.Firma || "";
    if (!company) {
      return jsonResponse({ ok: true, phones: {} });
    }

    const [items, personsLookup] = await Promise.all([
      getBookingsForCompany(env, company),
      getPersonsLookup(env),
    ]);

    const phones = {};
    for (const item of items) {
      const f = item.fields || {};
      const ref = f.Title || "";
      if (!ref) continue;
      const phone = personsLookup.findPhone(f.Person_Name || "");
      if (phone) phones[ref] = phone;
    }

    return jsonResponse({ ok: true, phones });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("booking-phones error:", err);
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
