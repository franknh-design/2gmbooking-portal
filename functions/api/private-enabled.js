// functions/api/private-enabled.js — v1.0
// GET /api/private-enabled
// Forteller 2gm.no-inngangssiden (/start) om privat booking er aktiv noe sted.
// { privateEnabled: true|false }  — true = minst én eiendom er åpen for privat
// booking (PublicBookingEnabled + positiv nattsats). Avledet, ingen egen bryter.
// Ved feil: 500 → inngangssiden faller til «vis Bedrift|Privat-valget».

import { isAnyPrivateEnabled } from "../_utils/sharepoint.js";

export async function onRequestGet(context) {
  try {
    const privateEnabled = await isAnyPrivateEnabled(context.env);
    return json({ privateEnabled }, 200);
  } catch (err) {
    console.error("private-enabled error:", err);
    return json({ error: "internal_error" }, 500);
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
