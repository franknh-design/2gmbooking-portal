/* =========================================================
   API-klient — kommuniserer med Cloudflare Pages Functions.
   Eksponert som globalt objekt: window.Api
   v2.0 - første versjon med ekte token-validering
   ========================================================= */
(function () {
  "use strict";

  const API_BASE = "/api"; // Pages Functions ligger på samme domene

  /**
   * POST /api/validate-token
   * Validerer token mot SharePoint Customer_Tokens-listen.
   *
   * Returnerer:
   *   - Ved gyldig:  { valid: true, firma, kontaktperson, telefon_maskert,
   *                    tillatte_lokasjoner: [...], maks_rom }
   *   - Ved ugyldig: { valid: false }
   *   - Ved nettverksfeil: kaster Error
   */
  async function validateToken(token) {
    if (!token || typeof token !== "string") {
      return { valid: false };
    }

    const response = await fetch(`${API_BASE}/validate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    // Selv ved 500-feil returnerer API-et JSON med valid:false
    // og en error-felt. Vi behandler det som "ugyldig" for kunden,
    // men logger detaljer for debugging.
    const data = await response.json().catch(() => ({ valid: false }));

    if (!response.ok && data.error) {
      // eslint-disable-next-line no-console
      console.error("[API] validate-token feilet:", response.status, data);
    }

    return data;
  }

  window.Api = {
    validateToken
  };
})();
