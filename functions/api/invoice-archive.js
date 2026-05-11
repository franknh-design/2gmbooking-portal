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
  getAllRates,
  getPropertiesByIdMap,
} from "../_utils/sharepoint.js";
import { getDailyRate } from "../_utils/rates.js";

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
    // v3.10.4: Rates + Properties hentes også så vi kan vise per-booking sum
    // (nights × rate) for kunden.
    const [items, roomsById, allRates, propertiesById] = await Promise.all([
      getAllBookingsForCompany(env, company),
      getRoomsByIdMap(env),
      getAllRates(env),
      getPropertiesByIdMap(env),
    ]);

    // v3.10.5: Split per måned med admin-appens natt-konvensjon.
    // Tidligere bukketerte vi hver booking i ÉN måned (måneden den endte i),
    // og åpne bookinger uten Check_Out fikk nights=null → ingen sum. Det
    // var misvisende for langtidsboere: en arbeider som har bodd hele april
    // dukket bare opp i mars (Check_In-måneden) uten beløp.
    //
    // Ny logikk: for hver booking iterer vi alle måneder mellom Check_In og
    // Check_Out (eller dagens dato for åpne bookinger), og legger en rad i
    // hver måned med nights = antall netter som ender i den måneden.
    //
    // Admin-konvensjon: April-grunnlaget dekker [31.03 00:00, 30.04 00:00].
    // Nattens 31.03 → 01.04 telles i april (natten ender i april).
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byMonth = new Map();
    const ONE_DAY = 86400000;

    for (const it of items) {
      const f = it.fields || {};
      if (!f.Check_In) continue;
      const ci = new Date(f.Check_In);
      ci.setHours(0, 0, 0, 0);
      if (isNaN(ci.getTime())) continue;

      let co, isOngoing = false;
      if (f.Check_Out) {
        co = new Date(f.Check_Out);
        co.setHours(0, 0, 0, 0);
      } else {
        // Åpen booking — anta at gjesten fortsatt bor og bruk dagens dato som
        // foreløpig sluttdato. Beløpene for inneværende måned er da et estimat
        // som vokser etter hvert som månedene går.
        co = new Date(today);
        isOngoing = true;
      }
      if (isNaN(co.getTime()) || co < ci) continue;

      const roomId = f.RoomLookupId ? String(f.RoomLookupId) : null;
      const room = roomId ? roomsById[roomId] : null;

      const effectiveCompany = (f.Billing_Company || f.Company || "").trim();
      const rateInfo = getDailyRate({
        personName: f.Person_Name,
        company: effectiveCompany,
        propertyTitle: f.Property_Name,
        roomId,
        allRates,
        roomsById,
        propertiesById,
      });
      const rate = rateInfo.rate || 0;

      const totalNightsBooking = Math.max(0, Math.round((co - ci) / ONE_DAY));

      // Iterer hver måned bookingen overlapper. monthFrom for måned M =
      // siste dag i (M-1) 00:00; monthTo = siste dag i M 00:00.
      // Start fra måned for første natt (kan være Check_In-måneden) og gå
      // til måned for siste natt.
      const startCursor = new Date(ci.getFullYear(), ci.getMonth(), 1);
      const endCursor = new Date(co.getFullYear(), co.getMonth(), 1);
      // Hvis Check_Out er på dag 1 i en måned, siste natt sluttet i forrige
      // måned ikke i Check_Out-måneden. Da skal vi ikke iterere Check_Out-måneden.
      const lastNightDate = new Date(co.getTime() - ONE_DAY);
      const stopCursor = new Date(lastNightDate.getFullYear(), lastNightDate.getMonth(), 1);

      let cursor = new Date(startCursor);
      while (cursor <= stopCursor) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const monthFrom = new Date(y, m, 0); // siste dag forrige måned 00:00
        monthFrom.setHours(0, 0, 0, 0);
        const monthTo = new Date(y, m + 1, 0); // siste dag denne måneden 00:00
        monthTo.setHours(0, 0, 0, 0);

        const start = ci > monthFrom ? ci : monthFrom;
        const end = co < monthTo ? co : monthTo;
        const nights = Math.max(0, Math.round((end - start) / ONE_DAY));

        if (nights > 0) {
          const key = `${y}-${String(m + 1).padStart(2, "0")}`;
          const total = rate ? Math.round(nights * rate) : null;
          const bookingObj = {
            ref: f.Title || "",
            property: f.Property_Name || "",
            roomNumber: room ? room.title : null,
            guest: f.Person_Name || "",
            checkIn: f.Check_In || null,
            checkOut: f.Check_Out || null,
            nights,
            totalNightsBooking,
            status: f.Status || "",
            rate: rate || null,
            total,
            isOngoing,
            isPartialMonth: nights !== totalNightsBooking,
          };

          if (!byMonth.has(key)) {
            byMonth.set(key, {
              period: key,
              label: `${MONTHS_EN[m]} ${y}`,
              labelNb: `${MONTHS_NB[m]} ${y}`,
              bookings: [],
              totalNights: 0,
              totalAmount: 0,
              bookingCount: 0,
            });
          }
          const bucket = byMonth.get(key);
          bucket.bookings.push(bookingObj);
          bucket.totalNights += nights;
          bucket.totalAmount += (total || 0);
          bucket.bookingCount += 1;
        }

        cursor = new Date(y, m + 1, 1);
      }
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
