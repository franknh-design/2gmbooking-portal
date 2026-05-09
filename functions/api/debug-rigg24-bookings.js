// functions/api/debug-rigg24-bookings.js
// MIDLERTIDIG - SLETT etter bruk.
// Viser status og Check_In/Check_Out for alle Rigg 24-bookinger.

import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const BOOKING_LIST_ID = "fe1dfe34-23df-4864-b0b1-b01bf60bfb75";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const path = `/sites/${SITE_ID}/lists/${BOOKING_LIST_ID}/items?expand=fields&$top=999`;
    const data = await graphRequest(env, path);

    const all = (data.value || []).filter(item =>
      item.fields.Property_Name === "Rigg 24"
    );

    const summary = {
      total: all.length,
      byStatus: {},
      activeAndUpcoming: 0,
      withCheckOut: 0,
      withoutCheckOut: 0,
      details: [],
    };

    for (const item of all) {
      const f = item.fields;
      const status = f.Status || "(none)";
      summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

      if (status === "Active" || status === "Upcoming") {
        summary.activeAndUpcoming++;
        if (f.Check_Out) summary.withCheckOut++;
        else summary.withoutCheckOut++;

        summary.details.push({
          id: item.id,
          room: f.Room || f.Title,
          person: f.Person_Name,
          company: f.Company,
          status,
          checkIn: f.Check_In,
          checkOut: f.Check_Out || "(open-ended)",
        });
      }
    }

    // Sort details by Check_In
    summary.details.sort((a, b) => (a.checkIn || "").localeCompare(b.checkIn || ""));

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
