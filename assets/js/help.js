/* =========================================================
   Hjelp-modal i portalen.
   v1.0
   - "? Hjelp"-knapp i topbar åpner modal med kortfattet guide.
   - Innholdet er strukturert i seksjoner; tekster ligger i i18n.js
     under help.* og følger automatisk valgt språk (NO/EN).
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }

  let dlg = null;

  const SECTIONS = [
    { icon: "👋", titleKey: "help.welcome.title",   bodyKey: "help.welcome.body"   },
    { icon: "🔑", titleKey: "help.login.title",     bodyKey: "help.login.body"     },
    { icon: "📅", titleKey: "help.booking.title",   bodyKey: "help.booking.body"   },
    { icon: "📋", titleKey: "help.mybookings.title",bodyKey: "help.mybookings.body"},
    { icon: "📱", titleKey: "help.sendcode.title",  bodyKey: "help.sendcode.body"  },
    { icon: "🧾", titleKey: "help.invoices.title",  bodyKey: "help.invoices.body"  },
    { icon: "💬", titleKey: "help.contact.title",   bodyKey: "help.contact.body"   },
  ];

  function init() {
    const btn = document.getElementById("btn-help");
    if (!btn) return;
    btn.addEventListener("click", openDialog);
  }

  function openDialog() {
    const d = ensureDialog();
    if (!d) return;
    renderContent();
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }

  function closeDialog() {
    if (!dlg) return;
    if (dlg.close) dlg.close();
    else dlg.removeAttribute("open");
  }

  function ensureDialog() {
    if (dlg) return dlg;
    if (typeof HTMLDialogElement === "undefined") return null;
    dlg = document.createElement("dialog");
    dlg.id = "helpDialog";
    dlg.className = "extend-dlg help-dlg";
    dlg.innerHTML = `
      <form method="dialog" class="extend-dlg-form help-form">
        <div class="help-head">
          <h3 class="extend-dlg-title help-title"></h3>
          <p class="extend-dlg-sub help-sub"></p>
        </div>
        <div class="help-body"></div>
        <div class="extend-dlg-buttons help-buttons">
          <button type="button" class="btn btn-primary" data-action="close"></button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      if (e.target?.dataset?.action === "close") closeDialog();
    });

    // Re-render hvis brukeren bytter språk mens modalen er åpen.
    window.addEventListener("i18n:change", () => {
      if (dlg && dlg.open) renderContent();
    });

    return dlg;
  }

  function renderContent() {
    if (!dlg) return;
    dlg.querySelector(".help-title").textContent = tx("help.title");
    dlg.querySelector(".help-sub").textContent   = tx("help.sub");
    dlg.querySelector('[data-action="close"]').textContent = tx("help.close");

    const body = dlg.querySelector(".help-body");
    body.innerHTML = SECTIONS.map(s => {
      const title = escapeHtml(tx(s.titleKey));
      const para  = tx(s.bodyKey);
      return `
        <section class="help-section">
          <h4 class="help-section-title">${s.icon} ${title}</h4>
          <div class="help-section-body">${paragraphs(para)}</div>
        </section>
      `;
    }).join("");
  }

  // i18n-stringen kan inneholde \n for linjeskift. Hver linje blir et <p>;
  // tomme linjer fungerer som avsnitt-separator.
  function paragraphs(s) {
    return String(s || "")
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => `<p>${escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`)
      .join("");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
