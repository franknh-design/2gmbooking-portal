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

  const MONTHS_NB = [
    "januar", "februar", "mars", "april", "mai", "juni",
    "juli", "august", "september", "oktober", "november", "desember"
  ];

  // Når regner vi en dag som "få igjen" vs "ledig"?
  // Hvis < AMBER_THRESHOLD av totalen er ledig → gult.
  const AMBER_THRESHOLD = 0.30;

  // Garantert antall dager kunden skal se fremover fra dagens dato.
  // 35 dager = 5 hele uker.
  const MIN_DAYS_AHEAD = 35;

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
    isLoading: false,

    init({ locationId, onSelect }) {
      this.locationId = locationId;
      this.onSelect = onSelect;

      const today = new Date();
      this.viewYear  = today.getFullYear();
      this.viewMonth = today.getMonth();

      document.getElementById("cal-prev").addEventListener("click", () => this.shift(-1));
      document.getElementById("cal-next").addEventListener("click", () => this.shift(+1));

      this.renderAndLoad();
    },

    setLocation(locationId) {
      this.locationId = locationId;
      this.renderAndLoad();
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
        this.availabilityMap  = results[0]; // null ved feil, Map ved suksess
        this.availabilityMap2 = extra ? results[1] : null;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CAL] availability-feil:", err);
        this.availabilityMap  = null;
        this.availabilityMap2 = null;
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
    },

    /**
     * Rendrer én måned inn i (gridEl, monthLabelEl) basert på (year, month, map).
     * map er null/Map; følger samme konvensjon som this.availabilityMap.
     */
    _renderMonthBlock(grid, monthEl, year, month, map) {
      if (!grid || !monthEl) return;

      monthEl.textContent = `${MONTHS_NB[month]} ${year}`;
      grid.innerHTML = "";

      // Spinner-overlay mens vi laster
      if (this.isLoading) grid.classList.add("is-loading");
      else grid.classList.remove("is-loading");

      const firstOfMonth = new Date(year, month, 1);
      const daysInMonth  = new Date(year, month + 1, 0).getDate();

      // Mandag-først: JS 0=søn → vil ha søn=6
      const jsDow = firstOfMonth.getDay();
      const monBased = (jsDow + 6) % 7;

      for (let i = 0; i < monBased; i++) {
        const empty = document.createElement("div");
        empty.className = "cal-cell cal-cell-empty";
        grid.appendChild(empty);
      }

      const todayIso = isoOf(new Date());

      for (let d = 1; d <= daysInMonth; d++) {
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
              ? "Fullt"
              : `${avail.available} ledig`;
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

      return { available, total, level };
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

  window.Calendar = Calendar;
})();
