// assets/js/andslimoen.mjs — v1.0. DOM-orkestrering for den offentlige
// bookingsiden. Laster config, håndterer datovelger + ledighet, sender
// reservasjon. All ren logikk ligger i andslimoen-format.mjs.
import {
  nightsBetween,
  totalPrice,
  formatKr,
  minAvailableForStay,
  isValidNoPhone,
  isValidEmail,
} from "./andslimoen-format.mjs";

const $ = (id) => document.getElementById(id);
const GALLERY = [
  { src: "assets/img/andslimoen/rom.jpg", alt: "Rom" },
  { src: "assets/img/andslimoen/bad.jpg", alt: "Bad og dusj" },
  { src: "assets/img/andslimoen/vaskerom.jpg", alt: "Vaskerom" },
  { src: "assets/img/andslimoen/kjokken.jpg", alt: "Kjøkken" },
  { src: "assets/img/andslimoen/rigg.jpg", alt: "Riggen" },
];

let nightlyRate = 0;

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
    img.src = g.src;
    img.alt = g.alt;
    if (i === 0) img.classList.add("active");
    img.addEventListener("click", () => {
      $("gallery-main").src = g.src;
      $("gallery-main").alt = g.alt;
      thumbs.querySelectorAll("img").forEach((t) => t.classList.remove("active"));
      img.classList.add("active");
    });
    thumbs.appendChild(img);
  });
}

async function init() {
  buildGallery();
  // Hent config (enabled + nightlyRate) med et lite vindu.
  const t = todayISO();
  let config;
  try {
    config = await postJSON("/api/public-availability", { fromDate: t, toDate: t });
  } catch {
    config = { enabled: false };
  }
  if (!config || !config.enabled) {
    $("closed-state").hidden = false;
    return;
  }
  nightlyRate = Number(config.nightlyRate) || 0;
  $("nightly-rate").textContent = formatKr(nightlyRate);
  $("booking-state").hidden = false;

  // Datofelt: min = i dag.
  $("checkin").min = t;
  $("checkout").min = t;
  $("checkin").addEventListener("change", onDatesChanged);
  $("checkout").addEventListener("change", onDatesChanged);
  ["guest-name", "guest-phone"].forEach((id) => $(id).addEventListener("input", refreshButton));
  $("guest-form").addEventListener("submit", onSubmit);
}

let lastStay = { from: "", to: "", available: 0 };

async function onDatesChanged() {
  const from = $("checkin").value;
  const to = $("checkout").value;
  const av = $("availability-result");
  const ps = $("price-summary");
  lastStay = { from, to, available: 0 };
  const nights = nightsBetween(from, to);
  if (!from || !to || nights <= 0) {
    av.textContent = ""; av.className = "availability";
    ps.textContent = "";
    refreshButton();
    return;
  }
  av.textContent = "Sjekker ledighet…"; av.className = "availability";
  let data;
  try {
    data = await postJSON("/api/public-availability", { fromDate: from, toDate: to });
  } catch {
    av.textContent = "Kunne ikke sjekke ledighet — prøv igjen."; av.className = "availability full";
    refreshButton();
    return;
  }
  if (!data || !data.enabled) {
    $("booking-state").hidden = true; $("closed-state").hidden = false;
    return;
  }
  const avail = minAvailableForStay(data.days || [], from, to);
  lastStay.available = avail;
  if (avail > 0) {
    av.textContent = `${avail} rom ledige`; av.className = "availability ok";
    ps.textContent = `${formatKr(totalPrice(nightlyRate, from, to))} kr for ${nights} ${nights === 1 ? "natt" : "netter"}`;
  } else {
    av.textContent = "Ingen ledige rom disse datoene"; av.className = "availability full";
    ps.textContent = "";
  }
  refreshButton();
}

function guestValid() {
  return (
    $("guest-name").value.trim().length > 0 &&
    isValidNoPhone($("guest-phone").value)
  );
}

function refreshButton() {
  const ok = lastStay.available > 0 && nightsBetween(lastStay.from, lastStay.to) > 0 && guestValid();
  const btn = $("reserve-btn");
  btn.disabled = !ok;
  btn.textContent =
    lastStay.available > 0 && nightsBetween(lastStay.from, lastStay.to) > 0
      ? `Reserver — ${formatKr(totalPrice(nightlyRate, lastStay.from, lastStay.to))} kr`
      : "Reserver";
}

const ERROR_TEXT = {
  sold_out: "Noen var raskere — prøv andre datoer.",
  public_booking_disabled: "Booking er midlertidig stengt.",
  invalid_guest: "Sjekk navn og telefonnummer.",
  invalid_dates: "Sjekk datoene.",
  invalid_request: "Noe gikk galt, prøv igjen.",
  internal_error: "Noe gikk galt, prøv igjen.",
};

async function onSubmit(e) {
  e.preventDefault();
  const err = $("form-error");
  err.hidden = true;
  const email = $("guest-email").value.trim();
  if (email && !isValidEmail(email)) {
    err.textContent = "Ugyldig e-postadresse."; err.hidden = false;
    return;
  }
  const btn = $("reserve-btn");
  btn.disabled = true;
  btn.textContent = "Reserverer…";
  let data;
  try {
    data = await postJSON("/api/public-booking", {
      fromDate: lastStay.from,
      toDate: lastStay.to,
      guest: { name: $("guest-name").value.trim(), phone: $("guest-phone").value, email: email || undefined },
    });
  } catch {
    data = { ok: false, error: "internal_error" };
  }
  if (data && data.ok) {
    $("booking-state").hidden = true;
    $("confirmation-ref").textContent = data.bookingRef;
    $("confirmation").hidden = false;
    return;
  }
  err.textContent = ERROR_TEXT[data && data.error] || "Noe gikk galt, prøv igjen.";
  err.hidden = false;
  refreshButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
