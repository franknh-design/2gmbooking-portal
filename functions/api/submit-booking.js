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
  getAllRates,
  getRoomsByIdMap,
  getPropertiesByIdMap,
} from "../_utils/sharepoint.js";

import { getDailyRate, getCheckoutFee } from "../_utils/rates.js";
import { sendEmail } from "../_utils/email.js";
import { getEmailTemplate, renderTemplate } from "../_utils/templates.js";

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
      // v3.14.0: telefon er obligatorisk og må være norsk format
      // (8 sifre med ledende 2-9, evt. +47/0047-prefiks). Defense in depth —
      // frontend validerer allerede, men vi stoler ikke på det.
      if (!g.phone || typeof g.phone !== "string" || !_isValidNoPhone(g.phone)) {
        return jsonResponse({ ok: false, error: "guest_invalid_phone" }, 400);
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
        guests.length,
        // v1.1: gi capacity-sjekken kundens Firma så long-term-rom som
        // tilhører dem selv ikke trekkes fra ledigheten.
        tokenRow.fields.Firma || null
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
        // v3.14.1: telefon går i sin egen Mobile-kolonne (createBookingRow),
        // ikke lenger i Notes — admin-appen leser b.Mobile direkte.
        guestPhone: g.phone || null,
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

    // 9. Send e-postvarsel til Frank + kvittering til kunden (parallelt,
    // fire-and-forget). v3.12.3: bruk context.waitUntil så Cloudflare holder
    // worker'en levende til begge e-postene er levert, selv etter at
    // responsen er sendt. Tidligere brukte vi Promise.race([emailPromise, 3s])
    // som returnerte etter 3 sek — siden customer-receipt-pathen krever en
    // Graph-rundtur for templates (kald start ~2-3s) ble både admin-varslet
    // og kunde-kvitteringen kuttet av worker-termineringen.
    const emailPromise = Promise.allSettled([
      sendBookingNotification(env, {
        bookingRef,
        tokenRow,
        propertyName,
        guests,
        capacityWarning,
        partialFailure: result.failed.length > 0 ? result.failed : null,
      }),
      sendCustomerReceipt(env, {
        bookingRef,
        tokenRow,
        propertyName,
        guests,
        capacityWarning,
      }),
    ]);

    if (context.waitUntil) {
      context.waitUntil(emailPromise);
    } else {
      // Local dev / eldre runtime uten waitUntil — fallback til kort vent
      // så vi ihvertfall venter på Resend før vi returnerer.
      await Promise.race([
        emailPromise,
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    }

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
    // v3.14.0: telefon på samme linje som navn så admin kan ringe/SMSe direkte
    const phonePart = g.phone ? ` · ${g.phone}` : "";
    return `  ${i + 1}. ${g.name}${phonePart} · ${period}`;
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
// Kunde-kvittering (submit_received-template fra PortalEmailTemplates)
// ----------------------------------------------------------------------------

async function sendCustomerReceipt(env, data) {
  const { tokenRow, bookingRef, propertyName, guests, capacityWarning } = data;
  const customerEmail = (tokenRow.fields.Epost || "").trim();
  if (!customerEmail) {
    console.log("[Receipt] Customer_Tokens.Epost er tom for token — hopper over kvittering");
    return;
  }
  const template = await getEmailTemplate(env, "submit_received");
  if (!template) {
    console.log("[Receipt] submit_received-template mangler eller er deaktivert");
    return;
  }
  // Pris-estimat pr. gjest (nights × nattpris + utvask). Feiler mykt:
  // priceBlock blir tom streng hvis rate-oppslaget kaster, og {priceBlock}
  // i malen rendres da til ingenting.
  let priceBlock = "";
  try {
    priceBlock = await buildPriceBlock(env, { tokenRow, propertyName, guests });
  } catch (e) {
    console.error("[Receipt] priceBlock-feil:", e);
  }
  const vars = buildTemplateVars({ tokenRow, bookingRef, propertyName, guests, capacityWarning, priceBlock });
  // v3.12.1: HTML-mal får html:true så gjestenavn etc. blir HTML-escapet.
  // Plain text-mal beholder default (ingen escape).
  const subject = renderTemplate(template.subject, vars) || `Bestilling ${bookingRef} mottatt`;
  const html = renderTemplate(template.bodyHtml, vars, { html: true });
  const text = renderTemplate(template.bodyText, vars);
  if (!html && !text) {
    console.log("[Receipt] submit_received har tom BodyHtml + BodyText");
    return;
  }
  const fromName = (template.fromName || "2GM Eiendom").trim();
  // v3.12.1: Avsenderdomenet styres via env-var slik at vi bytter til
  // noreply@2gm.no uten kode-endring så snart Iteam har DNS + Resend
  // har grønt domene. Default = onboarding@resend.dev (sandbox).
  const fromAddress = (env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev").trim();
  return sendEmail(env, {
    to: customerEmail,
    from: `${fromName} <${fromAddress}>`,
    subject,
    html: html || undefined,
    text: text || undefined,
  });
}

// v3.12.1: Norsk dato DD.MM.ÅÅÅÅ. Aksepterer ISO-streng eller Date;
// returnerer tom streng på ugyldig input.
function _fmtNoDate(input) {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(String(input).slice(0, 10) + "T12:00:00");
  if (isNaN(d.getTime())) return String(input || "");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

// Antall hele netter mellom to ISO-datoer. Returnerer 0 hvis checkOut
// mangler (open-ended) eller datoene er ugyldige.
function _nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const ci = new Date(String(checkIn).slice(0, 10) + "T12:00:00");
  const co = new Date(String(checkOut).slice(0, 10) + "T12:00:00");
  if (isNaN(ci.getTime()) || isNaN(co.getTime())) return 0;
  const n = Math.round((co - ci) / (24 * 60 * 60 * 1000));
  return n > 0 ? n : 0;
}

// nb-NO-formatert heltall (tusenskille), uten "kr"-suffiks.
function _fmtKr(amount) {
  return Number(amount || 0).toLocaleString("nb-NO");
}

// Bygger pris-estimatet til kvitteringen: én linje pr. gjest +
// totalsum eks./inkl. 25 % mva + forbeholds-linje. Prisen er flat pr.
// (firma, eiendom) — samme nattpris og utvask-gebyr for alle gjestene.
// Open-ended gjester (uten checkOut) får ingen natt-total, bare "åpen".
async function buildPriceBlock(env, { tokenRow, propertyName, guests }) {
  const company = tokenRow.fields.Firma || "";
  const [allRates, roomsById, propertiesById] = await Promise.all([
    getAllRates(env),
    getRoomsByIdMap(env),
    getPropertiesByIdMap(env),
  ]);
  const rate = getDailyRate({
    company,
    propertyTitle: propertyName,
    allRates,
    roomsById,
    propertiesById,
  }).rate || 0;
  const fee = getCheckoutFee({ company, propertyTitle: propertyName, allRates }).fee || 0;

  // Ingen avtalt nattpris ⇒ ingen estimat-blokk (forbeholdet dekker det).
  if (!(rate > 0)) return "";

  let totalEx = 0;
  const lines = guests.map((g) => {
    const ci = _fmtNoDate(g.checkIn);
    const hasCheckout = !!g.checkOut;
    const co = hasCheckout ? _fmtNoDate(g.checkOut) : "åpen";
    const nights = hasCheckout ? _nightsBetween(g.checkIn, g.checkOut) : 0;
    if (hasCheckout && nights > 0) {
      const lineTotal = nights * rate + fee;
      totalEx += lineTotal;
      return `• ${g.name} · ${ci}–${co} (${nights} netter) · `
        + `${nights}×${_fmtKr(rate)} + utvask ${_fmtKr(fee)} = ${_fmtKr(lineTotal)} kr`;
    }
    // Open-ended: ingen natt-total, men utvask-gebyret påløper uansett.
    totalEx += fee;
    return `• ${g.name} · ${ci}–${co} (åpen) · `
      + `nattpris ${_fmtKr(rate)} kr/natt + utvask ${_fmtKr(fee)} kr — `
      + `total beregnes ved utsjekk`;
  });

  const vat = Math.round(totalEx * 0.25);
  const totalInc = totalEx + vat;
  lines.push(
    `TOTALT: ${_fmtKr(totalEx)} kr eks. mva · + 25 % mva ${_fmtKr(vat)} kr `
      + `· ${_fmtKr(totalInc)} kr inkl. mva`,
  );
  lines.push(`Estimat — med forbehold om feil. Endelig faktura kan avvike.`);
  return lines.join("\n");
}

function buildTemplateVars({ tokenRow, bookingRef, propertyName, guests, capacityWarning, priceBlock }) {
  const customer = tokenRow.fields.Firma || "";
  const contact = tokenRow.fields.Kontaktperson || "";
  const token = tokenRow.fields.Token || "";
  const guestCount = guests.length;
  const checkIns = guests.map(g => g.checkIn).filter(Boolean).sort();
  const checkOuts = guests.map(g => g.checkOut).filter(Boolean).sort();
  const earliestCheckIn = checkIns[0] || "";
  const latestCheckOut = checkOuts.length === guests.length ? checkOuts[checkOuts.length - 1] : "";
  // v3.12.1: alle datoer formateres som DD.MM.ÅÅÅÅ i ALLE plassholdere
  // (inkludert inni guestList-linjene). Open-ended utsjekk vises som "åpen".
  const guestList = guests.map(g => {
    const ci = _fmtNoDate(g.checkIn);
    const co = g.checkOut ? _fmtNoDate(g.checkOut) : "åpen";
    return `• ${g.name} · ${ci} → ${co}`;
  }).join("\n");
  const portalUrl = token ? `https://2gmbooking-portal.pages.dev/?token=${encodeURIComponent(token)}` : "https://2gmbooking-portal.pages.dev/";
  return {
    customer,
    contact,
    bookingRef,
    property: propertyName,
    guestCount: String(guestCount),
    guestList,
    checkIn: _fmtNoDate(earliestCheckIn),
    checkOut: latestCheckOut ? _fmtNoDate(latestCheckOut) : "åpen",
    portalUrl,
    capacityWarning: capacityWarning || "",
    // Pris-estimat-blokk — plain-text med \n, samme behandling som guestList.
    // Tom streng hvis pris ikke kunne beregnes; {priceBlock} rendres da til
    // ingenting i både bodyText og bodyHtml.
    priceBlock: priceBlock || "",
  };
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

// v3.14.0: norsk telefonvalidering — duplikat av frontend-regelen i
// booking.js. Stripper whitespace/skilletegn + valgfri +47/0047/47-prefiks
// og krever 8 sifre med ledende 2-9 (gyldige norske start-sifre).
function _isValidNoPhone(s) {
  const cleaned = String(s || "")
    .replace(/[\s\-()./]/g, "")
    .replace(/^(\+47|0047|47)/, "");
  return /^[2-9]\d{7}$/.test(cleaned);
}
