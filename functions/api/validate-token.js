// functions/api/validate-token.js
// v1.0 - Token validation endpoint for booking portal

import { findToken, logTokenUsage, maskPhone, computeTokenStamp, getPortalLocationStatus } from "../_utils/sharepoint.js";

/**
 * POST /api/validate-token
 * Body: { token: string }
 * 
 * Returns 200 with { valid: false } if invalid (NEVER reveals why - 
 * prevents enumeration attacks).
 * Returns 200 with kunde-data if valid.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== "string" || token.length < 8) {
      return jsonResponse({ valid: false });
    }

    const match = await findToken(env, token);
    
    if (!match) {
      return jsonResponse({ valid: false });
    }

    const fields = match.fields;

    // Logg bruken (asynkront - vi venter ikke på den)
    // Hvis logging feiler, skal valideringen likevel returnere suksess
    logTokenUsage(env, match.id, fields.AntallBestillinger).catch(err => {
      console.error("logTokenUsage failed:", err);
    });

    // Parse tillatte lokasjoner (case-insensitive normalisering)
    const tillatteLokasjoner = (fields.TillatteLokasjoner || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    // v3.10.30: Standardspråk per kontaktperson — admin setter Sprak i
    // Customer_Tokens (nb/en/tom). Portalen kaller I18n.setLang etter
    // vellykket validering hvis feltet er satt.
    const language = String(fields.Sprak || "").toLowerCase();

    // v3.19.15: hvilke rigger som ikke er operative ennå («Kommer»/«Stengt»).
    // Feiler myk til tomt objekt — en Graph-blink skal ikke blokkere innlogging.
    // Selve bestillingen sjekkes uansett server-side i submit-booking.
    let lokasjonStatus = {};
    try {
      lokasjonStatus = await getPortalLocationStatus(env);
    } catch (err) {
      console.error("getPortalLocationStatus failed:", err);
    }

    return jsonResponse({
      valid: true,
      firma: fields.Firma,
      kontaktperson: fields.Kontaktperson,
      telefon_maskert: maskPhone(fields.Telefon),
      tillatte_lokasjoner: tillatteLokasjoner,
      maks_rom: fields.MaksRomPerBestilling || 1,
      // v3.19.11: firmaets standard fakturareferanse (satt ved registrering
      // eller av admin). Prefyller prosjektnr-feltet i bestillingsskjemaet —
      // kunden kan overstyre per bestilling.
      prosjektnr: String(fields.Prosjektnr || "").trim(),
      language: language === "nb" || language === "en" ? language : "",
      lokasjon_status: lokasjonStatus,
      // v1.1: token-stempel = hash av Pin+Aktiv+Token+Lokasjoner.
      // Klienten lagrer dette i sesjonen og logger ut hvis det endrer
      // seg mellom kall — gjør at PIN-rotering, token-rotering og andre
      // admin-endringer tvinger fersk innlogging umiddelbart.
      tokenStamp: await computeTokenStamp(fields),
    });
  } catch (err) {
    console.error("validate-token error:", err);
    return jsonResponse({ valid: false, error: "internal_error" }, 500);
  }
}

/**
 * Handle CORS preflight (selv om Pages Functions er på samme domene,
 * er dette nyttig hvis vi senere flytter til subdomene).
 */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
