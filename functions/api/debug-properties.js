// functions/api/debug-properties.js
// MIDLERTIDIG debug-endepunkt - SLETT etter bruk.
// Viser ID og navn for alle Properties (Eiendommer-listen).

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const PROPERTIES_LIST_ID = "d842d574-f238-442a-be3d-77334727e89f"; // "Eiendommer..."

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const path = `/sites/${SITE_ID}/lists/${PROPERTIES_LIST_ID}/items?expand=fields&$top=20`;
    const data = await graphRequest(env, path);

    const properties = (data.value || []).map(item => ({
      id: item.id,
      // Vis ALLE felter slik at vi ser navnet uansett hva kolonnen heter
      fields: item.fields,
    }));

    return new Response(JSON.stringify({ properties }, null, 2), {
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
