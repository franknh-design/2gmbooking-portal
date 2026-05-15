// functions/_utils/templates.js
// v1.0 — PortalEmailTemplates-reader + plassholder-renderer
//
// Henter rader fra PortalEmailTemplates-lista i SharePoint og rendrer
// {plassholder}-syntaks. Worker-memory cache i 5 min så vi ikke pinger
// Graph for hver innkommende booking.
//
// Liste-skjema (Title = key, sjekkes case-sensitivt):
//   - Title       (Single line)  — template-nøkkel: "submit_received" osv.
//   - Subject     (Single line)  — emnefelt, støtter plassholdere
//   - BodyHtml    (Plain text)   — HTML-kropp
//   - BodyText    (Plain text)   — plain-text-fallback
//   - FromName    (Single line)  — avsendernavn (frittstående)
//   - Active      (Yes/No)       — false ⇒ template ignoreres
//   - Notes       (Plain text)   — bare for admin, sendes ikke

import { graphRequest } from "./graph.js";

const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const TEMPLATES_LIST_NAME = "PortalEmailTemplates";
const CACHE_TTL_MS = 5 * 60 * 1000;

let _listIdCache = null;
let _listIdCacheAt = 0;
let _templatesCache = null;
let _templatesCacheAt = 0;

async function _resolveListId(env) {
  if (_listIdCache && Date.now() - _listIdCacheAt < CACHE_TTL_MS) return _listIdCache;
  const path = `/sites/${SITE_ID}/lists?$filter=displayName eq '${TEMPLATES_LIST_NAME}'&$select=id,displayName`;
  try {
    const data = await graphRequest(env, path);
    const id = data?.value?.[0]?.id || null;
    if (id) {
      _listIdCache = id;
      _listIdCacheAt = Date.now();
    }
    return id;
  } catch (err) {
    console.warn("[Templates] kunne ikke slå opp liste-ID:", err);
    return null;
  }
}

async function _fetchAll(env) {
  const listId = await _resolveListId(env);
  if (!listId) return [];
  const path = `/sites/${SITE_ID}/lists/${listId}/items?$expand=fields&$top=200`;
  const data = await graphRequest(env, path);
  return (data?.value || []).map(item => {
    const f = item.fields || {};
    return {
      id: item.id,
      title: String(f.Title || "").trim(),
      subject: f.Subject || "",
      bodyHtml: f.BodyHtml || "",
      bodyText: f.BodyText || "",
      fromName: f.FromName || "",
      active: f.Active !== false,
    };
  });
}

export async function getEmailTemplate(env, key) {
  if (!_templatesCache || Date.now() - _templatesCacheAt > CACHE_TTL_MS) {
    try {
      const list = await _fetchAll(env);
      const map = {};
      list.forEach(t => { if (t.title) map[t.title] = t; });
      _templatesCache = map;
      _templatesCacheAt = Date.now();
    } catch (err) {
      console.error("[Templates] fetch feilet:", err);
      return null;
    }
  }
  const t = _templatesCache[key];
  if (!t || !t.active) return null;
  return t;
}

// Erstatter {plassholder} i en streng. Ukjente plassholdere beholdes
// ordrett så ingen tom-substitusjon overrasker mottakeren.
// vars: { customer: "Acme AS", bookingRef: "2GM-AB12CD", ... }
export function renderTemplate(str, vars) {
  if (!str) return "";
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, key) => {
    const v = vars[key];
    return v == null ? m : String(v);
  });
}
