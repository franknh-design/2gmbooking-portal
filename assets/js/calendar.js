/* =========================================================
   Kalender-komponent.
   v2.3
   - Henter ledighet pr. dato fra ekte API (window.Api.getAvailability)
   - Viser spinner mens data lastes
   - Skjuler datoer som er passert (rendres som tomme celler)
   - Deaktiverer «forrige måned»-knappen når man står på inneværende måned
   - v2.3: Auto-utvider med neste måned når dagens måned har < 4 hele uker
     igjen, så kunden alltid ser minst 28 dager fremover.
   ========================================================= */
(function () {
  "use strict";

  // Når regner vi en dag som "få igjen" vs "ledig"?
  // Hvis < AMBER_THRESHOLD av totalen er ledig → gult.
  const AMBER_THRESHOLD = 0.30;

  function months() {
    return (window.I18n && window.I18n.t("months.long")) || [
      "januar","februar","mars","april","mai","juni",
      "juli","august","september","oktober","november","desember"
    ];
  }
  function weekdays() {
    return (window.I18n && window.I18n.t("weekdays.short")) || [
      "Man","Tir","Ons","Tor","Fre","Lør","Søn"
    ];
  }
  function tx(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  // Garantert antall dager kunden skal se fremover fra dagens dato.
  // 0 = auto-utvidelse av (måned + neste måned) er av; kunden ser kun
  // inneværende måned og navigerer selv med > når de trenger neste.
  const MIN_DAYS_AHEAD = 0;

  const Calendar = {
    locationId: null,
    viewYear:  null,
    viewMonth: null, // 0-indeksert
    rangeFrom: null,
    rangeTo:   null,
    onSelect:  null,

    // availabilityMap: Map<isoDate, { available, occupied, totalActive }>
    availabilityMap:  null,
    availabilityMap2: null, // for auto-utvidet neste måned
    // pricing: { rate, rateSource, checkoutFee, checkoutFee1, vatPercent } eller
    // null — flat pris for kundens firma på valgt lokasjon (samme for hele
    // måneden). checkoutFee1 = utvask-sats ved 1-natt-opphold (evt. rabattert).
    pricing: null,
    isLoading: false,

    init({ locationId, onSelect }) {
      this.locationId = locationId;
      this.onSelect = onSelect;

      const today = new Date();
      this.viewYear  = today.getFullYear();
      this.viewMonth = today.getMonth();

      document.getElementById("cal-prev").addEventListener("click", () => this.shift(-1));
      document.getElementById("cal-next").addEventListener("click", () => this.shift(+1));

      this._updateTitleSub();
      this.renderAndLoad();
    },

    setLocation(locationId) {
      this.locationId = locationId;
      this._updateTitleSub();
      this.renderAndLoad();
    },

    // v3.12.18: Vis valgt lokasjon i panel-tittelen ("Tilgjengelighet — Aspeveien 2")
    // så kunden ser hvilken lokasjon kalenderen gjelder uten å lese dropdownen.
    _updateTitleSub() {
      const el = document.getElementById("cal-location-sub");
      if (!el) return;
      const loc = window.MockData && window.MockData.getLocation
        ? window.MockData.getLocation(this.locationId)
        : null;
      el.textContent = loc && loc.name ? ` — ${loc.name}` : "";
    },

    setRange(fromIso, toIso) {
      this.rangeFrom = fromIso || null;
      this.rangeTo   = toIso   || null;
      this.render(); // ren rendering, ingen ny henting
    },

    shift(deltaMonths) {
      let m = this.viewMonth + deltaMonths;
      let y = this.viewYear;
      while (m < 0)  { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }

      // Ikke tillat navigering bakover forbi inneværende måned
      const today = new Date();
      const minY = today.getFullYear();
      const minM = today.getMonth();
      if (y < minY || (y === minY && m < minM)) {
        return;
      }

      this.viewMonth = m;
      this.viewYear  = y;
      this.renderAndLoad();
    },

    /**
     * Hovedflyt: render umiddelbart med spinner, hent data, render igjen.
     */
    async renderAndLoad() {
      // Tøm tidligere data og marker som loading
      this.availabilityMap  = null;
      this.availabilityMap2 = null;
      this.pricing = null;
      this.isLoading = true;
      this.render();

      // Ingen lokasjon valgt → ingen henting
      if (!this.locationId) {
        this.isLoading = false;
        this.render();
        return;
      }

      try {
        const fetches = [
          window.Api.getAvailability(this.locationId, this.viewYear, this.viewMonth)
        ];
        const extra = this._needsExtraMonth() ? this._extraMonthYM() : null;
        if (extra) {
          fetches.push(window.Api.getAvailability(this.locationId, extra.year, extra.month));
        }
        const results = await Promise.all(fetches);
        // v3.13.x: getAvailability returnerer nå {byDate, pricing} (eller null).
        const res0 = results[0];
        this.availabilityMap  = res0 ? res0.byDate : null;
        this.availabilityMap2 = (extra && results[1]) ? results[1].byDate : null;
        this.pricing = res0 ? res0.pricing : null;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CAL] availability-feil:", err);
        this.availabilityMap  = null;
        this.availabilityMap2 = null;
        this.pricing = null;
      } finally {
        this.isLoading = false;
        this.render();
      }
    },

    render() {
      // Deaktiver forrige-knappen når vi står på inneværende måned —
      // brukeren skal ikke kunne navigere til måneder som er passert.
      const prevBtn = document.getElementById("cal-prev");
      if (prevBtn) {
        const today = new Date();
        const onCurrentMonth =
          this.viewYear === today.getFullYear() &&
          this.viewMonth === today.getMonth();
        prevBtn.disabled = onCurrentMonth;
      }

      // Primær måned
      this._renderMonthBlock(
        document.getElementById("cal-grid"),
        document.getElementById("cal-month"),
        this.viewYear,
        this.viewMonth,
        this.availabilityMap
      );

      // Auto-utvidelse: neste måned under hvis nødvendig
      const extraWrap = document.getElementById("cal-extra");
      if (this._needsExtraMonth()) {
        const e = this._extraMonthYM();
        if (extraWrap) extraWrap.hidden = false;
        this._renderMonthBlock(
          document.getElementById("cal-grid-2"),
          document.getElementById("cal-month-2"),
          e.year,
          e.month,
          this.availabilityMap2
        );
      } else if (extraWrap) {
        extraWrap.hidden = true;
      }

      this._renderPriceLine();
      this._notifyBookingPricing();
    },

    /**
     * Pris-linje over kalender-rutenettet: nattpris for kundens firma på
     * valgt lokasjon, eks. og inkl. 25 % mva. Skjules hvis pris mangler
     * (anonymt oppslag, ingen avtalt rate, eller API-feil).
     */
    _renderPriceLine() {
      const el = document.getElementById("cal-price");
      if (!el) return;

      const p = this.pricing;
      if (!p || !(p.rate > 0)) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }

      const ex  = Math.round(p.rate);
      const inc = Math.round(p.rate * 1.25);
      el.innerHTML =
        `<span class="cal-price-main">Pris: ${formatKr(ex)} kr/natt eks. mva `
        + `· ${formatKr(inc)} kr inkl. mva</span>`
        + `<span class="cal-price-note">Med forbehold om feil.</span>`;
      el.hidden = false;
    },

    /**
     * Etter hver kalender-render: be bestillingsskjemaet oppdatere sitt
     * pris-estimat. Prisen lastes asynkront sammen med availability, så uten
     * dette ville price-summary stå tom til neste rom/dato-endring.
     */
    _notifyBookingPricing() {
      if (window.Booking && typeof window.Booking._renderPriceSummary === "function") {
        window.Booking._renderPriceSummary();
      }
    },

    /**
     * Rendrer én måned inn i (gridEl, monthLabelEl) basert på (year, month, map).
     * map er null/Map; følger samme konvensjon som this.availabilityMap.
     */
    _renderMonthBlock(grid, monthEl, year, month, map) {
      if (!grid || !monthEl) return;

      const ms = months();
      // v3.5.6: badge ved siden av månedsnavn når vi henter kapasitet,
      // så det er tydelig at siden faktisk laster (ikke bare frosset UI).
      const loadingTxt = window.I18n ? window.I18n.t("calendar.loading") : "laster…";
      const loadingBadge = this.isLoading
        ? ` <span class="cal-loading-tag">${loadingTxt}</span>`
        : "";
      monthEl.innerHTML = `${ms[month]} ${year}${loadingBadge}`;
      grid.innerHTML = "";

      // v3.11.2: Fyll ukedags-headerne med en ekstra venstre-kolonne for
      // uke-nr-overskriften ("Uke"/"Wk"). Grid har nå 8 kolonner: uke + 7 dager.
      const wd = weekdays();
      const wkHdr = window.I18n ? window.I18n.t("calendar.weekColShort") : "Uke";
      const wdEl1 = document.getElementById("cal-weekdays");
      const wdEl2 = document.getElementById("cal-weekdays-2");
      if (wdEl1 && !wdEl1.dataset.lang) wdEl1.dataset.lang = "";
      [wdEl1, wdEl2].forEach(host => {
        if (!host) return;
        host.innerHTML = `<span class="cal-week-hdr">${wkHdr}</span>`
          + wd.map(d => `<span>${d}</span>`).join("");
      });

      // Spinner-overlay mens vi laster
      if (this.isLoading) grid.classList.add("is-loading");
      else grid.classList.remove("is-loading");

      const firstOfMonth = new Date(year, month, 1);
      const daysInMonth  = new Date(year, month + 1, 0).getDate();

      // Mandag-først: JS 0=søn → vil ha søn=6
      const jsDow = firstOfMonth.getDay();
      const monBased = (jsDow + 6) % 7;

      const todayIso = isoOf(new Date());
      const totalCells = monBased + daysInMonth;
      const totalRows  = Math.ceil(totalCells / 7);

      for (let row = 0; row < totalRows; row++) {
        // v3.11.2: ISO-uke-nummer beregnes fra mandagen i denne raden, så
        // tallet stemmer overens med standard norsk/europeisk ukekalender.
        const mondayDayNum = row * 7 - monBased + 1;
        const mondayDate = new Date(year, month, mondayDayNum);
        const weekNum = isoWeek(mondayDate);
        const wkCell = document.createElement("div");
        wkCell.className = "cal-week-num";
        wkCell.textContent = String(weekNum);
        grid.appendChild(wkCell);

        for (let col = 0; col < 7; col++) {
          const idx = row * 7 + col;
          const d = idx - monBased + 1;
          if (d < 1 || d > daysInMonth) {
            const empty = document.createElement("div");
            empty.className = "cal-cell cal-cell-empty";
            grid.appendChild(empty);
            continue;
          }
          const date = new Date(year, month, d);
          const iso  = isoOf(date);

          // Skjul datoer som er passert (men behold dagens dato)
          if (iso < todayIso) {
            const empty = document.createElement("div");
            empty.className = "cal-cell cal-cell-empty";
            grid.appendChild(empty);
            continue;
          }

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-cell";
        cell.dataset.date = iso;

        // Beregn nivå basert på loaded data
        const avail = this._availabilityForFromMap(iso, map);
        cell.classList.add(`lvl-${avail.level}`);

        if (iso === todayIso) cell.classList.add("is-today");

        if (this.rangeFrom && iso === this.rangeFrom) {
          cell.classList.add("is-range-from");
          cell.dataset.endpoint = (iso === this.rangeTo) ? "1 dag" : "Fra";
        }
        if (this.rangeTo && iso === this.rangeTo && iso !== this.rangeFrom) {
          cell.classList.add("is-range-to");
          cell.dataset.endpoint = "Til";
        }
        if (this.rangeFrom && this.rangeTo &&
            iso > this.rangeFrom && iso < this.rangeTo) {
          cell.classList.add("is-in-range");
        }

        const dateEl = document.createElement("span");
        dateEl.className = "cal-date";
        dateEl.textContent = String(d);

        const roomsEl = document.createElement("span");
        roomsEl.className = "cal-rooms";

        if (this.isLoading) {
          roomsEl.textContent = "…";
        } else if (!this.locationId) {
          roomsEl.textContent = "—";
        } else if (map === null) {
          // API-feil — vis dash, lvl-red
          roomsEl.textContent = "—";
        } else {
          roomsEl.textContent =
            avail.level === "red"
              ? tx("calendar.full")
              : tx("calendar.available", { n: avail.available });
          // v3.7.2: rom-navn vises nå i en egen seksjon UNDER kalenderen,
          // ikke i selve cellen. Tooltip beholder lista som hint.
          if (avail.freeRooms && avail.freeRooms.length) {
            roomsEl.title = avail.freeRooms.join(", ");
          }
        }

        cell.appendChild(dateEl);
        cell.appendChild(roomsEl);

        cell.addEventListener("click", () => {
          if (typeof this.onSelect === "function") {
            this.onSelect(iso, avail);
          }
        });

        grid.appendChild(cell);
        }
      }
    },

    /**
     * Returnerer { available, total, level } for en gitt isoDate.
     * Fallback hvis data ikke er lastet ennå eller feil.
     */
    _availabilityForFromMap(iso, map) {
      if (this.isLoading || !map) {
        return { available: 0, total: 0, level: "red" };
      }

      const entry = map.get(iso);
      if (!entry) {
        // Dato utenfor henteperioden — burde ikke skje for samme måned
        return { available: 0, total: 0, level: "red" };
      }

      const available = entry.available;
      const total = entry.totalActive;

      let level = "green";
      if (total === 0 || available === 0) {
        level = "red";
      } else if (available / total < AMBER_THRESHOLD) {
        level = "amber";
      }

      return { available, total, level, freeRooms: entry.freeRooms || null };
    },

    /**
     * Trenger vi å rendre neste måned også for å oppfylle MIN_DAYS_AHEAD?
     * Kun aktuelt når vi står på inneværende kalendermåned — etter at
     * kunden har navigert framover er garantien automatisk oppfylt.
     */
    _needsExtraMonth() {
      const today = new Date();
      const onCurrent =
        this.viewYear === today.getFullYear() &&
        this.viewMonth === today.getMonth();
      if (!onCurrent) return false;

      const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
      const daysRemaining = daysInMonth - today.getDate() + 1; // dagens dato teller med
      return daysRemaining < MIN_DAYS_AHEAD;
    },

    _extraMonthYM() {
      let y = this.viewYear;
      let m = this.viewMonth + 1;
      if (m > 11) { m = 0; y += 1; }
      return { year: y, month: m };
    }
  };

  function isoOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // nb-NO-formatert heltall (tusenskille), uten "kr"-suffiks — kalleren
  // legger på "kr". Speiler formatKr() i invoices.js.
  function formatKr(amount) {
    return Number(amount).toLocaleString("nb-NO");
  }

  // ISO-8601-ukenummer: torsdag i samme uke avgjør hvilket år uka tilhører.
  // Følger samme regel som de fleste europeiske kalendere (mandag-start).
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  // Re-rendre kalenderen ved språkendring (måneder + ukedager + tekst-celler)
  document.addEventListener("i18n:change", () => {
    if (typeof Calendar.render === "function") Calendar.render();
  });

  window.Calendar = Calendar;
})();
