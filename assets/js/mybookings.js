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

  // Kortere format for booking-card: "10.05 → 24.05.2026"
  // Innen samme år: kort start (DD.MM) + full slutt (DD.MM.YYYY).
  // Ved årsskifte: full DD.MM.YYYY på begge for å unngå tvetydighet.
  function formatBookingDates(checkIn, checkOut) {
    if (!checkIn) return "";
    const d1 = parseIso(checkIn);
    if (!d1) return "";
    if (!checkOut) return `${ddmmyyyy(d1)} → ${tx("mybookings.openPeriod")}`;
    const d2 = parseIso(checkOut);
    if (!d2) return "";
    if (d1.y === d2.y) return `${ddmm(d1)} → ${ddmmyyyy(d2)}`;
    return `${ddmmyyyy(d1)} → ${ddmmyyyy(d2)}`;
  }

  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? { y: m[1], m: m[2], d: m[3] } : null;
  }
  function ddmm(p)     { return `${p.d}.${p.m}`; }
  function ddmmyyyy(p) { return `${p.d}.${p.m}.${p.y}`; }

  function nightsBetween(checkIn, checkOut) {
    if (!checkIn || !checkOut) return null;
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    if (isNaN(d1) || isNaN(d2)) return null;
    return Math.max(0, Math.round((d2 - d1) / 86400000));
  }

  function formatDoorCodeDigits(code) {
    if (!code) return "";
    return String(code).split("").join(" ");
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
        this.listEl.appendChild(this._renderBookingCard(b));
      }
    },

    _renderBookingCard(b) {
      const row = document.createElement("li");
      row.className = "mb-row mb-card";

      // ----- Header: navn + status·ref til høyre -----
      const head = document.createElement("div");
      head.className = "mb-card-head";

      const nameEl = document.createElement("h3");
      nameEl.className = "mb-card-name";
      nameEl.textContent = b.guest || tx("mybookings.unnamed");
      head.appendChild(nameEl);

      const right = document.createElement("div");
      right.className = "mb-card-head-right";
      right.appendChild(statusBadge(b.status, b.pendingConfirmation));
      if (b.ref) {
        const refEl = document.createElement("span");
        refEl.className = "mb-card-ref";
        refEl.textContent = b.ref;
        right.appendChild(refEl);
      }
      head.appendChild(right);
      row.appendChild(head);

      // ----- Subline: property · rom · adresse (alt på én linje) -----
      const subParts = [b.property || "—"];
      if (b.roomNumber) subParts.push(tx("mybookings.room", { n: b.roomNumber }));
      if (b.propertyAddress) subParts.push(b.propertyAddress);
      const sub = document.createElement("div");
      sub.className = "mb-card-sub";
      sub.textContent = subParts.join(" · ");
      row.appendChild(sub);

      // ----- Info-flex: venstre stack (datoer) + høyre stack (dørkode) -----
      const infoRow = document.createElement("div");
      infoRow.className = "mb-card-info-row";

      const leftStack = document.createElement("div");
      leftStack.className = "mb-card-info-stack";
      leftStack.appendChild(_infoItem(tx("mybookings.lblCheckIn"), _formatDateNb(b.checkIn) || "—"));

      let outVal;
      if (b.checkOut) {
        const n = nightsBetween(b.checkIn, b.checkOut);
        const nightsTxt = tx(n === 1 ? "mybookings.nightsOne" : "mybookings.nightsMany", { n });
        outVal = `${_formatDateNb(b.checkOut)} · ${nightsTxt}`;
      } else {
        outVal = tx("mybookings.openPeriod");
      }
      leftStack.appendChild(_infoItem(tx("mybookings.lblCheckOut"), outVal));
      infoRow.appendChild(leftStack);

      // Høyre stack: Dørkode (kun når rom er tildelt — uten rom ingen kode)
      if (b.roomNumber) {
        const rightStack = document.createElement("div");
        rightStack.className = "mb-card-info-stack mb-card-info-stack-right";
        rightStack.appendChild(_doorCodeItem(b.doorCode));
        infoRow.appendChild(rightStack);
      }

      row.appendChild(infoRow);

      // ----- Klikkbar kort: åpner action-meny hvis det finnes valg å gjøre -----
      const canExtend = (b.status === "Active" || b.status === "Upcoming") && b.checkOut;
      if (canExtend) {
        row.classList.add("mb-card-clickable");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.addEventListener("click", () => openActionMenu(b, this));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openActionMenu(b, this);
          }
        });
      }

      return row;
    },
  };

  // ---- Action-meny ----
  // Åpnes når kunden klikker på en booking-card. Lister tilgjengelige valg
  // (per nå kun Forleng oppholdet — utvidbart for fremtidige actions).
  function openActionMenu(booking, mybookingsRef) {
    const dlg = ensureActionMenu();
    if (!dlg) {
      // Fallback: bare åpne forleng-dialogen direkte
      openExtendDialog(booking, mybookingsRef);
      return;
    }
    dlg._booking = booking;
    dlg._mybookingsRef = mybookingsRef;
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function ensureActionMenu() {
    let dlg = document.getElementById("actionMenu");
    if (dlg) {
      // Re-render etiketter ved evt. språkbytte mellom kall
      dlg.querySelector(".action-menu-title").textContent  = tx("mybookings.actionsTitle");
      dlg.querySelector('[data-action="extend"]').textContent = tx("mybookings.extend");
      dlg.querySelector('[data-action="close"]').textContent  = tx("extend.cancel");
      return dlg;
    }
    if (typeof HTMLDialogElement === "undefined") return null;

    dlg = document.createElement("dialog");
    dlg.id = "actionMenu";
    dlg.className = "extend-dlg action-menu";
    dlg.innerHTML = `
      <div class="extend-dlg-form action-menu-form">
        <h3 class="extend-dlg-title action-menu-title">${tx("mybookings.actionsTitle")}</h3>
        <div class="action-menu-buttons">
          <button type="button" data-action="extend" class="action-menu-btn action-menu-btn-primary">${tx("mybookings.extend")}</button>
          <button type="button" data-action="close"  class="action-menu-btn">${tx("extend.cancel")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      const action = e.target?.dataset?.action;
      if (action === "close") {
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
      } else if (action === "extend") {
        const b = dlg._booking;
        const ref = dlg._mybookingsRef;
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
        openExtendDialog(b, ref);
      }
    });

    return dlg;
  }

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

  // Full DD.MM.YYYY for label-verdi-rader (ikke kort form).
  function _formatDateNb(iso) {
    const p = parseIso(iso);
    return p ? ddmmyyyy(p) : "";
  }

  function _infoItem(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "mb-card-info-item";
    const lbl = document.createElement("span");
    lbl.className = "mb-card-info-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "mb-card-info-value";
    val.textContent = value;
    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return wrap;
  }

  function _doorCodeItem(code) {
    const wrap = document.createElement("div");
    wrap.className = "mb-card-info-item mb-card-info-item-doorcode";
    const lbl = document.createElement("span");
    lbl.className = "mb-card-info-label";
    lbl.textContent = "🔑 " + tx("mybookings.doorCodeLabel");
    const val = document.createElement("span");
    val.className = "mb-card-info-value";
    if (code) {
      const span = document.createElement("span");
      span.className = "mb-card-doorcode-value";
      span.textContent = formatDoorCodeDigits(code);
      val.appendChild(span);
    } else {
      const span = document.createElement("span");
      span.className = "mb-card-doorcode-pending";
      span.textContent = tx("mybookings.doorCodePending");
      val.appendChild(span);
    }
    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return wrap;
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
