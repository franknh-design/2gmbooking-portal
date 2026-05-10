// functions/api/validate-pin.js
// v1.0 - PIN-bekreftelse for portal-innlogging.
//
// POST /api/validate-pin
// Body: { token: "jobzone-7f3a9c", pin: "483921" }
//
// Returnerer 200 med { ok: true } hvis PIN matcher (case-insensitive,
// digits-only sammenligning). 200 med { ok: false } hvis ugyldig — vi
// avslører ALDRI hva som var feil (token vs PIN) for å hindre enumeration.
//
// Best-effort: ved suksess oppdaterer vi SistBrukt + AntallBestillinger
// asynkront — failure her stopper ikke innlogging.

import { findToken, logTokenUsage } from "../_utils/sharepoint.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, pin } = body || {};

    if (!token || typeof token !== "string" || token.length < 8) {
      return jsonResponse({ ok: false });
    }
    if (!pin || typeof pin !== "string") {
      return jsonResponse({ ok: false });
    }

    const cleanPin = pin.replace(/\D/g, "");
    if (cleanPin.length !== 6) {
      return jsonResponse({ ok: false });
    }

    const match = await findToken(env, token);
    if (!match) {
      return jsonResponse({ ok: false });
    }

    const expected = String(match.fields.Pin || "").replace(/\D/g, "");
    if (!expected || expected !== cleanPin) {
      return jsonResponse({ ok: false });
    }

    // Logg bruken — ikke-blokkerende.
    logTokenUsage(env, match.id, match.fields.AntallBestillinger).catch(err => {
      // eslint-disable-next-line no-console
      console.error("logTokenUsage failed:", err);
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("validate-pin error:", err);
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
