// functions/api/lookup-room-bookings.js
// v1.0 — Slår opp aktive/kommende bookinger på et romnummer som tilhører
// kundens firma. Brukes av "Send dørkode"-knappen i banneret: kunden skriver
// inn et romnummer, og portalen henter den/de bookingen(e) som ligger der
// slik at koden kan fylles inn automatisk og kunden kan velge hvilken gjest
// SMS-en skal sendes til hvis flere deler rom.
//
// POST /api/lookup-room-bookings
// Body: { token: "...", roomNumber: "702" }
//
// Returnerer:
//   { ok: true, matches: [{ bookingId, bookingRef, personName, checkIn,
//                           checkOut, doorCode, phone, phoneMasked, status }] }
//   { ok: true, matches: [] }              — rom finnes ikke, eller ingen
//                                            aktive/kommende bookinger
//   { ok: false, error: "invalid_token" }

import {
  findToken,
  findBookingsByRoomForCompany,
  findPersonPhoneByName,
  maskPhone,
} from "../_utils/sharepoint.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, roomNumber } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    if (!roomNumber || typeof roomNumber !== "string") {
      return jsonResponse({ ok: false, error: "missing_roomNumber" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = (tokenRow.fields.Firma || "").trim();
    if (!company) {
      return jsonResponse({ ok: false, error: "token_no_company" }, 400);
    }

    const { bookings } = await findBookingsByRoomForCompany(env, roomNumber, company);
    if (!bookings.length) {
      return jsonResponse({ ok: true, matches: [] });
    }

    // Parallelliser person-oppslag for å unngå serielle waterfall-kall.
    const matches = await Promise.all(bookings.map(async b => {
      const f = b.fields || {};
      const personName = (f.Person_Name || "").trim();
      const doorCode = String(f.Door_Code || "").trim();

      let phone = "";
      if (personName) {
        const lookup = await findPersonPhoneByName(env, personName);
        if (lookup && lookup.phone) phone = lookup.phone;
      }

      return {
        bookingId:   b.id,
        bookingRef:  f.Title || "",
        personName,
        checkIn:     f.Check_In || null,
        checkOut:    f.Check_Out || null,
        status:      f.Status || "",
        doorCode,
        phone,
        phoneMasked: phone ? maskPhone(phone) : "",
      };
    }));

    return jsonResponse({ ok: true, matches });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("lookup-room-bookings error:", err);
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
