// functions/api/debug-lists.js
// MIDLERTIDIG debug-endepunkt - SLETT etter bruk.
// Lister opp alle SharePoint-lister med displayName og internt name.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const data = await graphRequest(env, `/sites/${SITE_ID}/lists?$select=name,displayName,id`);

    const lists = (data.value || []).map(l => ({
      displayName: l.displayName,
      name: l.name,
      id: l.id,
    }));

    return new Response(JSON.stringify({ lists }, null, 2), {
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
