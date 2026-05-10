// functions/api/debug-availability.js
// v1.0 - Diagnostisk endpoint: hvorfor er availability "fullt" for SalMar?
//
// Dumper hva findToken/Customer_Tokens ser, hvilken Firma som ble lest,
// og hvilke matcher long-term-sjekken treffer per rom på en gitt property.
//
// POST /api/debug-availability
// Body: { token: "salmar-...", property: "strandveien112" }
//
// Returnerer:
//   {
//     ok: true,
//     customerFirma: "SalMar AS",
//     customerLower: "salmar as",
//     property: { name: "Strandveien 112", fullTenantCompany: "SalMar AS", ftMatch: true },
//     rooms: [
//       { id, title, longTermCompany, ltMatch, isOwnLongTerm, longTermStart },
//       ...
//     ],
//     activeBookingsOnRooms: [ { ref, room, checkIn, checkOut, status }, ... ]
//   }

import {
  propertyIdToName,
  findToken,
  getPropertyMetaMap,
  getRoomsForProperty,
  getBookingsForProperty,
} from "../_utils/sharepoint.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, property } = body || {};

    const propertyName = propertyIdToName(property);
    if (!propertyName) {
      return jsonResponse({ ok: false, error: "invalid_property" }, 400);
    }

    let customerFirma = null;
    if (token && typeof token === "string") {
      const tokenRow = await findToken(env, token);
      if (tokenRow) customerFirma = tokenRow.fields.Firma || null;
    }
    const customerLower = String(customerFirma || "").trim().toLowerCase();

    const propertyMeta = await getPropertyMetaMap(env);
    const propertyMap = {};
    for (const [id, m] of Object.entries(propertyMeta)) {
      if (m.title) propertyMap[id] = m.title;
    }

    const [rooms, bookings] = await Promise.all([
      getRoomsForProperty(env, propertyName, propertyMap),
      getBookingsForProperty(env, propertyName),
    ]);

    // Finn property-meta for det aktuelle bygget
    let propertyEntry = null;
    for (const [id, m] of Object.entries(propertyMeta)) {
      if (String(m.title || "").trim().toLowerCase() === propertyName.toLowerCase()) {
        propertyEntry = { id, ...m };
        break;
      }
    }
    const ftCompanyRaw = propertyEntry?.fullTenantCompany || null;
    const ftLower = String(ftCompanyRaw || "").trim().toLowerCase();
    const ftMatch = !!customerLower && !!ftLower && ftLower === customerLower;

    const roomsOut = rooms.map(r => {
      const ltRaw = r.fields.LongTerm_Company || null;
      const ltLower = String(ltRaw || "").trim().toLowerCase();
      const ltMatch = !!customerLower && !!ltLower && ltLower === customerLower;
      const isOwnLongTerm = ltMatch || ftMatch;
      return {
        id: r.id,
        title: r.fields.Title || null,
        longTermCompany: ltRaw,
        longTermStart: r.fields.LongTerm_StartDate || null,
        ltMatch,
        ftMatch,
        isOwnLongTerm,
        excludedFromAvailability: !isOwnLongTerm && !!r.fields.LongTerm_StartDate,
      };
    });

    const activeBookingsOnRooms = bookings.map(b => ({
      ref: b.fields.Title || null,
      room: b.fields.Person_Name || "(no name)",
      roomLookupId: b.fields.RoomLookupId || null,
      checkIn: b.fields.Check_In || null,
      checkOut: b.fields.Check_Out || null,
      status: b.fields.Status || null,
      company: b.fields.Company || null,
    }));

    return jsonResponse({
      ok: true,
      tokenProvided: !!token,
      customerFirma,
      customerLower,
      property: {
        name: propertyName,
        fullTenantCompany: ftCompanyRaw,
        fullTenantLower: ftLower,
        ftMatch,
      },
      rooms: roomsOut,
      activeBookingsOnRooms,
      summary: {
        roomsTotal: roomsOut.length,
        roomsOwnLongTerm: roomsOut.filter(r => r.isOwnLongTerm).length,
        roomsExcluded: roomsOut.filter(r => r.excludedFromAvailability).length,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("debug-availability error:", err);
    return jsonResponse({ ok: false, error: "internal_error", message: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
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
