/* =========================================================
   Bestillingsskjema.
   - Lokasjonsdropdown (begrenset av kunde)
   - Fra/til-dato
   - Rom-teller med +/-
   - Dynamiske gjeste-felt (ett per rom)
   - Tilgjengelighets-badge
   - Mock submit
   ========================================================= */
(function () {
  "use strict";

  const Booking = {
    customer: null,
    onLocationChange: null,
    onDateChange: null,

    init({ customer, onLocationChange, onDateChange }) {
      this.customer = customer;
      this.onLocationChange = onLocationChange;
      this.onDateChange = onDateChange;

      this._populateLocations();
      this._wireUp();
      this._renderGuests(this._getRooms());
      this._setMinDates();
      this._applyOpenEndedState();
      this._refreshAvailabilityBadge();
    },

    OPEN_ENDED_DAYS: 90,

    isOpenEnded() {
      const cb = document.getElementById("f-open-ended");
      return !!(cb && cb.checked);
    },

    _applyOpenEndedState() {
      const open = this.isOpenEnded();
      const toEl = document.getElementById("f-to");
      toEl.disabled = open;
      if (open) toEl.value = "";
    },

    _populateLocations() {
      const sel = document.getElementById("f-location");
      sel.innerHTML = "";

      const locations = window.MockData.getLocationsForCustomer(this.customer);
      if (locations.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Ingen lokasjoner tilgjengelig";
        sel.appendChild(opt);
        sel.disabled = true;
        return;
      }

      for (const loc of locations) {
        const opt = document.createElement("option");
        opt.value = loc.id;
        opt.textContent = loc.name;
        sel.appendChild(opt);
      }
    },

    getSelectedLocationId() {
      return document.getElementById("f-location").value || null;
    },

    setDateRange(fromIso, toIso) {
      const fromEl = document.getElementById("f-from");
      const toEl   = document.getElementById("f-to");
      if (fromIso) fromEl.value = fromIso;
      if (toIso)   toEl.value   = toIso;
      this._refreshAvailabilityBadge();
    },

    _wireUp() {
      const locEl    = document.getElementById("f-location");
      const fromEl   = document.getElementById("f-from");
      const toEl     = document.getElementById("f-to");
      const roomsEl  = document.getElementById("f-rooms");
      const minus    = document.getElementById("rooms-minus");
      const plus     = document.getElementById("rooms-plus");
      const form     = document.getElementById("booking-form");
      const openEnd  = document.getElementById("f-open-ended");

      openEnd.addEventListener("change", () => {
        this._applyOpenEndedState();
        this._refreshAvailabilityBadge();
      });

      locEl.addEventListener("change", () => {
        if (typeof this.onLocationChange === "function") {
          this.onLocationChange(locEl.value);
        }
        this._refreshAvailabilityBadge();
      });

      fromEl.addEventListener("change", () => {
        // Hold til-dato >= fra-dato
        if (toEl.value && toEl.value < fromEl.value) {
          toEl.value = fromEl.value;
        }
        toEl.min = fromEl.value || "";
        this._refreshAvailabilityBadge();
        if (typeof this.onDateChange === "function") {
          this.onDateChange(fromEl.value);
        }
      });

      toEl.addEventListener("change", () => {
        this._refreshAvailabilityBadge();
      });

      minus.addEventListener("click", () => this._stepRooms(-1));
      plus.addEventListener("click",  () => this._stepRooms(+1));
      roomsEl.addEventListener("change", () => {
        const n = this._clampRooms(parseInt(roomsEl.value, 10) || 1);
        roomsEl.value = String(n);
        this._renderGuests(n);
      });

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this._submit();
      });
    },

    _setMinDates() {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      document.getElementById("f-from").min = iso;
      document.getElementById("f-to").min = iso;
    },

    _stepRooms(delta) {
      const el = document.getElementById("f-rooms");
      const next = this._clampRooms((parseInt(el.value, 10) || 1) + delta);
      el.value = String(next);
      this._renderGuests(next);
    },

    _clampRooms(n) {
      if (isNaN(n)) n = 1;
      return Math.max(1, Math.min(20, n));
    },

    _getRooms() {
      return this._clampRooms(parseInt(document.getElementById("f-rooms").value, 10) || 1);
    },

    _renderGuests(count) {
      const list = document.getElementById("guests-list");
      const existing = {};
      list.querySelectorAll("input[data-guest-idx]").forEach((inp) => {
        existing[inp.dataset.guestIdx] = inp.value;
      });

      list.innerHTML = "";
      for (let i = 1; i <= count; i++) {
        const row = document.createElement("div");
        row.className = "guest-row";

        const label = document.createElement("span");
        label.className = "guest-num";
        label.textContent = `Rom ${i}`;

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Navn på gjest";
        input.dataset.guestIdx = String(i);
        input.value = existing[String(i)] || "";
        input.required = true;

        row.appendChild(label);
        row.appendChild(input);
        list.appendChild(row);
      }
    },

    _refreshAvailabilityBadge() {
      const badge = document.getElementById("avail-badge");
      const locId  = this.getSelectedLocationId();
      const fromEl = document.getElementById("f-from");

      badge.classList.remove("lvl-green", "lvl-amber", "lvl-red");

      if (!locId || !fromEl.value) {
        badge.textContent = "Velg dato";
        return;
      }

      const date = new Date(fromEl.value);
      const a = window.MockData.getAvailability(locId, date);
      badge.classList.add(`lvl-${a.level}`);

      const suffix = this.isOpenEnded()
        ? ` · estimert ${this.OPEN_ENDED_DAYS} dager`
        : "";

      if (a.level === "red") badge.textContent = "Fullt" + suffix;
      else if (a.level === "amber") badge.textContent = `Få igjen (${a.available})` + suffix;
      else badge.textContent = `${a.available} ledige` + suffix;
    },

    _collectGuestNames() {
      const inputs = document.querySelectorAll("#guests-list input[data-guest-idx]");
      return Array.from(inputs).map((inp) => inp.value.trim());
    },

    /**
     * Itererer alle datoer fra fromIso til toIso (inkl. begge ender) og
     * returnerer en liste { date, available, missing } for dager med
     * mangel, sortert kronologisk.
     */
    _collectShortfalls(locationId, fromIso, toIso, rooms) {
      const start = parseIsoLocal(fromIso);
      const end   = parseIsoLocal(toIso);
      const out = [];

      for (let d = new Date(start); d <= end; d = addDaysDate(d, 1)) {
        const a = window.MockData.getAvailability(locationId, d);
        if (a.available < rooms) {
          out.push({
            date: isoLocal(d),
            available: a.available,
            missing: rooms - a.available
          });
        }
      }
      return out;
    },

    _submit() {
      const msg = document.getElementById("form-message");
      msg.hidden = true;
      msg.classList.remove("is-ok", "is-error");

      const locId    = this.getSelectedLocationId();
      const from     = document.getElementById("f-from").value;
      const toRaw    = document.getElementById("f-to").value;
      const openEnd  = this.isOpenEnded();
      const to       = openEnd ? null : (toRaw || null);
      const rooms    = this._getRooms();
      const guests   = this._collectGuestNames();

      if (!locId) return this._showMsg("Velg lokasjon.", "error");
      if (!from)  return this._showMsg("Velg fra-dato.", "error");
      if (!openEnd && !to) {
        return this._showMsg(
          "Velg til-dato, eller huk av for «Vet ikke utflyttingsdato».",
          "error"
        );
      }
      if (to && to < from) {
        return this._showMsg("Til-dato må være etter fra-dato.", "error");
      }
      if (guests.some((g) => !g)) {
        return this._showMsg("Fyll inn navn for alle rom.", "error");
      }

      // Sjekk tilgjengelighet for ALLE dager i perioden. Ved open-ended brukes
      // 90 dager frem som estimert periode. Bestillingen blokkeres ikke ved
      // mangel — i stedet bygges en advarsel som vises til kunden og som
      // sendes med i e-postvarselet til Frank.
      const periodEndIso = openEnd
        ? addDaysIso(from, this.OPEN_ENDED_DAYS - 1)
        : to;
      const shortfalls = this._collectShortfalls(locId, from, periodEndIso, rooms);
      const warning = shortfalls.length
        ? buildWarningMessage(shortfalls, rooms)
        : null;

      // Alle bestillinger opprettes som Upcoming + Pending_Confirmation i
      // SharePoint, uavhengig av kapasitet. Frank løser konflikter manuelt
      // ved bekreftelse. Advarselen er rent informasjonell.
      const payload = {
        customer: this.customer.id,
        location: locId,
        from,
        to,                           // null ved open-ended → Check_Out = null i SharePoint
        openEnded: openEnd,
        estimatedDays: openEnd ? this.OPEN_ENDED_DAYS : null,
        rooms,
        guests,
        status: "Upcoming",           // SharePoint: Status
        pendingConfirmation: true,    // SharePoint: Pending_Confirmation
        shortfalls,                   // [{ date: "YYYY-MM-DD", available, missing }]
        warning                       // ferdig formatert tekst eller null
      };

      const submitBtn = document.getElementById("submit-btn");
      submitBtn.disabled = true;
      submitBtn.textContent = "Sender…";

      window.MockData.submitBooking(payload).then((res) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send bestilling";
        if (res.ok) {
          this._showConfirmation(res.reference, payload.warning);
          document.getElementById("booking-form").reset();
          document.getElementById("f-rooms").value = "1";
          this._renderGuests(1);
          this._applyOpenEndedState();
          this._refreshAvailabilityBadge();
        } else {
          this._showMsg("Noe gikk galt. Prøv igjen.", "error");
        }
      });
    },

    _showMsg(text, kind) {
      const msg = document.getElementById("form-message");
      msg.textContent = text;
      msg.classList.remove("is-ok", "is-error", "has-warning");
      msg.classList.add(kind === "ok" ? "is-ok" : "is-error");
      msg.hidden = false;
    },

    _showConfirmation(reference, warning) {
      const msg = document.getElementById("form-message");
      msg.classList.remove("is-ok", "is-error", "has-warning");
      msg.classList.add("is-ok");
      msg.innerHTML = "";

      const head = document.createElement("strong");
      head.textContent = `Bestilling mottatt. Referanse: ${reference}`;
      msg.appendChild(head);

      const sub = document.createElement("p");
      sub.className = "form-submsg";
      sub.textContent = "Avventer bekreftelse fra 2GM Eiendom.";
      msg.appendChild(sub);

      if (warning) {
        msg.classList.add("has-warning");
        const warn = document.createElement("p");
        warn.className = "form-warning";
        warn.textContent = warning;
        msg.appendChild(warn);
      }

      msg.hidden = false;
    }
  };

  // ---------- date- og tekst-hjelpere ----------

  function parseIsoLocal(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function isoLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDaysDate(date, n) {
    const out = new Date(date);
    out.setDate(out.getDate() + n);
    return out;
  }

  function addDaysIso(iso, n) {
    return isoLocal(addDaysDate(parseIsoLocal(iso), n));
  }

  function formatDdMm(iso) {
    return iso.slice(8, 10) + "." + iso.slice(5, 7);
  }

  function joinNo(items) {
    if (items.length <= 1) return items.join("");
    if (items.length === 2) return items.join(" og ");
    return items.slice(0, -1).join(", ") + " og " + items[items.length - 1];
  }

  /**
   * Bygger advarselsteksten. Grupperer datoer som har samme antall
   * ledige rom, slik at "15.06 og 16.06 har bare 4 ledige rom" kan
   * stå som én setning.
   */
  function buildWarningMessage(shortfalls, rooms) {
    const groups = new Map(); // available → [iso, iso, ...]
    for (const s of shortfalls) {
      if (!groups.has(s.available)) groups.set(s.available, []);
      groups.get(s.available).push(s.date);
    }

    const sortedAvail = Array.from(groups.keys()).sort((a, b) => a - b);
    const sentences = sortedAvail.map((avail) => {
      const dates = groups.get(avail).map(formatDdMm);
      return `${joinNo(dates)} har bare ${avail} ledige rom — du har bestilt ${rooms}.`;
    });

    return "Obs: " + sentences.join(" ") + " 2GM vil kontakte deg.";
  }

  window.Booking = Booking;
})();
