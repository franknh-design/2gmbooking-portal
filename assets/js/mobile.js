/* =========================================================
   Mobile (<=767px) — sheet-flyt + skygge-state til desktop-skjemaet.
   v3.10.0

   Tilnærming: vi BEHOLDER det opprinnelige #booking-form i DOM
   (skjult via CSS) så all eksisterende submit/validering virker
   uendret. På mobil viser vi parallelle inputs med id="m-*" som
   speiler verdiene til/fra desktop-skjemaet via DOM-events. Når
   bruker trykker "Send bestilling" trigger vi submit-eventet på
   det opprinnelige skjemaet.
   ========================================================= */
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  const MS_NB = ["januar","februar","mars","april","mai","juni",
                 "juli","august","september","oktober","november","desember"];
  const MS_EN = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }
  function isMobile() { return window.matchMedia("(max-width: 767px)").matches; }

  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    const lang = window.I18n && window.I18n.getLang ? window.I18n.getLang() : "nb";
    const ms = lang === "en" ? MS_EN : MS_NB;
    return d.getDate() + ". " + ms[d.getMonth()];
  }
  function nightsBetween(fromIso, toIso) {
    const a = new Date(fromIso + "T00:00:00");
    const b = new Date(toIso + "T00:00:00");
    return Math.round((b - a) / 864e5);
  }

  // ---------- LOCATION SYNC ----------
  function syncLocations() {
    const f = document.getElementById("f-location");
    const m = document.getElementById("m-location");
    if (!f || !m) return;
    if (m.dataset.wired === "1") {
      // Re-sync options if desktop has been re-populated
      if (m.innerHTML !== f.innerHTML) m.innerHTML = f.innerHTML;
      m.value = f.value;
      return;
    }
    m.innerHTML = f.innerHTML;
    m.value = f.value;
    m.addEventListener("change", () => {
      f.value = m.value;
      f.dispatchEvent(new Event("change", { bubbles: true }));
    });
    f.addEventListener("change", () => {
      if (m.innerHTML !== f.innerHTML) m.innerHTML = f.innerHTML;
      m.value = f.value;
    });
    m.dataset.wired = "1";
  }

  // ---------- ROOMS COUNTER SYNC ----------
  function syncRooms() {
    const f = document.getElementById("f-rooms");
    const m = document.getElementById("m-rooms");
    const minus = document.getElementById("m-rooms-minus");
    const plus = document.getElementById("m-rooms-plus");
    if (!f || !m || minus.dataset.wired === "1") return;
    m.value = f.value;
    minus.addEventListener("click", () => {
      const v = Math.max(1, (parseInt(f.value, 10) || 1) - 1);
      setRooms(v);
    });
    plus.addEventListener("click", () => {
      const v = Math.min(20, (parseInt(f.value, 10) || 1) + 1);
      setRooms(v);
    });
    m.addEventListener("input", () => {
      const v = Math.max(1, Math.min(20, parseInt(m.value, 10) || 1));
      setRooms(v);
    });
    f.addEventListener("input", () => { m.value = f.value; });
    f.addEventListener("change", () => { m.value = f.value; });
    minus.dataset.wired = "1";
  }
  function setRooms(v) {
    const f = document.getElementById("f-rooms");
    const m = document.getElementById("m-rooms");
    if (f) { f.value = v; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); }
    if (m) m.value = v;
  }

  // ---------- OPEN-ENDED SYNC ----------
  function syncOpenEnded() {
    const f = document.getElementById("f-open-ended");
    const m = document.getElementById("m-open-ended");
    if (!f || !m || m.dataset.wired === "1") return;
    m.checked = f.checked;
    m.addEventListener("change", () => {
      f.checked = m.checked;
      f.dispatchEvent(new Event("change", { bubbles: true }));
    });
    f.addEventListener("change", () => { m.checked = f.checked; });
    m.dataset.wired = "1";
  }

  // ---------- FIRST-GUEST NAME SYNC ----------
  function syncFirstGuestName() {
    const m = document.getElementById("m-guest-name");
    if (!m) return;
    const firstInp = () => document.querySelector("#guests-list .guest-row [data-field='name']");
    // Initial pull
    const cur = firstInp();
    if (cur) m.value = cur.value || "";

    if (m.dataset.wired !== "1") {
      m.addEventListener("input", () => {
        const f = firstInp();
        if (!f) return;
        f.value = m.value;
        f.dispatchEvent(new Event("input", { bubbles: true }));
      });
      m.dataset.wired = "1";
    }

    // Watch guests-list for changes (re-render happens when rooms count changes)
    const list = document.getElementById("guests-list");
    if (list && list.dataset.observerWired !== "1") {
      const observer = new MutationObserver(() => {
        const f = firstInp();
        if (f && f.value !== m.value) m.value = f.value;
      });
      observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["value"] });
      // Also catch typing in desktop guest row
      list.addEventListener("input", (e) => {
        if (e.target && e.target.matches("[data-field='name']")) {
          const all = list.querySelectorAll("[data-field='name']");
          if (all[0] === e.target) m.value = e.target.value;
        }
      });
      list.dataset.observerWired = "1";
    }
  }

  // ---------- BOTTOM-BAR (date range + Fortsett-btn) ----------
  function updateBottomBar() {
    const bar = document.getElementById("mBottomBar");
    const rangeEl = document.getElementById("mDateRange");
    const nightsEl = document.getElementById("mNightsText");
    if (!bar || !rangeEl || !nightsEl) return;
    const fromInp = document.getElementById("f-from");
    const toInp = document.getElementById("f-to");
    const openInp = document.getElementById("f-open-ended");
    if (!fromInp) return;
    const from = fromInp.value;
    const to = toInp ? toInp.value : "";
    const open = openInp ? openInp.checked : false;
    if (!from) { bar.hidden = true; return; }
    bar.hidden = false;
    if (open) {
      rangeEl.textContent = fmtDate(from) + " →";
      nightsEl.textContent = tx("mobile.openPeriod");
    } else if (to) {
      const n = nightsBetween(from, to);
      rangeEl.textContent = fmtDate(from) + " → " + fmtDate(to);
      nightsEl.textContent = tx(n === 1 ? "mobile.oneNight" : "mobile.manyNights", { n });
    } else {
      rangeEl.textContent = fmtDate(from) + " → …";
      nightsEl.textContent = tx("mobile.pickEnd");
    }
  }

  // ---------- BOTTOM-SHEET (open / close) ----------
  function openSheet() {
    const ov = document.getElementById("mSheetOverlay");
    if (!ov) return;
    // Refresh sub-title with current selection
    const sub = document.getElementById("mSheetSub");
    const rangeEl = document.getElementById("mDateRange");
    const nightsEl = document.getElementById("mNightsText");
    const locEl = document.getElementById("f-location");
    if (sub) {
      const locTxt = locEl && locEl.options[locEl.selectedIndex]
        ? locEl.options[locEl.selectedIndex].textContent : "";
      sub.textContent = [locTxt, rangeEl ? rangeEl.textContent : "", nightsEl ? nightsEl.textContent : ""]
        .filter(Boolean).join(" · ");
    }
    // Refresh guest label and value
    const gLbl = document.getElementById("mGuestLabel");
    if (gLbl) gLbl.textContent = tx("mobile.guestLabel", { n: 1 });
    syncFirstGuestName();

    ov.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => ov.classList.add("open"));
  }
  function closeSheet() {
    const ov = document.getElementById("mSheetOverlay");
    if (!ov) return;
    ov.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => { ov.hidden = true; }, 220);
  }

  // ---------- SUBMIT FROM SHEET ----------
  function wireSubmit() {
    const btn = document.getElementById("m-submit");
    const form = document.getElementById("booking-form");
    if (!btn || !form || btn.dataset.wired === "1") return;
    btn.addEventListener("click", () => {
      // Final sync before submit so the desktop form has the latest values
      const mName = document.getElementById("m-guest-name");
      if (mName) {
        const fName = document.querySelector("#guests-list .guest-row [data-field='name']");
        if (fName && fName.value !== mName.value) {
          fName.value = mName.value;
          fName.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
    btn.dataset.wired = "1";
  }

  // ---------- "+ AVVIKENDE DATOER"-LENKE ----------
  // Klikket viser den eksisterende guests-list inni sheet'et så
  // bruker kan sette per-rom-datoer. Bygger ikke ny UI for dette
  // i v3.10.0 — peker bare bruker til desktop-flyten / utvider sheet.
  function wireDeviating() {
    const link = document.getElementById("m-deviating-link");
    if (!link || link.dataset.wired === "1") return;
    link.addEventListener("click", () => {
      const list = document.getElementById("guests-list");
      const host = document.getElementById("mDeviatingHost");
      if (!list || !host) return;
      // Først gang: flytt guests-list inn i host. Etterpå: bare toggle .open.
      // Lar list bli i host så vi ikke ødelegger inputs ved skjuling.
      if (list.parentNode !== host) host.appendChild(list);
      const willOpen = !host.classList.contains("open");
      host.classList.toggle("open", willOpen);
      link.textContent = tx(willOpen ? "mobile.hideDeviating" : "booking.deviatingDates");
    });
    link.dataset.wired = "1";
  }

  // ---------- INIT ----------
  function init() {
    if (!isMobile()) return; // Desktop trenger ingen av disse
    syncLocations();
    syncRooms();
    syncOpenEnded();
    syncFirstGuestName();
    updateBottomBar();

    // Date changes — flere kilder kan oppdatere f-from/f-to programmatisk
    // (Calendar.onSelect → Booking.setDateRange). Bruker både events og
    // en lav-frekvent polling som safety-net.
    ["input", "change"].forEach((ev) => {
      const fFrom = document.getElementById("f-from");
      const fTo = document.getElementById("f-to");
      const fOpen = document.getElementById("f-open-ended");
      if (fFrom) fFrom.addEventListener(ev, updateBottomBar);
      if (fTo) fTo.addEventListener(ev, updateBottomBar);
      if (fOpen) fOpen.addEventListener(ev, updateBottomBar);
    });
    setInterval(updateBottomBar, 600);

    // Fortsett-knappen
    const fortsett = document.getElementById("mFortsettBtn");
    if (fortsett && fortsett.dataset.wired !== "1") {
      fortsett.addEventListener("click", openSheet);
      fortsett.dataset.wired = "1";
    }
    // Tap utenfor sheet → lukk
    const ov = document.getElementById("mSheetOverlay");
    if (ov && ov.dataset.wired !== "1") {
      ov.addEventListener("click", (e) => { if (e.target === ov) closeSheet(); });
      ov.dataset.wired = "1";
    }
    // Lukk via Esc
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const ovEl = document.getElementById("mSheetOverlay");
        if (ovEl && !ovEl.hidden) closeSheet();
      }
    });
    wireSubmit();
    wireDeviating();

    // Globale handlers så HTML-attributter kan kalle dem
    window.MobileSheet = { open: openSheet, close: closeSheet };
  }

  // Re-init når språk byttes (oppdaterer tekster)
  function onLangChange() {
    if (!isMobile()) return;
    updateBottomBar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addEventListener("resize", () => {
    if (isMobile()) init();
  });
  window.addEventListener("i18n:change", onLangChange);

  // Re-init etter at auth har vist portalen (auth-screen skjules ved login;
  // booking.js populerer da locations-dropdown etterpå).
  document.addEventListener("portal:ready", init);
})();
