/* =========================================================
   Mine bookinger.
   v1.6
   - Henter kundens Active + Upcoming bookinger via Api.getMyBookings()
   - Sortert kronologisk på Check_In
   - Viser romnr + dørkode når admin har tildelt
   - Viser bygg-adresse på egen linje under meta
   - "Forleng"-knapp på aktive bookinger → dialog → API-forespørsel
   - Tre visnings-moduser basert på antall:
       0 bookinger     → panel skjult, layout (kalender + skjema) synlig
       1–2 bookinger   → panel sammentrukket over layout (klikk = utvid)
       3+ bookinger    → panel utvidet, layout skjult
     Topbar-knappen "+ Ny bestilling" åpner layouten når den er skjult.
   - v1.6: Auto-refresh hver 90 sek + ved visibilitychange så endringer
     fra admin (rom + dørkode + status) dukker opp uten manuell reload.
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }
  function shortMonths() {
    return (window.I18n && window.I18n.t("months.short")) || [
      "jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"
    ];
  }

  function formatIso(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const day = parseInt(m[3], 10);
    const month = shortMonths()[parseInt(m[2], 10) - 1];
    const year = m[1];
    return `${day}. ${month} ${year}`;
  }

  function formatPeriod(checkIn, checkOut) {
    const fromTxt = formatIso(checkIn) || "?";
    const toTxt = checkOut ? formatIso(checkOut) : tx("mybookings.openPeriod");
    return `${fromTxt} → ${toTxt}`;
  }

  function statusBadge(status, pending) {
    const wrap = document.createElement("span");
    wrap.className = "mb-status";

    if (pending) {
      wrap.classList.add("mb-status-pending");
      wrap.textContent = tx("mybookings.statusPending");
    } else if (status === "Active") {
      wrap.classList.add("mb-status-active");
      wrap.textContent = tx("mybookings.statusActive");
    } else if (status === "Upcoming") {
      wrap.classList.add("mb-status-upcoming");
      wrap.textContent = tx("mybookings.statusUpcoming");
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

      wireTopbarCta();
      wirePanelToggle();

      if (!this.container || !this.token) {
        if (this.container) this.container.hidden = true;
        // Demo / ingen token: layout skal være synlig, ingen topbar-CTA.
        setLayoutVisible(true);
        setTopbarCtaVisible(false);
        return;
      }

      this.container.hidden = false;
      // Mens vi laster: skjul layout for å unngå flash hvis kunden har
      // bookinger. Vises igjen i _render hvis lista er tom eller ved feil.
      setLayoutVisible(false);
      // Topbar-CTA er alltid synlig når kunden er logget inn (har token);
      // slik at det er en konsekvent vei til ny bestilling uavhengig av modus.
      setTopbarCtaVisible(true);
      this.refresh();

      // v1.6: Lytt etter admin-godkjenninger så portalen reflekterer endringer
      // (status: pending → confirmed, rom + dørkode tildelt) uten manuell reload.
      // Polling hvert 90. sek + ved visibilitychange (når fanen får fokus igjen).
      this._startAutoRefresh();
    },

    _startAutoRefresh() {
      if (this._autoRefreshStarted) return;
      this._autoRefreshStarted = true;
      setInterval(() => this.refresh(true), 90000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.refresh(true);
      });
    },

    async refresh(silent) {
      if (!this.token || !this.container) return;
      // Forhindrer overlappende fetch hvis polling og visibilitychange
      // utløses samtidig — drop nye kall mens vi venter på et eksisterende.
      if (this._loading) return;
      this._loading = true;

      // silent=true: ikke flip til loading-state. Vi beholder eksisterende
      // liste til ny data er klar, så det ikke flimrer ved bakgrunns-poll.
      if (!silent) this._setState("loading");

      const res = await window.Api.getMyBookings(this.token);
      this._loading = false;

      if (!res || !res.ok) {
        if (!silent) {
          this._setState("error");
          setLayoutVisible(true);
        }
        // Stille feil ved bakgrunns-refresh — beholder forrige render.
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
      const count = bookings.length;

      if (count === 0) {
        // Ingen bookinger → panelet kollapser via :has(), layout synlig.
        // Topbar-CTA forblir synlig (satt i init) som konsistent inngang.
        this._setState("empty");
        if (this.countEl) this.countEl.textContent = "";
        setPanelCollapsed(this.container, false);
        setLayoutVisible(true);
        return;
      }

      this._setState("list");

      if (this.countEl) {
        this.countEl.textContent = tx(count === 1 ? "mybookings.rowsOne" : "mybookings.rowsMany", { n: count });
      }

      // 1–2 bookinger: panel sammentrukket over layout (begge synlige).
      // 3+ bookinger:  panel utvidet, layout skjult bak topbar-CTA.
      const heavy = count > 2;
      setPanelCollapsed(this.container, !heavy);
      setLayoutVisible(!heavy);
      // Topbar-CTA forblir synlig (satt i init).

      this.listEl.innerHTML = "";

      for (const b of bookings) {
        const row = document.createElement("li");
        row.className = "mb-row";

        const main = document.createElement("div");
        main.className = "mb-row-main";

        const guestEl = document.createElement("span");
        guestEl.className = "mb-guest";
        guestEl.textContent = b.guest || tx("mybookings.unnamed");
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
          roomEl.textContent = tx("mybookings.room", { n: b.roomNumber });
          meta.appendChild(roomEl);
        }

        if (b.doorCode) {
          const codeEl = document.createElement("span");
          codeEl.className = "mb-doorcode";
          codeEl.textContent = tx("mybookings.code", { code: b.doorCode });
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
          extendBtn.textContent = tx("mybookings.extend");
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
      const min = laterIso(booking.checkOut, 1);
      const ans = window.prompt(
        tx("extend.fallbackPrompt", { ref: booking.ref, min }),
        min
      );
      if (ans) submitExtension(booking, ans, mybookingsRef);
      return;
    }

    // Bygg sub-teksten med fete ref og current i et trygt template.
    const refTxt     = booking.ref;
    const currentTxt = formatIso(booking.checkOut) || booking.checkOut;
    const subRaw     = tx("extend.subPart", { ref: "{REF}", current: "{CUR}" });
    const subSafe    = subRaw
      .replace("{REF}",  `<strong>${escapeHtml(refTxt)}</strong>`)
      .replace("{CUR}",  `<strong>${escapeHtml(String(currentTxt))}</strong>`);
    dlg.querySelector(".extend-dlg-sub").innerHTML = subSafe;

    dlg.querySelector(".extend-dlg-title").textContent = tx("extend.title");
    dlg.querySelector(".extend-dlg-newdate-label").textContent = tx("extend.newDate");
    dlg.querySelector('[data-action="cancel"]').textContent = tx("extend.cancel");
    dlg.querySelector('[data-action="submit"]').textContent = tx("extend.send");

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
        <h3 class="extend-dlg-title"></h3>
        <p class="extend-dlg-sub"></p>
        <label class="field">
          <span class="field-label extend-dlg-newdate-label"></span>
          <input type="date" name="newDate" required />
        </label>
        <p class="extend-dlg-msg" aria-live="polite"></p>
        <div class="extend-dlg-buttons">
          <button type="button" class="btn btn-ghost" data-action="cancel"></button>
          <button type="button" class="btn btn-primary" data-action="submit"></button>
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
          dlg.querySelector(".extend-dlg-msg").textContent = tx("extend.errPick");
          return;
        }
        const minIso = laterIso(booking.checkOut, 1);
        if (value < minIso) {
          dlg.querySelector(".extend-dlg-msg").textContent =
            tx("extend.errMin", { date: formatIso(minIso) || minIso });
          return;
        }
        submitExtension(booking, value, dlg._mybookingsRef, dlg);
      }
    });

    return dlg;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function submitExtension(booking, requestedCheckOut, mybookingsRef, dlg) {
    const msgEl = dlg ? dlg.querySelector(".extend-dlg-msg") : null;
    const submitBtn = dlg ? dlg.querySelector('[data-action="submit"]') : null;

    if (msgEl) msgEl.textContent = tx("extend.sending");
    if (submitBtn) submitBtn.disabled = true;

    const res = await window.Api.requestExtension({
      token: mybookingsRef.token,
      bookingRef: booking.ref,
      requestedCheckOut,
    });

    if (submitBtn) submitBtn.disabled = false;

    if (!res || !res.ok) {
      const err = (res && res.error) || "unknown";
      if (msgEl) msgEl.textContent = tx("extend.errFail", { err });
      else window.alert(tx("extend.fallbackFail", { err }));
      return;
    }

    if (dlg) {
      dlg.close ? dlg.close() : dlg.removeAttribute("open");
    }
    window.alert(tx("extend.success"));
  }

  function laterIso(iso, daysToAdd) {
    if (!iso) return new Date().toISOString().slice(0, 10);
    const d = new Date(iso);
    d.setDate(d.getDate() + daysToAdd);
    return d.toISOString().slice(0, 10);
  }

  // ---- Toggle-håndtering: topbar-CTA, layout, panel-collapse ----
  let _topbarWired = false;
  function wireTopbarCta() {
    if (_topbarWired) return;
    const btn = document.getElementById("topbar-new-booking");
    if (!btn) return;
    btn.addEventListener("click", () => {
      setLayoutVisible(true);
      const layout = document.getElementById("mainLayout");
      if (layout && typeof layout.scrollIntoView === "function") {
        layout.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    _topbarWired = true;
  }

  let _toggleWired = false;
  function wirePanelToggle() {
    if (_toggleWired) return;
    const toggle = document.getElementById("mybookings-toggle");
    const panel  = document.getElementById("mybookings-panel");
    if (!toggle || !panel) return;
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
    _toggleWired = true;
  }

  function setLayoutVisible(visible) {
    const layout = document.getElementById("mainLayout");
    if (layout) layout.hidden = !visible;
  }

  function setTopbarCtaVisible(visible) {
    const btn = document.getElementById("topbar-new-booking");
    if (btn) btn.hidden = !visible;
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;
    panel.classList.toggle("collapsed", !!collapsed);
    const toggle = document.getElementById("mybookings-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  // Re-rendre lista ved språkendring (status-tekster, knapper, tellere).
  document.addEventListener("i18n:change", () => {
    if (MyBookings.token) MyBookings.refresh();
  });

  window.MyBookings = MyBookings;
})();
