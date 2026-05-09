// functions/api/debug-rooms.js
// MIDLERTIDIG DEBUG-ENDEPUNKT - SLETTES ETTER FEILSØKING
//
// GET /api/debug-rooms?roomId=42
//   Returnerer rommet med id=42 (Booking.RoomLookupId-verdien) og
//   ALLE feltene Graph leverer på Rooms-lista. Bruk til å bekrefte at
//   Door_Code faktisk ligger på rommet.
//
// GET /api/debug-rooms?title=204
//   Søker etter Rom-rad hvor Title === "204".

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const ROOMS_LIST_ID = "bfa962a0-5eb2-416c-abe8-adba06558c11";

async function fetchAll(env) {
  const startPath = `/sites/${SITE_ID}/lists/${ROOMS_LIST_ID}/items?$expand=fields&$top=999`;
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

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId");
    const title  = url.searchParams.get("title");

    const all = await fetchAll(env);

    if (roomId) {
      const match = all.find(it => String(it.id) === String(roomId));
      if (!match) {
        return jsonResponse({ ok: false, error: "not_found", searchedRoomId: roomId, totalRooms: all.length });
      }
      return jsonResponse({
        ok: true,
        roomId,
        room: {
          id: match.id,
          createdDateTime: match.createdDateTime,
          lastModifiedDateTime: match.lastModifiedDateTime,
          fieldKeys: Object.keys(match.fields || {}),
          fields: match.fields,
        },
      });
    }

    if (title) {
      const matches = all.filter(it => String(it.fields?.Title || "").trim() === title.trim());
      return jsonResponse({
        ok: true,
        searchedTitle: title,
        matchCount: matches.length,
        rooms: matches.map(it => ({
          id: it.id,
          fieldKeys: Object.keys(it.fields || {}),
          fields: it.fields,
        })),
      });
    }

    // Default: oppsummer Door_Code-status på alle rom
    const summary = all.map(it => {
      const f = it.fields || {};
      return {
        id: it.id,
        title: f.Title || null,
        propertyLookupId: f.PropertyLookupId || null,
        active: f.Active === true,
        doorCode: f.Door_Code || null,
        doorCodeGeneratedAt: f.Door_Code_Generated_At || null,
        hasDoorCode: !!f.Door_Code,
      };
    });

    const stats = {
      total: summary.length,
      withDoorCode: summary.filter(r => r.hasDoorCode).length,
      withoutDoorCode: summary.filter(r => !r.hasDoorCode && r.active).length,
    };

    return jsonResponse({ ok: true, stats, rooms: summary });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
