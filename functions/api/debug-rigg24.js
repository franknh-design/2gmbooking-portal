// functions/api/debug-rigg24.js
// MIDLERTIDIG - SLETT etter bruk.
// Tester nøyaktig samme logikk som getRoomsForProperty for Rigg 24.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const ROOMS_LIST_ID = "bfa962a0-5eb2-416c-abe8-adba06558c11";
const PROPERTIES_LIST_ID = "d842d574-f238-442a-be3d-77334727e89f";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    // 1. Hent property-mapping (samme som i sharepoint.js)
    const propsData = await graphRequest(env,
      `/sites/${SITE_ID}/lists/${PROPERTIES_LIST_ID}/items?expand=fields&$top=999`);

    const propertyMap = {};
    for (const item of (propsData.value || [])) {
      const lookupId = item.id;
      const title = item.fields?.Title;
      if (lookupId && title) propertyMap[lookupId] = title;
    }

    // 2. Finn lookupId for "Rigg 24"
    const target = "Rigg 24";
    const lookupIdForProperty = Object.entries(propertyMap)
      .find(([id, name]) => name === target)?.[0];

    // 3. Hent Rooms og test filtreringen
    const roomsData = await graphRequest(env,
      `/sites/${SITE_ID}/lists/${ROOMS_LIST_ID}/items?expand=fields&$top=999`);

    const allRooms = roomsData.value || [];

    // Step-by-step filter (med tellinger på hver steg)
    const step1_total = allRooms.length;

    const step2_matchProperty = allRooms.filter(item =>
      String(item.fields.PropertyLookupId) === String(lookupIdForProperty)
    );

    const step3_hasTitle = step2_matchProperty.filter(item =>
      !!item.fields.Title
    );

    const step4_isActive = step3_hasTitle.filter(item =>
      item.fields.Active === true
    );

    // Vis 3 sample rom som *skulle* matche
    const sampleMatched = step2_matchProperty.slice(0, 3).map(item => ({
      id: item.id,
      Title: item.fields.Title,
      PropertyLookupId: item.fields.PropertyLookupId,
      PropertyLookupId_type: typeof item.fields.PropertyLookupId,
      Active: item.fields.Active,
      Active_type: typeof item.fields.Active,
    }));

    // Vis et sample rom uavhengig av filter (for sammenligning)
    const sampleAny = allRooms.slice(0, 3).map(item => ({
      id: item.id,
      Title: item.fields.Title,
      PropertyLookupId: item.fields.PropertyLookupId,
      PropertyLookupId_type: typeof item.fields.PropertyLookupId,
    }));

    return new Response(JSON.stringify({
      target,
      propertyMap,
      lookupIdForProperty,
      lookupIdForProperty_type: typeof lookupIdForProperty,
      counts: {
        step1_total,
        step2_matchProperty: step2_matchProperty.length,
        step3_hasTitle: step3_hasTitle.length,
        step4_isActive: step4_isActive.length,
      },
      sampleMatched,
      sampleAny,
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
