// functions/_utils/email.js
// v1.0 - Email wrapper for Resend (https://resend.com)
//
// Krever miljøvariabel RESEND_API_KEY (sett som secret i Cloudflare).
// Hvis variabelen mangler, logges meldingen i stedet for å sendes -
// gjør koden trygg å deploye før Resend er satt opp.

const RESEND_API_URL = "https://api.resend.com/emails";

// Standard avsenderadresse. Resend tillater onboarding@resend.dev uten
// domene-verifisering. Når 2gm.no er DKIM-verifisert hos Resend, bytt
// til "noreply@2gm.no".
const DEFAULT_FROM = "2GM Booking <onboarding@resend.dev>";

/**
 * Send en e-post via Resend.
 *
 * Returnerer:
 *   { ok: true, id, mode: "sent" }     - sendt via Resend
 *   { ok: true, mode: "logged" }       - logget i stedet (RESEND_API_KEY mangler)
 *   { ok: false, error }               - faktisk feil
 *
 * Funksjonen kaster IKKE exception - den feiler stille slik at
 * booking-flyten fortsetter selv om e-post ikke kan sendes. Faktiske
 * feil blir logget til Cloudflare-konsoll.
 */
export async function sendEmail(env, { to, subject, text, html, from }) {
  if (!env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.log("[EMAIL] RESEND_API_KEY mangler - hadde sendt:", { to, subject, text });
    return { ok: true, mode: "logged" };
  }

  const payload = {
    from: from || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
  };

  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!html && !text) {
    return { ok: false, error: "no_body" };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("[EMAIL] Resend feilet:", response.status, data);
      return { ok: false, error: data };
    }

    return { ok: true, id: data.id, mode: "sent" };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[EMAIL] Resend exception:", err);
    return { ok: false, error: String(err) };
  }
}
