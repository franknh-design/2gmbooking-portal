// functions/api/debug-rigg24-all.js
// MIDLERTIDIG - SLETT etter bruk.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const BOOKING_LIST_ID = "fe1dfe34-23df-4864-b0b1-b01bf60bfb75";

export async function onRequestGet(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const path = `/sites/${SITE_ID}/lists/${BOOKING_LIST_ID}/items?expand=fields&$top=999`;
    const data = await graphRequest(env, path);

    const all = (data.value || []).filter(item =>
      item.fields.Property_Name === "Rigg 24"
    );

    // Filtrer på "skulle vært opptatt i dag" basert på check-in/check-out
    const bookedToday = all.filter(item => {
      const f = item.fields;
      if (!f.Check_In) return false;
      const checkIn = f.Check_In.slice(0, 10);
      if (checkIn > today) return false; // ennå ikke flyttet inn
      if (f.Check_Out) {
        const checkOut = f.Check_Out.slice(0, 10);
        if (checkOut < today) return false; // har flyttet ut
      }
      return true; // open-ended og innenfor periode
    });

    const summary = {
      today,
      totalRigg24: all.length,
      byStatus: {},
      bookedTodayCount: bookedToday.length,
      bookedToday: bookedToday.map(item => ({
        id: item.id,
        person: item.fields.Person_Name,
        status: item.fields.Status,
        checkIn: item.fields.Check_In,
        checkOut: item.fields.Check_Out || "(open-ended)",
      })),
    };

    for (const item of all) {
      const s = item.fields.Status || "(none)";
      summary.byStatus[s] = (summary.byStatus[s] || 0) + 1;
    }

    return new Response(JSON.stringify(summary, null, 2), {
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
