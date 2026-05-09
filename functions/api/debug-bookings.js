// functions/api/debug-bookings.js
// MIDLERTIDIG DEBUG-ENDEPUNKT - SLETTES ETTER FEILSØKING
//
// GET /api/debug-bookings
// Returnerer de N nyeste radene fra Booking-lista med ALLE felter
// (interne SharePoint-feltnavn intakt), slik at vi kan se hva som
// faktisk lagres når portalen sender inn en bestilling.
//
// Bruk: https://2gmbooking-portal.pages.dev/api/debug-bookings?n=10

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const BOOKINGS_LIST_ID = "fe1dfe34-23df-4864-b0b1-b01bf60bfb75";

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const n = Math.min(parseInt(url.searchParams.get("n") || "5", 10) || 5, 50);

    // Hent rader sortert på createdDateTime desc, kun første side
    const path =
      `/sites/${SITE_ID}/lists/${BOOKINGS_LIST_ID}/items` +
      `?$expand=fields&$top=${n}&$orderby=createdDateTime desc`;

    const data = await graphRequest(env, path);

    const items = (data.value || []).map(item => ({
      id: item.id,
      createdDateTime: item.createdDateTime,
      lastModifiedDateTime: item.lastModifiedDateTime,
      webUrl: item.webUrl,
      fields: item.fields,
    }));

    return jsonResponse({
      ok: true,
      count: items.length,
      requested: n,
      items,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
