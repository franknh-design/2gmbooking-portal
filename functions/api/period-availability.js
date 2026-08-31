// functions/api/period-availability.js
// v1.0 (portal v3.19.18) — Hvor mange rom er ledige HELE en periode?
//
// Per-dag-tallet i kalenderen svarer på noe annet: det kan stå «1 ledig» hver
// dag i ti dager uten at ett rom er ledig hele tiden. Dette endepunktet gir
// tallet kunden faktisk trenger før de bestiller et sammenhengende opphold.
//
// POST /api/period-availability
// Body: { token, property, from: "YYYY-MM-DD", to: "YYYY-MM-DD" | null }
//   to = null → åpen periode, vurderes 30 dager fram (samme som submit).
//
// Returnerer:
//   { ok: true, roomsFreeWholePeriod: 3 }
//   { ok: false, error: "invalid_property" | "invalid_dates" | "invalid_token" }

import { propertyIdToName, findToken, checkWholePeriodFit } from "../_utils/sharepoint.js";

const MAX_SPAN_DAYS = 400;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { token, property, from, to } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    const propertyName = propertyIdToName(property);
    if (!propertyName) {
      return jsonResponse({ ok: false, error: "invalid_property" }, 400);
    }
    if (!from || isNaN(new Date(from).getTime())) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    if (to && isNaN(new Date(to).getTime())) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    if (to && new Date(to) < new Date(from)) {
      return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
    }
    if (to) {
      const days = Math.floor((new Date(to) - new Date(from)) / 86400000) + 1;
      if (days > MAX_SPAN_DAYS) {
        return jsonResponse({ ok: false, error: "range_too_large", maxDays: MAX_SPAN_DAYS }, 400);
      }
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    const fit = await checkWholePeriodFit(
      env,
      propertyName,
      [{ checkIn: String(from).slice(0, 10), checkOut: to ? String(to).slice(0, 10) : null }],
      tokenRow.fields.Firma || null,
    );

    return jsonResponse({
      ok: true,
      roomsFreeWholePeriod: fit.roomsPerSpan[0] || 0,
    });
  } catch (err) {
    console.error("period-availability error:", err);
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
