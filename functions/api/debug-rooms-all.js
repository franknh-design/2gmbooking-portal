// functions/api/debug-rooms-all.js
// MIDLERTIDIG debug-endepunkt - SLETT etter bruk.
// Viser alle rom (mer enn 3) for å fange opp LongTerm-felter på rom som har det.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const ROOMS_LIST_ID = "bfa962a0-5eb2-416c-abe8-adba06558c11";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const path = `/sites/${SITE_ID}/lists/${ROOMS_LIST_ID}/items?expand=fields&$top=999`;
    const data = await graphRequest(env, path);

    // Samle alle felt-navn som forekommer på tvers av alle rom
    const fieldNames = new Set();
    for (const item of (data.value || [])) {
      Object.keys(item.fields || {}).forEach(k => fieldNames.add(k));
    }

    // Returner et sammendrag og noen sampleeksempler:
    //  - alle felt-navn som finnes
    //  - 1 rom fra hver PropertyLookupId vi finner
    const samplesByProperty = new Map();
    for (const item of (data.value || [])) {
      const propId = item.fields.PropertyLookupId;
      if (!samplesByProperty.has(propId)) {
        samplesByProperty.set(propId, item);
      }
    }

    const samples = Array.from(samplesByProperty.values()).map(item => ({
      id: item.id,
      title: item.fields.Title,
      fields: item.fields,
    }));

    return new Response(JSON.stringify({
      totalCount: data.value.length,
      allFieldNames: Array.from(fieldNames).sort(),
      samples,
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
