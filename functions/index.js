// functions/index.js — v1.0
// GET / på www.2gm.no.
//   ?token=…  → bedriftsportalen (index.html) som før — lenkene i e-postene.
//   uten token → den offentlige forsiden (hjem.html) med 200, så Google får
//                ekte innhold på «/» i stedet for en JS-videresending til /start.
// index.html har fortsatt sin egen /start-redirect som reserve hvis denne
// funksjonen av en eller annen grunn ikke kjører.

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  if (url.searchParams.get("token")) return next();
  const res = await env.ASSETS.fetch(new URL("/hjem", url));
  if (!res.ok) return next();
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "public, max-age=300");
  return out;
}
