// functions/api/reset-pin/request.js
// v1.0 — Anonymt endepunkt: gjest skriver inn romnr → systemet finner Active/
// Upcoming-booking på rommet → genererer 3-bokstavers ODP og sender på SMS
// til registrert telefonnr → returnerer sessionId for verify-steget.
//
// POST /api/reset-pin/request
// Body: { roomNumber: "102" }
//
// Flyt:
//   1. Valider input
//   2. Rate-limit-sjekk (KV: ratelimit:room:{roomNumber}, max 3 per 24t)
//   3. Finn rom + Active/Upcoming-booking + Mobile
//   4. Generer ODP, lagre hash i KV (session:{sessionId}, TTL 5 min)
//   5. Send ODP via Flask /notify/text
//   6. Logg til PinResetLog
//   7. Returner { ok: true, sessionId } — gjest skriver inn ODP i neste request
//
// Errors:
//   { ok: false, error: "missing_room" }
//   { ok: false, error: "room_not_found" }      ← samme som no_booking — anti-enumerasjon
//   { ok: false, error: "no_booking" }
//   { ok: false, error: "no_mobile" }
//   { ok: false, error: "rate_limited", retryAfterMinutes: N }
//   { ok: false, error: "sms_failed" }
//   { ok: false, error: "internal" }

import {
  findRoomByNumber,
  findActiveBookingByRoomId,
  createPinResetLog,
} from "../../_utils/sharepoint.js";

const NOTIFY_PROXY_BASE = "https://locks.haugan.online";
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SEC = 86400;          // 24t
const SESSION_TTL_SEC = 300;                  // 5 min
const ODP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // A-Z minus I, O, L
const ODP_LENGTH = 3;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const roomNumber = String(body.roomNumber || "").trim();

    if (!roomNumber) {
      return jsonResponse({ ok: false, error: "missing_room" }, 400);
    }
    if (!/^\w{1,10}$/.test(roomNumber)) {
      return jsonResponse({ ok: false, error: "missing_room" }, 400);
    }

    // Rate-limit per rom (uavhengig av IP — flere gjester på samme WiFi).
    if (env.RESET_PIN_KV) {
      const rateKey = `ratelimit:room:${roomNumber}`;
      const existing = await env.RESET_PIN_KV.get(rateKey, { type: "json" });
      if (existing && existing.count >= RATE_LIMIT_MAX) {
        const elapsed = Math.floor((Date.now() - existing.firstAt) / 1000);
        const retryAfter = Math.max(0, RATE_LIMIT_WINDOW_SEC - elapsed);
        await logQuiet(env, {
          Title: `RateLimit ${roomNumber} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          Room_Number: roomNumber,
          Phone_Match: false,
          ODP_Verified: false,
          Result: "Rate_Limited",
          Charged_Amount: 0,
          IP_Address: clientIp(request),
          User_Agent: clientUa(request),
        });
        return jsonResponse({
          ok: false,
          error: "rate_limited",
          retryAfterMinutes: Math.ceil(retryAfter / 60),
        }, 429);
      }
    }

    // Slå opp rom + booking
    const room = await findRoomByNumber(env, roomNumber);
    if (!room) {
      // Anti-enumerasjon: samme generiske feilmelding som no_booking.
      // (Vi gir UI-en samme code så feedback er konsistent uansett årsak.)
      await logQuiet(env, {
        Title: `NotFound ${roomNumber} ${nowStamp()}`,
        Room_Number: roomNumber,
        Phone_Match: false,
        ODP_Verified: false,
        Result: "Room_Not_Found",
        Charged_Amount: 0,
        IP_Address: clientIp(request),
        User_Agent: clientUa(request),
      });
      return jsonResponse({ ok: false, error: "no_booking" }, 404);
    }

    const booking = await findActiveBookingByRoomId(env, room.id);
    if (!booking) {
      await logQuiet(env, {
        Title: `NoBooking ${roomNumber} ${nowStamp()}`,
        Room_Number: roomNumber,
        Phone_Match: false,
        ODP_Verified: false,
        Result: "Room_Not_Found",
        Charged_Amount: 0,
        IP_Address: clientIp(request),
        User_Agent: clientUa(request),
      });
      return jsonResponse({ ok: false, error: "no_booking" }, 404);
    }

    const bf = booking.fields || {};
    const mobile = String(bf.Mobile || "").trim();
    if (!mobile) {
      await logQuiet(env, {
        Title: `NoMobile ${roomNumber} ${nowStamp()}`,
        BookingLookupId: booking.id,
        Room_Number: roomNumber,
        Phone_Match: false,
        ODP_Verified: false,
        Result: "No_Mobile_On_Booking",
        Charged_Amount: 0,
        IP_Address: clientIp(request),
        User_Agent: clientUa(request),
      });
      return jsonResponse({ ok: false, error: "no_mobile" }, 400);
    }

    // Generer ODP og hash
    const odp = generateOdp();
    const odpHash = await sha256Hex(odp);
    const sessionId = generateSessionId();

    // Send ODP via Flask /notify/text
    const language = detectLanguage(request);
    const smsBody = formatOdpSms(odp, language);
    const smsResult = await sendSms(env, mobile, smsBody);
    if (!smsResult.ok) {
      await logQuiet(env, {
        Title: `SMSFail ${roomNumber} ${nowStamp()}`,
        BookingLookupId: booking.id,
        Room_Number: roomNumber,
        Phone_Used: maskPhone(mobile),
        Phone_Match: true,
        ODP_Verified: false,
        Result: "Tuya_Failed", // gjenbruker — SMS-feil dekkes ikke av eget choice
        Charged_Amount: 0,
        IP_Address: clientIp(request),
        User_Agent: clientUa(request),
      });
      return jsonResponse({ ok: false, error: "sms_failed", detail: smsResult.detail }, 502);
    }

    // Lagre session i KV (krever binding)
    if (!env.RESET_PIN_KV) {
      // Hvis KV mangler — vi kan ikke verifisere ODP senere. Avbryt.
      console.error("[reset-pin/request] RESET_PIN_KV binding missing");
      return jsonResponse({ ok: false, error: "internal" }, 500);
    }

    // Opprett log-rad og lagre id'en så verify kan oppdatere samme rad
    const logRow = await createPinResetLog(env, {
      Title: `ODP_Sent ${roomNumber} ${nowStamp()}`,
      BookingLookupId: booking.id,
      Room_Number: roomNumber,
      Phone_Used: maskPhone(mobile),
      Phone_Match: true,
      ODP_Verified: false,
      Result: "Cancelled", // Oppdateres ved verify (Success eller ODP_Failed)
      Charged_Amount: 0,
      IP_Address: clientIp(request),
      User_Agent: clientUa(request),
    }).catch(e => {
      console.error("[reset-pin/request] log row creation failed:", e);
      return null;
    });

    await env.RESET_PIN_KV.put(
      `session:${sessionId}`,
      JSON.stringify({
        bookingId: booking.id,
        roomId: room.id,
        roomNumber,
        phoneNumber: mobile,
        odpHash,
        attemptsLeft: 5,
        createdAt: Date.now(),
        logEntryId: logRow ? logRow.id : null,
      }),
      { expirationTtl: SESSION_TTL_SEC }
    );

    // Inkrementer rate-limit
    if (env.RESET_PIN_KV) {
      const rateKey = `ratelimit:room:${roomNumber}`;
      const existing = await env.RESET_PIN_KV.get(rateKey, { type: "json" });
      const newCount = (existing?.count || 0) + 1;
      const firstAt = existing?.firstAt || Date.now();
      await env.RESET_PIN_KV.put(
        rateKey,
        JSON.stringify({ count: newCount, firstAt }),
        { expirationTtl: RATE_LIMIT_WINDOW_SEC }
      );
    }

    return jsonResponse({
      ok: true,
      sessionId,
      phoneMasked: maskPhone(mobile),
      odpLength: ODP_LENGTH,
    });
  } catch (err) {
    console.error("[reset-pin/request] internal error:", err);
    return jsonResponse({ ok: false, error: "internal" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ============================================================================
// Helpers
// ============================================================================

function generateOdp() {
  const buf = new Uint8Array(ODP_LENGTH);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < ODP_LENGTH; i++) {
    s += ODP_ALPHABET[buf[i] % ODP_ALPHABET.length];
  }
  return s;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSessionId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

function detectLanguage(request) {
  // Først Accept-Language-header, så fallback til 'en'
  const al = String(request.headers.get("Accept-Language") || "").toLowerCase();
  if (al.startsWith("nb") || al.startsWith("no")) return "nb";
  if (al.startsWith("lv")) return "lv";
  return "en";
}

function formatOdpSms(odp, lang) {
  if (lang === "nb") return `Din 2GM-kode: ${odp}. Gyldig 5 min.`;
  if (lang === "lv") return `Jūsu 2GM kods: ${odp}. Derīgs 5 min.`;
  return `Your 2GM code: ${odp}. Valid 5 min.`;
}

async function sendSms(env, phone, body) {
  const notifyBase = env.NOTIFY_PROXY_BASE || NOTIFY_PROXY_BASE;
  try {
    const res = await fetch(`${notifyBase}/notify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length <= 4) return s;
  return s.slice(0, s.length - 4) + "••••";
}

function clientIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || "").slice(0, 60);
}

function clientUa(request) {
  return String(request.headers.get("User-Agent") || "").slice(0, 200);
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

async function logQuiet(env, fields) {
  try { await createPinResetLog(env, fields); } catch (_) { /* fail-soft */ }
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
