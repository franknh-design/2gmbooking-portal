/* =========================================================
   Mine bookinger.
   v1.2
   - Henter kundens Active + Upcoming bookinger via Api.getMyBookings()
   - Vises under kalenderen, alle lokasjoner samlet
   - Sortert kronologisk på Check_In
   - Viser romnr + dørkode når admin har tildelt
   - Viser bygg-adresse på egen linje under meta
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

        this.listEl.appendChild(row);
      }
    },
  };

  window.MyBookings = MyBookings;
})();
