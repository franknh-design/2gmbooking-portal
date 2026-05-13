/* =========================================================
   API-klient — kommuniserer med Cloudflare Pages Functions.
   v3.2
   - Lagt til getMyBookings() — kundens aktive + kommende bookinger
   - Lagt til requestExtension() — be admin om å forlenge en aktiv booking
   ========================================================= */
(function () {
  "use strict";

  const API_BASE = "/api";

  // --------------------------------------------------------------------------
  // validate-token
  // --------------------------------------------------------------------------

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
  // validate-pin
  // --------------------------------------------------------------------------

  async function validatePin(token, pin) {
    if (!token || !pin) return { ok: false };
    try {
      const response = await fetch(`${API_BASE}/validate-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin })
      });
      const data = await response.json().catch(() => ({ ok: false }));
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] validate-pin exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // availability (med cache per propertyId+måned)
  // --------------------------------------------------------------------------

  const availabilityCache = new Map();
  const inflightRequests = new Map();

  function cacheKey(propertyId, year, month) {
    return `${propertyId}:${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function isoDate(year, month, day) {
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  async function getAvailability(propertyId, year, month) {
    const key = cacheKey(propertyId, year, month);

    if (availabilityCache.has(key)) {
      return availabilityCache.get(key);
    }
    if (inflightRequests.has(key)) {
      return inflightRequests.get(key);
    }

    const fromDate = isoDate(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0).getDate();
    const toDate   = isoDate(year, month, lastDay);

    // v3.6.7: send token så availability vet hvilken kunde som spør —
    // kunder som SELV er long-term-tenant på alle leiligheter (SalMar /
    // Strandveien 112) skal se faktisk ledighet, ikke "fullt".
    const token = (window.Auth && window.Auth.token) || null;

    const promise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property: propertyId, fromDate, toDate, token })
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !Array.isArray(data.days)) {
          // eslint-disable-next-line no-console
          console.error("[API] availability feilet:", response.status, data);
          return null;
        }

        const byDate = new Map();
        for (const day of data.days) {
          byDate.set(day.date, {
            available: day.available || 0,
            occupied: day.occupied || 0,
            totalActive: day.totalActive || 0,
            freeRooms: Array.isArray(day.freeRooms) ? day.freeRooms : null
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

  function clearAvailabilityCache() {
    availabilityCache.clear();
  }

  // --------------------------------------------------------------------------
  // submit-booking
  // --------------------------------------------------------------------------

  /**
   * Sender en bestilling til serveren.
   *
   * Input:
   *   {
   *     token: "test-abc123-xyz789",
   *     property: "rigg24",
   *     guests: [
   *       { name: "Ola",  checkIn: "2026-05-18", checkOut: "2026-05-22" },
   *       { name: "Kari", checkIn: "2026-05-18", checkOut: null }
   *     ]
   *   }
   *
   * Returnerer ved suksess:
   *   { ok: true, bookingRef, rowsCreated, capacityWarning? }
   *
   * Returnerer ved feil:
   *   { ok: false, error: "...", status: 4xx/5xx }
   *
   * Kaster IKKE exception - kalleren sjekker .ok.
   */
  async function submitBooking({ token, property, guests }) {
    try {
      const response = await fetch(`${API_BASE}/submit-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, property, guests })
      });

      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error("[API] submit-booking feilet:", response.status, data);
        return {
          ok: false,
          error: data.error || "http_error",
          status: response.status
        };
      }

      // Vellykket innsending - tøm availability-cache så
      // kalenderen viser oppdatert ledighet ved neste oppslag
      clearAvailabilityCache();

      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] submit-booking exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // my-bookings
  // --------------------------------------------------------------------------

  /**
   * v3.10.31: Henter telefonnr per booking (via Persons-lookup).
   * Eget endepunkt så det dyre Persons-oppslaget ikke kjøres på hver
   * my-bookings-polling — bare når sendcode-modalen faktisk åpnes.
   * Returnerer { ok, phones: { "2GM-AB12CD": "+4799887766", ... } }.
   */
  async function getBookingPhones(token) {
    if (!token || typeof token !== "string") {
      return { ok: false, error: "missing_token", phones: {} };
    }
    try {
      const response = await fetch(`${API_BASE}/booking-phones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response", phones: {} }));
      if (!response.ok) {
        return { ok: false, error: data.error || "http_error", phones: {} };
      }
      return { ok: data.ok !== false, phones: data.phones || {} };
    } catch (_err) {
      return { ok: false, error: "network_error", phones: {} };
    }
  }

  /**
   * Henter kundens aktive + kommende bookinger (alle lokasjoner).
   * Returnerer { ok, bookings: [...] } eller { ok: false, error }.
   */
  async function getMyBookings(token) {
    if (!token || typeof token !== "string") {
      return { ok: false, error: "missing_token" };
    }
    try {
      const response = await fetch(`${API_BASE}/my-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        // v3.8.6: defensive — POST cachees normalt ikke, men noen mellomledd
        // (browser, CDN, service worker) kan likevel returnere stale data.
        cache: "no-store",
      });

      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error("[API] my-bookings feilet:", response.status, data);
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] my-bookings exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // extend-booking
  // --------------------------------------------------------------------------

  /**
   * Ber admin forlenge en aktiv booking. Skriver INGENTING til SharePoint —
   * sender kun e-post til admin som tar avgjørelsen manuelt.
   * Returnerer { ok: true, mode } eller { ok: false, error }.
   */
  async function requestExtension({ token, bookingRef, requestedCheckOut }) {
    if (!token || !bookingRef || !requestedCheckOut) {
      return { ok: false, error: "missing_arguments" };
    }
    try {
      const response = await fetch(`${API_BASE}/extend-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, bookingRef, requestedCheckOut })
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error("[API] extend-booking feilet:", response.status, data);
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] extend-booking exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // customer-free-rooms — alle ledige rom kunden eier på tvers av properties
  // --------------------------------------------------------------------------

  async function getCustomerFreeRooms(token) {
    if (!token) return { ok: false, error: "missing_token" };
    try {
      const response = await fetch(`${API_BASE}/customer-free-rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] customer-free-rooms exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // end-booking — kunden ber admin avslutte / forkorte oppholdet
  // --------------------------------------------------------------------------

  async function requestEnd({ token, bookingRef, requestedCheckOut }) {
    if (!token || !bookingRef || !requestedCheckOut) {
      return { ok: false, error: "missing_arguments" };
    }
    try {
      const response = await fetch(`${API_BASE}/end-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, bookingRef, requestedCheckOut })
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error("[API] end-booking feilet:", response.status, data);
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] end-booking exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // --------------------------------------------------------------------------
  // invoice-archive — historiske opphold gruppert per måned
  // --------------------------------------------------------------------------

  async function getInvoiceArchive(token) {
    if (!token || typeof token !== "string") {
      return { ok: false, error: "missing_token" };
    }
    try {
      const response = await fetch(`${API_BASE}/invoice-archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error("[API] invoice-archive feilet:", response.status, data);
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] invoice-archive exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // v3.10.15: Sender dørkoden til gjesten på SMS via KeySMS-proxyen.
  // Backend slår opp telefon fra Persons-lista og sender bare hvis gjesten
  // finnes der med et registrert nummer.
  // v3.10.25: phoneOverride lar kalleren bypasse Persons-oppslaget og bruke
  // et eksplisitt nummer (f.eks. fra en redigerbar input i banner-modalen).
  async function sendDoorcodeSms({ token, bookingRef, phoneOverride }) {
    if (!token || !bookingRef) return { ok: false, error: "missing_arguments" };
    try {
      const payload = { token, bookingRef };
      if (phoneOverride) payload.phoneOverride = phoneOverride;
      const response = await fetch(`${API_BASE}/send-doorcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        return { ok: false, error: data.error || "http_error", status: response.status, detail: data.detail };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] send-doorcode exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // v3.10.24: Slå opp aktive/kommende bookinger på et romnummer for kundens
  // firma. Brukes av "Send dørkode"-knappen i banneret som tar inn romnr →
  // backend returnerer kandidatlistene med kode + telefonnr.
  async function lookupRoomBookings({ token, roomNumber }) {
    if (!token || !roomNumber) return { ok: false, error: "missing_arguments" };
    try {
      const response = await fetch(`${API_BASE}/lookup-room-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, roomNumber }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        return { ok: false, error: data.error || "http_error", status: response.status };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] lookup-room-bookings exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // v3.10.24: Send dørkode via SMS basert på bookingId + telefonnr (i stedet
  // for bookingRef + Persons-oppslag). Brukes etter lookupRoomBookings når
  // kunden har valgt gjest og bekreftet/justert telefonnr.
  async function sendDoorcodeByRoom({ token, bookingId, phone }) {
    if (!token || !bookingId || !phone) return { ok: false, error: "missing_arguments" };
    try {
      const response = await fetch(`${API_BASE}/send-doorcode-by-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, bookingId, phone }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
      if (!response.ok) {
        return { ok: false, error: data.error || "http_error", status: response.status, detail: data.detail };
      }
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[API] send-doorcode-by-room exception:", err);
      return { ok: false, error: "network_error" };
    }
  }

  // v3.10.11: Lett heartbeat — la admin se hvem som har portalen åpen.
  async function heartbeat(token) {
    if (!token || typeof token !== "string") return { ok: false };
    try {
      const response = await fetch(`${API_BASE}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      return await response.json().catch(() => ({ ok: false }));
    } catch (_err) {
      // Stille feil — heartbeat skal aldri forstyrre brukerflyten
      return { ok: false };
    }
  }

  window.Api = {
    validateToken,
    validatePin,
    getAvailability,
    clearAvailabilityCache,
    submitBooking,
    getMyBookings,
    getBookingPhones,
    getCustomerFreeRooms,
    requestExtension,
    requestEnd,
    getInvoiceArchive,
    sendDoorcodeSms,
    heartbeat
  };
})();
