/* =========================================================
   Mock-data — erstattes med Tilgjengelighets-API senere.
   Eksponert som globalt objekt: window.MockData
   ========================================================= */
(function () {
  "use strict";

  const LOCATIONS = [
    { id: "drammen-sentrum",   name: "Drammen Sentrum",  totalRooms: 14 },
    { id: "drammen-bragernes", name: "Drammen Bragernes", totalRooms: 8 },
    { id: "kongsberg",         name: "Kongsberg",         totalRooms: 10 },
    { id: "horten",            name: "Horten",            totalRooms: 6 }
  ];

  // Kunder — lookup by ?kunde=<id>
  const CUSTOMERS = {
    "norconsult":   { id: "norconsult",   name: "Norconsult AS",        locations: ["drammen-sentrum", "drammen-bragernes", "kongsberg"] },
    "veidekke":     { id: "veidekke",     name: "Veidekke Entreprenør", locations: ["drammen-sentrum", "horten"] },
    "skanska":      { id: "skanska",      name: "Skanska Norge AS",     locations: ["kongsberg", "horten", "drammen-bragernes"] },
    "demo":         { id: "demo",         name: "Demo-kunde",           locations: ["drammen-sentrum", "drammen-bragernes", "kongsberg", "horten"] }
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

  function getLocationsForCustomer(customer) {
    if (!customer) return [];
    return LOCATIONS.filter(l => customer.locations.includes(l.id));
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
        // eslint-disable-next-line no-console
        console.log("[MOCK] Bestilling sendt:", payload, "→ ref", ref);

        // Simuler e-postvarsel til Frank. Når ekte API kommer på plass
        // skal denne advarselen ligge i e-post-bodyen så han kan ta
        // kontakt med kunden ved kapasitetsmangel.
        if (payload.warning) {
          // eslint-disable-next-line no-console
          console.warn(
            "[MOCK EMAIL → frankhaugan@gmail.com] Bestilling " + ref +
            " har kapasitetsmangel:\n" + payload.warning +
            "\nDetaljer:", payload.shortfalls
          );
        }

        resolve({ ok: true, reference: ref });
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
