/* =========================================================
   Send dørkode — banner-knapp + liste-modal.
   v2.0
   - Klikk på topbar-knapp åpner modal som viser ALLE kundens
     aktive/kommende bookinger som ei liste:
       Rom | Gjest | Kode | Telefon (redigerbar) | Send-knapp
   - Hver rad sendes individuelt (5 kr per SMS, samme som før).
   - Rader uten dørkode er deaktiverte (admin må generere PIN først).
   ========================================================= */
(function () {
  "use strict";

  function tx(key, vars) { return window.I18n ? window.I18n.t(key, vars) : key; }

  let dlg = null;
  let bookings = [];

  function init() {
    const btn = document.getElementById("btn-send-doorcode");
    if (!btn) return;
    btn.addEventListener("click", openDialog);
  }

  async function openDialog() {
    const d = ensureDialog();
    if (!d) {
      window.alert(tx("sendcode.unsupported"));
      return;
    }
    showLoader();
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    await refreshList();
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
    dlg.id = "sendDoorcodeDialog";
    dlg.className = "extend-dlg sc-dlg-list";
    dlg.innerHTML = `
      <form method="dialog" class="extend-dlg-form sc-form">
        <h3 class="extend-dlg-title sc-title"></h3>
        <p class="extend-dlg-sub sc-sub"></p>

        <div class="sc-list-wrap">
          <table class="sc-list-table">
            <colgroup>
              <col class="sc-c-room">
              <col class="sc-c-location">
              <col class="sc-c-guest">
              <col class="sc-c-code">
              <col class="sc-c-phone">
              <col class="sc-c-action">
            </colgroup>
            <thead>
              <tr>
                <th class="sc-col-room"></th>
                <th class="sc-col-location"></th>
                <th class="sc-col-guest"></th>
                <th class="sc-col-code"></th>
                <th class="sc-col-phone"></th>
                <th class="sc-col-action"></th>
              </tr>
            </thead>
            <tbody class="sc-list-body"></tbody>
          </table>
          <p class="sc-list-empty" hidden></p>
          <p class="sc-list-loading"></p>
        </div>

        <p class="sms-cost-note sc-cost" style="font-size:11px;color:var(--color-text-tertiary);margin:4px 0 0"></p>

        <div class="extend-dlg-buttons sc-list-buttons">
          <button type="button" class="btn btn-ghost" data-action="close"></button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    applyLabels();
    window.addEventListener("i18n:change", applyLabels);

    dlg.addEventListener("click", (e) => {
      const action = e.target?.dataset?.action;
      if (action === "close") closeDialog();
      else if (action === "send-row") {
        const idx = Number(e.target.dataset.idx);
        sendRow(idx);
      }
    });

    return dlg;
  }

  function applyLabels() {
    if (!dlg) return;
    dlg.querySelector(".sc-title").textContent = tx("sendcode.title");
    dlg.querySelector(".sc-sub").textContent   = tx("sendcode.subList");
    dlg.querySelector(".sc-col-room").textContent     = tx("sendcode.colRoom");
    dlg.querySelector(".sc-col-location").textContent = tx("sendcode.colLocation");
    dlg.querySelector(".sc-col-guest").textContent    = tx("sendcode.colGuest");
    dlg.querySelector(".sc-col-code").textContent     = tx("sendcode.colCode");
    dlg.querySelector(".sc-col-phone").textContent    = tx("sendcode.colPhone");
    dlg.querySelector(".sc-col-action").textContent   = "";
    dlg.querySelector(".sc-cost").textContent       = tx("sms.costNote");
    dlg.querySelector('[data-action="close"]').textContent = tx("sendcode.close");
    dlg.querySelector(".sc-list-loading").textContent = tx("sendcode.searching");
  }

  function showLoader() {
    if (!dlg) return;
    dlg.querySelector(".sc-list-loading").hidden = false;
    dlg.querySelector(".sc-list-empty").hidden = true;
    dlg.querySelector(".sc-list-body").innerHTML = "";
  }

  async function refreshList() {
    const token = window.Auth?.token;
    if (!token) {
      renderEmpty(tx("sms.errExpired"));
      return;
    }
    // v3.10.31: Telefonnr ligger ikke lenger i my-bookings (flyttet til eget
    // endepunkt for å unngå Persons-fetch på hver 60s-polling). Vi henter
    // bookinger først (rask render), så telefonnr i parallell — input-feltet
    // får default "+47" til oppdateringen kommer.
    const bookingsPromise = window.Api.getMyBookings(token);
    const phonesPromise = window.Api.getBookingPhones(token);

    const result = await bookingsPromise;
    if (!result.ok) {
      renderEmpty(tx("sendcode.lookupError"));
      return;
    }
    bookings = (result.bookings || []).filter(b =>
      b.status === "Active" || b.status === "Upcoming"
    );
    // v3.11.6: ingen ekte bookinger → vis demo-gjester (samme som Mine
    // bookinger) så kunden ser hvordan SMS-rad-flyten ser ut. Demo-rader
    // har fiktiv telefon og blir avvist av sendRow med vennlig melding.
    let isDemo = false;
    if (!bookings.length && window.DemoBookings && typeof window.DemoBookings.build === "function") {
      bookings = window.DemoBookings.build();
      isDemo = true;
    }
    // v3.10.27: stigende romnr-sortering. Bruker localeCompare m/ numeric
    // så "204" < "706" og "204A" sorteres mellom 204 og 205.
    bookings.sort((a, b) => {
      const ra = a.roomNumber || "";
      const rb = b.roomNumber || "";
      if (!ra && !rb) return 0;
      if (!ra) return 1;
      if (!rb) return -1;
      return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: "base" });
    });
    renderRows(isDemo);

    // v3.11.6: i demo-modus hopper vi over phones-fetch — de fiktive
    // gjestene har allerede phone fra buildDemoBookings.
    if (isDemo) return;

    // Når phones-respons kommer: oppdater input-feltene som ikke er manuelt
    // endret av kunden allerede.
    const phonesResult = await phonesPromise;
    if (phonesResult.ok && phonesResult.phones) {
      let changed = false;
      bookings.forEach((b, idx) => {
        const ph = phonesResult.phones[b.ref];
        if (!ph) return;
        b.phone = ph;
        const input = dlg && dlg.querySelector(`.sc-phone-input[data-idx="${idx}"]`);
        // Bare overskriv hvis kunden ikke har skrevet noe selv (verdi er
        // fortsatt default "+47").
        if (input && (input.value === "+47" || input.value === "")) {
          input.value = ph;
          changed = true;
        }
      });
      if (changed) { /* no-op — DOM allerede oppdatert */ }
    }
  }

  function renderEmpty(msg) {
    if (!dlg) return;
    dlg.querySelector(".sc-list-loading").hidden = true;
    const empty = dlg.querySelector(".sc-list-empty");
    empty.textContent = msg;
    empty.hidden = false;
    dlg.querySelector(".sc-list-body").innerHTML = "";
  }

  function renderRows(isDemo) {
    if (!dlg) return;
    dlg.querySelector(".sc-list-loading").hidden = true;
    const empty = dlg.querySelector(".sc-list-empty");
    const tbody = dlg.querySelector(".sc-list-body");
    tbody.innerHTML = "";

    if (!bookings.length) {
      empty.textContent = tx("sendcode.empty");
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    // v3.11.6: demo-banner øverst i lista når kunden ser fiktive gjester.
    if (isDemo) {
      const trBanner = document.createElement("tr");
      trBanner.className = "sc-demo-banner-row";
      trBanner.innerHTML = `<td colspan="6" class="sc-demo-banner">${escapeHtml(tx("sendcode.demoBanner"))}</td>`;
      tbody.appendChild(trBanner);
    }

    bookings.forEach((b, idx) => {
      const tr = document.createElement("tr");
      tr.className = "sc-row";
      const hasCode = !!b.doorCode;
      if (!hasCode) tr.classList.add("sc-row-disabled");

      const room = escapeHtml(b.roomNumber || "—");
      const guest = escapeHtml(b.guest || "—");
      const code = hasCode ? escapeHtml(b.doorCode) : `<span class="sc-no-code">${escapeHtml(tx("sendcode.noCode"))}</span>`;
      const phoneVal = b.phone || "+47";
      const sendLabel = escapeHtml(tx("sendcode.send"));
      // v3.10.28: vis lokasjon (property + adresse på neste linje). Begge er
      // alltid med — adressen står tom-streng hvis vi ikke har den mappet i
      // PROPERTY_ADDRESSES på backend, og blir da bare droppet i render.
      const propName = escapeHtml(b.property || "");
      const propAddr = escapeHtml(b.propertyAddress || "");
      const locCell = propName
        ? `<strong class="sc-loc-name">${propName}</strong>${propAddr?`<small class="sc-loc-addr">${propAddr}</small>`:""}`
        : "—";

      tr.innerHTML = `
        <td class="sc-room">${room}</td>
        <td class="sc-location">${locCell}</td>
        <td class="sc-guest">${guest}</td>
        <td class="sc-code">${code}</td>
        <td class="sc-phone-cell">
          <input type="tel" class="sc-phone-input" data-idx="${idx}" value="${escapeHtml(phoneVal)}" autocomplete="tel">
        </td>
        <td class="sc-action-cell">
          <button type="button" class="btn btn-primary sc-send-btn" data-action="send-row" data-idx="${idx}"${hasCode?"":" disabled"}>${sendLabel}</button>
          <span class="sc-row-msg" data-idx="${idx}"></span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function sendRow(idx) {
    const b = bookings[idx];
    if (!b) return;
    const phoneInput = dlg.querySelector(`.sc-phone-input[data-idx="${idx}"]`);
    const btn = dlg.querySelector(`.sc-send-btn[data-idx="${idx}"]`);
    const msg = dlg.querySelector(`.sc-row-msg[data-idx="${idx}"]`);
    if (!phoneInput || !btn || !msg) return;

    // v3.11.6: demo-rad → ikke send noe, vis vennlig melding i stedet.
    if (b._isDemo) {
      msg.textContent = tx("sendcode.demoRowMsg");
      msg.className = "sc-row-msg sc-msg-info";
      return;
    }

    const rawPhone = (phoneInput.value || "").trim();
    const phone = rawPhone.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{8,}$/.test(phone)) {
      msg.textContent = tx("sms.manualInvalid");
      msg.className = "sc-row-msg sc-msg-error";
      return;
    }

    const token = window.Auth?.token;
    if (!token) {
      msg.textContent = tx("sms.errExpired");
      msg.className = "sc-row-msg sc-msg-error";
      return;
    }

    btn.disabled = true;
    msg.textContent = tx("sendcode.sending");
    msg.className = "sc-row-msg sc-msg-info";

    const result = await window.Api.sendDoorcodeSms({
      token,
      bookingRef: b.ref,
      phoneOverride: phone,
    });

    if (result.ok) {
      msg.textContent = tx("sendcode.successInline", { phone: result.sentTo || phone });
      msg.className = "sc-row-msg sc-msg-success";
      // Behold knappen disabled så kunden ikke dobbelt-sender; gjenåpnes ved
      // ny modal-åpning. Lagre nye phone-verdien tilbake til state hvis ulik.
      b.phone = phone;
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
    msg.textContent = errMap[result.error] || tx("sms.errFailed", { err: result.error || "?" });
    msg.className = "sc-row-msg sc-msg-error";
    btn.disabled = false;
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
