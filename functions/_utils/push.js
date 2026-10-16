// functions/_utils/push.js
// v3.19.36 — push-varsel til Frank via egen ntfy-server (ntfy.haugan.online på
// VPS-en, bak cloudflared).
// v3.19.37: kort emne «2gm» (Frank taster det i appen). Sending krever nå
// env.NTFY_TOKEN (Cloudflare-secret, ntfy-brukeren «system», write-only på 2gm);
// Franks bruker er read-only. env.NTFY_TOPIC overstyrer emnet.
//
// Kaster aldri: push er et tillegg til e-posten og skal ikke kunne stoppe noe.
// JSON-publisering (ikke headere) så æøå i tittel virker.

const NTFY_BASE = "https://ntfy.haugan.online";
const DEFAULT_TOPIC = "2gm";
const ADMIN_URL = "https://booking.2gm.no/";

export async function sendPush(env, { title, message, tags, priority, click }) {
  try {
    const res = await fetch(NTFY_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env && env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        topic: (env && env.NTFY_TOPIC) || DEFAULT_TOPIC,
        title: String(title || "2GM").slice(0, 200),
        message: String(message || "").slice(0, 3000),
        tags: tags || [],
        priority: priority || 3,
        click: click || ADMIN_URL,
      }),
    });
    if (!res.ok) console.error("[PUSH] ntfy svarte", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[PUSH] ntfy feilet:", err);
    return false;
  }
}
