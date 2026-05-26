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
//   5. POST til Flask-proxyens /notify/text — Flask signerer mot KeySMS.
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
  findBookingByIdForCompany,
  findPersonPhoneByName,
  getRoomsByIdMap,
  getPropertiesFullByIdMap,
  updateBookingFields,
} from "../_utils/sharepoint.js";

// Flask-proxyen som signerer KeySMS-kallet. Samme base som tuya.js bruker
// (locks.haugan.online) — settes som env var for å kunne styre per-miljø.
const DEFAULT_NOTIFY_BASE = "https://locks.haugan.online";

// v3.10.16: Tjenesten koster — legges som notat på bookingen så admin/
// invoicing kan inkludere det i neste faktura. Beløpet eksponeres til
// frontend så bekreftelses-dialogen kan vise det før kunden trykker send.
const DOORCODE_SMS_PRICE_KR = 5;

// v3.10.18: Speil av admin-appens DEFAULT_SMS_TEMPLATE (js/messaging.js).
// Brukes når property.SMS_Template er tom. Placeholders må matche admin —
// _renderTemplate erstatter alle {key} med vars[key].
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
  // Trim flere blanke linjer som oppstår når floor_info/welcome_message er tomme.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, bookingId, bookingRef, phoneOverride } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    // v3.14.15: bookingId primær, bookingRef fallback. Bookinger uten Title
    // (SharePoint Title-feltet) feilet før på klient-side guard.
    const hasId = bookingId && typeof bookingId === "string";
    const hasRef = bookingRef && typeof bookingRef === "string";
    if (!hasId && !hasRef) {
      return jsonResponse({ ok: false, error: "missing_bookingRef" }, 400);
    }
    // v3.10.17: Hvis kunden taster inn nummer manuelt (når gjesten ikke er
    // i Persons-lista), bruk det i stedet for oppslag. Lett validering:
    // 8+ siffer etter at +/space/-/parens er strippet.
    let manualPhone = null;
    if (phoneOverride && typeof phoneOverride === "string") {
      const clean = phoneOverride.replace(/[\s\-()]/g, "");
      if (!/^\+?\d{8,}$/.test(clean)) {
        return jsonResponse({ ok: false, error: "invalid_phone" }, 400);
      }
      manualPhone = clean;
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const company = (tokenRow.fields.Firma || "").trim();
    if (!company) {
      return jsonResponse({ ok: false, error: "token_no_company" }, 400);
    }

    // v3.14.15: foretrekk id-oppslag (alltid satt); fall tilbake til Title hvis
    // bare bookingRef sendt (legacy klienter).
    let booking = null;
    if (hasId) {
      booking = await findBookingByIdForCompany(env, bookingId, company);
    }
    if (!booking && hasRef) {
      booking = await findBookingByRefForCompany(env, bookingRef, company);
    }
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
    // v3.10.23: Strikt per-booking kode — ingen fallback til Rooms.Door_Code.
    // Fallbacken lekket andre gjesters kode på samme rom. Admin må generere
    // PIN på akkurat denne bookingen for at SMS skal kunne sendes.
    const doorCode = String(f.Door_Code || "").trim();
    if (!doorCode) {
      return jsonResponse({ ok: false, error: "no_door_code" }, 400);
    }

    const personName = (f.Person_Name || "").trim();
    if (!personName) {
      return jsonResponse({ ok: false, error: "no_person_name" }, 400);
    }

    // v3.10.17: Manuelt nummer overstyrer Persons-oppslaget. Brukes når
    // kunden taster inn nummeret selv (gjest ikke i registeret).
    let person;
    if (manualPhone) {
      person = { phone: manualPhone, name: personName, manual: true };
    } else {
      person = await findPersonPhoneByName(env, personName);
      if (!person) {
        // Frontend kjenner igjen no_phone og åpner manuell-inntastings-dialog.
        return jsonResponse({ ok: false, error: "no_phone" }, 404);
      }
    }

    const roomNumber = room.title || "";

    // v3.10.18: Bygg SMS med samme template + placeholders som admin-appens
    // js/messaging.js. Bruker property.SMS_Template hvis satt, ellers
    // DEFAULT_SMS_TEMPLATE. Floor_info plukkes basert på room.Floor (1 eller 2).
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
      room:            roomNumber,
      room_door_code:  doorCode,
      wifi_ssid:       property ? property.wifiSsid : "",
      wifi_password:   property ? property.wifiPassword : "",
      welcome_message: property ? property.welcomeMessage : "",
      floor_info:      floorInfo,
    };
    const template = (property && property.smsTemplate) || DEFAULT_SMS_TEMPLATE;
    const message = renderTemplate(template, vars);

    const notifyBase = env.NOTIFY_PROXY_BASE || DEFAULT_NOTIFY_BASE;
    const smsResp = await fetch(`${notifyBase}/notify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: person.phone, body: message }),
    });
    let smsJson = null;
    try { smsJson = await smsResp.json(); } catch (_) {}

    if (!smsResp.ok || !smsJson || smsJson.success === false) {
      // eslint-disable-next-line no-console
      console.error("[send-doorcode] notify-proxy feilet:", smsResp.status, smsJson);
      const err = (smsJson && smsJson.error) || `proxy_${smsResp.status}`;
      return jsonResponse({ ok: false, error: "sms_failed", detail: err }, 502);
    }

    // v3.10.16: Logg gebyret som notat på bookingen så admin/invoicing kan
    // ta det med på neste faktura. Notes appendes (ikke overskrives) så
    // tidligere notater fra kunden eller admin beholdes. Patch-feilen er
    // ikke kritisk for kunden — SMS-en er allerede sendt — så vi logger og
    // returnerer success uansett.
    const nowIso = new Date().toISOString().replace("T", " ").slice(0, 16);
    const phoneTag = person.manual ? `${person.phone} (manuelt)` : person.phone;
    const chargeLine = `[${nowIso}] SMS dørkode → ${phoneTag}: ${DOORCODE_SMS_PRICE_KR} kr`;
    const existingNotes = String(f.Notes || "").trim();
    const newNotes = existingNotes ? `${existingNotes}\n${chargeLine}` : chargeLine;
    try {
      await updateBookingFields(env, booking.id, { Notes: newNotes });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[send-doorcode] kunne ikke logge gebyret på bookingen:", e?.message || e);
    }

    return jsonResponse({
      ok: true,
      sentTo: person.phone,
      guest: personName,
      roomNumber,
      costKr: DOORCODE_SMS_PRICE_KR,
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
