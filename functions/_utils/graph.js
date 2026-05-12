// functions/_utils/graph.js
// v1.2 - Microsoft Graph OAuth client credentials helper med to-lags cache.
//        v1.1 hadde kun modul-cache som var per-isolate — Cloudflare spinner
//        opp nye isolates etter hver deploy og ved trafikkspiker, så cachen
//        startet tom og 4 parallelle API-kall rasjet om sin egen OAuth-token.
//        Microsoft 429/503 → 503 fra Pages Function.
//
//        v1.2 legger Cloudflare Cache API som L2 så tokenet deles på tvers av
//        isolates i samme datacenter. Cold-start innenfor token-TTL henter
//        eksisterende token fra cachen i stedet for å lage et nytt OAuth-kall.

// L1: modul-cache — raskest, per-isolate
let _l1Token = null;
let _l1ExpiresAt = 0;
let _inflightFetch = null;

// Buffer på 5 min så vi alltid får ny token før den faktisk utløper.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// L2-nøkkel for Cache API. Syntetisk URL — brukes kun som cache-key.
const L2_CACHE_URL = "https://graph-token-cache.2gmbooking.internal/v1";

/**
 * Henter access token fra Microsoft Graph via OAuth client credentials flow.
 * Cacher tokenet i to lag:
 *   L1 modul-cache: per-isolate, raskest (<1µs)
 *   L2 Cloudflare Cache API: per-datacenter, deles på tvers av isolates
 * Tokenet er gyldig i ca. 1 time → vi gjør typisk 1 OAuth-kall per time
 * per datacenter, ikke per isolate eller per request.
 */
export async function getGraphToken(env) {
  const now = Date.now();

  // L1
  if (_l1Token && now < _l1ExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return _l1Token;
  }
  // Hvis en parallell request allerede henter ny token, vent på den.
  if (_inflightFetch) {
    return _inflightFetch;
  }

  _inflightFetch = (async () => {
    try {
      const cache = caches.default;

      // L2: Cache API — gyldig token fra et annet isolate i samme DC?
      try {
        const cached = await cache.match(new Request(L2_CACHE_URL));
        if (cached) {
          const body = await cached.json();
          if (body && body.token && now < body.expires_at - TOKEN_REFRESH_BUFFER_MS) {
            _l1Token = body.token;
            _l1ExpiresAt = body.expires_at;
            return body.token;
          }
        }
      } catch (_) {
        // Cache-lesing skal aldri blokkere — fall gjennom til fersk fetch.
      }

      // Hverken L1 eller L2 — hent fra Microsoft.
      const data = await _fetchNewToken(env);
      const ttlSec = data.expires_in || 3600;
      const expiresAt = Date.now() + ttlSec * 1000;
      _l1Token = data.access_token;
      _l1ExpiresAt = expiresAt;

      // Skriv tilbake til L2 så neste cold-start kan plukke opp.
      try {
        const ttlForL2 = Math.max(60, ttlSec - 300); // ikke server token siste 5 min av TTL
        await cache.put(
          new Request(L2_CACHE_URL),
          new Response(
            JSON.stringify({ token: data.access_token, expires_at: expiresAt }),
            { headers: { "Cache-Control": `max-age=${ttlForL2}` } }
          )
        );
      } catch (_) {
        // L2-write-feil er ikke fatal — neste isolate henter bare en ny.
      }

      return data.access_token;
    } finally {
      _inflightFetch = null;
    }
  })();

  return _inflightFetch;
}

async function _fetchNewToken(env) {
  const tokenUrl = `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph token failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Wrapper for Graph API-kall. Håndterer auth header og JSON-parsing.
 */
export async function graphRequest(env, path, options = {}) {
  const token = await getGraphToken(env);
  
  const url = path.startsWith("https://")
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph API failed: ${response.status} ${errorText}`);
  }

  return response.json();
}
