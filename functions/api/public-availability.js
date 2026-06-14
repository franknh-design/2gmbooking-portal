// functions/api/public-availability.js
// v1.0 — Anonymt ledighets-endepunkt for den offentlige bookingsiden.
//
// POST /api/public-availability
// Body: { fromDate: "2026-06-13", toDate: "2026-07-13" }
//
// Returnerer:
//   { enabled: true, nightlyRate: 895, days: [{ date, available, ... }] }
//   { enabled: false }                                  (global bryter av)
//   { error: "invalid_request" | "invalid_dates" | "range_too_large" | "internal_error" }
//
// Bundet til Rigg Andslimoen. Ingen token — dette er publikum-siden.

import { getPublicConfig } from "../_utils/sharepoint.js";
import { calculatePublicAvailability } from "../_utils/public-availability.js";

const PROPERTY_NAME = "Rigg Andslimoen";
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

    const config = await getPublicConfig(env, PROPERTY_NAME);
    if (!config.enabled) {
      return jsonResponse({ enabled: false });
    }

    const result = await calculatePublicAvailability(env, PROPERTY_NAME, fromDate, toDate);
    return jsonResponse({
      enabled: true,
      nightlyRate: config.nightlyRate,
      days: result.days,
    });
  } catch (err) {
    console.error("public-availability error:", err);
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
