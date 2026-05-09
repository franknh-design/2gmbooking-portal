// functions/api/validate-token.js
// v1.0 - Token validation endpoint for booking portal

import { findToken, logTokenUsage, maskPhone } from "../_utils/sharepoint.js";

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

    return jsonResponse({
      valid: true,
      firma: fields.Firma,
      kontaktperson: fields.Kontaktperson,
      telefon_maskert: maskPhone(fields.Telefon),
      tillatte_lokasjoner: tillatteLokasjoner,
      maks_rom: fields.MaksRomPerBestilling || 1,
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
