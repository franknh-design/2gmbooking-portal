// assets/js/andslimoen-format.mjs
// v1.0 — Rene format-/logikk-hjelpere for den offentlige bookingsiden. INGEN DOM,
// så de kan enhetstestes med `node --test` (og importeres i nettleseren som ES-modul).

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcMs(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

// Antall netter gjesten sover = utsjekk - innsjekk. 0 ved ugyldig/reversert.
export function nightsBetween(fromISO, toISO) {
  const a = parseUtcMs(fromISO);
  const b = parseUtcMs(toISO);
  if (a == null || b == null) return 0;
  const n = Math.round((b - a) / ONE_DAY_MS);
  return n > 0 ? n : 0;
}

export function totalPrice(nightlyRate, fromISO, toISO) {
  return (Number(nightlyRate) || 0) * nightsBetween(fromISO, toISO);
}

// Heltall med mellomrom som tusenskille (nb-NO-stil), avrundet. Deterministisk
// (ikke avhengig av Intl/ICU-versjon).
export function formatKr(amount) {
  return String(Math.round(Number(amount) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Minimum ledige rom over datoene oppholdet OPPTAR (innsjekk t.o.m. utsjekk,
// inklusiv). En manglende dato i `days` regnes som 0 (ikke ledig). 0 ved
// ugyldig/reversert periode.
export function minAvailableForStay(days, fromISO, toISO) {
  const a = parseUtcMs(fromISO);
  const b = parseUtcMs(toISO);
  if (a == null || b == null || b < a) return 0;
  const byDate = new Map();
  for (const d of days || []) byDate.set(d.date, Number(d.available) || 0);
  let min = Infinity;
  for (let t = a; t <= b; t += ONE_DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const avail = byDate.has(iso) ? byDate.get(iso) : 0;
    if (avail < min) min = avail;
  }
  return min === Infinity ? 0 : min;
}

// Norsk telefon — speiler regelen i submit-booking.js / public-booking.js.
export function isValidNoPhone(s) {
  const cleaned = String(s || "").replace(/[\s\-()./]/g, "").replace(/^(\+47|0047|47)/, "");
  return /^[2-9]\d{7}$/.test(cleaned);
}

// E-post — speiler backend-regelen.
export function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
