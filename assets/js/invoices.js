/* =========================================================
   Fakturaarkiv (Invoice archive).
   v1.1 (portal v3.10.2): klikk på booking-rad åpner grunnlags-dialog med
   per-gjest PDF/XLSX-eksport.
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

  function formatKr(amount) {
    if (amount == null || amount === "") return tx("invoices.noRate");
    return Number(amount).toLocaleString("nb-NO") + " kr";
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
        } else if (key === "amount") {
          av = a.totalAmount || 0; bv = b.totalAmount || 0;
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
      this._wireBookingRowClicks();
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
          <td class="inv-cell-amount num">${escapeHtml(formatKr(g.totalAmount))}</td>
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
          <th class="num">${tx("invoices.colRate")}</th>
          <th class="num">${tx("invoices.colAmount")}</th>
        </tr>`;
      const body = g.bookings.map((b, idx) => `
        <tr class="inv-booking-row" data-period="${escapeHtml(g.period)}" data-idx="${idx}" title="${escapeHtml(tx("invoices.viewSheet"))}">
          <td>${escapeHtml(b.roomNumber || "—")}</td>
          <td>${escapeHtml(b.guest || "—")}</td>
          <td>${escapeHtml(b.property || "—")}</td>
          <td>${escapeHtml(formatIsoDate(b.checkIn))}</td>
          <td>${escapeHtml(b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded"))}</td>
          <td class="num">${b.nights == null ? "—" : b.nights}</td>
          <td class="num">${escapeHtml(formatKr(b.rate))}</td>
          <td class="num">${escapeHtml(formatKr(b.total))}</td>
        </tr>`).join("");
      const footer = `
        <tr class="inv-detail-foot">
          <td colspan="5" style="text-align:right;font-weight:500">${escapeHtml(tx("invoices.colAmount"))}:</td>
          <td class="num">${g.totalNights}</td>
          <td></td>
          <td class="num" style="font-weight:600">${escapeHtml(formatKr(g.totalAmount))}</td>
        </tr>`;
      return `
        <tr class="inv-detail-row"><td colspan="6">
          <table class="inv-detail-table">
            <thead>${headers}</thead>
            <tbody>${body}</tbody>
            <tfoot>${footer}</tfoot>
          </table>
          <p class="inv-amount-note">${escapeHtml(tx("invoices.amountNote"))}</p>
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

    _wireBookingRowClicks() {
      const rows = this.listEl.querySelectorAll(".inv-booking-row");
      rows.forEach(tr => {
        tr.addEventListener("click", () => {
          const period = tr.getAttribute("data-period");
          const idx = parseInt(tr.getAttribute("data-idx"), 10);
          const group = this._archive.find(g => g.period === period);
          if (!group) return;
          const booking = group.bookings[idx];
          if (!booking) return;
          this._openGuestSheet(group, booking);
        });
      });
    },

    _openGuestSheet(group, booking) {
      const dlgId = "inv-guest-dlg";
      let dlg = document.getElementById(dlgId);
      if (!dlg) {
        dlg = document.createElement("dialog");
        dlg.id = dlgId;
        dlg.className = "inv-guest-dlg";
        document.body.appendChild(dlg);
      }
      const monthLabel = localizedMonthLabel(group);
      const checkOutLabel = booking.checkOut ? formatIsoDate(booking.checkOut) : tx("invoices.openEnded");
      const rows = [
        [tx("invoices.colRef"),       booking.ref || "—"],
        [tx("invoices.colGuest"),     booking.guest || "—"],
        [tx("invoices.colProperty"),  booking.property || "—"],
        [tx("invoices.colRoom"),      booking.roomNumber || "—"],
        [tx("invoices.colCheckIn"),   formatIsoDate(booking.checkIn)],
        [tx("invoices.colCheckOut"),  checkOutLabel],
        [tx("invoices.colNightsOne"), booking.nights == null ? "—" : String(booking.nights)],
        [tx("invoices.colRate"),      formatKr(booking.rate)],
        [tx("invoices.colAmount"),    formatKr(booking.total)],
        [tx("invoices.colPeriod"),    monthLabel],
        [tx("invoices.colStatus"),    booking.status || "—"],
      ];
      const rowsHtml = rows.map(([k, v]) => `
        <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>
      `).join("");
      dlg.innerHTML = `
        <form method="dialog" class="inv-guest-form">
          <h3 class="inv-guest-title">${escapeHtml(tx("invoices.guestSheet", { guest: booking.guest || "—" }))}</h3>
          <table class="inv-guest-table"><tbody>${rowsHtml}</tbody></table>
          <p class="inv-amount-note">${escapeHtml(tx("invoices.amountNote"))}</p>
          <div class="inv-guest-actions">
            <button type="button" class="inv-btn inv-btn-pdf"  data-action="pdf">${tx("invoices.btnPdf")}</button>
            <button type="button" class="inv-btn inv-btn-xlsx" data-action="xlsx">${tx("invoices.btnXlsx")}</button>
            <button type="submit" class="inv-btn inv-btn-close">${tx("invoices.close")}</button>
          </div>
        </form>`;
      dlg.querySelector('[data-action="pdf"]').addEventListener("click", () => {
        this._downloadGuestPdf(group, booking);
      });
      dlg.querySelector('[data-action="xlsx"]').addEventListener("click", () => {
        this._downloadGuestXlsx(group, booking);
      });
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    },

    _downloadGuestPdf(group, b) {
      const label = localizedMonthLabel(group);
      const customer = document.getElementById("customer-badge")?.textContent || "";
      const co = b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded");
      const rows = [
        [tx("invoices.colRef"),       b.ref || "—"],
        [tx("invoices.colGuest"),     b.guest || "—"],
        [tx("invoices.colProperty"),  b.property || "—"],
        [tx("invoices.colRoom"),      b.roomNumber || "—"],
        [tx("invoices.colCheckIn"),   formatIsoDate(b.checkIn)],
        [tx("invoices.colCheckOut"),  co],
        [tx("invoices.colNightsOne"), b.nights == null ? "—" : String(b.nights)],
        [tx("invoices.colRate"),      formatKr(b.rate)],
        [tx("invoices.colAmount"),    formatKr(b.total)],
        [tx("invoices.colPeriod"),    label],
        [tx("invoices.colStatus"),    b.status || "—"],
      ].map(([k, v]) => `<tr><th style="text-align:left;background:#f5f7fa;padding:6px 10px;border-bottom:.5px solid #e5e7eb;width:35%">${escapeHtml(k)}</th><td style="padding:6px 10px;border-bottom:.5px solid #e5e7eb">${escapeHtml(v)}</td></tr>`).join("");

      const html = `<!DOCTYPE html><html><head><title>${escapeHtml(tx("invoices.guestSheet", { guest: b.guest || "—" }))}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;color:#1f2937}
  h1{font-size:18pt;margin:0 0 4px;color:#1B4F72}
  .meta{color:#6b7280;font-size:11pt;margin-bottom:14px}
  .note{color:#6b7280;font-size:9pt;margin:8px 0 0;font-style:italic}
  table{border-collapse:collapse;width:100%;font-size:11pt}
  tr:last-child th,tr:last-child td{border-bottom:0}
  .footer{margin-top:18px;color:#6b7280;font-size:9pt;text-align:center}
  .print-btn{position:fixed;top:16px;right:16px;padding:8px 14px;background:#1B4F72;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12pt}
  @media print { .print-btn{display:none} }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<h1>${escapeHtml(tx("invoices.guestSheet", { guest: b.guest || "—" }))}</h1>
<div class="meta">${escapeHtml(customer)} · ${escapeHtml(label)}</div>
<table><tbody>${rows}</tbody></table>
<p class="note">${escapeHtml(tx("invoices.amountNote"))}</p>
<div class="footer">2GM Eiendom AS · ${new Date().toLocaleDateString("nb-NO")}</div>
</body></html>`;

      const w = window.open("", "_blank");
      if (!w) { alert("Popup blocked. Allow popups to download PDF."); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch(e){} }, 400);
    },

    _downloadGuestXlsx(group, b) {
      const sep = ";";
      const co = b.checkOut ? formatIsoDate(b.checkOut) : tx("invoices.openEnded");
      const rows = [
        [tx("invoices.colRef"),       b.ref || ""],
        [tx("invoices.colGuest"),     b.guest || ""],
        [tx("invoices.colProperty"),  b.property || ""],
        [tx("invoices.colRoom"),      b.roomNumber || ""],
        [tx("invoices.colCheckIn"),   formatIsoDate(b.checkIn)],
        [tx("invoices.colCheckOut"),  co],
        [tx("invoices.colNightsOne"), b.nights == null ? "" : String(b.nights)],
        [tx("invoices.colRate"),      b.rate == null ? "" : String(b.rate)],
        [tx("invoices.colAmount"),    b.total == null ? "" : String(b.total)],
        [tx("invoices.colPeriod"),    localizedMonthLabel(group)],
        [tx("invoices.colStatus"),    b.status || ""],
      ];
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = rows.map(r => r.map(esc).join(sep));
      const csv = "﻿" + lines.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = String(b.guest || "gjest").replace(/[^\w\d-]+/g, "_").slice(0, 40) || "gjest";
      a.download = `grunnlag-${safeName}-${group.period}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          <td style="text-align:right">${escapeHtml(formatKr(b.rate))}</td>
          <td style="text-align:right">${escapeHtml(formatKr(b.total))}</td>
        </tr>`).join("");

      const html = `<!DOCTYPE html><html><head><title>${escapeHtml(tx("invoices.summary", { month: label }))}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;color:#1f2937}
  h1{font-size:18pt;margin:0 0 4px;color:#1B4F72}
  .meta{color:#6b7280;font-size:11pt;margin-bottom:14px}
  .note{color:#6b7280;font-size:9pt;margin:8px 0 0;font-style:italic}
  table{border-collapse:collapse;width:100%;font-size:11pt}
  th,td{padding:6px 10px;border-bottom:.5px solid #e5e7eb;text-align:left}
  th{background:#f5f7fa;font-weight:600}
  tr:last-child td{border-bottom:0}
  tfoot td{font-weight:600;background:#fafafa}
  .footer{margin-top:18px;color:#6b7280;font-size:9pt;text-align:center}
  .print-btn{position:fixed;top:16px;right:16px;padding:8px 14px;background:#1B4F72;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12pt}
  @media print { .print-btn{display:none} }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<h1>${escapeHtml(tx("invoices.summary", { month: label }))}</h1>
<div class="meta">${escapeHtml(customer)} · ${escapeHtml(tx("invoices.totalBookings", { n: group.bookingCount }))} · ${escapeHtml(tx("invoices.totalNights", { n: group.totalNights }))} · ${escapeHtml(formatKr(group.totalAmount))}</div>
<table>
  <thead><tr>
    <th>${escapeHtml(tx("invoices.colRoom"))}</th>
    <th>${escapeHtml(tx("invoices.colGuest"))}</th>
    <th>${escapeHtml(tx("invoices.colProperty"))}</th>
    <th>${escapeHtml(tx("invoices.colCheckIn"))}</th>
    <th>${escapeHtml(tx("invoices.colCheckOut"))}</th>
    <th style="text-align:right">${escapeHtml(tx("invoices.colNightsOne"))}</th>
    <th style="text-align:right">${escapeHtml(tx("invoices.colRate"))}</th>
    <th style="text-align:right">${escapeHtml(tx("invoices.colAmount"))}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="5" style="text-align:right">${escapeHtml(tx("invoices.colAmount"))}</td>
    <td style="text-align:right">${group.totalNights}</td>
    <td></td>
    <td style="text-align:right">${escapeHtml(formatKr(group.totalAmount))}</td>
  </tr></tfoot>
</table>
<p class="note">${escapeHtml(tx("invoices.amountNote"))}</p>
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
        tx("invoices.colRate"),
        tx("invoices.colAmount"),
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
          b.rate == null ? "" : b.rate,
          b.total == null ? "" : b.total,
        ].map(esc).join(sep));
      }
      // Total-rad
      lines.push([
        "",
        "",
        "",
        "",
        tx("invoices.colAmount"),
        group.totalNights,
        "",
        group.totalAmount || 0,
      ].map(esc).join(sep));
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
