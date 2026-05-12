// functions/_utils/graph.js
// v1.1 - Microsoft Graph OAuth client credentials helper med token-cache.
//        v1.0 hentet ny token hvert eneste kall — med 4 parallelle endepunkter
//        ved page-load og flere samtidige portal-brukere traff vi OAuth rate-
//        limit fra Microsoft som propagerte som 503 fra Pages Functions.

// Module-level cache lever på tvers av requests innen samme Cloudflare-isolate
// (typisk minutter til timer). Concurrent requests deler samme inflight-promise
// så vi aldri har mer enn én token-fetch i lufta om gangen.
let _cachedToken = null;
let _cachedExpiresAt = 0;
let _inflightFetch = null;

// Buffer på 5 min så vi alltid får ny token før den faktisk utløper.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Henter access token fra Microsoft Graph via OAuth client credentials flow.
 * Cacher tokenet på modul-nivå — neste kall gjenbruker det inntil ~5 min før
 * utløp. Tokenet er gyldig i ca. 1 time, så vi hoster typisk 1 OAuth-kall
 * per time per isolate i stedet for ett per API-kall.
 */
export async function getGraphToken(env) {
  const now = Date.now();
  if (_cachedToken && now < _cachedExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return _cachedToken;
  }
  // Hvis en parallell request allerede henter ny token, vent på den i stedet
  // for å spinne opp en til.
  if (_inflightFetch) {
    return _inflightFetch;
  }

  _inflightFetch = _fetchNewToken(env)
    .then((data) => {
      _cachedToken = data.access_token;
      _cachedExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      return _cachedToken;
    })
    .finally(() => {
      _inflightFetch = null;
    });

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
