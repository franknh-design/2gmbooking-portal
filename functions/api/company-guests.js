// functions/api/company-guests.js
// v1.0 — Tidligere gjester for innlogget firma, til autoutfylling i
// bestillingsskjemaet: skriver bestilleren navnet på en som har bodd hos oss
// før FOR SAMME FIRMA, foreslås navnet og mobil/e-post fylles inn.
//
// POST /api/company-guests
// Body: { token: "..." }
// Returnerer: { ok: true, guests: [{ name, phone, email, lastStay }] }
//   sortert nyeste opphold først. Bare bookinger der Company/Billing_Company
//   matcher tokenets Firma (samme regel som Mine bookinger) — et firma ser
//   aldri andre firmaers gjester. Kansellerte bookinger tas ikke med.
//
// Kontaktinfo hentes fra bookingens egne felt (Mobile/Email), nyeste opphold
// først. Mangler mobil på alle bookingene, slås navnet opp i Persons-lista
// (samme oppslag som /api/booking-phones).

import {
  findToken,
  getAllBookingsForCompany,
  getPersonsLookup,
} from "../_utils/sharepoint.js";

const MAX_GUESTS = 500;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const token = body && body.token;
    if (!token || typeof token !== "string") {
      return json({ ok: false, error: "missing_token" }, 400);
    }
    const tokenRow = await findToken(env, token);
    if (!tokenRow) return json({ ok: false, error: "invalid_token" }, 401);

    const company = String(tokenRow.fields.Firma || "").trim();
    if (!company) return json({ ok: true, guests: [] });

    const items = await getAllBookingsForCompany(env, company);

    // Nyeste opphold først, så første treff per navn vinner for kontaktinfo.
    items.sort((a, b) => String(b.fields.Check_In || "").localeCompare(String(a.fields.Check_In || "")));

    const byName = new Map();
    for (const it of items) {
      const f = it.fields || {};
      const name = String(f.Person_Name || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      let g = byName.get(key);
      if (!g) {
        g = { name, phone: "", email: "", lastStay: String(f.Check_In || "").slice(0, 10) };
        byName.set(key, g);
      }
      if (!g.phone && f.Mobile) g.phone = String(f.Mobile).trim();
      if (!g.email && f.Email) g.email = String(f.Email).trim();
    }

    const guests = [...byName.values()].slice(0, MAX_GUESTS);
    if (guests.some(g => !g.phone)) {
      const persons = await getPersonsLookup(env);
      for (const g of guests) {
        if (!g.phone) g.phone = persons.findPhone(g.name) || "";
      }
    }

    return json({ ok: true, guests });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("company-guests error:", err);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
