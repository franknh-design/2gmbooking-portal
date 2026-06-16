// functions/api/register-company.js — v1.0
// Selvregistrering av nye firmakunder til token-portalen.
//
// POST /api/register-company
// Body: {
//   firma:        "Eksempel AS",            (påkrevd)
//   orgnr:        "123456789",              (valgfritt)
//   kontaktperson:"Ola Nordmann",           (påkrevd)
//   epost:        "ola@eksempel.no",        (påkrevd)
//   telefon:      "99102030",               (påkrevd, norsk format)
//   lokasjoner:   ["rigg24","andslimoen"],  (valgfritt — ønskede lokasjoner)
//   melding:      "fritekst",               (valgfritt)
//   lang:         "nb" | "en"               (valgfritt)
// }
//
// Oppretter en INAKTIV Customer_Tokens-rad (ingen Token/PIN) og varsler Frank.
// Kunden får IKKE tilgang før admin godkjenner i booking-appen. Returnerer
// alltid en generisk «takk»-respons så vi ikke lekker om e-posten finnes.

import {
  createPendingCustomerToken,
  findCustomerTokenByEmail,
  propertyIdToName,
} from "../_utils/sharepoint.js";
import { sendEmail } from "../_utils/email.js";

const NOTIFY_EMAIL = "frank@2gm.no";
const MAX_FIELD_LEN = 200;
const MAX_MELDING_LEN = 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({})) || {};

    // #1 Honningfelle — ekte brukere ser ikke «website»-feltet. Fyller en bot
    // det ut, later vi som om alt gikk bra (ingen rad opprettes, ingen e-post).
    if (String(body.website || "").trim()) {
      return jsonResponse({ ok: true }, 200);
    }

    // #3 Turnstile (bot-vern) — aktiveres automatisk når TURNSTILE_SECRET er
    // satt som Cloudflare-secret. Uten secret hoppes sjekken over, så skjemaet
    // virker også før nøklene er på plass. Fail-closed når den er påslått.
    if (env.TURNSTILE_SECRET) {
      const ok = await _verifyTurnstile(env, body.cfToken || "", request.headers.get("CF-Connecting-IP"));
      if (!ok) return jsonResponse({ ok: false, error: "verification_failed" }, 403);
    }

    let { firma, orgnr, kontaktperson, epost, telefon, lokasjoner, melding, lang } = body;

    firma = _trim(firma);
    orgnr = String(orgnr == null ? "" : orgnr).replace(/\s/g, "").slice(0, 20);
    kontaktperson = _trim(kontaktperson);
    epost = _trim(epost);
    telefon = _trim(telefon);
    melding = _trim(melding, MAX_MELDING_LEN);
    lang = String(lang || "nb").toLowerCase() === "en" ? "en" : "nb";

    // --- Validering (defense in depth — frontend validerer også) ---
    if (!firma) return jsonResponse({ ok: false, error: "missing_firma" }, 400);
    if (!/^\d{9}$/.test(orgnr)) return jsonResponse({ ok: false, error: "invalid_orgnr" }, 400);
    if (!kontaktperson) return jsonResponse({ ok: false, error: "missing_contact" }, 400);
    if (!epost || !_isValidEmail(epost)) return jsonResponse({ ok: false, error: "invalid_email" }, 400);
    if (!telefon || !_isValidPhone(telefon)) return jsonResponse({ ok: false, error: "invalid_phone" }, 400);

    // Behold kun gyldige lokasjon-slugs.
    const slugs = Array.isArray(lokasjoner)
      ? lokasjoner
          .map(s => String(s || "").trim().toLowerCase())
          .filter(s => s && propertyIdToName(s))
      : [];
    const requestedNames = slugs.map(propertyIdToName);

    // --- Dedupe på e-post ---
    // Finnes en aktiv kunde → ikke opprett duplikat, men varsle Frank.
    // Finnes en ventende rad → allerede registrert, ikke opprett på nytt.
    let existing = null;
    try {
      existing = await findCustomerTokenByEmail(env, epost);
    } catch (e) {
      console.error("[register-company] dedupe-oppslag feilet:", e);
    }

    if (existing) {
      const f = existing.fields || {};
      const isActive = f.Aktiv === true;
      // Varsle Frank om forsøket (fire-and-forget), men returner generisk.
      const note = isActive
        ? "Eksisterende AKTIV kunde forsøkte å registrere seg på nytt."
        : "Allerede registrert og venter på godkjenning (duplikat-forsøk).";
      _fireEmail(context, sendOwnerNotification(env, {
        firma, orgnr, kontaktperson, epost, telefon, requestedNames, melding, note,
      }));
      // #2 Returner samme generiske svar som ved nyregistrering — avslør IKKE
      // (via status-feltet) om e-posten allerede finnes (enumerasjons-vern).
      return jsonResponse({ ok: true });
    }

    // --- Opprett inaktiv rad ---
    await createPendingCustomerToken(env, {
      Title: firma,
      Firma: firma,
      Kontaktperson: kontaktperson,
      Epost: epost,
      Telefon: telefon,
      Sprak: lang,
      Aktiv: false,
      TillatteLokasjoner: slugs.join(","),
    });

    // --- Varsle Frank ---
    _fireEmail(context, sendOwnerNotification(env, {
      firma, orgnr, kontaktperson, epost, telefon, requestedNames, melding,
      note: "Ny registrering — venter på godkjenning i booking-appen.",
    }));

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("register-company error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ----------------------------------------------------------------------------

function _fireEmail(context, promise) {
  const p = Promise.resolve(promise).catch(e => console.error("[register-company] e-post feilet:", e));
  if (context.waitUntil) context.waitUntil(p);
}

async function sendOwnerNotification(env, data) {
  const { firma, orgnr, kontaktperson, epost, telefon, requestedNames, melding, note } = data;
  const lines = [
    note || "Ny firma-registrering fra portalen.",
    "",
    `Firma:        ${firma}`,
    `Org.nr:       ${orgnr || "(ikke oppgitt)"}`,
    `Kontakt:      ${kontaktperson}`,
    `E-post:       ${epost}`,
    `Telefon:      ${telefon}`,
    `Ønsker:       ${requestedNames.length ? requestedNames.join(", ") : "(ikke spesifisert)"}`,
  ];
  if (melding) lines.push("", "Melding:", melding);
  lines.push(
    "",
    "→ Åpne booking-appen → Firmaer → «Ventende registreringer» for å godkjenne",
    "  (sett tillatte lokasjoner + maks rom, deretter send URL/PIN til kunden).",
    "",
    "--",
    "2GM Booking Portal",
  );
  return sendEmail(env, {
    to: NOTIFY_EMAIL,
    subject: `[2GM] Ny firma-registrering — ${firma}`,
    text: lines.join("\n"),
  });
}

// ----------------------------------------------------------------------------

// #3 Verifiser Turnstile-token mot Cloudflare. Fail-closed: returnerer false
// ved manglende token eller nettverksfeil (kalles kun når TURNSTILE_SECRET er satt).
async function _verifyTurnstile(env, token, ip) {
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    return data && data.success === true;
  } catch (e) {
    console.error("[register-company] Turnstile-verifisering feilet:", e);
    return false;
  }
}

function _trim(s, max = MAX_FIELD_LEN) {
  return String(s == null ? "" : s).trim().slice(0, max);
}

function _isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

// Internasjonalt vennlig telefonvalidering — firmakunder kan være utenlandske.
// Valgfri ledende +, 6–15 siffer etter at skilletegn er strippet (E.164-aktig).
// Speiler isValidPhone i andslimoen-format.mjs.
function _isValidPhone(s) {
  const cleaned = String(s || "").replace(/[\s\-()./]/g, "");
  return /^\+?\d{6,15}$/.test(cleaned);
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
