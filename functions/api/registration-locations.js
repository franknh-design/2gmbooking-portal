// functions/api/registration-locations.js — v1.0
// GET /api/registration-locations
// Returnerer lokasjonene som skal vises på /registrer (Properties med
// ShowOnRegistration=true, satt i admin). { ok:true, locations:[{slug,title}] }
// Ved feil: 500 → registreringssiden faller tilbake til hardkodet liste.

import { getRegistrationLocations } from "../_utils/sharepoint.js";

export async function onRequestGet(context) {
  try {
    const locations = await getRegistrationLocations(context.env);
    return json({ ok: true, locations }, 200);
  } catch (err) {
    console.error("registration-locations error:", err);
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
