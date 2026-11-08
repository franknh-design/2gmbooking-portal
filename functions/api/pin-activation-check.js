// functions/api/pin-activation-check.js
// v3.19.44 — Kl 14-sjekk: har dagens innflyttere en AKTIV dørkode på låsen?
//
// Bakgrunn: PIN 001453 (rom 718, 08.11.2026) ble laget mens huben hadde hengt
// seg, så Tuya-skyen sto med den som «Planlagt» og den kom aldri ned til låsen.
// Gjesten sto da uten virkende kode. Nå får Frank push (ntfy, emne 2gm).
//
// Kalles av GitHub Actions (.github/workflows/pin-activation-check.yml) 12:05
// og 13:05 UTC — den som treffer etter 14:00 norsk tid gjør jobben, den andre
// hopper over. Hver booking varsles maks én gang per dag (KV), så endepunktet
// kan ikke brukes til å spamme. Svaret inneholder bare tall, ingen navn/PIN-er.
//
// ?force=1 hopper over klokkesjekken (for manuell test etter kl 12).
// v3.19.45: varselet går også på SMS til Frank (via Flask /notify/text).

import { getSmartLockCheckinsForDate } from "../_utils/sharepoint.js";
import { listPins } from "../_utils/tuya.js";
import { sendPush } from "../_utils/push.js";

const ALERT_SMS_TO = "+4799101041";
const NOTIFY_PROXY_BASE = "https://locks.haugan.online";

const PHASE = { 1: "Planlagt", 2: "Aktiv", 3: "Utløpt", 4: "Slettet", 5: "Slettes" };

function osloNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")), time: `${g("hour")}:${g("minute")}` };
}

async function run(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = osloNow();
  // PIN-en er gyldig fra 12:00 — før det er «Planlagt» normalt.
  if (now.hour < (force ? 12 : 14)) {
    return json({ ok: true, skipped: "before_cutoff", osloTime: now.time });
  }

  const checkins = await getSmartLockCheckinsForDate(env, now.date);
  const byDevice = {};
  for (const b of checkins) (byDevice[b.deviceId] = byDevice[b.deviceId] || []).push(b);

  const problems = [];
  await Promise.all(Object.entries(byDevice).map(async ([deviceId, list]) => {
    let pins;
    try {
      pins = await listPins(deviceId);
    } catch (e) {
      for (const b of list) problems.push({ b, why: "låsen svarte ikke (" + String(e.message).slice(0, 80) + ")" });
      return;
    }
    for (const b of list) {
      const matches = pins.filter(p =>
        (b.tuyaPasswordId && String(p.id) === b.tuyaPasswordId) || String(p.name || "").trim() === b.doorCode);
      if (matches.some(p => p.phase === 2)) continue;
      const why = matches.length
        ? "status " + (PHASE[matches[0].phase] || "phase " + matches[0].phase)
        : "finnes ikke på låsen";
      problems.push({ b, why });
    }
  }));

  // Én push per booking per dag.
  const fresh = [];
  for (const p of problems) {
    const key = `pinchk2:${now.date}:${p.b.id}`;
    if (env.RESET_PIN_KV) {
      if (await env.RESET_PIN_KV.get(key)) continue;
      await env.RESET_PIN_KV.put(key, "1", { expirationTtl: 2 * 86400 });
    }
    fresh.push(p);
  }

  if (fresh.length) {
    const lines = fresh.map(({ b, why }) =>
      `• Rom ${b.room}: ${b.person || "?"}${b.company ? " (" + b.company + ")" : ""} — PIN ${b.doorCode} ${why}`);
    await sendPush(env, {
      title: fresh.length === 1
        ? `Dørkode ikke aktiv — rom ${fresh[0].b.room}`
        : `${fresh.length} dørkoder ikke aktive`,
      message: `Kl ${now.time}, innflytting i dag:\n${lines.join("\n")}\n\nHuben kan ha hengt seg. Sjekk låsen og lag ny kode om nødvendig.`,
      tags: ["warning", "key"],
      priority: 4,
    });
    const sms = "2GM: dørkode ikke aktiv kl " + now.time + "
"
      + fresh.map(({ b, why }) => `Rom ${b.room} ${b.person || "?"}: PIN ${b.doorCode} ${why}`).join("
");
    await sendAlertSms(env, sms);
  }

  return json({ ok: true, osloTime: now.time, checked: checkins.length, problems: problems.length, pushed: fresh.length });
}

// Kaster aldri — SMS er et tillegg til pushen.
async function sendAlertSms(env, body) {
  try {
    const res = await fetch(`${env.NOTIFY_PROXY_BASE || NOTIFY_PROXY_BASE}/notify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Notify-Secret": env.NOTIFY_SHARED_SECRET || "" },
      body: JSON.stringify({ to: ALERT_SMS_TO, body: body.slice(0, 600) }),
    });
    if (!res.ok) console.error("[PIN-CHECK] SMS svarte", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[PIN-CHECK] SMS feilet:", err);
  }
}

export async function onRequestGet(context) {
  try { return await run(context); }
  catch (err) {
    console.error("[PIN-CHECK]", err);
    return json({ ok: false, error: "internal" }, 500);
  }
}
export const onRequestPost = onRequestGet;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
