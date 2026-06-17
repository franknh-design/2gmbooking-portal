// functions/api/private-availability.js
// v1.0 — Anonymt ledighets-endepunkt for den offentlige bookingsiden.
//
// POST /api/private-availability
// Body: { fromDate: "2026-06-13", toDate: "2026-07-13" }
//
// Returnerer:
//   { enabled: true, nightlyRate: 895, days: [{ date, available, ... }] }
//   { enabled: false }                                  (global bryter av)
//   { error: "invalid_request" | "invalid_dates" | "range_too_large" | "internal_error" }
//
// Bundet til Rigg Andslimoen. Ingen token — dette er publikum-siden.

import { getPrivateConfig, propertyIdToName } from "../_utils/sharepoint.js";
import { calculatePrivateAvailability } from "../_utils/private-availability.js";

// Default-rigg når ingen `property` sendes (bakoverkompatibelt med enkelt-rigg).
const DEFAULT_PROPERTY = "Rigg Andslimoen";
const MAX_DAYS = 92;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    const { fromDate, toDate } = body || {};

    // Rigg-velger: resolve slug → eiendomsnavn. Ingen slug = default-riggen.
    // Ukjent slug behandles som stengt (fail closed).
    const property = (body && body.property) ? propertyIdToName(body.property) : DEFAULT_PROPERTY;
    if (!property) {
      return jsonResponse({ enabled: false });
    }

    if (!fromDate || !toDate) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    const dayCount = Math.floor((to - from) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_DAYS) {
      return jsonResponse({ error: "range_too_large", maxDays: MAX_DAYS }, 400);
    }

    const config = await getPrivateConfig(env, property);
    if (!config.enabled) {
      return jsonResponse({ enabled: false });
    }

    const result = await calculatePrivateAvailability(env, property, fromDate, toDate);
    return jsonResponse({
      enabled: true,
      nightlyRate: config.nightlyRate,
      days: result.days,
    });
  } catch (err) {
    console.error("private-availability error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
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
