// functions/api/debug-portalstatus.js
// MIDLERTIDIG DEBUG-ENDEPUNKT — SLETTES ETTER VERIFISERING.
// Leser Properties uten $select og viser hvilke feltnavn radene faktisk har,
// så vi kan bekrefte internnavnet på den nye PortalStatus-kolonnen.
import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const PROPERTIES_LIST_ID = "d842d574-f238-442a-be3d-77334727e89f";

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const data = await graphRequest(
      env,
      `/sites/${SITE_ID}/lists/${PROPERTIES_LIST_ID}/items?$expand=fields&$top=999`
    );
    const rows = (data.value || []).map(it => {
      const f = it.fields || {};
      return {
        id: it.id,
        title: f.Title || null,
        harPortalStatus: "PortalStatus" in f,
        portalStatus: f.PortalStatus ?? null,
        feltnavn: Object.keys(f).filter(k => !k.startsWith("@")),
      };
    });
    const cols = await graphRequest(
      env,
      `/sites/${SITE_ID}/lists/${PROPERTIES_LIST_ID}/columns?$select=name,displayName,columnGroup`
    );
    return new Response(JSON.stringify({
      ok: true,
      rows,
      kolonner: (cols.value || [])
        .filter(c => /portal|status/i.test(c.name + " " + c.displayName))
        .map(c => ({ internnavn: c.name, visningsnavn: c.displayName })),
    }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
