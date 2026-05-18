// Manual test runner — kjør med `node tests/test-tuya.mjs` i 2gmbooking-portal-katalogen.
// Cloudflare Functions har ikke innebygd test-runner, så vi bruker vanilla node.

import { hasAdminUnlockToday } from '../functions/_utils/tuya.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg); }
  else      { failed++; console.error('  ✗', msg); }
}

console.log('hasAdminUnlockToday:');

// Bruk Oslo-midnatt for "i dag" så testen matcher prod-logikken
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
const parts = fmt.formatToParts(new Date());
const y = parts.find(p => p.type === 'year').value;
const m = parts.find(p => p.type === 'month').value;
const d = parts.find(p => p.type === 'day').value;
const probe = new Date(`${y}-${m}-${d}T12:00:00Z`);
const osloHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false }).format(probe));
const offsetHours = osloHour - 12;
const todayMs = Date.UTC(Number(y), Number(m) - 1, Number(d)) - offsetHours * 3600 * 1000;
const yesterdayMs = todayMs - 86400000;

assert(hasAdminUnlockToday([]) === false, 'tom liste → false');

assert(hasAdminUnlockToday([
  { status: { code: 'unlock_password', value: '10' }, nick_name: '', update_time: todayMs + 3600000 }
]) === true, 'slot-10 uten navn etter midnatt → true');

assert(hasAdminUnlockToday([
  { status: { code: 'unlock_password', value: '5' }, nick_name: 'admin', update_time: todayMs + 3600000 }
]) === true, 'nick_name=admin → true');

assert(hasAdminUnlockToday([
  { status: { code: 'unlock_password', value: '10' }, nick_name: '', update_time: yesterdayMs }
]) === false, 'event fra i går → false');

assert(hasAdminUnlockToday([
  { status: { code: 'unlock_password', value: '5' }, nick_name: 'Ola', update_time: todayMs + 3600000 }
]) === false, 'vanlig gjest-PIN → false');

assert(hasAdminUnlockToday([
  { status: { code: 'something_else', value: '10' }, nick_name: '', update_time: todayMs + 3600000 }
]) === false, 'ikke-password-event → false');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
