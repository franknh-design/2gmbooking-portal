// assets/js/private.mjs — v1.6. DOM-orkestrering for den private
// bookingsiden, tospråklig (NO/EN). Laster config, håndterer flatpickr-datovelger
// + ledighet, sender reservasjon. Ren logikk i private-format.mjs, tekster i
// private-i18n.mjs.
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidPhone,
  isValidEmail,
} from "./private-format.mjs";
import { STRINGS, fmt, pickLang } from "./private-i18n.mjs";

const $ = (id) => document.getElementById(id);
const GALLERY = [
  { src: "assets/img/private/rom.jpg", key: "galRom" },
  { src: "assets/img/private/bad.jpg", key: "galBad" },
  { src: "assets/img/private/vaskerom.jpg", key: "galVaskerom" },
  { src: "assets/img/private/kjokken.jpg", key: "galKjokken" },
  { src: "assets/img/private/rigg.jpg", key: "galRigg" },
];
const LANG_KEY = "andslimoen_lang";

// Turnstile (bot-vern). Samme site key som firma-registreringssiden. Tom = av
// (skjemaet virker uten). Server-verifisering krever at TURNSTILE_SECRET er satt
// som Cloudflare-secret — uten secret rendres widgeten, men sjekkes ikke.
const TURNSTILE_SITEKEY = "0x4AAAAAADl36_i1SsZ20nxm";

let nightlyRate = 0;
let lang = "nb";
let galleryIndex = 0;
let lastStay = { from: "", to: "", available: 0 };
let tsWidgetId = null;
let locations = [];        // rigger åpne for privat booking (fra /api/private-locations)
let selectedSlug = null;   // valgt rigg-slug
const fpInstances = [];
const thumbImgs = [];

function escLite(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || key;
}

// Render/re-render Turnstile-widgeten med riktig språk. No-op før api.js er
// lastet (kalles på nytt via window._tsOnload når scriptet er klart).
function renderTurnstile() {
  if (!TURNSTILE_SITEKEY || !window.turnstile) return;
  const holder = $("ts-holder");
  if (!holder) return;
  if (tsWidgetId !== null) { try { window.turnstile.remove(tsWidgetId); } catch (_) {} tsWidgetId = null; }
  holder.innerHTML = "";
  tsWidgetId = window.turnstile.render(holder, {
    sitekey: TURNSTILE_SITEKEY,
    language: lang === "en" ? "en" : "no",
  });
}

function loadTurnstile() {
  if (!TURNSTILE_SITEKEY) return;
  window._tsOnload = renderTurnstile; // kalles når api.js er ferdiglastet
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=_tsOnload";
  s.async = true; s.defer = true;
  document.head.appendChild(s);
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getJSON(path) {
  const res = await fetch(path);
  return res.json();
}

// --- Rigg-velger (multi-rigg) ------------------------------------------------
// Vises kun når 2+ rigger er åpne for privat booking. Bytte rigg oppdaterer
// tittel, pris og ledighet; valgt slug sendes med til availability/booking.
function renderRigSelector() {
  const wrap = $("rig-selector");
  if (!wrap) return;
  if (locations.length < 2) { wrap.hidden = true; wrap.innerHTML = ""; return; }
  wrap.hidden = false;
  wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px";
  wrap.innerHTML = locations.map((l) =>
    '<button type="button" data-slug="' + escLite(l.slug) + '" style="padding:8px 14px;border:1px solid #cdd3da;border-radius:8px;background:#fff;color:#222;cursor:pointer;font:inherit;font-size:14px">' + escLite(l.address || l.title) + "</button>"
  ).join("");
  wrap.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => selectRig(b.dataset.slug));
  });
}

function applySelectedRig() {
  const loc = locations.find((l) => l.slug === selectedSlug) || locations[0];
  if (!loc) return;
  nightlyRate = Number(loc.nightlyRate) || 0;
  if ($("nightly-rate")) $("nightly-rate").textContent = formatKr(nightlyRate);
  renderSelectedTitle();
  document.querySelectorAll("#rig-selector button").forEach((b) => {
    const on = b.dataset.slug === selectedSlug;
    b.style.background = on ? "#1B4F72" : "#fff";
    b.style.color = on ? "#fff" : "#222";
    b.style.fontWeight = on ? "600" : "400";
  });
}

function renderSelectedTitle() {
  const el = $("introTitle");
  const loc = locations.find((l) => l.slug === selectedSlug);
  if (!el || !loc) return;
  el.removeAttribute("data-i18n"); // ikke overskriv av applyLang
  // Vis adressen (kunder kjenner ikke interne rigg-navn); «Rom i <adresse>».
  el.textContent = (lang === "en" ? "Rooms at " : "Rom i ") + (loc.address || loc.title);
}

async function selectRig(slug) {
  if (!slug || slug === selectedSlug) return;
  selectedSlug = slug;
  applySelectedRig();
  // Re-spør ledighet for ny rigg hvis datoer allerede er valgt.
  if (lastStay.from && lastStay.to && nightsBetween(lastStay.from, lastStay.to) > 0) {
    await onDatesChanged();
  } else {
    renderStay();
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildGallery() {
  const thumbs = $("gallery-thumbs");
  GALLERY.forEach((g, i) => {
    const img = document.createElement("img");
    // v1.2: lazy + async dekoding på thumbs — kun hovedbildet trengs umiddelbart.
    img.loading = "lazy";
    img.decoding = "async";
    img.src = g.src;
    img.alt = t(g.key);
    if (i === 0) img.classList.add("active");
    img.addEventListener("click", () => {
      galleryIndex = i;
      $("gallery-main").src = g.src;
      $("gallery-main").alt = t(g.key);
      thumbs.querySelectorAll("img").forEach((x) => x.classList.remove("active"));
      img.classList.add("active");
    });
    thumbs.appendChild(img);
    thumbImgs.push(img);
  });
}

function applyLang(newLang) {
  lang = newLang === "en" ? "en" : "nb";
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  document.documentElement.setAttribute("lang", lang);

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-ph"));
  });

  thumbImgs.forEach((img, i) => { img.alt = t(GALLERY[i].key); });
  if ($("gallery-main")) $("gallery-main").alt = t(GALLERY[galleryIndex].key);

  const fpLoc = lang === "nb" && typeof flatpickr !== "undefined" && flatpickr.l10ns && flatpickr.l10ns.no
    ? flatpickr.l10ns.no : "default";
  fpInstances.forEach((fp) => {
    try { fp.set("locale", fpLoc); } catch (_) {}
    if (fp.altInput) fp.altInput.placeholder = t("datePlaceholder");
  });

  document.querySelectorAll("#lang-toggle button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });

  // Re-lokaliser eventuell allerede-vist ledighet/pris/knapp + rigg-tittel.
  renderStay();
  renderSelectedTitle(); // "Rom på {rigg}" på valgt språk (no-op før rigger lastet)
  renderTurnstile(); // re-render bot-widgeten på nytt språk (no-op før lastet)
}

async function init() {
  lang = pickLang((() => { try { return localStorage.getItem(LANG_KEY); } catch (_) { return null; } })(), navigator.language);
  buildGallery();
  $("lang-toggle").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => applyLang(b.dataset.lang));
  });
  applyLang(lang);

  // Retur fra Stripe Checkout: ?ok=<ref> → vis bekreftelse (ikke last booking-shell).
  const _params = new URLSearchParams(location.search);
  if (_params.get("ok")) {
    $("confirmation-ref").textContent = _params.get("ok");
    const _sum = $("confirmation-sum"); if (_sum) _sum.textContent = "";
    const _msg = document.querySelector('#confirmation [data-i18n="confMsg"]');
    if (_msg) { _msg.removeAttribute("data-i18n"); _msg.textContent = t("paidConfirmed"); }
    $("confirmation").hidden = false;
    return;
  }

  const today = todayISO();
  // v1.2: Vis booking-shell (galleri/intro/dato/skjema) UMIDDELBART så siden
  // ikke står blank mens config-kallet går (Functions→Graph→SharePoint kan ta
  // 1–3s). Pris vises som «–» til API-et svarer; ved «stengt» byttes til
  // closed-state. Reserver-knappen er uansett disabled til gyldig opphold + pris.
  $("booking-state").hidden = false;
  initDatePickers(today);
  ["guest-name", "guest-phone"].forEach((id) => $(id).addEventListener("input", refreshButton));
  $("terms-check").addEventListener("change", refreshButton);
  $("guest-form").addEventListener("submit", onSubmit);
  loadTurnstile(); // injiser Turnstile-script (rendres via _tsOnload når klart)
  applyLang(lang); // sett flatpickr-placeholder/lokalitet nå som instansene finnes

  // Hent riggene som er åpne for privat booking. Tom liste = stengt.
  let locs = [];
  try {
    const r = await getJSON("/api/private-locations");
    if (r && r.ok && Array.isArray(r.locations)) locs = r.locations;
  } catch { locs = []; }
  if (!locs.length) {
    $("booking-state").hidden = true;
    $("closed-state").hidden = false;
    return;
  }
  locations = locs;
  // Forhåndsvalg fra ?rigg=slug hvis gyldig, ellers første åpne rigg.
  const wantSlug = _params.get("rigg");
  selectedSlug = (wantSlug && locs.some((l) => l.slug === wantSlug)) ? wantSlug : locs[0].slug;
  renderRigSelector();
  applySelectedRig();
}

function initDatePickers(todayStr) {
  if (typeof flatpickr === "undefined") {
    $("checkin").min = todayStr;
    $("checkout").min = todayStr;
    $("checkin").addEventListener("change", onDatesChanged);
    $("checkout").addEventListener("change", onDatesChanged);
    return;
  }
  // Mandag som ukestart også på engelsk (default-lokaliteten starter ellers søndag;
  // den norske l10n-en har mandag fra før).
  try { flatpickr.l10ns.default.firstDayOfWeek = 1; } catch (_) {}
  const opts = {
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d.m.Y",
    weekNumbers: true,
    minDate: "today",
    disableMobile: true,
    onChange: onDatesChanged,
  };
  fpInstances.push(flatpickr($("checkin"), opts));
  fpInstances.push(flatpickr($("checkout"), opts));
}

// Render ledighet/pris/knapp ut fra lastStay (ingen fetch) — brukes etter
// datovalg OG ved språkbytte.
function renderStay() {
  const av = $("availability-result");
  const ps = $("price-summary");
  if (!av || !ps) return;
  const { from, to, available } = lastStay;
  const nights = nightsBetween(from, to);
  if (!from || !to || nights <= 0) {
    av.textContent = ""; av.className = "availability";
    ps.textContent = "";
    refreshButton();
    return;
  }
  if (available > 0) {
    av.textContent = fmt(t("roomsAvailable"), { n: available });
    av.className = "availability ok";
    const unit = nights === 1 ? t("nightOne") : t("nightMany");
    ps.textContent = fmt(t("priceFor"), { p: formatKr(totalPrice(nightlyRate, from, to)), n: nights, unit });
  } else {
    av.textContent = t("noRooms");
    av.className = "availability full";
    ps.textContent = "";
  }
  refreshButton();
}

async function onDatesChanged() {
  const from = $("checkin").value;
  const to = $("checkout").value;
  lastStay = { from, to, available: 0 };
  const nights = nightsBetween(from, to);
  if (!from || !to || nights <= 0) {
    renderStay();
    return;
  }
  const av = $("availability-result");
  av.textContent = t("checking"); av.className = "availability";
  $("price-summary").textContent = "";
  let data;
  try {
    data = await postJSON("/api/private-availability", { fromDate: from, toDate: to, property: selectedSlug });
  } catch {
    av.textContent = t("availError"); av.className = "availability full";
    refreshButton();
    return;
  }
  if (!data || !data.enabled) {
    $("booking-state").hidden = true; $("closed-state").hidden = false;
    return;
  }
  lastStay.available = minAvailableForStay(data.days || [], from, to);
  renderStay();
}

function guestValid() {
  return $("guest-name").value.trim().length > 0 && isValidPhone($("guest-phone").value) && $("terms-check").checked;
}

function refreshButton() {
  const nights = nightsBetween(lastStay.from, lastStay.to);
  const haveStay = lastStay.available > 0 && nights > 0;
  const btn = $("reserve-btn");
  if (!btn) return;
  btn.disabled = !(haveStay && guestValid());
  btn.textContent = haveStay
    ? fmt(t("reserveWithPrice"), { p: formatKr(totalPrice(nightlyRate, lastStay.from, lastStay.to)) })
    : t("reserve");
}

function errText(error) {
  const key = "err_" + error;
  return (STRINGS[lang] && STRINGS[lang][key]) || t("err_generic");
}

async function onSubmit(e) {
  e.preventDefault();
  const err = $("form-error");
  err.hidden = true;
  const email = $("guest-email").value.trim();
  if (email && !isValidEmail(email)) {
    err.textContent = t("errEmail"); err.hidden = false;
    return;
  }
  // Bot-vern: hent Turnstile-token (når aktivert). Mangler det, be gjesten
  // fullføre sjekken før vi sender.
  let cfToken = "";
  if (TURNSTILE_SITEKEY) {
    try {
      cfToken = (window.turnstile && tsWidgetId !== null) ? (window.turnstile.getResponse(tsWidgetId) || "") : "";
    } catch (_) { cfToken = ""; }
    if (!cfToken) {
      err.textContent = t("err_robot"); err.hidden = false;
      return;
    }
  }
  const btn = $("reserve-btn");
  btn.disabled = true;
  btn.textContent = t("reserving");
  let data;
  try {
    data = await postJSON("/api/private-booking", {
      fromDate: lastStay.from,
      toDate: lastStay.to,
      lang,
      property: selectedSlug,
      termsAccepted: $("terms-check").checked,
      cfToken,
      guest: { name: $("guest-name").value.trim(), phone: $("guest-phone").value, email: email || undefined },
    });
  } catch {
    data = { ok: false, error: "internal_error" };
  }
  if (data && data.ok && data.checkoutUrl) {
    btn.textContent = t("redirecting");
    window.location.href = data.checkoutUrl;
    return;
  }
  // Token er engangsbruk — nullstill widgeten så gjesten kan prøve på nytt.
  try { if (window.turnstile && tsWidgetId !== null) window.turnstile.reset(tsWidgetId); } catch (_) {}
  err.textContent = errText(data && data.error);
  err.hidden = false;
  refreshButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
