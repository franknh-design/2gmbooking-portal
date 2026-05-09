// functions/api/my-bookings.js
// v1.0 - Returnerer aktive + kommende bookinger for kunden bak token
//
// POST /api/my-bookings
// Body: { token: "..." }
//
// Returnerer:
//   { ok: true, bookings: [
//       {
//         ref: "2GM-AB12CD",
//         property: "Rigg 24",
//         guest: "Ola Nordmann",
//         checkIn: "2026-05-18",
//         checkOut: "2026-05-22",   // null hvis open-ended
//         status: "Upcoming",
//         pendingConfirmation: true
//       }, ...
//     ] }

import { findToken, getBookingsForCompany } from "../_utils/sharepoint.js";

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
      return jsonResponse({ ok: true, bookings: [] });
    }

    const items = await getBookingsForCompany(env, company);

    const bookings = items.map(item => {
      const f = item.fields;
      return {
        ref: f.Title || "",
        property: f.Property_Name || "",
        guest: f.Person_Name || "",
        checkIn: f.Check_In || null,
        checkOut: f.Check_Out || null,
        status: f.Status || "",
        pendingConfirmation: f.Pending_Confirmation === true,
      };
    });

    bookings.sort((a, b) => {
      const ai = a.checkIn || "";
      const bi = b.checkIn || "";
      return ai.localeCompare(bi);
    });

    return jsonResponse({ ok: true, bookings });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("my-bookings error:", err);
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
