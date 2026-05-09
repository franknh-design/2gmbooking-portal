// functions/api/debug-rooms.js
// MIDLERTIDIG debug-endepunkt - SLETT etter bruk.
// Viser rå Rooms-data fra Graph API for å se hva felt-navnene faktisk er.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const ROOMS_LIST_ID = "bfa962a0-5eb2-416c-abe8-adba06558c11";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    // Hent kun de 3 første radene for å redusere størrelse
    const path = `/sites/${SITE_ID}/lists/${ROOMS_LIST_ID}/items?expand=fields&$top=3`;
    const data = await graphRequest(env, path);

    // Returner kun fields-objektet for hver rad - det er der felt-navnene synes
    const samples = (data.value || []).map(item => ({
      id: item.id,
      fields: item.fields,
    }));

    return new Response(JSON.stringify({ samples }, null, 2), {
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
