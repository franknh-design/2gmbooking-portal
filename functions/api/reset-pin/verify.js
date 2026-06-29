// functions/api/reset-pin/verify.js
// v1.0 — Andre steg av reset-PIN-flyt. Gjest skriver inn 3-bokstavers ODP fra
// SMS-en, og hvis riktig:
//   1. Slett gammel PIN fra Tuya-lock
//   2. Generer ny PIN
//   3. Oppdater SP (Room.Door_Code, Booking.Tuya_Password_ID + Door_Code)
//   4. Send ny PIN på SMS
//   5. Opprett BookingCharges-rad (5 kr)
//   6. Oppdater PinResetLog (Result=Success, Charged_Amount=5)
//
// POST /api/reset-pin/verify
// Body: { sessionId, odpCode }
//
// Returns:
//   { ok: true, doorPin: "184739" }
//   { ok: false, error: "session_expired" }
//   { ok: false, error: "invalid_odp", attemptsLeft: 3 }
//   { ok: false, error: "no_attempts_left" }
//   { ok: false, error: "tuya_failed" }
//   { ok: false, error: "internal" }

import {
  findRoomByNumber,
  updateRoomFields,
  updateBookingFields,
  createBookingCharge,
  updatePinResetLog,
} from "../../_utils/sharepoint.js";

const NOTIFY_PROXY_BASE = "https://locks.haugan.online";
const TUYA_PROXY_BASE = "https://locks.haugan.online";
const PIN_RESET_CHARGE_KR = 5;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    const odpCodeRaw = String(body.odpCode || "").trim().toUpperCase();

    if (!sessionId || !odpCodeRaw) {
      return jsonResponse({ ok: false, error: "missing_input" }, 400);
    }
    if (!env.RESET_PIN_KV) {
      console.error("[reset-pin/verify] RESET_PIN_KV binding missing");
      return jsonResponse({ ok: false, error: "internal" }, 500);
    }

    const sessionKey = `session:${sessionId}`;
    const sessionRaw = await env.RESET_PIN_KV.get(sessionKey);
    if (!sessionRaw) {
      return jsonResponse({ ok: false, error: "session_expired" }, 410);
    }
    const session = JSON.parse(sessionRaw);

    if (session.attemptsLeft <= 0) {
      return jsonResponse({ ok: false, error: "no_attempts_left" }, 429);
    }

    // Verifiser ODP (case-insensitiv match via hash)
    const enteredHash = await sha256Hex(odpCodeRaw);
    if (enteredHash !== session.odpHash) {
      const newAttemptsLeft = session.attemptsLeft - 1;
      if (newAttemptsLeft <= 0) {
        // Slett sesjonen så ingen kan brute-force videre
        await env.RESET_PIN_KV.delete(sessionKey);
        if (session.logEntryId) {
          await updatePinResetLog(env, session.logEntryId, {
            Result: "ODP_Failed",
            ODP_Verified: false,
          }).catch(() => {});
        }
        return jsonResponse({ ok: false, error: "no_attempts_left" }, 429);
      }
      // Lagre tilbake med redusert teller, behold samme TTL
      const remainingTtl = Math.max(
        30,
        Math.floor((session.createdAt + 5 * 60 * 1000 - Date.now()) / 1000)
      );
      await env.RESET_PIN_KV.put(
        sessionKey,
        JSON.stringify({ ...session, attemptsLeft: newAttemptsLeft }),
        { expirationTtl: remainingTtl }
      );
      return jsonResponse({
        ok: false,
        error: "invalid_odp",
        attemptsLeft: newAttemptsLeft,
      }, 401);
    }

    // ODP er riktig — fortsett med ny PIN-generering.
    // Først slett sesjonen så samme ODP ikke kan brukes om igjen.
    await env.RESET_PIN_KV.delete(sessionKey);

    // Slå opp rom igjen for å få Tuya_Device_ID (KV lagrer kun id)
    // Vi har roomId i session, men findRoomByNumber krever Title — så vi
    // henter via id direkte. Enklere: lagre Tuya_Device_ID i session ved
    // request-tid. Men for å holde det enkelt henter vi rommet på nytt nå.
    const roomItem = await findRoomById(env, session.roomId);
    if (!roomItem) {
      await failLog(env, session.logEntryId, "Tuya_Failed");
      return jsonResponse({ ok: false, error: "tuya_failed", detail: "room_lookup" }, 500);
    }
    const rf = roomItem.fields || {};
    const tuyaDeviceId = String(rf.Tuya_Device_ID || "").trim();
    if (!tuyaDeviceId) {
      await failLog(env, session.logEntryId, "Tuya_Failed");
      return jsonResponse({ ok: false, error: "tuya_failed", detail: "no_device" }, 500);
    }

    // Slett gammel PIN (best-effort — hvis det feiler gjør vi det stille)
    // Vi henter Booking.Tuya_Password_ID for dette.
    const bookingItem = await findBookingById(env, session.bookingId);
    const bf = bookingItem ? bookingItem.fields || {} : {};
    const oldPasswordId = bf.Tuya_Password_ID ? String(bf.Tuya_Password_ID) : null;
    if (oldPasswordId) {
      await tuyaPost(env, "delete_pin", {
        device_id: tuyaDeviceId,
        password_id: parseInt(oldPasswordId, 10),
      }).catch(e => {
        console.warn("[reset-pin/verify] delete_pin failed (ignored):", e?.message || e);
      });
    }

    // Generer ny 6-sifret PIN
    const newPin = generatePin();
    // v1.3: backdater valid_from til midnatt UTC i dag istedenfor exakt Date.now()
    // for å unngå klokke-skew-feil mellom Flask-proxy, Tuya-cloud og selve
    // låsen. Hvis valid_from er nøyaktig nå og låsen er 30 sek foran cloud,
    // avviser låsen PIN-en helt til 30 sek har passert. Midnatt-buffer gjør
    // PIN-en gyldig hele dagen uavhengig av klokke-skew.
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const validFrom = Math.floor(todayMidnight.getTime() / 1000);
    // valid_to droppes — Flask-proxy bruker 01.01.2030 default

    const pinName = `2GM-${session.roomNumber}-RESET`;
    let createResult;
    try {
      createResult = await tuyaPost(env, "create_pin", {
        device_id: tuyaDeviceId,
        pin: newPin,
        name: pinName,
        valid_from: validFrom,
      });
    } catch (e) {
      console.error("[reset-pin/verify] create_pin failed:", e);
      await failLog(env, session.logEntryId, "Tuya_Failed");
      return jsonResponse({ ok: false, error: "tuya_failed", detail: String(e?.message || e) }, 502);
    }

    const newPasswordId = String(createResult.password_id || "");
    const generatedAt = new Date().toISOString();

    // Oppdater Room og Booking
    try {
      await updateRoomFields(env, session.roomId, {
        Door_Code: newPin,
        Door_Code_Generated_At: generatedAt,
      });
    } catch (e) {
      console.warn("[reset-pin/verify] updateRoomFields failed:", e?.message || e);
    }
    try {
      await updateBookingFields(env, session.bookingId, {
        Tuya_Password_ID: newPasswordId,
        Door_Code: newPin,
        Door_Code_Generated_At: generatedAt,
      });
    } catch (e) {
      console.warn("[reset-pin/verify] updateBookingFields failed:", e?.message || e);
    }

    // Send ny PIN på SMS
    const language = detectLanguage(request);
    const smsBody = formatNewPinSms(newPin, session.roomNumber, language);
    const smsResult = await sendSms(env, session.phoneNumber, smsBody);
    if (!smsResult.ok) {
      console.warn("[reset-pin/verify] SMS-send feilet (PIN er likevel generert):", smsResult.detail);
      // Vi har allerede generert PIN-en — vis den på skjerm. Logger SMS-feilen
      // som notis men resultatet er Success.
    }

    // Opprett BookingCharges (5 kr) — track om skrivingen faktisk gikk gjennom
    // så audit-loggen reflekterer virkelig charge-status, ikke "intent".
    let chargeOk = false;
    try {
      await createBookingCharge(env, {
        bookingId: session.bookingId,
        chargeType: "PIN_Reset",
        amount: PIN_RESET_CHARGE_KR,
        description: `PIN-reset via portal — rom ${session.roomNumber}`,
        title: `PIN_Reset_${session.roomNumber}_${nowStamp().replace(/[:\s]/g, "")}`,
      });
      chargeOk = true;
    } catch (e) {
      console.warn("[reset-pin/verify] BookingCharge-opprettelse feilet:", e?.message || e);
    }

    // Oppdater PinResetLog — Charged_Amount=0 hvis SP-skrivingen feilet,
    // så admin kan korrelere mot manglende BookingCharges-rad
    if (session.logEntryId) {
      await updatePinResetLog(env, session.logEntryId, {
        Result: "Success",
        ODP_Verified: true,
        Charged_Amount: chargeOk ? PIN_RESET_CHARGE_KR : 0,
      }).catch(e => console.warn("[reset-pin/verify] log update failed:", e?.message || e));
    }

    return jsonResponse({
      ok: true,
      doorPin: newPin,
      roomNumber: session.roomNumber,
      smsSent: smsResult.ok,
    });
  } catch (err) {
    console.error("[reset-pin/verify] internal error:", err);
    return jsonResponse({
      ok: false,
      error: "internal",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ============================================================================
// Helpers (mange speilet fra request.js — gjenbruker mønstre)
// ============================================================================

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generatePin() {
  // 6-sifret PIN, første siffer ikke 0 så låsen ikke noterer det som ledende-0-bug
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let s = String((buf[0] % 9) + 1); // 1-9
  for (let i = 1; i < 6; i++) s += String(buf[i] % 10);
  return s;
}

function detectLanguage(request) {
  const al = String(request.headers.get("Accept-Language") || "").toLowerCase();
  if (al.startsWith("nb") || al.startsWith("no")) return "nb";
  if (al.startsWith("lv")) return "lv";
  return "en";
}

function formatNewPinSms(pin, roomNumber, lang) {
  if (lang === "nb") return `Ny dørkode for rom ${roomNumber}: ${pin}. 2GM Eiendom.`;
  if (lang === "lv") return `Jauns durvju kods telpai ${roomNumber}: ${pin}. 2GM Eiendom.`;
  return `New door code for room ${roomNumber}: ${pin}. 2GM Eiendom.`;
}

async function sendSms(env, phone, body) {
  const notifyBase = env.NOTIFY_PROXY_BASE || NOTIFY_PROXY_BASE;
  try {
    const res = await fetch(`${notifyBase}/notify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Notify-Secret": env.NOTIFY_SHARED_SECRET || "" },
      body: JSON.stringify({ to: phone, body }),
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    if (!res.ok || !json || json.success === false) {
      return { ok: false, detail: (json && json.error) || `proxy_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

async function tuyaPost(env, endpoint, body) {
  const base = env.TUYA_PROXY_BASE || TUYA_PROXY_BASE;
  const res = await fetch(`${base}/tuya/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!res.ok) {
    throw new Error(`Tuya ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
  if (json && json.success === false) {
    throw new Error(`Tuya ${endpoint} returned success=false: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json || {};
}

async function failLog(env, logEntryId, result) {
  if (!logEntryId) return;
  try {
    await updatePinResetLog(env, logEntryId, { Result: result, ODP_Verified: false });
  } catch (_) {}
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

// findBookingById og findRoomById er ikke i SP-utils ennå — inline lookups.
// Disse henter én rad ved id direkte via Graph (ingen fetchAll).
import { graphRequest } from "../../_utils/graph.js";
const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const BOOKINGS_LIST = "fe1dfe34-23df-4864-b0b1-b01bf60bfb75";
const ROOMS_LIST = "bfa962a0-5eb2-416c-abe8-adba06558c11";

async function findBookingById(env, bookingId) {
  if (!bookingId) return null;
  try {
    const path = `/sites/${SITE_ID}/lists/${BOOKINGS_LIST}/items/${bookingId}?$expand=fields`;
    return await graphRequest(env, path);
  } catch (e) {
    console.warn("[reset-pin/verify] findBookingById feilet:", e?.message || e);
    return null;
  }
}

async function findRoomById(env, roomId) {
  if (!roomId) return null;
  try {
    const path = `/sites/${SITE_ID}/lists/${ROOMS_LIST}/items/${roomId}?$expand=fields`;
    return await graphRequest(env, path);
  } catch (e) {
    console.warn("[reset-pin/verify] findRoomById feilet:", e?.message || e);
    return null;
  }
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
