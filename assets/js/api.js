/* =========================================================
   API-klient — kommuniserer med Cloudflare Pages Functions.
   Eksponert som globalt objekt: window.Api
   v2.1
   - Lagt til getAvailability() med per-(propertyId+måned) cache
   ========================================================= */
(function () {
  "use strict";

  const API_BASE = "/api";

  /**
   * POST /api/validate-token
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

    const data = await response.json().catch(() => ({ valid: false }));

    if (!response.ok && data.error) {
      // eslint-disable-next-line no-console
      console.error("[API] validate-token feilet:", response.status, data);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // getAvailability med cache per (propertyId + år + måned)
  // --------------------------------------------------------------------------

  // cacheKey = "rigg24:2026-05" → { days: [{ date, available, occupied, totalActive }, ...] }
  const availabilityCache = new Map();

  // In-flight requests for å unngå dobbeltkall ved samtidige render()
  const inflightRequests = new Map();

  function cacheKey(propertyId, year, month) {
    return `${propertyId}:${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function isoDate(year, month, day) {
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  /**
   * Henter tilgjengelighet for én måned på én property.
   *
   * Returnerer en Map: dato (YYYY-MM-DD) → { available, occupied, totalActive }
   * for raskt oppslag i kalender-renderen.
   *
   * Bruker cache: samme måned hentes ikke to ganger i samme session.
   * Hvis du vil tvinge ny henting (f.eks. etter en booking), kall clearAvailabilityCache().
   */
  async function getAvailability(propertyId, year, month) {
    const key = cacheKey(propertyId, year, month);

    // Hit i cache?
    if (availabilityCache.has(key)) {
      return availabilityCache.get(key);
    }

    // Allerede i gang med samme spørring? Vent på den.
    if (inflightRequests.has(key)) {
      return inflightRequests.get(key);
    }

    const fromDate = isoDate(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0).getDate();
    const toDate   = isoDate(year, month, lastDay);

    const promise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property: propertyId,
            fromDate,
            toDate
          })
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !Array.isArray(data.days)) {
          // eslint-disable-next-line no-console
          console.error("[API] availability feilet:", response.status, data);
          return null; // signaliser feil til kalleren
        }

        // Konverter array → Map for raskt oppslag
        const byDate = new Map();
        for (const day of data.days) {
          byDate.set(day.date, {
            available: day.available || 0,
            occupied: day.occupied || 0,
            totalActive: day.totalActive || 0
          });
        }

        availabilityCache.set(key, byDate);
        return byDate;
      } finally {
        inflightRequests.delete(key);
      }
    })();

    inflightRequests.set(key, promise);
    return promise;
  }

  /**
   * Tøm cache. Kall etter en vellykket booking-innsending så kalenderen
   * laster fersk data neste gang.
   */
  function clearAvailabilityCache() {
    availabilityCache.clear();
  }

  window.Api = {
    validateToken,
    getAvailability,
    clearAvailabilityCache
  };
})();
