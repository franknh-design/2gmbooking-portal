// functions/api/customer-free-rooms.js
// v1.0 - Returnerer alle rom som er kundens egne (LongTerm_Company eller
//        property.FullTenant_Company matcher Customer_Tokens.Firma) på tvers
//        av alle properties, med "ledig fra"-dato basert på siste utflytting
//        og evt. neste innflytting.
//
// POST /api/customer-free-rooms
// Body: { token: "..." }
//
// Returnerer:
//   {
//     ok: true,
//     customer: "SalMar AS",
//     rooms: [
//       {
//         title: "L203",
//         property: "Strandveien 112",
//         currentlyFree: false,
//         freeFrom: "2026-06-01",          // første dag rommet er ledig fra i dag og fremover
//         nextBookingCheckIn: null,         // YYYY-MM-DD eller null hvis ingen påfølgende booking
//         currentGuest: "Reinis & Ieva"     // navnet på gjest som okkuperer nå (null hvis ledig nå)
//       }, ...
//     ]
//   }

import {
  findToken,
  getCustomerOwnedFreeRooms,
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

    const customerCompany = tokenRow.fields.Firma || "";
    if (!customerCompany) {
      return jsonResponse({ ok: true, customer: "", rooms: [] });
    }

    const rooms = await getCustomerOwnedFreeRooms(env, customerCompany);
    return jsonResponse({ ok: true, customer: customerCompany, rooms });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("customer-free-rooms error:", err);
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
