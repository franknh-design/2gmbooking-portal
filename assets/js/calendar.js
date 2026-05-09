/* =========================================================
   Kalender-komponent.
   v2.1
   - Henter ledighet pr. dato fra ekte API (window.Api.getAvailability)
   - Viser spinner mens data lastes
   - Faller tilbake til mock hvis API-kall feiler (utviklerscenario)
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

  const Calendar = {
    locationId: null,
    viewYear:  null,
    viewMonth: null, // 0-indeksert
    rangeFrom: null,
    rangeTo:   null,
    onSelect:  null,

    // availabilityMap: Map<isoDate, { available, occupied, totalActive }>
    availabilityMap: null,
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
      this.viewMonth = m;
      this.viewYear  = y;
      this.renderAndLoad();
    },

    /**
     * Hovedflyt: render umiddelbart med spinner, hent data, render igjen.
     */
    async renderAndLoad() {
      // Tøm tidligere data og marker som loading
      this.availabilityMap = null;
      this.isLoading = true;
      this.render();

      // Ingen lokasjon valgt → ingen henting
      if (!this.locationId) {
        this.isLoading = false;
        this.render();
        return;
      }

      try {
        // window.Api.getAvailability har egen cache
        const data = await window.Api.getAvailability(
          this.locationId,
          this.viewYear,
          this.viewMonth
        );
        this.availabilityMap = data; // null ved feil, Map ved suksess
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CAL] availability-feil:", err);
        this.availabilityMap = null;
      } finally {
        this.isLoading = false;
        this.render();
      }
    },

    render() {
      const grid = document.getElementById("cal-grid");
      const monthEl = document.getElementById("cal-month");

      monthEl.textContent = `${MONTHS_NB[this.viewMonth]} ${this.viewYear}`;
      grid.innerHTML = "";

      // Vis spinner-overlay mens vi laster
      if (this.isLoading) {
        grid.classList.add("is-loading");
      } else {
        grid.classList.remove("is-loading");
      }

      const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
      const daysInMonth  = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();

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
        const date = new Date(this.viewYear, this.viewMonth, d);
        const iso  = isoOf(date);

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-cell";
        cell.dataset.date = iso;

        // Beregn nivå basert på loaded data
        const avail = this._availabilityFor(iso);
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
        } else if (this.availabilityMap === null) {
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
    _availabilityFor(iso) {
      if (this.isLoading || !this.availabilityMap) {
        return { available: 0, total: 0, level: "red" };
      }

      const entry = this.availabilityMap.get(iso);
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
