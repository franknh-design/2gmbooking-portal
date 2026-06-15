// assets/js/andslimoen.mjs — v1.3. DOM-orkestrering for den offentlige
// bookingsiden, tospråklig (NO/EN). Laster config, håndterer flatpickr-datovelger
// + ledighet, sender reservasjon. Ren logikk i andslimoen-format.mjs, tekster i
// andslimoen-i18n.mjs.
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidPhone,
  isValidEmail,
} from "./andslimoen-format.mjs";
import { STRINGS, fmt, pickLang } from "./andslimoen-i18n.mjs";

const $ = (id) => document.getElementById(id);
const GALLERY = [
  { src: "assets/img/andslimoen/rom.jpg", key: "galRom" },
  { src: "assets/img/andslimoen/bad.jpg", key: "galBad" },
  { src: "assets/img/andslimoen/vaskerom.jpg", key: "galVaskerom" },
  { src: "assets/img/andslimoen/kjokken.jpg", key: "galKjokken" },
  { src: "assets/img/andslimoen/rigg.jpg", key: "galRigg" },
];
const LANG_KEY = "andslimoen_lang";

let nightlyRate = 0;
let lang = "nb";
let galleryIndex = 0;
let lastStay = { from: "", to: "", available: 0 };
const fpInstances = [];
const thumbImgs = [];

function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || key;
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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

  // Re-lokaliser eventuell allerede-vist ledighet/pris/knapp.
  renderStay();
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
  applyLang(lang); // sett flatpickr-placeholder/lokalitet nå som instansene finnes

  let config;
  try {
    config = await postJSON("/api/public-availability", { fromDate: today, toDate: today });
  } catch {
    config = { enabled: false };
  }
  if (!config || !config.enabled) {
    $("booking-state").hidden = true;
    $("closed-state").hidden = false;
    return;
  }
  nightlyRate = Number(config.nightlyRate) || 0;
  $("nightly-rate").textContent = formatKr(nightlyRate);
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
    data = await postJSON("/api/public-availability", { fromDate: from, toDate: to });
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
  const btn = $("reserve-btn");
  btn.disabled = true;
  btn.textContent = t("reserving");
  let data;
  try {
    data = await postJSON("/api/public-booking", {
      fromDate: lastStay.from,
      toDate: lastStay.to,
      lang,
      termsAccepted: $("terms-check").checked,
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
  err.textContent = errText(data && data.error);
  err.hidden = false;
  refreshButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
