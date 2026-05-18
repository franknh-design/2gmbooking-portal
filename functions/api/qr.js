// functions/api/c.js
// v1.0 — QR-handler for vaskeverifisering. Eksponert som /c via _redirects.
// GET /c?r=<roomId>   → sjekker Tuya, evt. PIN-form, ev. skriver WashOverrides
// POST /c             → PIN-verify + skriv WashOverrides

import {
  findRoomById,
  findActiveBookingForRoom,
  findExistingCompletedToday,
  createWashOverride,
} from '../_utils/sharepoint.js';
import { fetchLockLog, hasAdminUnlockToday } from '../_utils/tuya.js';

const PIN_LOCALSTORAGE_KEY = 'qr-pin-ok';
const PIN_LOCALSTORAGE_TTL_DAYS = 30;

const PIN_RATE_LIMIT_KEY_PREFIX = 'qr-pin-fail:';
const PIN_RATE_LIMIT_MAX = 3;
const PIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

// ----------------------------------------------------------------------------
// GET /c?r=<roomId>
// ----------------------------------------------------------------------------
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const roomId = url.searchParams.get('r');

  if (!roomId) {
    return htmlResponse(renderError('Ingen rom-ID i URL', 'Lenken mangler ?r=&lt;id&gt;.'), 400);
  }

  const room = await findRoomById(env, roomId);
  if (!room) {
    return htmlResponse(renderError('Ukjent rom', `Fant ikke rom-ID ${escapeHtml(roomId)}.`), 404);
  }

  let verified = null;
  if (room.Tuya_Device_ID) {
    const events = await fetchLockLog(room.Tuya_Device_ID);
    if (hasAdminUnlockToday(events)) verified = 'tuya';
  }

  if (verified === 'tuya') {
    return await writeAndConfirm(env, room, 'qr-scan-tuya', 'Tuya verified');
  }

  return htmlResponse(renderPinForm(roomId, room));
}

// ----------------------------------------------------------------------------
// POST /c
// ----------------------------------------------------------------------------
export async function onRequestPost(context) {
  const { request, env } = context;
  const form = await request.formData();
  const roomId = form.get('r');
  const pin = form.get('pin');

  if (!roomId) {
    return htmlResponse(renderError('Ingen rom-ID', 'Form-data mangler r.'), 400);
  }
  const room = await findRoomById(env, roomId);
  if (!room) {
    return htmlResponse(renderError('Ukjent rom', `Fant ikke rom-ID ${escapeHtml(roomId)}.`), 404);
  }
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return htmlResponse(renderPinError(roomId, room, 'PIN må være 4 sifre.'), 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await isPinRateLimited(ip)) {
    return htmlResponse(renderError('For mange forsøk', 'Vent 5 minutter og prøv igjen.'), 429);
  }

  const expectedPin = env.QR_CLEANER_PIN || '';
  if (!expectedPin) {
    console.error('[QR] QR_CLEANER_PIN secret er ikke satt — avviser alle PIN-forsøk');
    return htmlResponse(renderError('Konfigurasjons-feil', 'Admin må sette QR_CLEANER_PIN på serveren.'), 500);
  }
  if (String(pin) !== String(expectedPin)) {
    await incrementPinFailure(ip);
    return htmlResponse(renderPinError(roomId, room, 'Feil PIN. Prøv igjen.'), 401);
  }

  return await writeAndConfirmWithPinSet(env, room, pin);
}

// ----------------------------------------------------------------------------
// Skrive- og rendring-hjelpere
// ----------------------------------------------------------------------------

async function writeAndConfirm(env, room, source, reasonSuffix) {
  const booking = await findActiveBookingForRoom(env, room.id);
  if (!booking) {
    return htmlResponse(renderSuccess({ room, booking: null, source }), 200);
  }
  const existing = await findExistingCompletedToday(env, booking.id);
  if (existing) {
    const at = osloHHMM(existing.ChangedAt);
    return htmlResponse(renderSuccess({ room, booking, source, alreadyAt: at }), 200);
  }
  const reasonText = `QR-scan kl ${osloHHMM(Date.now())} (${reasonSuffix})`;
  try {
    await createWashOverride(env, {
      bookingId: booking.id,
      action: 'Completed',
      newDate: new Date(),
      source,
      reasonText,
    });
  } catch (e) {
    console.error('[QR] createWashOverride failed:', e.message);
    return htmlResponse(renderError('Klarte ikke lagre', 'Prøv igjen om litt eller meld fra til admin.'), 503);
  }
  return htmlResponse(renderSuccess({ room, booking, source }), 200);
}

async function writeAndConfirmWithPinSet(env, room, pin) {
  const booking = await findActiveBookingForRoom(env, room.id);
  let alreadyAt = null;
  if (booking) {
    const existing = await findExistingCompletedToday(env, booking.id);
    if (existing) {
      alreadyAt = osloHHMM(existing.ChangedAt);
    } else {
      const reasonText = `QR-scan kl ${osloHHMM(Date.now())} (PIN)`;
      try {
        await createWashOverride(env, {
          bookingId: booking.id,
          action: 'Completed',
          newDate: new Date(),
          source: 'qr-scan-pin',
          reasonText,
        });
      } catch (e) {
        console.error('[QR] createWashOverride (PIN-path) failed:', e.message);
        return htmlResponse(renderError('Klarte ikke lagre', 'Prøv igjen om litt.'), 503);
      }
    }
  }

  const baseHtml = renderSuccess({ room, booking, source: 'qr-scan-pin', alreadyAt });
  const html = baseHtml.replace('</body>', `<script>
try {
  localStorage.setItem('${PIN_LOCALSTORAGE_KEY}', JSON.stringify({
    pin: ${JSON.stringify(String(pin))},
    expires: Date.now() + ${PIN_LOCALSTORAGE_TTL_DAYS} * 86400000
  }));
} catch(_){}
</script></body>`);
  return htmlResponse(html, 200);
}

// ----------------------------------------------------------------------------
// HTML-rendring
// ----------------------------------------------------------------------------

function renderPinForm(roomId, room) {
  return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bekreft vask — Rom ${escapeHtml(room.Title)}</title>
<style>${baseCss()}</style></head><body>
<div class="card">
  <div class="muted">${escapeHtml(room.propertyTitle || '')}</div>
  <h1>Rom ${escapeHtml(room.Title)}</h1>
  <p>Tast vasker-PIN for å bekrefte vask:</p>
  <form id="pinForm" method="POST" action="/c">
    <input type="hidden" name="r" value="${escapeHtml(roomId)}">
    <input type="tel" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autofocus
           style="font-size:32px;padding:10px;width:160px;text-align:center;letter-spacing:8px">
    <br><br>
    <button type="submit" style="font-size:18px;padding:10px 24px;background:#1D9E75;color:#fff;border:0;border-radius:8px;cursor:pointer">Bekreft</button>
  </form>
  <script>
    try {
      const ok = JSON.parse(localStorage.getItem('${PIN_LOCALSTORAGE_KEY}') || 'null');
      if (ok && ok.expires > Date.now() && ok.pin) {
        const f = document.getElementById('pinForm');
        f.querySelector('input[name=pin]').value = ok.pin;
        f.submit();
      }
    } catch (_) {}
  </script>
</div></body></html>`;
}

function renderPinError(roomId, room, msg) {
  return renderPinForm(roomId, room)
    .replace('<p>Tast vasker-PIN', `<p style="color:#dc2626;font-weight:600">${escapeHtml(msg)}</p><p>Tast vasker-PIN`);
}

function renderError(title, body) {
  return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${baseCss()}</style></head><body>
<div class="card error">
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
</div></body></html>`;
}

function renderSuccess({ room, booking, source, alreadyAt }) {
  const sourceLabel = source === 'qr-scan-tuya'
    ? '(verifisert via Tuya admin-PIN)'
    : '(verifisert via PIN)';
  const timeNow = osloHHMM(Date.now());
  const stamp = alreadyAt
    ? `<p class="muted">Allerede registrert kl ${escapeHtml(alreadyAt)}</p>`
    : `<p class="muted">${escapeHtml(timeNow)} ${sourceLabel}</p>`;
  return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>✓ Rom ${escapeHtml(room.Title)} vasket</title>
<style>${baseCss()}</style></head><body>
<div class="card ok">
  <div class="check">✓</div>
  <h1>Rom ${escapeHtml(room.Title)} vasket</h1>
  <div class="muted">${escapeHtml(room.propertyTitle || '')}</div>
  ${booking
    ? `<p>Gjest: ${escapeHtml(booking.Person_Name || '—')}</p>`
    : `<p class="warn">Ingen aktiv gjest funnet — ikke logget i SharePoint.</p>`}
  ${stamp}
</div></body></html>`;
}

function baseCss() {
  return `
body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f4ef;padding:24px;color:#222}
.card{max-width:480px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center}
.card h1{font-size:28px;margin:8px 0}
.card .muted{color:#888;font-size:14px;margin-bottom:6px}
.card.ok .check{font-size:64px;color:#1D9E75;line-height:1}
.card.error h1{color:#dc2626}
.warn{color:#d97706}
`;
}

// ----------------------------------------------------------------------------
// PIN-rate-limit (CF Cache API per IP, 5 min)
// ----------------------------------------------------------------------------

async function isPinRateLimited(ip) {
  try {
    const cache = caches.default;
    const url = `https://qr-pin-rl.local/${PIN_RATE_LIMIT_KEY_PREFIX}${encodeURIComponent(ip)}`;
    const cached = await cache.match(new Request(url));
    if (!cached) return false;
    const body = await cached.json();
    if (body && body.count >= PIN_RATE_LIMIT_MAX && body.expires > Date.now()) {
      return true;
    }
  } catch (_) {}
  return false;
}

async function incrementPinFailure(ip) {
  try {
    const cache = caches.default;
    const url = `https://qr-pin-rl.local/${PIN_RATE_LIMIT_KEY_PREFIX}${encodeURIComponent(ip)}`;
    let count = 1;
    try {
      const cached = await cache.match(new Request(url));
      if (cached) {
        const body = await cached.json();
        if (body && body.expires > Date.now()) count = (body.count || 0) + 1;
      }
    } catch (_) {}
    const expires = Date.now() + PIN_RATE_LIMIT_WINDOW_MS;
    await cache.put(
      new Request(url),
      new Response(JSON.stringify({ count, expires }), {
        headers: { 'Cache-Control': `max-age=${Math.ceil(PIN_RATE_LIMIT_WINDOW_MS / 1000)}` }
      })
    );
  } catch (_) {}
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

function osloHHMM(input) {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit'
  }).format(d);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
