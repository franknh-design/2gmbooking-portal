/* =========================================================
   Bestillingsskjema.
   v3.1
   - Innsending kaller ekte /api/submit-booking
   - Overbooking-validering henter ekte tilgjengelighet via
     Api.getAvailability (fjernet siste MockData-avhengighet)
   - Etter vellykket innsending: lås portal, vis takk-skjerm
   - Generisk feilmelding ved feil (peker til telefonsupport)
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }

  const Booking = {
    customer: null,
    onLocationChange: null,
    onDateChange: null,

    init({ customer, preferredLocId, onLocationChange, onDateChange }) {
      this.customer = customer;
      this.preferredLocId = preferredLocId || null;
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
      // v3.9.1: hint kunden om å fylle inn navn når perioden er komplett.
      this._maybeNudgeEmptyGuestName();
    },

    // v3.9.1: når begge datoer er satt (eller fra+open-ended) og første gjest
    // mangler navn → auto-fokus + 2 raske amber pulses som visuell hint.
    // Stjeler ikke fokus hvis kunden er midt i å skrive et annet sted.
    // Re-nudger ikke samme felt innen 5 sek (unngår å mase ved små edits).
    _maybeNudgeEmptyGuestName() {
      const { from, to } = this.getDateRange();
      if (!from) return;
      const openEnded = this.isOpenEnded();
      if (!openEnded && !to) return;
      // Ikke avbryt aktiv input — med mindre fokus ER på datofeltene
      // (i så fall er datovalget akkurat fullført og navne-fokus er trygt).
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        if (active.id !== "f-from" && active.id !== "f-to") return;
      }
      const rows = document.querySelectorAll("#guests-list .guest-row");
      for (const row of rows) {
        const nameInp = row.querySelector("[data-field='name']");
        if (!nameInp || nameInp.value.trim()) continue;
        // Throttle: ikke re-nudg samme felt innenfor 5 sek
        const lastNudge = Number(nameInp.dataset.nudgedAt || 0);
        if (lastNudge && (Date.now() - lastNudge) < 5000) return;
        nameInp.dataset.nudgedAt = String(Date.now());
        nameInp.classList.add("name-nudge");
        nameInp.focus();
        setTimeout(() => nameInp.classList.remove("name-nudge"), 1200);
        return;
      }
    },

    _populateLocations() {
      const sel = document.getElementById("f-location");
      sel.innerHTML = "";

      const locations = window.MockData.getLocationsForCustomer(this.customer);
      if (locations.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = tx("booking.noLocations");
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
      // v3.8.7: sett foretrukket default (typisk Rigg 44, valgt i app.js).
      if (this.preferredLocId) {
        const match = locations.find(l => l.id === this.preferredLocId);
        if (match) sel.value = this.preferredLocId;
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
          phone: (row.querySelector("[data-field='phone']") || {}).value || "",
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
      numEl.textContent = tx("booking.guestRoom", { n: idx });

      // v3.14.0: navn + telefon stables vertikalt i et inputs-wrapper så
      // grid-strukturen (70 / 1fr / auto) holder seg uforandret.
      const inputs = document.createElement("div");
      inputs.className = "guest-inputs";

      const nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.placeholder = tx("booking.guestName");
      nameEl.dataset.field = "name";
      nameEl.value = prev.name || "";
      nameEl.required = true;

      const phoneEl = document.createElement("input");
      phoneEl.type = "tel";
      phoneEl.placeholder = tx("booking.guestPhone");
      phoneEl.dataset.field = "phone";
      phoneEl.value = prev.phone || "";
      phoneEl.autocomplete = "tel";
      phoneEl.inputMode = "tel";
      phoneEl.required = true;
      // Live-validering: marker .invalid mens kunden skriver så feilen er
      // synlig før submit. Sletter klassen så snart input igjen er gyldig
      // (eller tom — tom valideres ved submit).
      phoneEl.addEventListener("input", () => {
        const v = phoneEl.value.trim();
        if (!v) { phoneEl.classList.remove("invalid"); return; }
        phoneEl.classList.toggle("invalid", !isValidNoPhone(v));
      });
      phoneEl.addEventListener("blur", () => {
        const v = phoneEl.value.trim();
        phoneEl.classList.toggle("invalid", !!v && !isValidNoPhone(v));
      });

      inputs.append(nameEl, phoneEl);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "guest-toggle";

      main.append(numEl, inputs, toggle);

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
      fromLabel.innerHTML = `<span class="field-label">${tx("booking.from")}</span>`;
      const fromInp = document.createElement("input");
      fromInp.type = "date";
      fromInp.dataset.field = "from";
      fromInp.value = prev.from || "";
      fromLabel.appendChild(fromInp);

      const toLabel = document.createElement("label");
      toLabel.className = "field";
      toLabel.innerHTML = `<span class="field-label">${tx("booking.to")}</span>`;
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
      openText.textContent = tx("booking.dontKnowOut");
      openLabel.append(openInp, openText);

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "guest-reset";
      reset.textContent = tx("booking.useShared");

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

      const label = hasOwn ? tx("booking.tabOwn") : tx("booking.tabDeviating");
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
          sum.textContent = tx("booking.summaryOwn", { period: this._formatPeriodNo(period) });
        } else {
          sum.classList.remove("is-custom");
          sum.textContent = topFrom
            ? tx("booking.summaryShared", { period: this._formatPeriodNo(period) })
            : tx("booking.summaryNotPicked");
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
      if (!period.from) return tx("booking.periodNotPicked");
      const fromStr = formatDdMm(period.from);
      if (period.openEnded) return tx("booking.openPeriod", { from: fromStr, days: this.OPEN_ENDED_DAYS });
      if (!period.to) return tx("booking.fromOnly", { from: fromStr });
      return tx("booking.fullPeriod", { from: fromStr, to: formatDdMm(period.to) });
    },

    _refreshAvailabilityBadge() {
      const badge = document.getElementById("avail-badge");
      const locId  = this.getSelectedLocationId();
      const fromEl = document.getElementById("f-from");

      badge.classList.remove("lvl-green", "lvl-amber", "lvl-red");

      if (!locId || !fromEl.value) {
        badge.textContent = tx("booking.pickDate");
        return;
      }

      // Bruk samme cache som kalenderen via window.Api.getAvailability
      // Vi henter måneden valgt fra-dato ligger i, og slår opp eksakt dag.
      const date = new Date(fromEl.value);
      const year  = date.getFullYear();
      const month = date.getMonth();

      // Vis "Henter…" mens vi venter
      badge.textContent = tx("booking.fetching");

      window.Api.getAvailability(locId, year, month).then(map => {
        // Brukeren kan ha endret dato eller lokasjon mens vi ventet —
        // sjekk at vi fortsatt viser samme valg
        if (this.getSelectedLocationId() !== locId) return;
        if (fromEl.value !== isoLocal(date)) return;

        if (!map) {
          badge.textContent = tx("booking.unknown");
          return;
        }

        const entry = map.get(isoLocal(date)) || { available: 0, totalActive: 0 };
        const total = entry.totalActive;
        const available = entry.available;

        let level = "green";
        if (total === 0 || available === 0) level = "red";
        else if (available / total < 0.30) level = "amber";

        badge.classList.add(`lvl-${level}`);

        const suffix = this.isOpenEnded()
          ? tx("booking.openSuffix", { days: this.OPEN_ENDED_DAYS })
          : "";

        if (level === "red") badge.textContent = tx("booking.full") + suffix;
        else if (level === "amber") badge.textContent = tx("booking.fewLeft", { n: available }) + suffix;
        else badge.textContent = tx("booking.nFree", { n: available }) + suffix;
      }).catch(err => {
        // eslint-disable-next-line no-console
        console.error("[BOOKING] availability-feil:", err);
        badge.textContent = tx("booking.unknown");
      });
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
        const phoneRaw = (row.querySelector("[data-field='phone']") || {}).value || "";
        return {
          index: i + 1,
          name,
          phoneRaw: phoneRaw.trim(),
          phone: normalizeNoPhone(phoneRaw),
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
     *
     * Henter ekte tilgjengelighet via Api.getAvailability (cachet per
     * propertyId+måned). Server-siden gjør sin egen kapasitetssjekk i
     * tillegg, så hvis vi mangler data for en dag (API-feil), skipper vi
     * den her — Frank får uansett varsel hvis det finnes konflikt.
     */
    async _collectShortfalls(locationId, guests) {
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

      const monthsNeeded = new Set();
      for (let d = parseIsoLocal(minFrom); d <= parseIsoLocal(maxEnd); d = addDaysDate(d, 1)) {
        monthsNeeded.add(`${d.getFullYear()}-${d.getMonth()}`);
      }

      const availabilityByDate = new Map();
      await Promise.all(Array.from(monthsNeeded).map(async (key) => {
        const [y, m] = key.split("-").map(Number);
        const monthMap = await window.Api.getAvailability(locationId, y, m);
        if (monthMap) {
          for (const [iso, info] of monthMap.entries()) {
            availabilityByDate.set(iso, info);
          }
        }
      }));

      const out = [];
      for (let d = parseIsoLocal(minFrom); d <= parseIsoLocal(maxEnd); d = addDaysDate(d, 1)) {
        const iso = isoLocal(d);
        const onSite = periods.filter((p) => iso >= p.from && iso <= p.end);
        const needed = onSite.length;
        if (needed === 0) continue;

        const info = availabilityByDate.get(iso);
        if (!info) continue;

        if (info.available < needed) {
          out.push({
            date: iso,
            available: info.available,
            needed,
            missing: needed - info.available,
            guests: onSite.map((p) => p.guest.name || `Rom ${p.guest.index}`)
          });
        }
      }
      return out;
    },

    async _submit() {
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

      if (!locId) return this._showMsg(tx("booking.errPickLoc"), "error");

      if (guests.some((g) => !g.name)) {
        return this._showMsg(tx("booking.errAllNames"), "error");
      }

      // v3.14.0: telefonvalidering — alle gjester må ha norsk mobil/fasttelefon.
      // Markerer det første ugyldige feltet visuelt og scroll'er det inn i view
      // før vi viser feilmeldingen.
      for (const g of guests) {
        if (!g.phoneRaw) {
          this._focusGuestField(g.index, "phone");
          return this._showMsg(tx("booking.errAllPhones"), "error");
        }
        if (!isValidNoPhone(g.phoneRaw)) {
          this._focusGuestField(g.index, "phone");
          return this._showMsg(tx("booking.errPhoneInvalid", { n: g.index, name: g.name }), "error");
        }
      }

      // Hver gjest må ha en gyldig effektiv periode (egen eller felles)
      for (const g of guests) {
        if (!g.from) {
          const who = g.hasOwnDates
            ? tx("booking.guestRoom", { n: g.index }) + ` («${g.name}»)`
            : tx("booking.sharedPeriod");
          return this._showMsg(tx("booking.errNoFrom", { who }), "error");
        }
        if (!g.openEnded && !g.to) {
          return this._showMsg(tx("booking.errNoTo", { n: g.index, name: g.name }), "error");
        }
        if (g.to && g.to < g.from) {
          return this._showMsg(tx("booking.errBadOrder", { n: g.index, name: g.name }), "error");
        }
      }

      const submitBtn = document.getElementById("submit-btn");
      submitBtn.disabled = true;
      submitBtn.textContent = tx("booking.sending");

      // Sjekk tilgjengelighet per dag basert på hvor mange gjester som er
      // på huset hver dag. Bestillingen blokkeres ikke ved mangel — i
      // stedet bygges advarsel som vises til kunden og legges ved
      // e-postvarselet til Frank.
      // v3.12.6: Hvis shortfall → vis bekreftelse-dialog før submit. Kunde
      // må eksplisitt klikke "Send likevel" for å overstyre. Setter rett
      // forventning: 2GM forsøker å finne løsning, men ikke garantert.
      const shortfalls = await this._collectShortfalls(locId, guests);
      const warning = shortfalls.length
        ? buildWarningMessage(shortfalls)
        : null;
      if (warning) {
        const proceed = await _confirmOverbooking(warning);
        if (!proceed) {
          submitBtn.disabled = false;
          submitBtn.textContent = tx("booking.submit");
          return;
        }
      }

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

      // Bygg gjeste-payload til ekte API. Hver gjest får checkIn/checkOut
      // basert på sin effektive periode (egen eller fellesperioden).
      const apiGuests = guests.map(g => ({
        name: g.name,
        phone: g.phone,
        checkIn: g.from,
        checkOut: g.openEnded ? null : g.to
      }));

      const res = await window.Api.submitBooking({
        token: window.Auth?.token || null,
        property: locId,
        guests: apiGuests
      });

      submitBtn.disabled = false;
      submitBtn.textContent = tx("booking.submit");

      if (res.ok) {
        // v3.8.4: bytt til "Kommende"-filter FØR refresh så den nye bookingen
        // (Status: Upcoming + Pending_Confirmation) er synlig direkte når
        // listen oppdateres — uten denne lander den under default "Aktive"
        // som ikke matcher pending-statusen.
        if (window.MyBookings && typeof window.MyBookings.setFilter === "function") {
          window.MyBookings.setFilter("upcoming");
        }
        // Oppdater "Mine bookinger"-listen så den nye bestillingen vises
        if (window.MyBookings && typeof window.MyBookings.refresh === "function") {
          window.MyBookings.refresh();
        }
        // Lås portalen og vis takk-skjerm
        this._lockPortalAndShowThanks(res.bookingRef, res.capacityWarning || warning);
      } else {
        // eslint-disable-next-line no-console
        console.error("[BOOKING] Innsending feilet:", res);
        this._showMsg(tx("booking.errGeneric"), "error");
      }
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
    },

    /**
     * Vellykket innsending: skjul bestillingsskjemaet, vis stor takk-melding
     * med booking-referansen. Kalenderen blir fortsatt synlig (lesetilgang).
     */
    _lockPortalAndShowThanks(bookingRef, warning) {
      // Skjul hele formen
      const form = document.getElementById("booking-form");
      if (form) form.hidden = true;

      // Bytt panel-tittel
      const panelHead = document.querySelector(".panel-form .panel-head");
      if (panelHead) {
        panelHead.innerHTML = `<h2 class="panel-title">${tx("booking.thanksTitle")}</h2>`;
      }

      const panel = document.querySelector(".panel-form");
      if (!panel) return;

      const existing = panel.querySelector(".thanks-screen");
      if (existing) existing.remove();

      const thanks = document.createElement("div");
      thanks.className = "thanks-screen";
      thanks.innerHTML = `
        <div class="thanks-icon" aria-hidden="true">✓</div>
        <p class="thanks-lead">${tx("booking.thanksLead")}</p>
        <p class="thanks-ref">${tx("booking.thanksRef", { ref: escapeHtml(bookingRef) })}</p>
        <p class="thanks-sub">${tx("booking.thanksSub")}</p>
        ${warning ? `<p class="thanks-warning">${escapeHtml(warning)}</p>` : ""}
        <button type="button" class="thanks-see-booking-btn" id="thanks-see-booking">
          ${escapeHtml(tx("booking.thanksSeeBooking"))}
        </button>
        <p class="thanks-foot">${tx("booking.thanksFoot")}</p>
        <button type="button" class="thanks-close-btn" id="thanks-close">
          ${escapeHtml(tx("booking.close"))}
        </button>
      `;
      panel.appendChild(thanks);

      // v3.12.2: åpne Mine bookinger-panelet via tab-raden (accordion-modus
       // gjør at panelet er kollapset som default — bare scrollIntoView holdt
       // ikke; kunden så bare headeren). Bruker eksisterende portal-nav-knapp
       // så vi får panel-bytte + collapse-de-andre + scroll i én operasjon.
      const seeBtn = thanks.querySelector("#thanks-see-booking");
      if (seeBtn) {
        seeBtn.addEventListener("click", () => {
          const navBtn = document.querySelector('.portal-nav-btn[data-target="mybookings-panel"]');
          if (navBtn) {
            navBtn.click();
            return;
          }
          // Fallback hvis tab-raden ikke finnes (eldre layout).
          const mb = document.getElementById("mybookings-panel");
          if (mb) {
            mb.classList.remove("collapsed");
            if (typeof mb.scrollIntoView === "function") {
              mb.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }
        });
      }

      // v3.12.12: "Lukk"-knapp kollapser hele Bestilling-seksjonen
      // (kunden klaget over at "Du kan lukke vinduet"-teksten ikke hadde
      // noen knapp). Kunden kan re-åpne via toggle eller +Ny bestilling
      // i top-navet.
      const closeBtn = thanks.querySelector("#thanks-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          const section = document.getElementById("bestilling-panel");
          const toggle  = document.getElementById("bestilling-toggle");
          if (section) section.classList.add("collapsed");
          if (toggle)  toggle.setAttribute("aria-expanded", "false");
        });
      }
    }
  };

  // ---------- telefonvalidering (norsk) ----------

  // v3.14.0: norsk telefonnummer.
  // Aksepterer formater som "+47 912 34 567", "0047 91234567", "91234567",
  // "22 12 34 56" osv. Strips bort mellomrom, bindestrek, parenteser før
  // sjekken. Krever 8 sifre med ledende 2-9 (gyldig norsk start: 2-7=fast/
  // service, 4=mobil/IP, 8=spesial, 9=mobil). Tillater +47/0047/47-prefiks.
  function normalizeNoPhone(s) {
    return String(s || "").replace(/[\s\-()./]/g, "");
  }
  function isValidNoPhone(s) {
    const cleaned = normalizeNoPhone(s).replace(/^(\+47|0047|47)/, "");
    return /^[2-9]\d{7}$/.test(cleaned);
  }

  // Eksponer for _buildGuestRow's live-validering — moduleskoperte funksjoner
  // er ikke synlige inni metoden via `this`.
  Booking._focusGuestField = function _focusGuestField(idx, field) {
    const row = document.querySelector(`#guests-list .guest-row[data-guest-idx='${idx}']`);
    if (!row) return;
    const el = row.querySelector(`[data-field='${field}']`);
    if (!el) return;
    el.classList.add("invalid");
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    el.focus();
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
    const and = ` ${tx("booking.joinAnd")} `;
    if (items.length <= 1) return items.join("");
    if (items.length === 2) return items.join(and);
    return items.slice(0, -1).join(", ") + and + items[items.length - 1];
  }

  /**
   * Liten HTML-escape for å trygt sette inn tekst (bookingRef, warning) i
   * innerHTML uten XSS-risiko, selv om innholdet kommer fra vårt eget API.
   */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
        return tx("booking.warningSentence", {
          dates: joinNo(dates),
          available: g.available,
          needed: g.needed,
        });
      });

    return `${tx("booking.warningPrefix")} ${sentences.join(" ")} ${tx("booking.warningSuffix")}`;
  }

  // v3.12.6: Bekreftelse-dialog ved kapasitetskonflikt. Kunden får tydelig
  // beskjed om at det ikke er nok ledig nå, men oppfordres til å sende
  // bestillingen likevel — vi forsøker å finne en løsning. Returnerer en
  // Promise<boolean>: true = send likevel, false = avbryt/rediger.
  function _confirmOverbooking(warningText) {
    return new Promise((resolve) => {
      if (typeof HTMLDialogElement === "undefined") {
        // Eldre nettlesere uten <dialog>: bruk native confirm som fallback.
        const fallbackMsg = warningText + "\n\nSend bestillingen likevel? 2GM Eiendom vil forsøke å finne en løsning for deg.";
        resolve(window.confirm(fallbackMsg));
        return;
      }
      const dlg = document.createElement("dialog");
      dlg.className = "overbooking-confirm-dlg";
      dlg.innerHTML = `
        <div class="overbooking-dlg-body">
          <h3 class="overbooking-dlg-title">Ikke nok ledige rom på valgt periode</h3>
          <p class="overbooking-dlg-warn">${escapeHtml(warningText)}</p>
          <p class="overbooking-dlg-lead">Send bestillingen likevel — vi forsøker å finne en løsning for deg så snart vi får sett på den.</p>
          <div class="overbooking-dlg-actions">
            <button type="button" class="overbooking-dlg-cancel">Avbryt og endre</button>
            <button type="button" class="overbooking-dlg-send">Send bestilling likevel</button>
          </div>
        </div>
      `;
      document.body.appendChild(dlg);
      const cleanup = (answer) => {
        try { dlg.close(); } catch (_) {}
        dlg.remove();
        resolve(answer);
      };
      dlg.querySelector(".overbooking-dlg-cancel").addEventListener("click", () => cleanup(false));
      dlg.querySelector(".overbooking-dlg-send").addEventListener("click", () => cleanup(true));
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); cleanup(false); });
      dlg.showModal();
    });
  }

  // Re-rendre dynamisk innhold ved språkbytte (badge, gjeste-rader, summaries).
  document.addEventListener("i18n:change", () => {
    if (typeof Booking._refreshAvailabilityBadge === "function") {
      Booking._refreshAvailabilityBadge();
    }
    if (typeof Booking._renderGuests === "function") {
      Booking._renderGuests(Booking._getRooms());
    }
  });

  window.Booking = Booking;
})();
