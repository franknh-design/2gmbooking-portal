// functions/_utils/graph.js
// v1.0 - Microsoft Graph OAuth client credentials helper

/**
 * Henter access token fra Microsoft Graph via OAuth client credentials flow.
 * Tokenet er gyldig i ca. 1 time. Vi cacher ikke her - hver request henter nytt.
 * (Kan optimaliseres senere med Cloudflare Cache API hvis volum øker.)
 */
export async function getGraphToken(env) {
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

  const data = await response.json();
  return data.access_token;
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
