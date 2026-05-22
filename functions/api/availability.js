// functions/api/availability.js
// v1.0 - Availability endpoint for booking portal
//
// POST /api/availability
// Body: { property: "rigg24", fromDate: "2026-05-01", toDate: "2026-05-31" }
//
// Returns:
//   {
//     property: "rigg24",
//     propertyName: "Rigg 24",
//     days: [
//       { date: "2026-05-01", available: 7, occupied: 1, totalActive: 8 },
//       ...
//     ]
//   }
//
// Eller ved feil:
//   { error: "invalid_property" | "invalid_dates" | "internal_error" }

import {
  propertyIdToName,
  calculateAvailability,
  findToken,
  getAllRates,
  getRoomsByIdMap,
  getPropertiesByIdMap,
} from "../_utils/sharepoint.js";
import { getDailyRate, getCheckoutFee } from "../_utils/rates.js";

// Maksimalt antall dager per spørring. Klienten bør be om én måned om gangen.
// Forhindrer DoS-aktige spørringer ("gi meg 10 år") som ville hentet og
// itererte over enorme datamengder.
const MAX_DAYS = 92;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { property, fromDate, toDate, token, details } = body || {};

    // Valider property-id mot kjent mapping
    const propertyName = propertyIdToName(property);
    if (!propertyName) {
      return jsonResponse({ error: "invalid_property" }, 400);
    }

    // Valider datoer
    if (!fromDate || !toDate) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    const from = new Date(fromDate);
    const to   = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }
    if (to < from) {
      return jsonResponse({ error: "invalid_dates" }, 400);
    }

    const dayCount = Math.floor((to - from) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_DAYS) {
      return jsonResponse({ error: "range_too_large", maxDays: MAX_DAYS }, 400);
    }

    // v1.1: hvis token er gitt, slå opp kundens Firma så long-term-rom som
    // tilhører dem selv blir behandlet som vanlig ledighet (ikke "fullt").
    let customerCompany = null;
    if (token && typeof token === "string") {
      try {
        const tokenRow = await findToken(env, token);
        if (tokenRow) customerCompany = tokenRow.fields.Firma || null;
      } catch (_) { /* token-feil: behandle som anonym, fortsett */ }
    }

    const result = await calculateAvailability(
      env,
      propertyName,
      fromDate,
      toDate,
      customerCompany,
      { details: details === true },
    );

    // Nattpris + utvask-gebyr for kundens firma på denne eiendommen, så
    // portalen kan vise pris i kalenderen og bestillings-sammendraget.
    // Flat pr. (firma, eiendom) — varierer ikke pr. dato. Feiler myk:
    // pricing=null hvis rate-oppslaget kaster, og kalenderen skjuler da prisen.
    let pricing = null;
    try {
      const [allRates, roomsById, propertiesById] = await Promise.all([
        getAllRates(env),
        getRoomsByIdMap(env),
        getPropertiesByIdMap(env),
      ]);
      const rateInfo = getDailyRate({
        company: customerCompany,
        propertyTitle: propertyName,
        allRates,
        roomsById,
        propertiesById,
      });
      // To gebyr-oppslag: normalt (≥2 netter) og 1-natt-rabattert.
      // Kalkulatoren i frontend velger riktig sats ut fra valgt periode.
      const feeInfo = getCheckoutFee({
        company: customerCompany,
        propertyTitle: propertyName,
        allRates,
        nights: 2,
      });
      const feeInfo1 = getCheckoutFee({
        company: customerCompany,
        propertyTitle: propertyName,
        allRates,
        nights: 1,
      });
      pricing = {
        rate: rateInfo.rate,
        rateSource: rateInfo.source,
        checkoutFee: feeInfo.fee,
        checkoutFee1: feeInfo1.fee,
        vatPercent: 25,
      };
    } catch (e) {
      console.error("availability pricing error:", e);
    }

    return jsonResponse({
      property,
      propertyName,
      days: result.days,
      pricing,
    });
  } catch (err) {
    console.error("availability error:", err);
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
