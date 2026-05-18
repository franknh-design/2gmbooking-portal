// functions/_utils/tuya.js
// v1.0 — Wrapper for locks.haugan.online/tuya/lock_log.
// Speiler 2gmbooking/js/tuya.js:_isAdminUnlockEvent slik at vi gjenkjenner
// admin/vasker-PIN-events på samme måte som admin-appen.

const TUYA_PROXY_BASE = 'https://locks.haugan.online';

/**
 * Henter siste 24t unlock-events fra Tuya for ett lock-device.
 * Returnerer tom liste ved feil (graceful degradation — kallenes ansvar
 * å rapportere når array er tom og forventet å ha events).
 */
export async function fetchLockLog(deviceId) {
  if (!deviceId) return [];
  try {
    const url = `${TUYA_PROXY_BASE}/tuya/lock_log?device_id=${encodeURIComponent(deviceId)}&days=1`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    if (!body || body.success !== true) return [];
    return Array.isArray(body.result) ? body.result : [];
  } catch (_) {
    return [];
  }
}

/**
 * Identifiser admin-/vasker-PIN-opplåsninger.
 * Mirror av js/tuya.js:_isAdminUnlockEvent (v20.26.7).
 */
function isAdminUnlockEvent(ev) {
  const code = String((ev && ev.status && ev.status.code) || '').toLowerCase();
  if (!/password|temporary|pin/.test(code)) return false;
  const who = String((ev && ev.nick_name) || '').trim();
  // Eksplisitt admin-mønster
  if (who && /^\s*(admin|10\s*password|password\s*10|112113)\s*$/i.test(who)) return true;
  // Slot 10 uten navn = "10 password" master-PIN
  const slot = String((ev && ev.status && ev.status.value) || '').trim();
  if (!who && slot === '10') return true;
  return false;
}

/**
 * Sjekker om listen inneholder en admin-unlock etter midnatt (Europe/Oslo).
 */
export function hasAdminUnlockToday(events) {
  const startMs = startOfTodayOsloMs();
  return (events || []).some(ev => {
    const ts = Number(ev && ev.update_time || 0);
    if (ts < startMs) return false;
    return isAdminUnlockEvent(ev);
  });
}

function startOfTodayOsloMs() {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  // Finn Oslo's UTC-offset for denne datoen (1 vinter, 2 sommer)
  const probe = new Date(`${y}-${m}-${d}T12:00:00Z`);
  const osloHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false
  }).format(probe));
  const offsetHours = osloHour - 12;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) - offsetHours * 3600 * 1000;
}
