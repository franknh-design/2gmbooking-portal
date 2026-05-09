// functions/api/debug-bookings.js
// MIDLERTIDIG DEBUG-ENDEPUNKT - SLETTES ETTER FEILSØKING
//
// GET /api/debug-bookings?n=5
//   Returnerer de N nyeste radene fra Booking-lista (paginert hent +
//   client-side sort på createdDateTime desc fordi Graph ignorerer
//   $orderby på dette feltet).
//
// GET /api/debug-bookings?ref=2GM-XXXXXX
//   Finner rader hvor Title (eller noen feltverdi) matcher bookingref.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const BOOKINGS_LIST_ID = "fe1dfe34-23df-4864-b0b1-b01bf60bfb75";

async function fetchAllBookingItems(env) {
  const startPath = `/sites/${SITE_ID}/lists/${BOOKINGS_LIST_ID}/items?$expand=fields&$top=999`;
  const all = [];
  let nextUrl = null;
  let pages = 0;
  do {
    const data = nextUrl
      ? await graphRequest(env, nextUrl)
      : await graphRequest(env, startPath);
    if (Array.isArray(data.value)) all.push(...data.value);
    nextUrl = data["@odata.nextLink"] || null;
    pages++;
    if (pages >= 10) break;
  } while (nextUrl);
  return all;
}

function shapeItem(item) {
  return {
    id: item.id,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    webUrl: item.webUrl,
    fields: item.fields,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const ref = url.searchParams.get("ref");
    const n = Math.min(parseInt(url.searchParams.get("n") || "5", 10) || 5, 50);

    const all = await fetchAllBookingItems(env);

    if (ref) {
      const target = ref.trim().toLowerCase();
      const matches = all.filter(item => {
        const f = item.fields || {};
        const title = String(f.Title || "").trim().toLowerCase();
        const notes = String(f.Notes || "").toLowerCase();
        return title === target || notes.includes(target);
      });
      return jsonResponse({
        ok: true,
        searchedRef: ref,
        totalRowsScanned: all.length,
        matches: matches.length,
        items: matches.map(shapeItem),
      });
    }

    const sorted = all.slice().sort((a, b) => {
      const ad = a.createdDateTime || "";
      const bd = b.createdDateTime || "";
      return bd.localeCompare(ad);
    });

    const top = sorted.slice(0, n).map(shapeItem);

    return jsonResponse({
      ok: true,
      totalRowsScanned: all.length,
      requested: n,
      items: top,
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
