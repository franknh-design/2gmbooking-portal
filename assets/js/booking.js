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

    _emitDateChange() {
      this._refreshGuestSummaries();
      if (typeof this.onDateChange === "function") {
        this.onDateChange(this.getDateRange());
      }
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

    /**
     * Sett dato-feltene programmatisk.
     * Pass undefined for å la et felt være urørt; "" eller null for å tømme.
     */
    setDateRange(fromIso, toIso) {
      const fromEl = document.getElementById("f-from");
      const toEl   = document.getElementById("f-to");
      if (fromIso !== undefined) fromEl.value = fromIso || "";
      if (toIso   !== undefined) toEl.value   = toIso   || "";
      // Hold til-dato sin min-attributt i synk slik at manuell redigering oppfører seg likt
      toEl.min = fromEl.value || "";
      this._refreshAvailabilityBadge();
      this._refreshGuestSummaries();
    },

    getDateRange() {
      return {
        from: document.getElementById("f-from").value || null,
        to:   document.getElementById("f-to").value || null
      };
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
        this._emitDateChange();
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
        this._emitDateChange();
      });

      toEl.addEventListener("change", () => {
        this._refreshAvailabilityBadge();
        this._emitDateChange();
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

      // Behold tidligere data per gjest når antallet endrer seg
      const existing = {};
      list.querySelectorAll(".guest-row").forEach((row) => {
        const idx = row.dataset.guestIdx;
        existing[idx] = {
          name: row.querySelector("[data-field='name']").value,
          from: row.querySelector("[data-field='from']").value,
          to: row.querySelector("[data-field='to']").value,
          openEnded: row.querySelector("[data-field='openEnded']").checked,
          expanded: row.classList.contains("is-expanded")
        };
      });

      list.innerHTML = "";
      for (let i = 1; i <= count; i++) {
        list.appendChild(this._buildGuestRow(i, existing[String(i)] || {}));
      }
      this._refreshGuestSummaries();
    },

    _buildGuestRow(idx, prev) {
      const row = document.createElement("div");
      row.className = "guest-row";
      row.dataset.guestIdx = String(idx);

      // hasOwn er rent avledet av om noen av feltene har verdi.
      // expanded er en separat visuell tilstand — panelet kan være kollapset
      // selv om gjesten har egne datoer, så det blir mer oversiktlig.
      const hasOwn = !!(prev.from || prev.to || prev.openEnded);
      // Default: utvid hvis vi rendrer på nytt og brukeren tidligere
      // hadde panelet åpent; eller hvis det er første gang og det
      // allerede ligger verdier inne.
      const expanded = prev.expanded ?? hasOwn;
      if (hasOwn) row.classList.add("has-own-dates");
      if (expanded) row.classList.add("is-expanded");

      // Hovedlinje: nummer + navn + toggle
      const main = document.createElement("div");
      main.className = "guest-row-main";

      const numEl = document.createElement("span");
      numEl.className = "guest-num";
      numEl.textContent = `Rom ${idx}`;

      const nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.placeholder = "Navn på gjest";
      nameEl.dataset.field = "name";
      nameEl.value = prev.name || "";
      nameEl.required = true;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "guest-toggle";

      main.append(numEl, nameEl, toggle);

      // Sammendrag (vises når panelet er kollapset)
      const summary = document.createElement("p");
      summary.className = "guest-summary";
      summary.dataset.role = "summary";

      // Datopanel
      const dates = document.createElement("div");
      dates.className = "guest-dates";
      dates.hidden = !expanded;

      const fromLabel = document.createElement("label");
      fromLabel.className = "field";
      fromLabel.innerHTML = '<span class="field-label">Fra dato</span>';
      const fromInp = document.createElement("input");
      fromInp.type = "date";
      fromInp.dataset.field = "from";
      fromInp.value = prev.from || "";
      fromLabel.appendChild(fromInp);

      const toLabel = document.createElement("label");
      toLabel.className = "field";
      toLabel.innerHTML = '<span class="field-label">Til dato</span>';
      const toInp = document.createElement("input");
      toInp.type = "date";
      toInp.dataset.field = "to";
      toInp.value = prev.to || "";
      toLabel.appendChild(toInp);

      const openLabel = document.createElement("label");
      openLabel.className = "checkbox";
      const openInp = document.createElement("input");
      openInp.type = "checkbox";
      openInp.dataset.field = "openEnded";
      openInp.checked = !!prev.openEnded;
      const openText = document.createElement("span");
      openText.textContent = "Vet ikke utflyttingsdato";
      openLabel.append(openInp, openText);

      // "Bruk fellesperioden i stedet" — eksplisitt vei tilbake til
      // standardperioden. Vises bare når gjesten faktisk har egne
      // datoer (toggles via has-own-dates-klassen).
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "guest-reset";
      reset.textContent = "← Bruk fellesperioden i stedet";

      dates.append(fromLabel, toLabel, openLabel, reset);

      // Wiring: toggle = ren expand/collapse, ingen sletting av verdier
      toggle.addEventListener("click", () => {
        const exp = !row.classList.contains("is-expanded");
        row.classList.toggle("is-expanded", exp);
        dates.hidden = !exp;
        this._updateGuestRowVisual(row);
      });

      reset.addEventListener("click", () => {
        fromInp.value = "";
        toInp.value = "";
        openInp.checked = false;
        toInp.disabled = false;
        // Kollaps automatisk siden det ikke er noe å vise lenger
        row.classList.remove("is-expanded");
        dates.hidden = true;
        this._updateGuestRowVisual(row);
        this._refreshGuestSummaries();
      });

      const refresh = () => {
        this._applyGuestOpenEnded(row);
        this._updateGuestRowVisual(row);
        this._refreshGuestSummaries();
      };
      fromInp.addEventListener("change", () => {
        if (toInp.value && toInp.value < fromInp.value) toInp.value = fromInp.value;
        toInp.min = fromInp.value || "";
        refresh();
      });
      toInp.addEventListener("change", refresh);
      openInp.addEventListener("change", refresh);

      row.append(main, summary, dates);
      this._applyGuestOpenEnded(row);
      this._updateGuestRowVisual(row);
      return row;
    },

    /**
     * Synkroniserer toggle-knappens tekst og has-own-dates-klassen ut
     * fra om feltene har verdi (semantisk) og om panelet er åpent
     * (visuelt). Skiller bevisst de to dimensjonene.
     */
    _updateGuestRowVisual(row) {
      const fromInp = row.querySelector("[data-field='from']");
      const toInp   = row.querySelector("[data-field='to']");
      const openInp = row.querySelector("[data-field='openEnded']");
      const toggle  = row.querySelector(".guest-toggle");

      const hasOwn   = !!(fromInp.value || toInp.value || openInp.checked);
      const expanded = row.classList.contains("is-expanded");
      row.classList.toggle("has-own-dates", hasOwn);

      const label = hasOwn ? "Egne datoer" : "Avvikende datoer";
      const arrow = expanded ? "▴" : "▾";
      toggle.textContent = `${label} ${arrow}`;
    },

    _applyGuestOpenEnded(row) {
      const openInp = row.querySelector("[data-field='openEnded']");
      const toInp = row.querySelector("[data-field='to']");
      toInp.disabled = openInp.checked;
      if (openInp.checked) toInp.value = "";
    },

    _refreshGuestSummaries() {
      const { from: topFrom, to: topTo } = this.getDateRange();
      const topOpen = this.isOpenEnded();
      document.querySelectorAll("#guests-list .guest-row").forEach((row) => {
        const sum = row.querySelector("[data-role='summary']");
        const period = this._effectivePeriodForRow(row, topFrom, topTo, topOpen);

        if (period.hasOwn) {
          sum.classList.add("is-custom");
          sum.textContent = "Egne datoer: " + this._formatPeriodNo(period);
        } else {
          sum.classList.remove("is-custom");
          sum.textContent = topFrom
            ? "Bruker fellesperioden: " + this._formatPeriodNo(period)
            : "Bruker fellesperioden (ikke valgt enda).";
        }
      });
    },

    _effectivePeriodForRow(row, topFrom, topTo, topOpen) {
      const fromInp = row.querySelector("[data-field='from']");
      const toInp   = row.querySelector("[data-field='to']");
      const openInp = row.querySelector("[data-field='openEnded']");
      // hasOwn er rent avledet fra om feltene har verdi — uavhengig av
      // om panelet er åpent eller ikke.
      const hasOwn = !!(fromInp.value || toInp.value || openInp.checked);

      if (hasOwn) {
        return {
          hasOwn: true,
          from: fromInp.value || null,
          to: openInp.checked ? null : (toInp.value || null),
          openEnded: openInp.checked
        };
      }
      return {
        hasOwn: false,
        from: topFrom || null,
        to: topOpen ? null : (topTo || null),
        openEnded: topOpen
      };
    },

    _formatPeriodNo(period) {
      if (!period.from) return "ikke valgt";
      const fromStr = formatDdMm(period.from);
      if (period.openEnded) return `${fromStr} → open-ended (${this.OPEN_ENDED_DAYS} d.)`;
      if (!period.to) return `${fromStr} →`;
      return `${fromStr} – ${formatDdMm(period.to)}`;
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

    /**
     * Samler gjester med faktisk navn + effektiv periode (faller tilbake
     * til fellesperioden hvis gjesten ikke har egne datoer).
     */
    _collectGuests(topFrom, topTo, topOpen) {
      const rows = document.querySelectorAll("#guests-list .guest-row");
      return Array.from(rows).map((row, i) => {
        const period = this._effectivePeriodForRow(row, topFrom, topTo, topOpen);
        const name = row.querySelector("[data-field='name']").value.trim();
        return {
          index: i + 1,
          name,
          from: period.from,
          to: period.to,
          openEnded: period.openEnded,
          hasOwnDates: period.hasOwn
        };
      });
    },

    /**
     * Sjekk per-dag etterspørsel mot tilgjengelig kapasitet. For hver dag
     * i unionen av alle gjesters perioder telles antall gjester på huset
     * den dagen. Hvis tallet overstiger ledige rom, registreres mangel.
     * Open-ended-perioder iterereres 90 dager frem.
     */
    _collectShortfalls(locationId, guests) {
      if (!guests.length) return [];
      const periods = guests.map((g) => ({
        from: g.from,
        end:  g.to || addDaysIso(g.from, this.OPEN_ENDED_DAYS - 1),
        guest: g
      }));

      let minFrom = periods[0].from;
      let maxEnd  = periods[0].end;
      for (const p of periods) {
        if (p.from < minFrom) minFrom = p.from;
        if (p.end  > maxEnd)  maxEnd  = p.end;
      }

      const out = [];
      for (let d = parseIsoLocal(minFrom); d <= parseIsoLocal(maxEnd); d = addDaysDate(d, 1)) {
        const iso = isoLocal(d);
        const onSite = periods.filter((p) => iso >= p.from && iso <= p.end);
        const needed = onSite.length;
        if (needed === 0) continue;

        const a = window.MockData.getAvailability(locationId, d);
        if (a.available < needed) {
          out.push({
            date: iso,
            available: a.available,
            needed,
            missing: needed - a.available,
            guests: onSite.map((p) => p.guest.name || `Rom ${p.guest.index}`)
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
      const topFrom  = document.getElementById("f-from").value;
      const topToRaw = document.getElementById("f-to").value;
      const topOpen  = this.isOpenEnded();
      const topTo    = topOpen ? null : (topToRaw || null);
      const rooms    = this._getRooms();
      const guests   = this._collectGuests(topFrom, topTo, topOpen);

      if (!locId) return this._showMsg("Velg lokasjon.", "error");

      if (guests.some((g) => !g.name)) {
        return this._showMsg("Fyll inn navn for alle rom.", "error");
      }

      // Hver gjest må ha en gyldig effektiv periode (egen eller felles)
      for (const g of guests) {
        if (!g.from) {
          const who = g.hasOwnDates ? `Rom ${g.index} («${g.name}»)` : "Fellesperioden";
          return this._showMsg(
            `${who} mangler fra-dato.`, "error"
          );
        }
        if (!g.openEnded && !g.to) {
          return this._showMsg(
            `Rom ${g.index} («${g.name}») mangler til-dato — eller huk av for «Vet ikke utflyttingsdato».`,
            "error"
          );
        }
        if (g.to && g.to < g.from) {
          return this._showMsg(
            `Rom ${g.index} («${g.name}»): til-dato må være etter fra-dato.`,
            "error"
          );
        }
      }

      // Sjekk tilgjengelighet per dag basert på hvor mange gjester som er
      // på huset hver dag. Bestillingen blokkeres ikke ved mangel — i
      // stedet bygges advarsel som vises til kunden og legges ved
      // e-postvarselet til Frank.
      const shortfalls = this._collectShortfalls(locId, guests);
      const warning = shortfalls.length
        ? buildWarningMessage(shortfalls)
        : null;

      // Alle bestillinger opprettes som Upcoming + Pending_Confirmation i
      // SharePoint, uavhengig av kapasitet. Frank løser konflikter manuelt
      // ved bekreftelse. Advarselen er rent informasjonell.
      const hasMixedDates = guests.some((g) => g.hasOwnDates);
      const payload = {
        customer: this.customer.id,
        location: locId,
        from: topFrom || null,        // fellesperioden, brukes som default for gjester uten egne datoer
        to: topTo,                    // null ved open-ended → Check_Out = null i SharePoint
        openEnded: topOpen,
        estimatedDays: (topOpen || guests.some((g) => g.openEnded))
          ? this.OPEN_ENDED_DAYS
          : null,
        rooms,
        guests,                       // [{ index, name, from, to, openEnded, hasOwnDates }]
        hasMixedDates,
        status: "Upcoming",           // SharePoint: Status
        pendingConfirmation: true,    // SharePoint: Pending_Confirmation
        shortfalls,                   // [{ date, available, needed, missing, guests:[names] }]
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
          // Tøm guests-list helt så ingen gamle navn/datoer arves over
          document.getElementById("guests-list").innerHTML = "";
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
   * Bygger advarselsteksten. Grupperer datoer som har samme (available,
   * needed)-kombinasjon, slik at sammenhengende dager med samme
   * kapasitetsbilde slås sammen til én setning.
   */
  function buildWarningMessage(shortfalls) {
    const groups = new Map(); // "avail|needed" → [iso, ...]
    for (const s of shortfalls) {
      const key = `${s.available}|${s.needed}`;
      if (!groups.has(key)) groups.set(key, { available: s.available, needed: s.needed, dates: [] });
      groups.get(key).dates.push(s.date);
    }

    const sentences = Array.from(groups.values())
      .sort((a, b) => a.available - b.available)
      .map((g) => {
        const dates = g.dates.map(formatDdMm);
        return `${joinNo(dates)} har bare ${g.available} ledige rom — du trenger ${g.needed}.`;
      });

    return "Obs: " + sentences.join(" ") + " 2GM vil kontakte deg.";
  }

  window.Booking = Booking;
})();
