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
      this._refreshAvailabilityBadge();
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
      const locEl   = document.getElementById("f-location");
      const fromEl  = document.getElementById("f-from");
      const toEl    = document.getElementById("f-to");
      const roomsEl = document.getElementById("f-rooms");
      const minus   = document.getElementById("rooms-minus");
      const plus    = document.getElementById("rooms-plus");
      const form    = document.getElementById("booking-form");

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

      if (a.level === "red") badge.textContent = "Fullt";
      else if (a.level === "amber") badge.textContent = `Få igjen (${a.available})`;
      else badge.textContent = `${a.available} ledige`;
    },

    _collectGuestNames() {
      const inputs = document.querySelectorAll("#guests-list input[data-guest-idx]");
      return Array.from(inputs).map((inp) => inp.value.trim());
    },

    _submit() {
      const msg = document.getElementById("form-message");
      msg.hidden = true;
      msg.classList.remove("is-ok", "is-error");

      const locId  = this.getSelectedLocationId();
      const from   = document.getElementById("f-from").value;
      const to     = document.getElementById("f-to").value;
      const rooms  = this._getRooms();
      const guests = this._collectGuestNames();

      if (!locId)  return this._showMsg("Velg lokasjon.", "error");
      if (!from)   return this._showMsg("Velg fra-dato.", "error");
      if (!to)     return this._showMsg("Velg til-dato.", "error");
      if (to < from) return this._showMsg("Til-dato må være etter fra-dato.", "error");
      if (guests.some((g) => !g)) return this._showMsg("Fyll inn navn for alle rom.", "error");

      // Sjekk tilgjengelighet på fra-dato
      const a = window.MockData.getAvailability(locId, new Date(from));
      if (a.available < rooms) {
        return this._showMsg(
          `Ikke nok ledige rom (${a.available} tilgjengelig, ${rooms} ønsket).`,
          "error"
        );
      }

      const payload = {
        customer: this.customer.id,
        location: locId,
        from, to, rooms,
        guests
      };

      const submitBtn = document.getElementById("submit-btn");
      submitBtn.disabled = true;
      submitBtn.textContent = "Sender…";

      window.MockData.submitBooking(payload).then((res) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send bestilling";
        if (res.ok) {
          this._showMsg(
            `Bestilling mottatt. Referanse: ${res.reference}`,
            "ok"
          );
          document.getElementById("booking-form").reset();
          document.getElementById("f-rooms").value = "1";
          this._renderGuests(1);
          this._refreshAvailabilityBadge();
        } else {
          this._showMsg("Noe gikk galt. Prøv igjen.", "error");
        }
      });
    },

    _showMsg(text, kind) {
      const msg = document.getElementById("form-message");
      msg.textContent = text;
      msg.classList.remove("is-ok", "is-error");
      msg.classList.add(kind === "ok" ? "is-ok" : "is-error");
      msg.hidden = false;
    }
  };

  window.Booking = Booking;
})();
