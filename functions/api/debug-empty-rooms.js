// functions/api/debug-empty-rooms.js
// MIDLERTIDIG - SLETT etter bruk.
// Lister rader i Rooms som mangler Title eller PropertyLookupId.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const ROOMS_LIST_ID = "bfa962a0-5eb2-416c-abe8-adba06558c11";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const path = `/sites/${SITE_ID}/lists/${ROOMS_LIST_ID}/items?expand=fields&$top=999`;
    const data = await graphRequest(env, path);

    const empty = (data.value || [])
      .filter(item => {
        const f = item.fields;
        return !f.Title || !f.PropertyLookupId;
      })
      .map(item => ({
        id: item.id,
        Title: item.fields.Title || "(MANGLER)",
        PropertyLookupId: item.fields.PropertyLookupId || "(MANGLER)",
        Active: item.fields.Active,
        Created: item.fields.Created,
        Modified: item.fields.Modified,
      }));

    return new Response(JSON.stringify({
      totalEmpty: empty.length,
      rows: empty,
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
