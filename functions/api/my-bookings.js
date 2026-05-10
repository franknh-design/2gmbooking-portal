// functions/api/my-bookings.js
// v1.3 - Returnerer aktive + kommende bookinger for kunden bak token.
//        Beriket med roomNumber + doorCode når admin har tildelt rom,
//        og propertyAddress (statisk per bygg, kommer fra sharepoint.js).
//
//        v1.3: AUTO-CHECKIN — flipper Status: Upcoming → Active før retur
//        når Check_In <= i dag, rom er rent (Cleaning_Status !== "Dirty"),
//        og ingen annen booking på samme rom er Active. Mirror av
//        admin-appens js/auto_checkin.js, men kjører server-side så det
//        ikke avhenger av at admin har åpen Booking-appen.
//
// POST /api/my-bookings
// Body: { token: "..." }
//
// Returnerer:
//   { ok: true, bookings: [
//       {
//         ref: "2GM-AB12CD",
//         property: "Rigg 24",
//         propertyAddress: "Aspeveien 2, 9300 Finnsnes", // null hvis ukjent
//         guest: "Ola Nordmann",
//         checkIn: "2026-05-18",
//         checkOut: "2026-05-22",   // null hvis open-ended
//         status: "Active",         // "Upcoming" inntil dagen kommer + rom er rent
//         pendingConfirmation: true,
//         roomNumber: "204",        // null før tildelt
//         doorCode: "1234#"         // null hvis ikke satt
//       }, ...
//     ] }

import {
  findToken,
  getBookingsForCompany,
  getRoomsByIdMap,
  propertyAddress,
  updateBookingStatus,
} from "../_utils/sharepoint.js";

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
    if (!company) {
      return jsonResponse({ ok: true, bookings: [] });
    }

    const [items, roomsById] = await Promise.all([
      getBookingsForCompany(env, company),
      getRoomsByIdMap(env),
    ]);

    // ----- AUTO-CHECKIN -----
    // Flip Status: Upcoming → Active for bookings hvor Check_In er passert,
    // rommet er rent og ingen annen booking holder rommet aktivt. Patch'er
    // SharePoint og oppdaterer item.fields.Status så den endelige mapping'en
    // returnerer "Active" til kunden umiddelbart.
    await autoCheckIn(env, items, roomsById);

    const bookings = items.map(item => {
      const f = item.fields;
      const roomId = f.RoomLookupId;
      const room = roomId ? roomsById[String(roomId)] : null;
      return {
        ref: f.Title || "",
        property: f.Property_Name || "",
        propertyAddress: propertyAddress(f.Property_Name),
        guest: f.Person_Name || "",
        checkIn: f.Check_In || null,
        checkOut: f.Check_Out || null,
        status: f.Status || "",
        pendingConfirmation: f.Pending_Confirmation === true,
        roomNumber: room ? room.title : null,
        doorCode: room ? room.doorCode : null,
      };
    });

    bookings.sort((a, b) => {
      const ai = a.checkIn || "";
      const bi = b.checkIn || "";
      return ai.localeCompare(bi);
    });

    return jsonResponse({ ok: true, bookings });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("my-bookings error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Server-side auto-checkin. Mirrors logikken i admin-appens js/auto_checkin.js.
 * Flipper Status: Upcoming → Active for bookings hvor:
 *   - Check_In er i dag eller før
 *   - Tildelt rom har Cleaning_Status !== "Dirty" (eller mangler/Clean)
 *   - Ingen annen booking på samme rom er Active
 * Mutterer item.fields.Status in-place så den endelige mapping'en returnerer
 * den nye statusen umiddelbart, uten en ny round-trip til Graph.
 *
 * Feiler stille per booking — én PATCH-feil stopper ikke resten. Logges til
 * Cloudflare-konsollen.
 */
async function autoCheckIn(env, items, roomsById) {
  const todayISO = new Date().toISOString().slice(0, 10);

  // Indeks: hvilke rom har en aktiv booking allerede? (hindrer dobbel-aktivering)
  const activeRoomIds = new Set();
  for (const it of items) {
    if (it.fields?.Status === "Active" && it.fields?.RoomLookupId) {
      activeRoomIds.add(String(it.fields.RoomLookupId));
    }
  }

  for (const it of items) {
    const f = it.fields || {};
    if (f.Status !== "Upcoming") continue;
    if (!f.Check_In) continue;
    if (String(f.Check_In).slice(0, 10) > todayISO) continue;
    if (!f.RoomLookupId) continue;

    const roomId = String(f.RoomLookupId);
    const room = roomsById[roomId];
    if (!room) continue;
    if (room.cleaningStatus === "Dirty") continue;
    if (activeRoomIds.has(roomId)) continue;

    try {
      await updateBookingStatus(env, it.id, "Active");
      f.Status = "Active";
      activeRoomIds.add(roomId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[auto-checkin] PATCH failed for booking", it.id, e?.message || e);
    }
  }
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
