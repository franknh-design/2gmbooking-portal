// functions/api/invoice-archive.js
// v1.0 — Returnerer kundens fakturaarkiv: tidligere opphold gruppert per måned.
//
// POST /api/invoice-archive
// Body: { token: "..." }
//
// Returnerer:
//   { ok: true, archive: [
//       {
//         period: "2026-04",            // ISO år-måned
//         label:  "April 2026",         // menneskelig lesbar (engelsk)
//         labelNb: "april 2026",
//         bookings: [
//           {
//             ref: "2GM-AB12CD",
//             property: "Rigg 24",
//             roomNumber: "204",
//             guest: "Ola Nordmann",
//             checkIn: "2026-04-03",
//             checkOut: "2026-04-12",
//             nights: 9,
//             status: "Completed"
//           }, ...
//         ],
//         totalNights: 27,
//         bookingCount: 4
//       }, ...
//     ] }
//
// Sortering: nyeste måned først. Hver bookings-liste sorteres på check-in.

import {
  findToken,
  getAllBookingsForCompany,
  getRoomsByIdMap,
} from "../_utils/sharepoint.js";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const MONTHS_NB = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember"
];

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { token } = body || {};
    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }
    const company = tokenRow.fields.Firma || "";
    if (!company) return jsonResponse({ ok: true, archive: [] });

    // Hent ALLE bookinger for kunden (alt unntatt Cancelled). Vi grupperer
    // selv basert på siste natt — sammenfaller med admin-appens "natt-tilhører-
    // måneden-den-slutter-i"-konvensjon.
    const [items, roomsById] = await Promise.all([
      getAllBookingsForCompany(env, company),
      getRoomsByIdMap(env),
    ]);

    // Group by month-of-last-night. For open-ended bookinger uten Check_Out,
    // grupperer vi på Check_In-måneden — kunden trenger fortsatt å se dem.
    const byMonth = new Map();
    for (const it of items) {
      const f = it.fields || {};
      if (!f.Check_In) continue;
      const ci = String(f.Check_In).slice(0, 10);
      // Siste natt = Check_Out - 1 dag. Hvis Check_Out mangler, bruk Check_In.
      let bucketDate;
      if (f.Check_Out) {
        const co = new Date(f.Check_Out);
        co.setDate(co.getDate() - 1);
        bucketDate = co;
      } else {
        bucketDate = new Date(ci + "T00:00:00");
      }
      if (isNaN(bucketDate.getTime())) continue;
      const y = bucketDate.getFullYear();
      const m = bucketDate.getMonth(); // 0-indexed
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;

      const roomId = f.RoomLookupId ? String(f.RoomLookupId) : null;
      const room = roomId ? roomsById[roomId] : null;
      const nights = (f.Check_Out)
        ? Math.max(0, Math.round((new Date(f.Check_Out) - new Date(f.Check_In)) / 86400000))
        : null;

      const bookingObj = {
        ref: f.Title || "",
        property: f.Property_Name || "",
        roomNumber: room ? room.title : null,
        guest: f.Person_Name || "",
        checkIn: f.Check_In || null,
        checkOut: f.Check_Out || null,
        nights,
        status: f.Status || "",
      };

      if (!byMonth.has(key)) {
        byMonth.set(key, {
          period: key,
          label: `${MONTHS_EN[m]} ${y}`,
          labelNb: `${MONTHS_NB[m]} ${y}`,
          bookings: [],
          totalNights: 0,
          bookingCount: 0,
        });
      }
      const bucket = byMonth.get(key);
      bucket.bookings.push(bookingObj);
      bucket.totalNights += (nights || 0);
      bucket.bookingCount += 1;
    }

    // Sort hver gruppes bookinger på check-in stigende
    for (const bucket of byMonth.values()) {
      bucket.bookings.sort((a, b) =>
        String(a.checkIn || "").localeCompare(String(b.checkIn || ""))
      );
    }

    // Sort gruppene nyeste først
    const archive = Array.from(byMonth.values()).sort((a, b) =>
      b.period.localeCompare(a.period)
    );

    return jsonResponse({ ok: true, archive, company });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("invoice-archive error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
