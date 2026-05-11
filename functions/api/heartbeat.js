// functions/api/heartbeat.js
// v1.0 (portal v3.10.11) — Lett "jeg er fortsatt her"-puls fra portalen.
//
// Portalen poster hit hvert minutt mens fanen er aktiv. Vi oppdaterer
// Customer_Tokens.LastSeen til nåtid, slik at admin-appen kan vise hvem
// som faktisk har portalen åpen akkurat nå (i motsetning til SistBrukt
// som bare bumpes ved innlogging og bestilling).
//
// Sikkerhet: token-validering kreves som vanlig. Ingen lockout-sjekk (PIN
// er allerede verifisert ved innlogging).

import { findToken, updateTokenHeartbeat } from "../_utils/sharepoint.js";

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
    // Fire-and-forget — vi bryr oss ikke om PATCH-en feiler (kan skje hvis
    // LastSeen-kolonnen ikke finnes ennå). Klienten trenger ikke vite.
    try {
      await updateTokenHeartbeat(env, tokenRow.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("heartbeat: LastSeen PATCH feilet (kolonne mangler?):", err.message);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("heartbeat error:", err);
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
