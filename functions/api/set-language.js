// functions/api/set-language.js
// Persisterer kundens valgte språk på Customer_Tokens.Sprak.
// Kalt fire-and-forget fra portalens i18n.setLang så admin-utløste
// e-poster (booking_confirmed osv.) kan velge riktig språkvariant av
// templaten via portal_emails.js.
//
// POST /api/set-language
// Body: { token: string, lang: "nb"|"en"|"lv" }
//
// 200 { ok: true, lang }       — vellykket PATCH
// 400 { ok: false, error }     — ugyldig input (missing_token, invalid_lang)
// 401 { ok: false, error }     — token ikke funnet / utløpt / inaktiv
// 500 { ok: false, error }     — internal_error (PATCH-feil mot Graph)

import { findToken } from "../_utils/sharepoint.js";
import { graphRequest } from "../_utils/graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const TOKENS_LIST_ID = "73f113fe-76b0-48b2-9105-243a45166420";
const ALLOWED_LANGS = new Set(["nb", "en", "lv"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const { token, lang } = body || {};

    if (!token || typeof token !== "string") {
      return jsonResponse({ ok: false, error: "missing_token" }, 400);
    }
    const normLang = String(lang || "").toLowerCase();
    if (!ALLOWED_LANGS.has(normLang)) {
      return jsonResponse({ ok: false, error: "invalid_lang" }, 400);
    }

    const tokenRow = await findToken(env, token);
    if (!tokenRow) {
      // Samme svar som validate-token ved feil — ikke avslør detaljer
      return jsonResponse({ ok: false, error: "invalid_token" }, 401);
    }

    // PATCH Sprak-feltet via Graph. Speiler mønsteret fra
    // updateBookingFields/logTokenUsage i functions/_utils/sharepoint.js.
    const path = `/sites/${SITE_ID}/lists/${TOKENS_LIST_ID}/items/${tokenRow.id}/fields`;
    await graphRequest(env, path, {
      method: "PATCH",
      body: JSON.stringify({ Sprak: normLang }),
    });

    return jsonResponse({ ok: true, lang: normLang });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("set-language error:", err);
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
