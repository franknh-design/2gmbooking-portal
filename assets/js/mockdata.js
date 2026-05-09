/* =========================================================
   Mock-data — erstattes med Tilgjengelighets-API senere.
   Eksponert som globalt objekt: window.MockData
   v2.0 — bytter Drammen-mockdata med 2GM-lokasjoner.
   Token-validering er nå ekte (via window.Api), men kalender,
   tilgjengelighet, OTP og booking-innsending er fortsatt mock.
   ========================================================= */
(function () {
  "use strict";

  const LOCATIONS = [
    { id: "strandveien112", name: "Strandveien 112",  totalRooms: 12 },
    { id: "rigg24",         name: "Rigg 24",          totalRooms: 8  },
    { id: "rigg44",         name: "Rigg 44",          totalRooms: 8  },
    { id: "riggbotnhagen",  name: "Riggbotnhågen",    totalRooms: 6  },
    { id: "andslimoen",     name: "Andslimoen",       totalRooms: 10 }
  ];

  // Demo-kunde brukes kun når portalen åpnes uten ?token=
  // (utviklingsmodus). Ekte kundedata kommer fra Customer_Tokens
  // via window.Api.validateToken().
  const CUSTOMERS = {
    "demo": {
      id: "demo",
      name: "Demo-kunde",
      locations: ["strandveien112", "rigg24", "rigg44", "riggbotnhagen", "andslimoen"],
      maxRooms: 10
    }
  };

  /**
   * Deterministisk pseudo-tilfeldig tall basert på dato + lokasjon
   * (slik at samme dato alltid viser samme tall ved reload).
   */
  function seededInt(key, max) {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % (max + 1);
  }

  /**
   * Hent ledige rom for en gitt dato (Date) på en lokasjon.
   * Returnerer { available, total, level } hvor level ∈ "green"|"amber"|"red".
   */
  function getAvailability(locationId, date) {
    const loc = LOCATIONS.find(l => l.id === locationId);
    if (!loc) return { available: 0, total: 0, level: "red" };

    const key = `${locationId}|${date.toISOString().slice(0, 10)}`;
    let available = seededInt(key, loc.totalRooms);

    // Litt mer "realisme": helger er litt mindre ledig
    const day = date.getDay();
    if (day === 5 || day === 6) {
      available = Math.max(0, available - Math.ceil(loc.totalRooms * 0.2));
    }

    const ratio = loc.totalRooms === 0 ? 0 : available / loc.totalRooms;
    let level = "green";
    if (available === 0) level = "red";
    else if (ratio < 0.3) level = "amber";

    return { available, total: loc.totalRooms, level };
  }

  function getLocations() { return LOCATIONS.slice(); }
  function getLocation(id) { return LOCATIONS.find(l => l.id === id) || null; }

  function getCustomer(idRaw) {
    if (!idRaw) return null;
    const id = String(idRaw).toLowerCase();
    return CUSTOMERS[id] || null;
  }

  /**
   * Filtrer LOCATIONS basert på customer.locations-array.
   * Sammenligning er case-insensitive for robusthet mot SharePoint-data.
   */
  function getLocationsForCustomer(customer) {
    if (!customer || !customer.locations) return [];
    const allowed = customer.locations.map(s => String(s).toLowerCase());
    return LOCATIONS.filter(l => allowed.includes(l.id.toLowerCase()));
  }

  /**
   * Mock-validering av engangskode.
   * Godkjenner enhver 6-sifret kode, og logger en "fake" kode i konsollen.
   */
  function generateMockOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }
  function validateMockOtp(code) {
    return /^[0-9]{6}$/.test(String(code || "").trim());
  }

  /**
   * Mock-innsending av bestilling.
   */
  function submitBooking(payload) {
    return new Promise((resolve) => {
      // Simuler nettverk
      setTimeout(() => {
        const ref = "2GM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
        const customerName = payload.customerName || payload.customer || "Ukjent";

        // Hver gjest blir én SharePoint-rad. Referansen skrives både som
        // eget felt (Reference) og inn i Notes-kolonnen, slik at hver
        // rad er sporbar tilbake til samme bestilling både for filtre
        // og for menneskelig lesing.
        const sharepointRows = (payload.guests || []).map((g) => {
          const noteParts = [
            `Ref: ${ref}`,
            customerName,
            g.hasOwnDates ? "Avvikende datoer" : "Fellesperiode",
            g.openEnded ? "Open-ended (estimert " + (payload.estimatedDays || 90) + " d.)" : null
          ].filter(Boolean);

          return {
            Reference: ref,
            Customer: payload.customer,
            CustomerName: customerName,
            Location: payload.location,
            Guest: g.name,
            Check_In: g.from,
            Check_Out: g.openEnded ? null : g.to,
            Status: payload.status,
            Pending_Confirmation: payload.pendingConfirmation,
            Notes: noteParts.join(" · ")
          };
        });

        // eslint-disable-next-line no-console
        console.log(
          `[MOCK SHAREPOINT] Bestilling ${ref}: opprettet ${sharepointRows.length} rad(er)`,
          sharepointRows
        );

        // Simuler e-postvarsel til Frank.
        const headline = payload.warning
          ? "har KAPASITETSKONFLIKT — manuell bekreftelse kreves"
          : "venter på bekreftelse";

        const guestLines = sharepointRows.map((r, i) => {
          const period = r.Check_Out
            ? `${r.Check_In} → ${r.Check_Out}`
            : `${r.Check_In} → open-ended`;
          return `  · Rom ${i + 1} ${r.Guest}: ${period}\n    Notes: ${r.Notes}`;
        }).join("\n");

        // eslint-disable-next-line no-console
        console.warn(
          `[MOCK EMAIL → frankhaugan@gmail.com] Bestilling ${ref} ${headline}.`,
          "\nStatus: Upcoming · Pending_Confirmation: true" +
          (payload.hasMixedDates ? " · Blandede gjeste-datoer" : ""),
          "\nGjester:\n" + guestLines,
          payload.warning ? "\n" + payload.warning : "",
          "\nPayload:", payload
        );

        resolve({ ok: true, reference: ref, sharepointRows });
      }, 600);
    });
  }

  window.MockData = {
    getLocations,
    getLocation,
    getCustomer,
    getLocationsForCustomer,
    getAvailability,
    generateMockOtp,
    validateMockOtp,
    submitBooking
  };
})();
