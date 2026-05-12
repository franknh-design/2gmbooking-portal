// functions/api/send-doorcode.js
// v1.0 — Sender dørkoden til en booking-gjest via SMS (KeySMS) hvis gjesten
// er registrert i Persons-lista og har et telefonnummer der.
//
// POST /api/send-doorcode
// Body: { token: "...", bookingRef: "2GM-AB12CD" }
//
// Flyt:
//   1. Validér token → finn kundens Firma
//   2. Slå opp bookingen på ref og verifiser at den tilhører kunden
//      (Billing_Company eller Company match) — hindrer at noen gjetter
//      en annen kundes ref og lekker dørkoden.
//   3. Finn rommets dørkode via Rooms.Door_Code (samme felt admin-appen
//      bruker, oppdateres ved Tuya create_pin).
//   4. Slå opp Person_Name i Persons-lista (fuzzy match som admin) og hent
//      telefonnummer (Mobile/Phone/Telefon).
//   5. POST til Flask-proxyens /notify/sms — Flask signerer mot KeySMS.
//
// Returnerer:
//   { ok: true, sentTo: "+4791234567" }          — fra-maskert? nei, vi lar
//     kunden se nummeret slik at de kan dobbelt-sjekke før de evt. ber gjesten
//     legge inn nytt nummer.
//   { ok: false, error: "no_phone" }             — person ikke funnet ELLER
//     ingen telefon
//   { ok: false, error: "no_door_code" }
//   { ok: false, error: "not_your_booking" }
//   { ok: false, error: "invalid_token" }

import {
  findToken,
  findBookingByRefForCompany,
  findPersonPhoneByName,
  getRoomsByIdMap,
} from "../_utils/sharepoint.js";

// Flask-proxyen som signerer KeySMS-kallet. Samme base som tuya.js bruker
// (locks.haugan.online) — settes som env var for å kunne styre per-miljø.
const DEFAULT_NOTIFY_BASE = "https://locks.haugan.online";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingRef } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    if (!bookingRef || typeof bookingRef !== "string") {
      return jsonResponse({ ok: false, error: "missing_bookingRef" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = (tokenRow.fields.Firma || "").trim();
    if (!company) {
      return jsonResponse({ ok: false, error: "token_no_company" }, 400);
    }

    const booking = await findBookingByRefForCompany(env, bookingRef, company);
    if (!booking) {
      return jsonResponse({ ok: false, error: "not_your_booking" }, 404);
    }

    const f = booking.fields || {};
    const roomId = f.RoomLookupId ? String(f.RoomLookupId) : null;
    if (!roomId) {
      return jsonResponse({ ok: false, error: "no_room_assigned" }, 400);
    }

    const roomsById = await getRoomsByIdMap(env);
    const room = roomsById[roomId];
    if (!room) {
      return jsonResponse({ ok: false, error: "room_not_found" }, 404);
    }
    const doorCode = room.doorCode;
    if (!doorCode) {
      return jsonResponse({ ok: false, error: "no_door_code" }, 400);
    }

    const personName = (f.Person_Name || "").trim();
    if (!personName) {
      return jsonResponse({ ok: false, error: "no_person_name" }, 400);
    }

    const person = await findPersonPhoneByName(env, personName);
    if (!person) {
      // Skiller ikke mellom "ikke i Persons" og "i Persons men uten nr" —
      // begge tilfeller har samme handling fra kundens side (legg inn nr.
      // hos admin), og vi unngår å lekke om personen finnes i registeret.
      return jsonResponse({ ok: false, error: "no_phone" }, 404);
    }

    const roomNumber = room.title || "";
    const message = roomNumber
      ? `2GM dørkode rom ${roomNumber}: ${doorCode}#`
      : `2GM dørkode: ${doorCode}#`;

    const notifyBase = env.NOTIFY_PROXY_BASE || DEFAULT_NOTIFY_BASE;
    const smsResp = await fetch(`${notifyBase}/notify/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: person.phone, message }),
    });
    let smsJson = null;
    try { smsJson = await smsResp.json(); } catch (_) {}

    if (!smsResp.ok || !smsJson || smsJson.success === false) {
      // eslint-disable-next-line no-console
      console.error("[send-doorcode] notify-proxy feilet:", smsResp.status, smsJson);
      const err = (smsJson && smsJson.error) || `proxy_${smsResp.status}`;
      return jsonResponse({ ok: false, error: "sms_failed", detail: err }, 502);
    }

    return jsonResponse({
      ok: true,
      sentTo: person.phone,
      guest: personName,
      roomNumber,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("send-doorcode error:", err);
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
