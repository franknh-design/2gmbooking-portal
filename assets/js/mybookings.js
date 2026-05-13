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

  // Tabler-style inline SVG-ikoner. Inline så vi unngår icon-bibliotek.
  const SVG_BUILDING = '<svg class="mb-icon mb-icon-building" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 8h1"/><path d="M9 12h1"/><path d="M9 16h1"/><path d="M14 8h1"/><path d="M14 12h1"/><path d="M14 16h1"/></svg>';
  const SVG_KEY = '<svg class="mb-icon mb-icon-key" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z"/><path d="M15 9h.01"/></svg>';
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

  // v3.11.3: Demo-bookinger som vises i Mine bookinger så lenge kunden
  // ikke har noen ekte bookinger. Forsvinner automatisk når første ekte
  // booking er på plass. Ser ut akkurat som ekte bookinger (dørkode etc)
  // men er ikke klikkbare — action-menyen kobles bort i _renderBookingCard.
  function buildDemoBookings() {
    const customerFirma = (window.Auth && window.Auth.customer && window.Auth.customer.name) || "";
    const today = new Date();
    const addDays = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    return [
      {
        _isDemo: true,
        id: "demo-active-1",
        ref: "2GM-DEMO-A",
        guest: "Per Eksempel",
        company: customerFirma,
        property: "Strandveien 112",
        propertyAddress: "Strandveien 112, 1234 Stedet",
        roomNumber: "201",
        doorCode: "473829",
        status: "Active",
        checkIn: addDays(-5),
        checkOut: addDays(10),
      },
      {
        _isDemo: true,
        id: "demo-upcoming-1",
        ref: "2GM-DEMO-B",
        guest: "Kari Mønster",
        company: customerFirma,
        property: "Strandveien 112",
        propertyAddress: "Strandveien 112, 1234 Stedet",
        roomNumber: "305",
        doorCode: "918274",
        status: "Upcoming",
        checkIn: addDays(3),
        checkOut: addDays(21),
      },
      {
        _isDemo: true,
        id: "demo-upcoming-2",
        ref: "2GM-DEMO-C",
        guest: "Lars Demonsen",
        company: customerFirma,
        property: "Sjøvegen 7",
        propertyAddress: "Sjøvegen 7, 5678 Stedet",
        roomNumber: "112",
        doorCode: "562039",
        status: "Upcoming",
        checkIn: addDays(14),
        checkOut: null,
      },
    ];
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
    } else if (status === "Cancelled") {
      wrap.classList.add("mb-status-cancelled");
      wrap.textContent = tx("mybookings.statusCancelled");
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
    // v3.7.8: filter-state — "active" | "upcoming" | "all"
    // v3.10.20: default "all" så kunden ser alle bookinger (aktive +
    // kommende) med én gang — tidligere skjulte default-filteret kommende.
    _filter: "all",
    _lastBookings: [],

    init({ token }) {
      this.token = token || null;
      this.container = document.getElementById("mybookings-panel");
      this.listEl    = document.getElementById("mybookings-list");
      this.emptyEl   = document.getElementById("mybookings-empty");
      this.loadingEl = document.getElementById("mybookings-loading");
      this.errorEl   = document.getElementById("mybookings-error");
      this.countEl   = document.getElementById("mybookings-count");

      wirePanelToggle();
      this._wireFilters();

      if (!this.container || !this.token) {
        if (this.container) this.container.hidden = true;
        // Demo / ingen token: layout skal være synlig.
        setLayoutVisible(true);
        return;
      }

      this.container.hidden = false;
      // v3.7.9: Tilgjengelighet + Ny bestilling er alltid åpne under Mine
      // bookinger — vi skjuler ikke layout lenger og har ikke topbar-CTA.
      setLayoutVisible(true);
      this.refresh();

      // v1.6: Lytt etter admin-godkjenninger så portalen reflekterer endringer
      // (status: pending → confirmed, rom + dørkode tildelt) uten manuell reload.
      // Polling hvert 90. sek + ved visibilitychange (når fanen får fokus igjen).
      this._startAutoRefresh();
    },

    _startAutoRefresh() {
      if (this._autoRefreshStarted) return;
      this._autoRefreshStarted = true;
      // v3.8.6: 90s → 60s. Pending → Confirmed-flips skal ikke ta mer enn ett
      // minutt å reflektere i portalen.
      setInterval(() => this.refresh(true), 60000);
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

      // v3.8.6: try/finally så `_loading` ALLTID resettes — uten dette ville
      // en uventet exception (f.eks. fra _render) blokkere all videre polling.
      let res;
      try {
        res = await window.Api.getMyBookings(this.token);
      } finally {
        this._loading = false;
      }

      if (!res || !res.ok) {
        if (!silent) {
          this._setState("error");
          setLayoutVisible(true);
        }
        // Stille feil ved bakgrunns-refresh — beholder forrige render.
        return;
      }

      const bookings = Array.isArray(res.bookings) ? res.bookings : [];
      this._render(bookings, !!silent);
      this._updateLastRefreshed();
    },

    // v3.8.6: viser "Sist oppdatert HH:MM" så kunden ser at lista poller seg
    // selv. Oppdateres etter hver vellykket fetch (manuell + auto-poll).
    _updateLastRefreshed() {
      let el = document.getElementById("mybookings-last-refreshed");
      if (!el) {
        const filtersWrap = document.getElementById("mybookings-filters");
        if (!filtersWrap || !filtersWrap.parentNode) return;
        el = document.createElement("p");
        el.id = "mybookings-last-refreshed";
        el.className = "mb-last-refreshed";
        filtersWrap.parentNode.insertBefore(el, filtersWrap.nextSibling);
      }
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      el.textContent = tx("mybookings.lastRefreshed", { time: `${hh}:${mm}` });
    },

    _setState(state) {
      if (this.loadingEl) this.loadingEl.hidden = state !== "loading";
      if (this.errorEl)   this.errorEl.hidden   = state !== "error";
      if (this.emptyEl)   this.emptyEl.hidden   = state !== "empty";
      if (this.listEl)    this.listEl.hidden    = state !== "list";
      if (this.countEl)   this.countEl.hidden   = state !== "list";
    },

    _wireFilters() {
      const wrap = document.getElementById("mybookings-filters");
      if (!wrap || wrap._wired) return;
      wrap._wired = true;
      wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-mb-filter]");
        if (btn) {
          const f = btn.getAttribute("data-mb-filter");
          if (f === this._filter) return;
          this._filter = f;
          this._render(this._lastBookings, true);
          return;
        }
        // v3.10.14: Skriv ut åpner et eget vindu med utskriftsvennlig liste.
        const printBtn = e.target.closest("#mybookings-print");
        if (printBtn) {
          this.printList();
        }
      });
    },

    // v3.10.14: Åpner et nytt vindu med utskriftsvennlig liste over bookingene
    // som er i nåværende filter, og trigger print-dialogen automatisk. Gruppert
    // per property — samme som on-screen-visningen.
    printList() {
      const bookings = this._applyFilter(this._lastBookings || []);
      if (!bookings.length) {
        window.alert(tx("mybookings.printEmpty") || "Ingen bookinger å skrive ut.");
        return;
      }

      const groups = new Map();
      for (const b of bookings) {
        const key = (b.property || "").trim() || tx("mybookings.noLocation");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
      const sortedKeys = Array.from(groups.keys())
        .sort((a, b) => a.localeCompare(b, "nb", { sensitivity: "base" }));
      for (const key of sortedKeys) {
        groups.get(key).sort((a, b) => {
          const an = String(a.roomNumber || "");
          const bn = String(b.roomNumber || "");
          if (!an && !bn) return 0;
          if (!an) return 1;
          if (!bn) return -1;
          return an.localeCompare(bn, undefined, { numeric: true });
        });
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const printedAt = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const filterLabel = this._filter === "active"
        ? (tx("mybookings.filterActive") || "Aktive")
        : this._filter === "upcoming"
          ? (tx("mybookings.filterUpcoming") || "Kommende")
          : (tx("mybookings.filterAll") || "Alle");

      const groupsHtml = sortedKeys.map(propKey => {
        const list = groups.get(propKey);
        const addr = list.find(b => b.propertyAddress)?.propertyAddress;
        const rows = list.map(b => {
          const nights = b.checkOut ? nightsBetween(b.checkIn, b.checkOut) : null;
          const dates = formatBookingDates(b.checkIn, b.checkOut) || "";
          const nightsTxt = nights != null
            ? (nights === 1 ? "1 natt" : `${nights} netter`)
            : (tx("mybookings.openPeriod") || "Åpen");
          const statusTxt = b.pendingConfirmation
            ? (tx("mybookings.statusPending") || "Avventer")
            : (b.status || "");
          return `<tr>
            <td>${escapeHtml(b.guest || "—")}</td>
            <td>${escapeHtml(b.roomNumber || "—")}</td>
            <td>${escapeHtml(b.doorCode || "—")}</td>
            <td>${escapeHtml(dates)}</td>
            <td>${escapeHtml(nightsTxt)}</td>
            <td>${escapeHtml(statusTxt)}</td>
            <td class="ref">${escapeHtml(b.ref || "")}</td>
          </tr>`;
        }).join("");
        const addrLine = addr ? `<div class="prop-addr">${escapeHtml(addr)}</div>` : "";
        return `<section class="prop-group">
          <h2>${escapeHtml(propKey)}</h2>${addrLine}
          <table>
            <thead><tr>
              <th>Gjest</th><th>Rom</th><th>Dørkode</th><th>Periode</th><th>Lengde</th><th>Status</th><th>Ref</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
      }).join("");

      const html = `<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8"><title>2GM — Mine bookinger</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#222;margin:18mm;font-size:12px;line-height:1.4}
  header{border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:baseline;gap:24px;flex-wrap:wrap}
  header h1{margin:0;font-size:18px;font-weight:600}
  header .meta{font-size:11px;color:#666}
  .prop-group{margin-bottom:22px;break-inside:avoid}
  .prop-group h2{font-size:13px;margin:0 0 2px;border-bottom:1px solid #999;padding-bottom:3px}
  .prop-addr{font-size:11px;color:#666;margin-bottom:6px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{padding:5px 7px;text-align:left;border-bottom:.5px solid #ddd;vertical-align:top}
  th{background:#f0f0f0;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  td.ref{font-family:Consolas,monospace;font-size:10px;color:#666}
  footer{margin-top:24px;font-size:10px;color:#999;text-align:center;border-top:.5px solid #ddd;padding-top:8px}
  @media print{body{margin:10mm}@page{margin:10mm}}
</style></head><body>
  <header>
    <h1>2GM Eiendom — Mine bookinger</h1>
    <div class="meta">${escapeHtml(filterLabel)} · ${escapeHtml(String(bookings.length))} bookinger · skrevet ut ${escapeHtml(printedAt)}</div>
  </header>
  ${groupsHtml}
  <footer>2GM Eiendom AS · Bestillingsportal</footer>
</body></html>`;

      const w = window.open("", "_blank");
      if (!w) {
        window.alert("Pop-up blokkert. Tillat pop-ups for å skrive ut.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      // Vent på onload + en kort timeout som fallback hvis onload ikke fyrer
      // (skjer på enkelte mobile nettlesere som åpner i samme prosess).
      const triggerPrint = () => { try { w.focus(); w.print(); } catch (_) {} };
      if (w.document.readyState === "complete") {
        setTimeout(triggerPrint, 200);
      } else {
        w.addEventListener("load", () => setTimeout(triggerPrint, 200));
        setTimeout(triggerPrint, 800);
      }
    },

    _applyFilter(bookings) {
      if (this._filter === "active")   return bookings.filter(b => b.status === "Active");
      if (this._filter === "upcoming") return bookings.filter(b => b.status === "Upcoming");
      return bookings;
    },

    _updateFilterButtons(bookings) {
      const counts = {
        active:   bookings.filter(b => b.status === "Active").length,
        upcoming: bookings.filter(b => b.status === "Upcoming").length,
        all:      bookings.length,
      };
      const labels = {
        active:   tx("mybookings.filterActive"),
        upcoming: tx("mybookings.filterUpcoming"),
        all:      tx("mybookings.filterAll"),
      };
      // v3.8.4: tell pending-bookinger så vi kan vise "n avventer"-badge på
      // Kommende-pillen — gjør avventer-tilstanden synlig uten å bytte filter.
      const pendingCount = bookings.filter(b => b.pendingConfirmation).length;
      document.querySelectorAll("#mybookings-filters [data-mb-filter]").forEach(btn => {
        const k = btn.getAttribute("data-mb-filter");
        const pendingPill = (k === "upcoming" && pendingCount > 0)
          ? ` <span class="mb-filter-pending">${escapeHtml(tx("mybookings.filterPending", { n: pendingCount }))}</span>`
          : "";
        btn.innerHTML = `${escapeHtml(labels[k])} <span class="mb-filter-count">(${counts[k]})</span>${pendingPill}`;
        btn.classList.toggle("is-active", k === this._filter);
      });
    },

    // v3.8.4: lar booking.js bytte filter etter en vellykket innsending så
    // den nye bookingen er synlig uten at kunden må klikke "Kommende".
    setFilter(name) {
      if (name !== "active" && name !== "upcoming" && name !== "all") return;
      if (name === this._filter) return;
      this._filter = name;
      // Re-render hvis vi har data; ellers blir filteret brukt ved neste render.
      if (this._lastBookings && this._lastBookings.length) {
        this._render(this._lastBookings, true);
      }
    },

    _render(bookings, silent) {
      // v3.9.2: detekter Upcoming → Active-transisjon (admin tildelte rom +
      // check-in dato passerte → status flippet automatisk i backend).
      // Hvis kunden står på "Kommende"-fanen og en booking nettopp ble aktiv,
      // bytt til "Aktive" så den nye live-bookingen er åpenbart synlig.
      // Ignorerer "all"-filteret (kunden har eksplisitt valgt det) og
      // "active" (allerede riktig fane).
      const wasUpcomingIds = new Set();
      for (const b of (this._lastBookings || [])) {
        if (b && b.status === "Upcoming") wasUpcomingIds.add(b.id);
      }
      const newlyActive = (bookings || []).some(b => b && b.status === "Active" && wasUpcomingIds.has(b.id));
      if (newlyActive && this._filter === "upcoming") {
        this._filter = "active";
      }

      // v3.7.8: cache full liste så filter-bytte kan re-rendre uten ny fetch
      // v3.11.3: hvis ingen ekte bookinger, inject demo-bookinger så kunden
      // ser hvordan portalen vil se ut. Forsvinner automatisk når første
      // ekte booking er gjort.
      this._isShowingDemo = false;
      const realBookings = bookings || [];
      if (realBookings.length === 0) {
        this._lastBookings = buildDemoBookings();
        this._isShowingDemo = true;
      } else {
        this._lastBookings = realBookings;
      }
      const totalCount = this._lastBookings.length;

      // Oppdater filter-knappenes counts uansett (også når 0)
      this._updateFilterButtons(this._lastBookings);

      if (totalCount === 0) {
        this._setState("empty");
        if (this.countEl) this.countEl.textContent = "";
        return;
      }

      const filtered = this._applyFilter(this._lastBookings);
      const count = filtered.length;

      if (count === 0) {
        // Filter har truffet 0 — vis filterspesifikk empty-message
        this._setState("empty");
        if (this.emptyEl) {
          if (this._filter === "active") this.emptyEl.textContent = tx("mybookings.emptyActive");
          else if (this._filter === "upcoming") this.emptyEl.textContent = tx("mybookings.emptyUpcoming");
          else this.emptyEl.textContent = tx("mybookings.empty");
        }
        if (this.countEl) this.countEl.textContent = "";
        return;
      }

      this._setState("list");

      // v3.7.9: vis bare antallet — header er kompakt nok at "55 row" ble støy.
      // v3.11.4: bruk totalen (ikke filtrert) så sirkelen bak «Mine bookinger»
      // alltid viser hvor mange bookinger kunden faktisk har. Skjul den helt
      // i demo-modus så telleren ikke villeder kunden.
      if (this.countEl) {
        if (this._isShowingDemo) {
          this.countEl.hidden = true;
          this.countEl.textContent = "";
        } else {
          this.countEl.hidden = false;
          this.countEl.textContent = String(totalCount);
        }
      }

      // v3.10.10: ikke utvid panelet automatisk — kun "+ Ny bestilling" er
      // åpen som default. Brukeren åpner Mine bookinger ved å klikke tab
      // eller chevron i headeren.

      this.listEl.innerHTML = "";

      // v3.11.3: demo-banner — én linje øverst i lista som forteller
      // kunden at dette er en eksempelvisning. Forsvinner med demoene
      // når første ekte booking er på plass.
      if (this._isShowingDemo) {
        const banner = document.createElement("li");
        banner.className = "mb-demo-banner";
        banner.textContent = tx("mybookings.demoBanner");
        this.listEl.appendChild(banner);
      }

      // v3.5.3: gruppér på lokasjon (b.property) og sorter rom stigende
      // innenfor hver gruppe. Hjelper kunder med mange bookinger spredt
      // over flere bygg å lese lista raskt.
      const groups = new Map();
      for (const b of filtered) {
        const key = (b.property || "").trim() || tx("mybookings.noLocation");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
      const sortedKeys = Array.from(groups.keys())
        .sort((a, b) => a.localeCompare(b, "nb", { sensitivity: "base" }));
      for (const key of sortedKeys) {
        groups.get(key).sort((a, b) => {
          const an = String(a.roomNumber || "");
          const bn = String(b.roomNumber || "");
          if (!an && !bn) return 0;
          if (!an) return 1;
          if (!bn) return -1;
          return an.localeCompare(bn, undefined, { numeric: true });
        });
      }

      for (const key of sortedKeys) {
        const group = groups.get(key);
        const header = document.createElement("li");
        header.className = "mb-group-header";
        header.textContent = `${key} · ${group.length}`;
        this.listEl.appendChild(header);
        for (const b of group) {
          this.listEl.appendChild(this._renderBookingCard(b));
        }
      }
    },

    _renderBookingCard(b) {
      const row = document.createElement("li");
      row.className = "mb-row mb-card";

      // ----- VENSTRE: navn + property/rom + adresse -----
      const left = document.createElement("div");
      left.className = "mb-card-col-left";

      const nameEl = document.createElement("div");
      nameEl.className = "mb-card-name";
      nameEl.textContent = b.guest || tx("mybookings.unnamed");
      left.appendChild(nameEl);

      // v3.6.1: rom og lokasjon på hver sin linje — rom prominent (primær,
      // 13/600), lokasjon mykere under (11/500, sekundær). Ikonet flankerer.
      const propEl = document.createElement("div");
      propEl.className = "mb-card-prop";
      const roomTxt = b.roomNumber ? tx("mybookings.room", { n: b.roomNumber }) : "";
      const locTxt  = b.property || "—";
      const inner = b.roomNumber
        ? `<span class="mb-card-prop-room">${escapeHtml(roomTxt)}</span><span class="mb-card-prop-loc">${escapeHtml(locTxt)}</span>`
        : `<span class="mb-card-prop-room">${escapeHtml(locTxt)}</span>`;
      propEl.innerHTML = SVG_BUILDING + `<span class="mb-card-prop-text">${inner}</span>`;
      left.appendChild(propEl);

      if (b.propertyAddress) {
        const addrEl = document.createElement("div");
        addrEl.className = "mb-card-addr";
        addrEl.textContent = b.propertyAddress;
        left.appendChild(addrEl);
      }
      row.appendChild(left);

      // ----- MIDT: dørkode med nøkkel-ikon (auto-bredde) -----
      const mid = document.createElement("div");
      mid.className = "mb-card-col-mid";
      if (b.roomNumber) {
        mid.innerHTML = SVG_KEY;
        const codeSpan = document.createElement("span");
        if (b.doorCode) {
          codeSpan.className = "mb-card-doorcode-value";
          codeSpan.textContent = formatDoorCodeDigits(b.doorCode);
        } else {
          codeSpan.className = "mb-card-doorcode-pending";
          codeSpan.textContent = tx("mybookings.doorCodePending");
        }
        mid.appendChild(codeSpan);
      }
      row.appendChild(mid);

      // ----- HØYRE: dato + netter + status·ref -----
      const right = document.createElement("div");
      right.className = "mb-card-col-right";

      const datesEl = document.createElement("div");
      datesEl.className = "mb-card-dates";
      datesEl.textContent = formatBookingDates(b.checkIn, b.checkOut);
      right.appendChild(datesEl);

      const nightsEl = document.createElement("div");
      nightsEl.className = "mb-card-nights";
      if (b.checkOut) {
        const n = nightsBetween(b.checkIn, b.checkOut);
        nightsEl.textContent = tx(n === 1 ? "mybookings.nightsOne" : "mybookings.nightsMany", { n });
      } else {
        nightsEl.textContent = tx("mybookings.openPeriod");
      }
      right.appendChild(nightsEl);

      const metaEl = document.createElement("div");
      metaEl.className = "mb-card-meta";
      metaEl.appendChild(statusBadge(b.status, b.pendingConfirmation));
      if (b.ref) {
        const refEl = document.createElement("span");
        refEl.className = "mb-card-ref";
        refEl.textContent = b.ref;
        metaEl.appendChild(refEl);
      }
      right.appendChild(metaEl);
      row.appendChild(right);

      // ----- Klikkbar kort: åpner action-meny hvis det finnes valg å gjøre -----
      // v3.5.2: åpner menyen for ALLE Active/Upcoming-bookinger, også
      // open-ended (uten checkOut) — kunden trenger Avslutt-handlingen
      // selv (kanskje særlig) når oppholdet er åpent.
      // v3.11.3: demo-bookinger er ikke klikkbare — ingen action-meny.
      const canEdit = !b._isDemo && (b.status === "Active" || b.status === "Upcoming");
      if (canEdit) {
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
    const smsBtnHtml = () =>
      `<button type="button" data-action="sms-doorcode" class="action-menu-btn action-menu-btn-with-hint">
         <span class="action-menu-btn-label">${escapeHtml(tx("mybookings.smsDoorcode"))}</span>
         <small class="action-menu-btn-hint">${escapeHtml(tx("mybookings.smsCostHint"))}</small>
       </button>`;
    if (dlg) {
      // Re-render etiketter ved evt. språkbytte mellom kall
      dlg.querySelector(".action-menu-title").textContent  = tx("mybookings.actionsTitle");
      dlg.querySelector('[data-action="extend"]').textContent = tx("mybookings.extend");
      const endBtn = dlg.querySelector('[data-action="end"]');
      if (endBtn) endBtn.textContent = tx("mybookings.endRental");
      const smsBtn = dlg.querySelector('[data-action="sms-doorcode"]');
      if (smsBtn) {
        // v3.10.17: Erstatter hele knappen så både hovedtekst og hint
        // oppdateres ved språkbytte.
        smsBtn.outerHTML = smsBtnHtml();
      }
      dlg.querySelector('[data-action="close"]').textContent  = tx("extend.cancel");
      return dlg;
    }
    if (typeof HTMLDialogElement === "undefined") return null;

    dlg = document.createElement("dialog");
    dlg.id = "actionMenu";
    dlg.className = "extend-dlg action-menu";
    dlg.innerHTML = `
      <div class="extend-dlg-form action-menu-form">
        <h3 class="extend-dlg-title action-menu-title">${escapeHtml(tx("mybookings.actionsTitle"))}</h3>
        <div class="action-menu-buttons">
          <button type="button" data-action="extend" class="action-menu-btn action-menu-btn-primary">${escapeHtml(tx("mybookings.extend"))}</button>
          <button type="button" data-action="end"    class="action-menu-btn">${escapeHtml(tx("mybookings.endRental"))}</button>
          ${smsBtnHtml()}
          <button type="button" data-action="close"  class="action-menu-btn">${escapeHtml(tx("extend.cancel"))}</button>
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
      } else if (action === "end") {
        const b = dlg._booking;
        const ref = dlg._mybookingsRef;
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
        openEndDialog(b, ref);
      } else if (action === "sms-doorcode") {
        const b = dlg._booking;
        const ref = dlg._mybookingsRef;
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
        sendDoorcodeOnSms(b, ref);
      }
    });

    return dlg;
  }

  // v3.10.15-17: Sender dørkode på SMS til gjesten. Først prøver backend å
  // finne nummeret i Persons-lista; hvis det mangler åpner vi en dialog så
  // kunden kan taste inn nummeret manuelt. Tjenesten koster 5 kr som
  // logges på bookingens Notes-felt for fakturering.
  async function sendDoorcodeOnSms(booking, mybookingsRef) {
    if (!booking || !mybookingsRef) return;
    if (!booking.doorCode) {
      window.alert(tx("sms.errNoCode"));
      return;
    }
    const guest = booking.guest || tx("mybookings.unnamed");
    const confirmMsg =
      `${tx("sms.confirm", { guest })}\n\n` +
      `${tx("sms.costNote")}`;
    if (!window.confirm(confirmMsg)) return;

    await _trySendDoorcode(booking, mybookingsRef, null, guest);
  }

  async function _trySendDoorcode(booking, mybookingsRef, phoneOverride, guest) {
    const payload = {
      token: mybookingsRef.token,
      bookingRef: booking.ref,
    };
    if (phoneOverride) payload.phoneOverride = phoneOverride;

    const res = await window.Api.sendDoorcodeSms(payload);
    if (res && res.ok) {
      window.alert(tx("sms.success", { phone: res.sentTo }));
      return;
    }
    const err = (res && res.error) || "unknown";
    // Mangler nummer i Persons → tilby manuell inntasting.
    if (err === "no_phone" && !phoneOverride) {
      openManualPhoneDialog(booking, mybookingsRef, guest);
      return;
    }
    const map = {
      no_door_code:     tx("sms.errNoCode"),
      no_room_assigned: tx("sms.errNoRoom"),
      not_your_booking: tx("sms.errNotYours"),
      invalid_token:    tx("sms.errExpired"),
      invalid_phone:    tx("sms.manualInvalid"),
      sms_failed:       tx("sms.errFailed", { err: (res && res.detail) || "?" }),
    };
    window.alert(map[err] || tx("sms.errFailed", { err }));
  }

  // v3.10.17: Manuell telefon-inntastings-dialog. Åpnes automatisk hvis
  // backend rapporterer no_phone (gjest mangler nummer i Persons-lista).
  function openManualPhoneDialog(booking, mybookingsRef, guest) {
    const dlg = ensureManualPhoneDialog();
    if (!dlg) {
      const ans = window.prompt(
        tx("sms.manualPrompt", { guest }) + "\n\n" + tx("sms.costNote"),
        "+47"
      );
      if (ans) _trySendDoorcode(booking, mybookingsRef, ans, guest);
      return;
    }
    dlg._booking = booking;
    dlg._mybookingsRef = mybookingsRef;
    dlg._guest = guest;
    dlg.querySelector(".extend-dlg-title").textContent = tx("sms.manualTitle");
    dlg.querySelector(".extend-dlg-sub").textContent = tx("sms.manualPrompt", { guest });
    dlg.querySelector(".extend-dlg-newdate-label").textContent = tx("sms.manualLabel");
    const input = dlg.querySelector("input[name=phone]");
    input.placeholder = tx("sms.manualPlaceholder");
    input.value = "+47";
    dlg.querySelector(".sms-cost-note").textContent = tx("sms.costNote");
    dlg.querySelector('[data-action="cancel"]').textContent = tx("sms.manualCancel");
    dlg.querySelector('[data-action="submit"]').textContent = tx("sms.manualSend");
    dlg.querySelector(".extend-dlg-msg").textContent = "";
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    // Litt forsinket fokus så dialog-animasjonen rekker å starte først
    setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 50);
  }

  function ensureManualPhoneDialog() {
    let dlg = document.getElementById("smsPhoneDialog");
    if (dlg) return dlg;
    if (typeof HTMLDialogElement === "undefined") return null;
    dlg = document.createElement("dialog");
    dlg.id = "smsPhoneDialog";
    dlg.className = "extend-dlg";
    dlg.innerHTML = `
      <form method="dialog" class="extend-dlg-form">
        <h3 class="extend-dlg-title"></h3>
        <p class="extend-dlg-sub"></p>
        <label class="field">
          <span class="field-label extend-dlg-newdate-label"></span>
          <input type="tel" name="phone" required autocomplete="tel" />
        </label>
        <p class="sms-cost-note" style="font-size:11px;color:var(--color-text-tertiary);margin:4px 0 0"></p>
        <p class="extend-dlg-msg" aria-live="polite"></p>
        <div class="extend-dlg-buttons">
          <button type="button" class="btn btn-ghost" data-action="cancel"></button>
          <button type="button" class="btn btn-primary" data-action="submit"></button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", async (e) => {
      const action = e.target?.dataset?.action;
      if (action === "cancel") {
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
      } else if (action === "submit") {
        const input = dlg.querySelector("input[name=phone]");
        const value = (input.value || "").trim();
        const cleaned = value.replace(/[\s\-()]/g, "");
        if (!/^\+?\d{8,}$/.test(cleaned)) {
          dlg.querySelector(".extend-dlg-msg").textContent = tx("sms.manualInvalid");
          return;
        }
        const submitBtn = dlg.querySelector('[data-action="submit"]');
        submitBtn.disabled = true;
        dlg.querySelector(".extend-dlg-msg").textContent = "…";
        await _trySendDoorcode(dlg._booking, dlg._mybookingsRef, cleaned, dlg._guest);
        submitBtn.disabled = false;
        dlg.close ? dlg.close() : dlg.removeAttribute("open");
      }
    });

    return dlg;
  }

  // ---- Avslutt-leien-dialog (v3.5.2) ----
  // Brukt både for open-ended bookinger (sett ny utflyttingsdato) og for
  // å forkorte et eksisterende opphold. API'et er separat fra extend så
  // valideringen kan være motsatt: req må være >= i dag og >= check-in,
  // men kan godt være FØR nåværende Check_Out.
  function openEndDialog(booking, mybookingsRef) {
    const dlg = ensureEndDialog();
    if (!dlg) {
      const ans = window.prompt(
        tx("end.fallbackPrompt", { ref: booking.ref }),
        new Date().toISOString().slice(0, 10)
      );
      if (ans) submitEnd(booking, ans, mybookingsRef);
      return;
    }

    const refTxt     = booking.ref;
    const currentTxt = booking.checkOut
      ? (formatIso(booking.checkOut) || booking.checkOut)
      : tx("end.openEnded");
    const subRaw     = tx("end.subPart", { ref: "{REF}", current: "{CUR}" });
    const subSafe    = subRaw
      .replace("{REF}",  `<strong>${escapeHtml(refTxt)}</strong>`)
      .replace("{CUR}",  `<strong>${escapeHtml(String(currentTxt))}</strong>`);
    dlg.querySelector(".extend-dlg-sub").innerHTML = subSafe;

    dlg.querySelector(".extend-dlg-title").textContent = tx("end.title");
    dlg.querySelector(".extend-dlg-newdate-label").textContent = tx("end.newDate");
    dlg.querySelector('[data-action="cancel"]').textContent = tx("extend.cancel");
    dlg.querySelector('[data-action="submit"]').textContent = tx("end.send");

    const input = dlg.querySelector("input[name=newDate]");
    const todayIso = new Date().toISOString().slice(0, 10);
    // Min: enten check-in (hvis i fremtiden) eller i dag
    const minIso = (booking.checkIn && booking.checkIn > todayIso) ? booking.checkIn : todayIso;
    input.min = minIso;
    input.value = todayIso > minIso ? todayIso : minIso;
    dlg.querySelector(".extend-dlg-msg").textContent = "";

    dlg._booking = booking;
    dlg._mybookingsRef = mybookingsRef;

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function ensureEndDialog() {
    let dlg = document.getElementById("endDialog");
    if (dlg) return dlg;

    if (typeof HTMLDialogElement === "undefined") return null;

    dlg = document.createElement("dialog");
    dlg.id = "endDialog";
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
        const todayIso = new Date().toISOString().slice(0, 10);
        const minIso = (booking.checkIn && booking.checkIn > todayIso) ? booking.checkIn : todayIso;
        if (value < minIso) {
          dlg.querySelector(".extend-dlg-msg").textContent =
            tx("end.errMin", { date: formatIso(minIso) || minIso });
          return;
        }
        submitEnd(booking, value, dlg._mybookingsRef, dlg);
      }
    });

    return dlg;
  }

  async function submitEnd(booking, requestedCheckOut, mybookingsRef, dlg) {
    const msgEl = dlg ? dlg.querySelector(".extend-dlg-msg") : null;
    const submitBtn = dlg ? dlg.querySelector('[data-action="submit"]') : null;

    if (msgEl) msgEl.textContent = tx("end.sending");
    if (submitBtn) submitBtn.disabled = true;

    const res = await window.Api.requestEnd({
      token: mybookingsRef.token,
      bookingRef: booking.ref,
      requestedCheckOut,
    });

    if (submitBtn) submitBtn.disabled = false;

    if (!res || !res.ok) {
      const err = (res && res.error) || "unknown";
      if (msgEl) msgEl.textContent = tx("end.errFail", { err });
      else window.alert(tx("end.fallbackFail", { err }));
      return;
    }

    if (dlg) {
      dlg.close ? dlg.close() : dlg.removeAttribute("open");
    }
    window.alert(tx("end.success"));
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

  // v3.4.0: _infoItem / _doorCodeItem ble fjernet — kortet bygges nå
  // direkte i _renderBookingCard med 3-kolonne grid.

  // ---- Toggle-håndtering: layout + panel-collapse ----
  // v3.7.9: topbar-CTA og Ny bestilling-lukk-knappen er fjernet — Tilgjengelighet
  // og Ny bestilling er alltid synlige. setLayoutVisible kalles fortsatt fra
  // gamle stier (loading/feil) men gjør nå alltid layout synlig.
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

  function setLayoutVisible(_visible) {
    // v3.7.9: layout er alltid synlig — funksjonen finnes for bakoverkompatibilitet
    // med gamle kall, men ignorerer argumentet.
    const layout = document.getElementById("mainLayout");
    if (layout && layout.hidden) layout.hidden = false;
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
