// functions/api/private-locations.js — v1.0
// GET /api/private-locations
// Lister riggene som er åpne for privat booking (PublicBookingEnabled + pris),
// til rigg-velgeren på /private. { ok:true, locations:[{slug,title,nightlyRate,address}] }
// Ved feil: 500 → siden faller tilbake til enkelt-rigg (Andslimoen).

import { getPrivateLocations } from "../_utils/sharepoint.js";

export async function onRequestGet(context) {
  try {
    const locations = await getPrivateLocations(context.env);
    return json({ ok: true, locations }, 200);
  } catch (err) {
    console.error("private-locations error:", err);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
