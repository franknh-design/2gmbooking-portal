/* =========================================================
   Fakturaarkiv (Invoice archive).
   v1.0
   - Henter historiske opphold for innlogget kunde via Api.getInvoiceArchive
   - Tabell gruppert per måned med antall bookinger + totale netter
   - Klikk på rad → utvider og viser detaljerte bookinger (rom, gjest, dato)
   - Søk: filter på gjestenavn, rom eller måned (NB+EN labels)
   - Sortering: klikk på kolonneoverskrift (Periode default ↓)
   - Last ned: PDF (popup-print) eller XLSX (CSV med BOM — Excel åpner som UTF-8)
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatIsoDate(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function localizedMonthLabel(group) {
    const lang = (window.I18n && window.I18n.getLang) ? window.I18n.getLang() : "nb";
    return lang === "en" ? group.label : group.labelNb;
  }

  function nightsLabel(n) {
    return tx("invoices.totalNights", { n });
  }

  const Invoices = {
    token: null,
    container: null,
    listEl: null,
    emptyEl: null,
    loadingEl: null,
    errorEl: null,
    countEl: null,
    searchEl: null,

    _archive: [],
    _sortKey: "period",
    _sortDir: "desc",
    _searchQuery: "",
    _expanded: new Set(),

    init({ token }) {
      this.token = token || null;
      this.container = document.getElementById("invoices-panel");
      if (!this.container) return;

      this.listEl    = document.getElementById("invoices-list");
      this.emptyEl   = document.getElementById("invoices-empty");
      this.loadingEl = document.getElementById("invoices-loading");
      this.errorEl   = document.getElementById("invoices-error");
      this.countEl   = document.getElementById("invoices-count");
      this.searchEl  = document.getElementById("invoices-search");

      this._wirePanelToggle();
      this._wireSearch();
      this._wireSortHeaders();

      if (!this.token) {
        this.container.hidden = true;
        return;
      }

      this.container.hidden = false;
      this.refresh();
    },

    async refresh() {
      if (!this.token || !this.container) return;
      this._setState("loading");
      const res = await window.Api.getInvoiceArchive(this.token);
      if (!res || !res.ok) {
        this._setState("error");
        return;
      }
      this._archive = Array.isArray(res.archive) ? res.archive : [];
      this._render();
    },

    _setState(state) {
      if (this.loadingEl) this.loadingEl.hidden = state !== "loading";
      if (this.errorEl)   this.errorEl.hidden   = state !== "error";
      if (this.emptyEl)   this.emptyEl.hidden   = state !== "empty";
      if (this.listEl)    this.listEl.hidden    = state !== "list";
      if (this.countEl)   this.countEl.hidden   = state !== "list";
    },

    _wirePanelToggle() {
      const toggle = document.getElementById("invoices-toggle");
      if (!toggle || toggle._wired) return;
      toggle._wired = true;
      toggle.addEventListener("click", () => {
        const collapsed = this.container.classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
    },

    _wireSearch() {
      if (!this.searchEl || this.searchEl._wired) return;
      this.searchEl._wired = true;
      this.searchEl.addEventListener("input", () => {
        this._searchQuery = (this.searchEl.value || "").trim().toLowerCase();
        this._render();
      });
    },

    _wireSortHeaders() {
      const headers = document.querySelectorAll("#invoices-table th[data-sort-key]");
      headers.forEach(th => {
        if (th._wired) return;
        th._wired = true;
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-sort-key");
          if (this._sortKey === key) {
            this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
          } else {
            this._sortKey = key;
            this._sortDir = key === "period" ? "desc" : "asc";
          }
          this._render();
        });
      });
    },

    _filterArchive() {
      const q = this._searchQuery;
      if (!q) return this._archive;

      return this._archive.map(group => {
        const labelMatches =
          group.label.toLowerCase().includes(q) ||
          group.labelNb.toLowerCase().includes(q) ||
          group.period.toLowerCase().includes(q);
        const matchingBookings = (group.bookings || []).filter(b => {
          const room = String(b.roomNumber || "").toLowerCase();
          const guest = String(b.guest || "").toLowerCase();
          const prop = String(b.property || "").toLowerCase();
          return room.includes(q) || guest.includes(q) || prop.includes(q);
        });
        if (labelMatches) return group;
        if (matchingBookings.length === 0) return null;
        return Object.assign({}, group, {
          bookings: matchingBookings,
          bookingCount: matchingBookings.length,
          totalNights: matchingBookings.reduce((s, b) => s + (b.nights || 0), 0),
          _matched: true,
        });
      }).filter(Boolean);
    },

    _sortArchive(groups) {
      const dir = this._sortDir === "asc" ? 1 : -1;
      const key = this._sortKey;
      const arr = groups.slice();
      arr.sort((a, b) => {
        let av, bv;
        if (key === "period") {
          av = a.period; bv = b.period;
        } else if (key === "bookings") {
          av = a.bookingCount; bv = b.bookingCount;
        } else if (key === "nights") {
          av = a.totalNights; bv = b.totalNights;
        } else if (key === "property") {
          av = (a.bookings[0] && a.bookings[0].property) || "";
          bv = (b.bookings[0] && b.bookings[0].property) || "";
        } else {
          av = ""; bv = "";
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
        return 0;
      });
      return arr;
    },

    _render() {
      if (!this.listEl) return;
      const total = this._archive.length;
      if (this.countEl) this.countEl.textContent = String(total);

      if (total === 0) {
        this._setState("empty");
        return;
      }

      const filtered = this._filterArchive();
      if (filtered.length === 0) {
        this._setState("empty");
        if (this.emptyEl) {
          this.emptyEl.textContent = tx("invoices.searchNoMatch", { q: this._searchQuery });
        }
        return;
      }

      this._setState("list");
      if (this.emptyEl) this.emptyEl.textContent = tx("invoices.empty");

      const sorted = this._sortArchive(filtered);
      this.listEl.innerHTML = sorted.map(g => this._renderGroupRow(g)).join("");
      this._updateSortIndicators();
      this._wireExpandClicks();
      this._wireActionButtons();
    },

    _renderGroupRow(g) {
      const properties = [...new Set(g.bookings.map(b => b.property).filter(Boolean))].join(", ");
      const expanded = this._expanded.has(g.period);
      const detailRow = expanded ? this._renderDetailRow(g) : "";
      const chevron = expanded ? "▾" : "▸";
      return `
        <tr class="inv-row" data-period="${escapeHtml(g.period)}">
          <td class="inv-cell-period">
            <button type="button" class="inv-expand-btn" data-period="${escapeHtml(g.period)}"
                    aria-expanded="${expanded ? "true" : "false"}">
              <span class="inv-chevron">${chevron}</span>
              <span>${escapeHtml(localizedMonthLabel(g))}</span>
            </button>
          </td>
          <td class="inv-cell-bookings num">${g.bookingCount}</td>
          <td class="inv-cell-nights num">${g.totalNights}</td>
          <td class="inv-cell-property">${escapeHtml(properties || "—")}</td>
          <td class="inv-cell-actions">
            <button type="button" class="inv-btn inv-btn-pdf"  data-action="pdf"  data-period="${escapeHtml(g.period)}">${tx("invoices.btnPdf")}</button>
            <button type="button" class="inv-btn inv-btn-xlsx" data-action="xlsx" data-period="${escapeHtml(g.period)}">${tx("invoices.btnXlsx")}</button>
          </td>
        </tr>
        ${detailRow}
      `;
    },

    _renderDetailRow(g) {
      const headers = `
        <tr>
          <th>${tx("invoices.colRoom")}</th>
          <th>${tx("invoices.colGuest")}</th>
          <th>${tx("invoices.colProperty")}</th>
          <th>${tx("invoices.colCheckIn")}</th>
          <th>${tx("invoices.colCheckOut")}</th>
          <th class="num">${tx("invoices.colNightsOne")}</th>
        </tr>`;
      const body = g.bookings.map(b => `
        <tr>
          <td>${escapeHtml(b.roomNumber || "—")}</td>
          <td>${escapeHtml(b.guest || "—")}</td>
          <td>${escapeHtml(b.property || "—")}</td>
          <td>${escapeHtml(formatIsoDate(b.checkIn))}</td>
          <td>${escapeHtml(b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded"))}</td>
          <td class="num">${b.nights == null ? "—" : b.nights}</td>
        </tr>`).join("");
      return `
        <tr class="inv-detail-row"><td colspan="5">
          <table class="inv-detail-table">
            <thead>${headers}</thead>
            <tbody>${body}</tbody>
          </table>
        </td></tr>
      `;
    },

    _updateSortIndicators() {
      const headers = document.querySelectorAll("#invoices-table th[data-sort-key]");
      headers.forEach(th => {
        const key = th.getAttribute("data-sort-key");
        th.classList.toggle("inv-sort-active", key === this._sortKey);
        th.classList.toggle("inv-sort-asc",  key === this._sortKey && this._sortDir === "asc");
        th.classList.toggle("inv-sort-desc", key === this._sortKey && this._sortDir === "desc");
      });
    },

    _wireExpandClicks() {
      const btns = this.listEl.querySelectorAll(".inv-expand-btn");
      btns.forEach(btn => {
        btn.addEventListener("click", () => {
          const p = btn.getAttribute("data-period");
          if (this._expanded.has(p)) this._expanded.delete(p);
          else this._expanded.add(p);
          this._render();
        });
      });
    },

    _wireActionButtons() {
      const btns = this.listEl.querySelectorAll(".inv-btn");
      btns.forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const period = btn.getAttribute("data-period");
          const action = btn.getAttribute("data-action");
          const group = this._archive.find(g => g.period === period);
          if (!group) return;
          if (action === "pdf") this._downloadPdf(group);
          else if (action === "xlsx") this._downloadXlsx(group);
        });
      });
    },

    _downloadPdf(group) {
      const label = localizedMonthLabel(group);
      const customer = document.getElementById("customer-badge")?.textContent || "";
      const rows = group.bookings.map(b => `
        <tr>
          <td>${escapeHtml(b.roomNumber || "—")}</td>
          <td>${escapeHtml(b.guest || "—")}</td>
          <td>${escapeHtml(b.property || "—")}</td>
          <td>${escapeHtml(formatIsoDate(b.checkIn))}</td>
          <td>${escapeHtml(b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded"))}</td>
          <td style="text-align:right">${b.nights == null ? "—" : b.nights}</td>
        </tr>`).join("");

      const html = `<!DOCTYPE html><html><head><title>${escapeHtml(tx("invoices.summary", { month: label }))}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;color:#1f2937}
  h1{font-size:18pt;margin:0 0 4px;color:#1B4F72}
  .meta{color:#6b7280;font-size:11pt;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;font-size:11pt}
  th,td{padding:6px 10px;border-bottom:.5px solid #e5e7eb;text-align:left}
  th{background:#f5f7fa;font-weight:600}
  tr:last-child td{border-bottom:0}
  .footer{margin-top:18px;color:#6b7280;font-size:9pt;text-align:center}
  .print-btn{position:fixed;top:16px;right:16px;padding:8px 14px;background:#1B4F72;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12pt}
  @media print { .print-btn{display:none} }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<h1>${escapeHtml(tx("invoices.summary", { month: label }))}</h1>
<div class="meta">${escapeHtml(customer)} · ${escapeHtml(tx("invoices.totalBookings", { n: group.bookingCount }))} · ${escapeHtml(tx("invoices.totalNights", { n: group.totalNights }))}</div>
<table>
  <thead><tr>
    <th>${escapeHtml(tx("invoices.colRoom"))}</th>
    <th>${escapeHtml(tx("invoices.colGuest"))}</th>
    <th>${escapeHtml(tx("invoices.colProperty"))}</th>
    <th>${escapeHtml(tx("invoices.colCheckIn"))}</th>
    <th>${escapeHtml(tx("invoices.colCheckOut"))}</th>
    <th style="text-align:right">${escapeHtml(tx("invoices.colNightsOne"))}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">2GM Eiendom AS · ${new Date().toLocaleDateString("nb-NO")}</div>
</body></html>`;

      const w = window.open("", "_blank");
      if (!w) { alert("Popup blocked. Allow popups to download PDF."); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch(e){} }, 400);
    },

    _downloadXlsx(group) {
      // CSV med UTF-8 BOM så Excel åpner æøå riktig.
      const sep = ";";
      const headers = [
        tx("invoices.colRoom"),
        tx("invoices.colGuest"),
        tx("invoices.colProperty"),
        tx("invoices.colCheckIn"),
        tx("invoices.colCheckOut"),
        tx("invoices.colNightsOne"),
      ];
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.map(esc).join(sep)];
      for (const b of group.bookings) {
        lines.push([
          b.roomNumber || "",
          b.guest || "",
          b.property || "",
          formatIsoDate(b.checkIn),
          b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded"),
          b.nights == null ? "" : b.nights,
        ].map(esc).join(sep));
      }
      const csv = "﻿" + lines.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fakturaarkiv-${group.period}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  // Re-render ved språkbytte (kolonneoverskrifter, knapper, månedslabels)
  document.addEventListener("i18n:change", () => {
    if (Invoices.token && Invoices._archive.length) Invoices._render();
  });

  window.Invoices = Invoices;
})();
