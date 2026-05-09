// functions/api/submit-booking.js
// v1.1 - Notes-feltet inneholder nå AVVENTER ROMTILDELING-markør
//        slik at admin-appen ikke får "Room not found"-popup på null lookup
//
// POST /api/submit-booking
// Body: {
//   token: "test-abc123-xyz789",
//   property: "rigg24",
//   guests: [
//     { name: "Ola Nordmann",  checkIn: "2026-05-18", checkOut: "2026-05-22" },
//     { name: "Kari Nordmann", checkIn: "2026-05-18", checkOut: "2026-05-22" }
//   ]
// }
//
// Returnerer:
//   { ok: true, bookingRef: "2GM-AB12CD", rowsCreated: 2, capacityWarning?: "..." }

import {
  findToken,
  propertyIdToName,
  generateBookingRef,
  createBookingRows,
  checkCapacityConflict,
} from "../_utils/sharepoint.js";

import { sendEmail } from "../_utils/email.js";

// Hvor varselet om ny booking går
const NOTIFY_EMAIL = "frank@2gm.no";

// Maks antall gjester per innsending - sikkerhetsmekanisme mot misbruk
const MAX_GUESTS_PER_BOOKING = 50;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { token, property, guests } = body || {};

    // Valider input
    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    if (!Array.isArray(guests) || guests.length === 0) {
      return jsonResponse({ ok: false, error: "no_guests" }, 400);
    }
    if (guests.length > MAX_GUESTS_PER_BOOKING) {
      return jsonResponse({ ok: false, error: "too_many_guests" }, 400);
    }

    // 1. Validér token og hent kunde-info
    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    // 2. Validér at kunden har tilgang til den valgte property
    const propertyName = propertyIdToName(property);
    if (!propertyName) {
      return jsonResponse({ ok: false, error: "invalid_property" }, 400);
    }

    const allowedProperties = (tokenRow.fields.TillatteLokasjoner || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    if (!allowedProperties.includes(String(property).toLowerCase())) {
      return jsonResponse({ ok: false, error: "property_not_allowed" }, 403);
    }

    // 3. Maks antall rom per bestilling fra Customer_Tokens
    const maxRooms = tokenRow.fields.MaksRomPerBestilling || 999;
    if (guests.length > maxRooms) {
      return jsonResponse({
        ok: false,
        error: "exceeds_max_rooms",
        maxRooms,
      }, 400);
    }

    // 4. Validér gjeste-data
    for (const g of guests) {
      if (!g.name || typeof g.name !== "string") {
        return jsonResponse({ ok: false, error: "guest_missing_name" }, 400);
      }
      if (!g.checkIn || isNaN(new Date(g.checkIn).getTime())) {
        return jsonResponse({ ok: false, error: "guest_invalid_checkin" }, 400);
      }
      // checkOut kan være null/tom (open-ended), men hvis satt må den være gyldig
      if (g.checkOut && isNaN(new Date(g.checkOut).getTime())) {
        return jsonResponse({ ok: false, error: "guest_invalid_checkout" }, 400);
      }
    }

    // 5. Sjekk kapasitetskonflikt for fellesperioden (alle gjester samme datoer)
    // Vi bruker tidligste checkIn og seneste checkOut som overordnet periode.
    // Spesifikke konflikter per dato vises hvis de finnes.
    let capacityWarning = null;
    try {
      const earliestCheckIn = guests
        .map(g => g.checkIn)
        .sort()[0];

      // Hvis noen gjester er open-ended, kan vi ikke sjekke fremtidig kapasitet
      // Vi sjekker minst de første 30 dagene
      const allHaveCheckOut = guests.every(g => !!g.checkOut);
      let latestCheckOut;

      if (allHaveCheckOut) {
        latestCheckOut = guests
          .map(g => g.checkOut)
          .sort()
          .slice(-1)[0];
      } else {
        // Open-ended: sjekk 30 dager frem fra tidligste checkIn
        const thirtyDaysOut = new Date(earliestCheckIn);
        thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
        latestCheckOut = thirtyDaysOut.toISOString().slice(0, 10);
      }

      const conflicts = await checkCapacityConflict(
        env,
        propertyName,
        earliestCheckIn.slice(0, 10),
        latestCheckOut.slice(0, 10),
        guests.length
      );

      if (conflicts.length > 0) {
        capacityWarning = `Kapasitetskonflikt på ${conflicts.length} dag(er). ` +
          `Verste dag: ${conflicts[0].date} har bare ${conflicts[0].available} ledige, ` +
          `bestilling krever ${conflicts[0].needed}.`;
      }
    } catch (err) {
      // Kapasitetssjekk skal ikke blokkere booking - logg og fortsett
      // eslint-disable-next-line no-console
      console.error("Capacity check failed:", err);
    }

    // 6. Generer felles booking-referanse
    const bookingRef = generateBookingRef();

    // 7. Bygg rader til SharePoint
    // Notes inneholder en eksplisitt AVVENTER ROMTILDELING-markør så
    // admin-appen kan vise raden tydelig som "ikke tildelt ennå" og
    // unngå "Room not found"-popup ved null RoomLookupId.
    const PENDING_TAG = "AVVENTER ROMTILDELING";
    const rowsToCreate = guests.map(g => {
      const noteParts = [bookingRef, PENDING_TAG];
      if (capacityWarning) noteParts.push(capacityWarning);
      return {
        bookingRef,
        propertyName,
        guestName: g.name,
        companyName: tokenRow.fields.Firma || "",
        checkIn: g.checkIn,
        checkOut: g.checkOut || null,
        notes: noteParts.join(" · "),
      };
    });

    // 8. Opprett rader
    const result = await createBookingRows(env, rowsToCreate);

    if (result.succeeded.length === 0) {
      // eslint-disable-next-line no-console
      console.error("All booking rows failed:", result.failed);
      return jsonResponse({ ok: false, error: "save_failed" }, 500);
    }

    // 9. Send e-postvarsel til Frank (asynkront - blokkerer ikke svaret)
    const emailPromise = sendBookingNotification(env, {
      bookingRef,
      tokenRow,
      propertyName,
      guests,
      capacityWarning,
      partialFailure: result.failed.length > 0 ? result.failed : null,
    });

    // Vent maksimalt 3 sekunder på e-post, ellers gå videre
    await Promise.race([
      emailPromise,
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);

    // 10. Logg token-bruk
    // (gjenbruker logTokenUsage fra token-validering)
    // Bruksteller-økning her er valgfritt - vi har allerede økt ved validate-token

    return jsonResponse({
      ok: true,
      bookingRef,
      rowsCreated: result.succeeded.length,
      rowsFailed: result.failed.length,
      capacityWarning: capacityWarning || undefined,
    });

  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("submit-booking error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ----------------------------------------------------------------------------
// E-postvarsel
// ----------------------------------------------------------------------------

async function sendBookingNotification(env, data) {
  const { bookingRef, tokenRow, propertyName, guests, capacityWarning, partialFailure } = data;

  const customer = tokenRow.fields.Firma || "Ukjent kunde";
  const contact  = tokenRow.fields.Kontaktperson || "(ukjent)";
  const phone    = tokenRow.fields.Telefon || "(ukjent)";
  const email    = tokenRow.fields.Epost || "(ukjent)";

  const guestLines = guests.map((g, i) => {
    const period = g.checkOut
      ? `${g.checkIn} → ${g.checkOut}`
      : `${g.checkIn} → open-ended`;
    return `  ${i + 1}. ${g.name} · ${period}`;
  }).join("\n");

  const subject = capacityWarning
    ? `[2GM ⚠️ KAPASITETSKONFLIKT] ${bookingRef} - ${customer}`
    : `[2GM] Ny bestilling ${bookingRef} - ${customer}`;

  const lines = [
    `Ny bestilling registrert i SharePoint.`,
    ``,
    `Referanse:    ${bookingRef}`,
    `Kunde:        ${customer}`,
    `Kontakt:      ${contact}`,
    `Telefon:      ${phone}`,
    `E-post:       ${email}`,
    `Lokasjon:     ${propertyName}`,
    `Antall rom:   ${guests.length}`,
    ``,
    `Gjester:`,
    guestLines,
    ``,
  ];

  if (capacityWarning) {
    lines.push(`⚠️ ${capacityWarning}`, ``);
  }

  if (partialFailure) {
    lines.push(`⚠️ Delvis feil: ${partialFailure.length} rad(er) ble ikke opprettet.`, ``);
  }

  lines.push(
    `Status er Upcoming + Pending_Confirmation. Tildel rom og bekreft i SharePoint.`,
    ``,
    `--`,
    `2GM Booking Portal`,
  );

  return sendEmail(env, {
    to: NOTIFY_EMAIL,
    subject,
    text: lines.join("\n"),
  });
}

// ----------------------------------------------------------------------------
// HTTP-helpers
// ----------------------------------------------------------------------------

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
