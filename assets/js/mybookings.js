/* =========================================================
   Mine bookinger.
   v1.3
   - Henter kundens Active + Upcoming bookinger via Api.getMyBookings()
   - Vises under kalenderen, alle lokasjoner samlet
   - Sortert kronologisk på Check_In
   - Viser romnr + dørkode når admin har tildelt
   - Viser bygg-adresse på egen linje under meta
   - "Forleng"-knapp på aktive bookinger → dialog → API-forespørsel
   ========================================================= */
(function () {
  "use strict";

  const MONTHS_NB = [
    "jan", "feb", "mar", "apr", "mai", "jun",
    "jul", "aug", "sep", "okt", "nov", "des"
  ];

  function formatIso(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const day = parseInt(m[3], 10);
    const month = MONTHS_NB[parseInt(m[2], 10) - 1];
    const year = m[1];
    return `${day}. ${month} ${year}`;
  }

  function formatPeriod(checkIn, checkOut) {
    const fromTxt = formatIso(checkIn) || "?";
    const toTxt = checkOut ? formatIso(checkOut) : "åpen";
    return `${fromTxt} → ${toTxt}`;
  }

  function statusBadge(status, pending) {
    const wrap = document.createElement("span");
    wrap.className = "mb-status";

    if (pending) {
      wrap.classList.add("mb-status-pending");
      wrap.textContent = "Avventer bekreftelse";
    } else if (status === "Active") {
      wrap.classList.add("mb-status-active");
      wrap.textContent = "Aktiv";
    } else if (status === "Upcoming") {
      wrap.classList.add("mb-status-upcoming");
      wrap.textContent = "Bekreftet";
    } else {
      wrap.textContent = status || "—";
    }
    return wrap;
  }

  const MyBookings = {
    token: null,
    container: null,
    listEl: null,
    emptyEl: null,
    loadingEl: null,
    errorEl: null,
    countEl: null,

    init({ token }) {
      this.token = token || null;
      this.container = document.getElementById("mybookings-panel");
      this.listEl    = document.getElementById("mybookings-list");
      this.emptyEl   = document.getElementById("mybookings-empty");
      this.loadingEl = document.getElementById("mybookings-loading");
      this.errorEl   = document.getElementById("mybookings-error");
      this.countEl   = document.getElementById("mybookings-count");

      if (!this.container || !this.token) {
        if (this.container) this.container.hidden = true;
        return;
      }

      this.container.hidden = false;
      this.refresh();
    },

    async refresh() {
      if (!this.token || !this.container) return;

      this._setState("loading");

      const res = await window.Api.getMyBookings(this.token);

      if (!res || !res.ok) {
        this._setState("error");
        return;
      }

      const bookings = Array.isArray(res.bookings) ? res.bookings : [];
      this._render(bookings);
    },

    _setState(state) {
      if (this.loadingEl) this.loadingEl.hidden = state !== "loading";
      if (this.errorEl)   this.errorEl.hidden   = state !== "error";
      if (this.emptyEl)   this.emptyEl.hidden   = state !== "empty";
      if (this.listEl)    this.listEl.hidden    = state !== "list";
      if (this.countEl)   this.countEl.hidden   = state !== "list";
    },

    _render(bookings) {
      if (!bookings.length) {
        this._setState("empty");
        if (this.countEl) this.countEl.textContent = "";
        return;
      }

      this._setState("list");
      if (this.countEl) {
        this.countEl.textContent = `${bookings.length} ${bookings.length === 1 ? "rad" : "rader"}`;
      }

      this.listEl.innerHTML = "";

      for (const b of bookings) {
        const row = document.createElement("li");
        row.className = "mb-row";

        const main = document.createElement("div");
        main.className = "mb-row-main";

        const guestEl = document.createElement("span");
        guestEl.className = "mb-guest";
        guestEl.textContent = b.guest || "(uten navn)";
        main.appendChild(guestEl);

        const periodEl = document.createElement("span");
        periodEl.className = "mb-period";
        periodEl.textContent = formatPeriod(b.checkIn, b.checkOut);
        main.appendChild(periodEl);

        row.appendChild(main);

        const meta = document.createElement("div");
        meta.className = "mb-row-meta";

        const propEl = document.createElement("span");
        propEl.className = "mb-property";
        propEl.textContent = b.property || "—";
        meta.appendChild(propEl);

        if (b.ref) {
          const refEl = document.createElement("span");
          refEl.className = "mb-ref";
          refEl.textContent = b.ref;
          meta.appendChild(refEl);
        }

        if (b.roomNumber) {
          const roomEl = document.createElement("span");
          roomEl.className = "mb-room";
          roomEl.textContent = `Rom ${b.roomNumber}`;
          meta.appendChild(roomEl);
        }

        if (b.doorCode) {
          const codeEl = document.createElement("span");
          codeEl.className = "mb-doorcode";
          codeEl.textContent = `Kode ${b.doorCode}`;
          meta.appendChild(codeEl);
        }

        meta.appendChild(statusBadge(b.status, b.pendingConfirmation));

        row.appendChild(meta);

        if (b.propertyAddress) {
          const addrEl = document.createElement("div");
          addrEl.className = "mb-address";
          addrEl.textContent = b.propertyAddress;
          row.appendChild(addrEl);
        }

        // Forleng-knapp kun på aktive bookinger med satt utflytting.
        // Open-ended (Check_Out null) trenger ikke forlengelse.
        if (b.status === "Active" && b.checkOut) {
          const actions = document.createElement("div");
          actions.className = "mb-actions";

          const extendBtn = document.createElement("button");
          extendBtn.type = "button";
          extendBtn.className = "btn btn-ghost mb-extend-btn";
          extendBtn.textContent = "Forleng oppholdet";
          extendBtn.addEventListener("click", () => openExtendDialog(b, this));
          actions.appendChild(extendBtn);

          row.appendChild(actions);
        }

        this.listEl.appendChild(row);
      }
    },
  };

  // ---- Forleng-dialog ----
  // Åpnes som <dialog>-element; faller tilbake til prompt() hvis nettleseren
  // ikke støtter <dialog> (Safari < 15.4 etc.).
  function openExtendDialog(booking, mybookingsRef) {
    const dlg = ensureDialog();
    if (!dlg) {
      // fallback: ren prompt
      const today = new Date().toISOString().slice(0, 10);
      const min = laterIso(booking.checkOut, 1);
      const ans = window.prompt(
        `Ny utflyttingsdato for ${booking.ref} (YYYY-MM-DD), tidligst ${min}:`,
        min
      );
      if (ans) submitExtension(booking, ans, mybookingsRef);
      return;
    }

    dlg.querySelector(".extend-dlg-ref").textContent = booking.ref;
    dlg.querySelector(".extend-dlg-current").textContent = formatIso(booking.checkOut) || booking.checkOut;
    const input = dlg.querySelector("input[name=newDate]");
    const minIso = laterIso(booking.checkOut, 1);
    input.min = minIso;
    input.value = minIso;
    dlg.querySelector(".extend-dlg-msg").textContent = "";

    dlg._booking = booking;
    dlg._mybookingsRef = mybookingsRef;

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function ensureDialog() {
    let dlg = document.getElementById("extendDialog");
    if (dlg) return dlg;

    if (typeof HTMLDialogElement === "undefined") return null;

    dlg = document.createElement("dialog");
    dlg.id = "extendDialog";
    dlg.className = "extend-dlg";
    dlg.innerHTML = `
      <form method="dialog" class="extend-dlg-form">
        <h3 class="extend-dlg-title">Forleng oppholdet</h3>
        <p class="extend-dlg-sub">
          Booking <strong class="extend-dlg-ref"></strong>,
          nåværende utflytting <strong class="extend-dlg-current"></strong>.
        </p>
        <label class="field">
          <span class="field-label">Ny utflyttingsdato</span>
          <input type="date" name="newDate" required />
        </label>
        <p class="extend-dlg-msg" aria-live="polite"></p>
        <div class="extend-dlg-buttons">
          <button type="button" class="btn btn-ghost" data-action="cancel">Avbryt</button>
          <button type="button" class="btn btn-primary" data-action="submit">Send forespørsel</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      const action = e.target?.dataset?.action;
      if (action === "cancel") {
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
      } else if (action === "submit") {
        const input = dlg.querySelector("input[name=newDate]");
        const value = input.value;
        const booking = dlg._booking;
        if (!value) {
          dlg.querySelector(".extend-dlg-msg").textContent = "Velg en dato.";
          return;
        }
        const minIso = laterIso(booking.checkOut, 1);
        if (value < minIso) {
          dlg.querySelector(".extend-dlg-msg").textContent =
            `Datoen må være ${formatIso(minIso) || minIso} eller senere.`;
          return;
        }
        submitExtension(booking, value, dlg._mybookingsRef, dlg);
      }
    });

    return dlg;
  }

  async function submitExtension(booking, requestedCheckOut, mybookingsRef, dlg) {
    const msgEl = dlg ? dlg.querySelector(".extend-dlg-msg") : null;
    const submitBtn = dlg ? dlg.querySelector('[data-action="submit"]') : null;

    if (msgEl) msgEl.textContent = "Sender …";
    if (submitBtn) submitBtn.disabled = true;

    const res = await window.Api.requestExtension({
      token: mybookingsRef.token,
      bookingRef: booking.ref,
      requestedCheckOut,
    });

    if (submitBtn) submitBtn.disabled = false;

    if (!res || !res.ok) {
      const err = (res && res.error) || "ukjent feil";
      if (msgEl) msgEl.textContent = `Kunne ikke sende: ${err}`;
      else window.alert(`Kunne ikke sende forespørselen (${err}).`);
      return;
    }

    if (dlg) {
      dlg.close ? dlg.close() : dlg.removeAttribute("open");
    }
    window.alert(
      "Takk! Forespørselen er sendt til 2GM. Du får tilbakemelding så snart admin har sett på den."
    );
  }

  function laterIso(iso, daysToAdd) {
    if (!iso) return new Date().toISOString().slice(0, 10);
    const d = new Date(iso);
    d.setDate(d.getDate() + daysToAdd);
    return d.toISOString().slice(0, 10);
  }

  window.MyBookings = MyBookings;
})();
