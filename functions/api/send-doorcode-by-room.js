// functions/api/send-doorcode-by-room.js
// v1.0 — Sender dørkode via SMS basert på bookingId + telefonnr (i stedet for
// person-oppslag som /api/send-doorcode bruker). Brukes av "Send dørkode"-
// knappen i banneret: kunden taster romnr → henter aktive bookinger →
// velger gjest hvis flere → sender SMS med telefonnr (default fra Persons,
// kan overstyres).
//
// POST /api/send-doorcode-by-room
// Body: { token, bookingId, phone }
//
// Flyt:
//   1. Validér token + finn Firma
//   2. Hent booking på id og verifiser at den tilhører kundens firma
//   3. Hent rom + property → bygg SMS med samme template som admin
//   4. POST til Flask-proxy /notify/sms
//   5. Logg gebyret (5 kr) til Notes på bookingen
//
// Returnerer samme shape som /api/send-doorcode for kompatibilitet.

import {
  findToken,
  findBookingByIdForCompany,
  getRoomsByIdMap,
  getPropertiesFullByIdMap,
  updateBookingFields,
} from "../_utils/sharepoint.js";

const DEFAULT_NOTIFY_BASE = "https://locks.haugan.online";
const DOORCODE_SMS_PRICE_KR = 5;

// Speil av admin-appens DEFAULT_SMS_TEMPLATE. Holdes synkronisert med
// js/messaging.js og send-doorcode.js — fallback når property.SMS_Template
// er tom.
const DEFAULT_SMS_TEMPLATE = `Hello {first_name},
Welcome to {property}.
Room: {room}, door code: {room_door_code}
WiFi: {wifi_ssid} / {wifi_password}
{floor_info}
{welcome_message}
Best regards, Frank — 2GM`;

function renderTemplate(template, vars) {
  let out = template || "";
  for (const k of Object.keys(vars)) {
    const re = new RegExp("\\{" + k + "\\}", "g");
    out = out.replace(re, vars[k] != null ? String(vars[k]) : "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingId, phone } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    if (!bookingId) {
      return jsonResponse({ ok: false, error: "missing_bookingId" }, 400);
    }
    if (!phone || typeof phone !== "string") {
      return jsonResponse({ ok: false, error: "missing_phone" }, 400);
    }
    const cleanPhone = phone.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{8,}$/.test(cleanPhone)) {
      return jsonResponse({ ok: false, error: "invalid_phone" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }
    const company = (tokenRow.fields.Firma || "").trim();
    if (!company) {
      return jsonResponse({ ok: false, error: "token_no_company" }, 400);
    }

    const booking = await findBookingByIdForCompany(env, bookingId, company);
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

    const doorCode = String(f.Door_Code || "").trim();
    if (!doorCode) {
      return jsonResponse({ ok: false, error: "no_door_code" }, 400);
    }

    const personName = (f.Person_Name || "").trim();
    if (!personName) {
      return jsonResponse({ ok: false, error: "no_person_name" }, 400);
    }

    const propsById = await getPropertiesFullByIdMap(env);
    const property = room.propertyLookupId ? propsById[room.propertyLookupId] : null;

    let floorInfo = "";
    if (property && room.floor) {
      if (room.floor === "1") floorInfo = property.floor1Info || "";
      else if (room.floor === "2") floorInfo = property.floor2Info || "";
    }

    const firstName = (personName.split(/\s+/)[0] || personName).trim();
    const vars = {
      first_name:      firstName,
      guest_name:      personName,
      property:        property ? property.title : (f.Property_Name || ""),
      room:            room.title || "",
      room_door_code:  doorCode,
      wifi_ssid:       property ? property.wifiSsid : "",
      wifi_password:   property ? property.wifiPassword : "",
      welcome_message: property ? property.welcomeMessage : "",
      floor_info:      floorInfo,
    };
    const template = (property && property.smsTemplate) || DEFAULT_SMS_TEMPLATE;
    const message = renderTemplate(template, vars);

    const notifyBase = env.NOTIFY_PROXY_BASE || DEFAULT_NOTIFY_BASE;
    const smsResp = await fetch(`${notifyBase}/notify/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    let smsJson = null;
    try { smsJson = await smsResp.json(); } catch (_) {}

    if (!smsResp.ok || !smsJson || smsJson.success === false) {
      // eslint-disable-next-line no-console
      console.error("[send-doorcode-by-room] notify-proxy feilet:", smsResp.status, smsJson);
      const detail = (smsJson && smsJson.error) || `proxy_${smsResp.status}`;
      return jsonResponse({ ok: false, error: "sms_failed", detail }, 502);
    }

    const nowIso = new Date().toISOString().replace("T", " ").slice(0, 16);
    const chargeLine = `[${nowIso}] SMS dørkode (banner) → ${cleanPhone}: ${DOORCODE_SMS_PRICE_KR} kr`;
    const existingNotes = String(f.Notes || "").trim();
    const newNotes = existingNotes ? `${existingNotes}\n${chargeLine}` : chargeLine;
    try {
      await updateBookingFields(env, booking.id, { Notes: newNotes });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[send-doorcode-by-room] kunne ikke logge gebyret:", e?.message || e);
    }

    return jsonResponse({
      ok: true,
      sentTo: cleanPhone,
      guest: personName,
      roomNumber: room.title || "",
      costKr: DOORCODE_SMS_PRICE_KR,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("send-doorcode-by-room error:", err);
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
