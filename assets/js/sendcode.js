/* =========================================================
   Send dørkode — banner-knapp + modal.
   v1.0
   - Knappen i topbar åpner en modal med tre felter: romnr, kode, telefon.
   - Bruker skriver inn romnr → blur trigger lookup mot /api/lookup-room-
     bookings → fyller kode + telefon automatisk.
   - Flere bookinger på samme rom → liste med radio-valg.
   - Submit kaller /api/send-doorcode-by-room.
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }

  let dlg = null;
  let lookupTimer = null;
  let currentMatches = [];      // siste lookup-resultat
  let selectedMatch = null;     // valgt booking i listen (eller eneste)

  function init() {
    const btn = document.getElementById("btn-send-doorcode");
    if (!btn) return;
    btn.addEventListener("click", openDialog);
  }

  function openDialog() {
    const d = ensureDialog();
    if (!d) {
      // Fallback for nettlesere uten <dialog>-støtte. Bør aldri nås
      // (moderne browsere har full støtte), men holder appen robust.
      window.alert(tx("sendcode.unsupported"));
      return;
    }
    resetForm();
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    setTimeout(() => {
      const room = d.querySelector("input[name=room]");
      if (room) { try { room.focus(); room.select(); } catch (_) {} }
    }, 60);
  }

  function closeDialog() {
    if (!dlg) return;
    if (dlg.close) dlg.close();
    else dlg.removeAttribute("open");
  }

  function resetForm() {
    if (!dlg) return;
    dlg.querySelector("input[name=room]").value = "";
    dlg.querySelector("input[name=phone]").value = "";
    dlg.querySelector("input[name=code]").value = "";
    dlg.querySelector(".sc-msg").textContent = "";
    dlg.querySelector(".sc-msg").classList.remove("sc-msg-error", "sc-msg-success");
    dlg.querySelector(".sc-candidates").innerHTML = "";
    dlg.querySelector(".sc-candidates").hidden = true;
    dlg.querySelector(".sc-guest-line").textContent = "";
    dlg.querySelector(".sc-guest-line").hidden = true;
    currentMatches = [];
    selectedMatch = null;
    setSubmitEnabled(false);
  }

  function setSubmitEnabled(enabled) {
    if (!dlg) return;
    const btn = dlg.querySelector('[data-action="submit"]');
    if (btn) btn.disabled = !enabled;
  }

  function ensureDialog() {
    if (dlg) return dlg;
    if (typeof HTMLDialogElement === "undefined") return null;
    dlg = document.createElement("dialog");
    dlg.id = "sendDoorcodeDialog";
    dlg.className = "extend-dlg sc-dlg";
    dlg.innerHTML = `
      <form method="dialog" class="extend-dlg-form sc-form">
        <h3 class="extend-dlg-title sc-title"></h3>
        <p class="extend-dlg-sub sc-sub"></p>

        <label class="field">
          <span class="field-label sc-room-label"></span>
          <input type="text" name="room" inputmode="numeric" autocomplete="off" />
        </label>

        <div class="sc-candidates" hidden></div>

        <p class="sc-guest-line" hidden></p>

        <label class="field">
          <span class="field-label sc-code-label"></span>
          <input type="text" name="code" readonly autocomplete="off" />
        </label>

        <label class="field">
          <span class="field-label sc-phone-label"></span>
          <input type="tel" name="phone" autocomplete="tel" />
        </label>

        <p class="sms-cost-note sc-cost" style="font-size:11px;color:var(--color-text-tertiary);margin:4px 0 0"></p>
        <p class="extend-dlg-msg sc-msg" aria-live="polite"></p>

        <div class="extend-dlg-buttons">
          <button type="button" class="btn btn-ghost" data-action="cancel"></button>
          <button type="button" class="btn btn-primary" data-action="submit" disabled></button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    applyLabels();
    window.addEventListener("i18n:change", applyLabels);

    const roomInput = dlg.querySelector("input[name=room]");
    roomInput.addEventListener("input", () => {
      if (lookupTimer) clearTimeout(lookupTimer);
      const val = roomInput.value.trim();
      if (!val) {
        dlg.querySelector("input[name=code]").value = "";
        dlg.querySelector(".sc-candidates").hidden = true;
        dlg.querySelector(".sc-candidates").innerHTML = "";
        dlg.querySelector(".sc-guest-line").hidden = true;
        dlg.querySelector(".sc-msg").textContent = "";
        selectedMatch = null;
        setSubmitEnabled(false);
        return;
      }
      lookupTimer = setTimeout(() => doLookup(val), 250);
    });
    roomInput.addEventListener("blur", () => {
      if (lookupTimer) { clearTimeout(lookupTimer); lookupTimer = null; }
      const val = roomInput.value.trim();
      if (val) doLookup(val);
    });

    dlg.addEventListener("click", async (e) => {
      const action = e.target?.dataset?.action;
      if (action === "cancel") {
        closeDialog();
      } else if (action === "submit") {
        await doSend();
      }
    });

    return dlg;
  }

  function applyLabels() {
    if (!dlg) return;
    dlg.querySelector(".sc-title").textContent      = tx("sendcode.title");
    dlg.querySelector(".sc-sub").textContent        = tx("sendcode.sub");
    dlg.querySelector(".sc-room-label").textContent = tx("sendcode.roomLabel");
    dlg.querySelector(".sc-code-label").textContent = tx("sendcode.codeLabel");
    dlg.querySelector(".sc-phone-label").textContent= tx("sendcode.phoneLabel");
    dlg.querySelector(".sc-cost").textContent       = tx("sms.costNote");
    dlg.querySelector('[data-action="cancel"]').textContent = tx("sendcode.cancel");
    dlg.querySelector('[data-action="submit"]').textContent = tx("sendcode.send");
    const roomInput = dlg.querySelector("input[name=room]");
    if (roomInput) roomInput.placeholder = tx("sendcode.roomPlaceholder");
    const phoneInput = dlg.querySelector("input[name=phone]");
    if (phoneInput) phoneInput.placeholder = tx("sendcode.phonePlaceholder");
  }

  async function doLookup(roomNumber) {
    const token = window.Auth?.token;
    if (!token) {
      showMsg("error", tx("sms.errExpired"));
      return;
    }
    showMsg("info", tx("sendcode.searching"));
    const result = await window.Api.lookupRoomBookings({ token, roomNumber });
    if (!result.ok) {
      showMsg("error", tx("sendcode.lookupError"));
      currentMatches = [];
      selectedMatch = null;
      setSubmitEnabled(false);
      return;
    }
    currentMatches = result.matches || [];

    if (!currentMatches.length) {
      dlg.querySelector("input[name=code]").value = "";
      dlg.querySelector(".sc-candidates").hidden = true;
      dlg.querySelector(".sc-candidates").innerHTML = "";
      dlg.querySelector(".sc-guest-line").hidden = true;
      showMsg("error", tx("sendcode.noBookings"));
      selectedMatch = null;
      setSubmitEnabled(false);
      return;
    }

    showMsg("clear", "");

    if (currentMatches.length === 1) {
      selectMatch(currentMatches[0]);
      dlg.querySelector(".sc-candidates").hidden = true;
      dlg.querySelector(".sc-candidates").innerHTML = "";
      const m = currentMatches[0];
      const line = dlg.querySelector(".sc-guest-line");
      line.textContent = formatGuestLine(m);
      line.hidden = false;
    } else {
      renderCandidates(currentMatches);
      dlg.querySelector(".sc-guest-line").hidden = true;
      // Velg ikke noe enda — krev valg fra brukeren
      selectedMatch = null;
      dlg.querySelector("input[name=code]").value = "";
      dlg.querySelector("input[name=phone]").value = "";
      setSubmitEnabled(false);
    }
  }

  function formatGuestLine(m) {
    const name = m.personName || "—";
    const status = m.status === "Active" ? tx("mybookings.statusActive") : tx("mybookings.statusUpcoming");
    return tx("sendcode.guestLine", { name, status });
  }

  function renderCandidates(matches) {
    const wrap = dlg.querySelector(".sc-candidates");
    wrap.innerHTML = "";
    const heading = document.createElement("p");
    heading.className = "sc-candidates-head";
    heading.textContent = tx("sendcode.pickGuest", { n: matches.length });
    wrap.appendChild(heading);

    matches.forEach((m, idx) => {
      const id = `sc-cand-${idx}`;
      const row = document.createElement("label");
      row.className = "sc-cand-row";
      row.htmlFor = id;
      const status = m.status === "Active" ? tx("mybookings.statusActive") : tx("mybookings.statusUpcoming");
      const dates = formatBookingDates(m.checkIn, m.checkOut);
      row.innerHTML = `
        <input type="radio" id="${id}" name="sc-candidate" value="${idx}">
        <span class="sc-cand-main">
          <strong>${escapeHtml(m.personName || "—")}</strong>
          <small>${escapeHtml(status)} · ${escapeHtml(dates)}</small>
        </span>
      `;
      row.querySelector("input").addEventListener("change", () => {
        selectMatch(m);
      });
      wrap.appendChild(row);
    });
    wrap.hidden = false;
  }

  function selectMatch(m) {
    selectedMatch = m;
    dlg.querySelector("input[name=code]").value = m.doorCode || "";
    // Pre-fyll telefon hvis registrert, men la kunden overstyre.
    const phoneInput = dlg.querySelector("input[name=phone]");
    if (m.phone) {
      phoneInput.value = m.phone;
    } else if (!phoneInput.value) {
      phoneInput.value = "+47";
    }
    if (!m.doorCode) {
      showMsg("error", tx("sendcode.noDoorCode"));
      setSubmitEnabled(false);
      return;
    }
    showMsg("clear", "");
    setSubmitEnabled(true);
  }

  function showMsg(kind, text) {
    const el = dlg.querySelector(".sc-msg");
    if (!el) return;
    el.classList.remove("sc-msg-error", "sc-msg-success", "sc-msg-info");
    if (kind === "error")   el.classList.add("sc-msg-error");
    if (kind === "success") el.classList.add("sc-msg-success");
    if (kind === "info")    el.classList.add("sc-msg-info");
    el.textContent = kind === "clear" ? "" : text;
  }

  async function doSend() {
    if (!selectedMatch) return;
    const phoneRaw = dlg.querySelector("input[name=phone]").value.trim();
    const phone = phoneRaw.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{8,}$/.test(phone)) {
      showMsg("error", tx("sms.manualInvalid"));
      return;
    }
    const token = window.Auth?.token;
    if (!token) {
      showMsg("error", tx("sms.errExpired"));
      return;
    }

    setSubmitEnabled(false);
    showMsg("info", tx("sendcode.sending"));

    const result = await window.Api.sendDoorcodeByRoom({
      token,
      bookingId: selectedMatch.bookingId,
      phone,
    });

    if (result.ok) {
      showMsg("success", tx("sendcode.success", { phone: result.sentTo || phone }));
      setTimeout(() => { closeDialog(); }, 1800);
      return;
    }

    const errMap = {
      no_door_code:    tx("sms.errNoCode"),
      no_room_assigned:tx("sms.errNoRoom"),
      not_your_booking:tx("sms.errNotYours"),
      invalid_token:   tx("sms.errExpired"),
      invalid_phone:   tx("sms.manualInvalid"),
      sms_failed:      tx("sms.errFailed", { err: result.detail || "?" }),
    };
    showMsg("error", errMap[result.error] || tx("sms.errFailed", { err: result.error || "?" }));
    setSubmitEnabled(true);
  }

  function formatBookingDates(checkIn, checkOut) {
    if (!checkIn) return "";
    const fmt = iso => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
    };
    if (!checkOut) return `${fmt(checkIn)} → ${tx("mybookings.openPeriod")}`;
    return `${fmt(checkIn)} → ${fmt(checkOut)}`;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
