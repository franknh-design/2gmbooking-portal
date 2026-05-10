// functions/api/validate-pin.js
// v1.2 - PIN-bekreftelse for portal-innlogging med rate-limit + lockout.
//
// POST /api/validate-pin
// Body: { token: "jobzone-7f3a9c", pin: "483921" }
//
// Returnerer 200 med { ok: true } hvis PIN matcher. 200 med { ok: false }
// hvis ugyldig — vi avslører ALDRI hva som var feil (token vs PIN) for å
// hindre enumeration. Ved lockout settes locked:true så frontend kan vise
// en passende melding.
//
// v1.2: per-token rate-limit (5 mislykkede forsøk → 1 times lockout).
// Implementert via SharePoint-listen Pin_Attempts; degraderer stille til
// "ingen rate-limit" hvis listen ikke er konfigurert (LIST_IDS.PIN_ATTEMPTS
// tom).

import {
  findToken,
  logTokenUsage,
  computeTokenStamp,
  isPinTokenLocked,
  recordFailedPinAttempt,
  clearPinAttempts,
} from "../_utils/sharepoint.js";

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

    // v1.2: tidlig lockout-sjekk FØR PIN-validering. Hvis token er låst
    // hopper vi rett til ok:false med locked-flagg. Bevisst ingen telling
    // av forsøk under lockout — det forlenger bare lockout-vinduet og
    // belaster SharePoint unødvendig.
    if (await isPinTokenLocked(env, token)) {
      return jsonResponse({ ok: false, locked: true });
    }

    const match = await findToken(env, token);
    if (!match) {
      // Ukjent token: vi tracker IKKE forsøk her. Per-token-rate-limit
      // krever en ekte token-streng som key — ellers ville en angriper
      // bare bytte token mellom hvert forsøk og omgå systemet.
      return jsonResponse({ ok: false });
    }

    const expected = String(match.fields.Pin || "").replace(/\D/g, "");
    if (!expected || expected !== cleanPin) {
      // v1.2: registrer mislykket forsøk. Returnerer locked-flagg hvis
      // dette forsøket utløste lockout (5. mislykkede).
      const result = await recordFailedPinAttempt(env, token).catch(err => {
        // eslint-disable-next-line no-console
        console.error("recordFailedPinAttempt failed:", err);
        return { locked: false };
      });
      return jsonResponse({ ok: false, locked: result.locked });
    }

    // v1.2: vellykket innlogging — nullstill teller (fire-and-forget).
    clearPinAttempts(env, token).catch(err => {
      // eslint-disable-next-line no-console
      console.error("clearPinAttempts failed:", err);
    });

    // Logg bruken — ikke-blokkerende.
    logTokenUsage(env, match.id, match.fields.AntallBestillinger).catch(err => {
      // eslint-disable-next-line no-console
      console.error("logTokenUsage failed:", err);
    });

    // v1.1: returner samme tokenStamp som validate-token så klienten kan
    // lagre fersk verdi rett etter PIN-bekreftelse.
    return jsonResponse({
      ok: true,
      tokenStamp: await computeTokenStamp(match.fields),
    });
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
