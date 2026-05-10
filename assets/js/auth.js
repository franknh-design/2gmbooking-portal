/* =========================================================
   PIN-basert innlogging mot Customer_Tokens.
   v3.0
   - Leser ?token= fra URL.
   - validateToken() henter kunde-info (firmanavn, lokasjoner).
   - Kunden taster 6-sifret PIN → validatePin() bekrefter mot SharePoint.
   - 24t localStorage-sesjon per token, så reload hopper PIN-steget.
   - "Logg ut" tømmer sesjonen og tvinger PIN-flyten igjen.

   v3.0: SMS-flyten erstattet med direkte PIN-validering. PIN-en genereres
   av admin i booking-appen (Companies-modal → Portal-tilgang) og deles
   separat fra URL'en (telefon, e-post osv.).
   ========================================================= */
(function () {
  "use strict";

  const SESSION_PREFIX = "2gm_portal_auth_";
  const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function loadSession(token) {
    if (!token) return null;
    try {
      const raw = localStorage.getItem(SESSION_PREFIX + token);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.verifiedAt) return null;
      if (Date.now() - obj.verifiedAt > SESSION_MAX_AGE_MS) {
        localStorage.removeItem(SESSION_PREFIX + token);
        return null;
      }
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveSession(token, tokenStamp) {
    if (!token) return;
    try {
      localStorage.setItem(SESSION_PREFIX + token, JSON.stringify({
        verifiedAt: Date.now(),
        tokenStamp: tokenStamp || null,
      }));
    } catch (_) {}
  }

  function clearSession(token) {
    if (!token) return;
    try { localStorage.removeItem(SESSION_PREFIX + token); }
    catch (_) {}
  }

  const Auth = {
    customer: null,
    token: null,
    onSuccess: null,

    async init(onSuccess) {
      this.onSuccess = onSuccess;

      const params = new URLSearchParams(window.location.search);
      const tokenParam = params.get("token");

      this.token = tokenParam || null;

      this._wireUpUi();

      if (!this.token) {
        // eslint-disable-next-line no-console
        console.log("[AUTH] Ingen token i URL, bruker demo-kunde.");
        this.customer = window.MockData.getCustomer("demo");
        this._showAuthScreen();
        return;
      }

      this._showLoading();

      try {
        const result = await window.Api.validateToken(this.token);

        if (!result.valid) {
          this._showInvalidToken();
          return;
        }

        this.customer = {
          id: this.token,
          name: result.firma,
          contactName: result.kontaktperson,
          locations: result.tillatte_lokasjoner || [],
          maxRooms: result.maks_rom || 1
        };
        this._currentStamp = result.tokenStamp || null;

        // eslint-disable-next-line no-console
        console.log("[AUTH] Token gyldig for:", this.customer.name);

        const session = loadSession(this.token);
        if (session) {
          // v3.5.9: invalidér sesjonen hvis admin har endret noe på
          // Customer_Tokens-raden (PIN, token, Aktiv, lokasjoner) siden
          // sist innlogging. Da må kunden taste PIN på nytt.
          if (session.tokenStamp && this._currentStamp && session.tokenStamp !== this._currentStamp) {
            // eslint-disable-next-line no-console
            console.log("[AUTH] Token-stempel endret — sesjonen er ugyldig, krever ny PIN.");
            clearSession(this.token);
          } else {
            // eslint-disable-next-line no-console
            console.log("[AUTH] Gyldig sesjon (24t) — hopper over PIN.");
            this._completeLogin();
            return;
          }
        }

        this._showAuthScreen();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AUTH] Feil under validering:", err);
        this._showNetworkError();
      }
    },

    _wireUpUi() {
      const pinForm  = document.getElementById("auth-pin-form");
      const logoutBtn = document.getElementById("btn-logout");

      if (logoutBtn) {
        logoutBtn.hidden = !this.token;
        logoutBtn.addEventListener("click", () => {
          clearSession(this.token);
          location.reload();
        });
      }

      if (pinForm) {
        pinForm.addEventListener("submit", (e) => {
          e.preventDefault();
          this._handlePinSubmit();
        });
      }
    },

    _showLoading() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = window.I18n ? window.I18n.t("auth.verifying") : "Verifiserer tilgang…";

      const pinForm = document.getElementById("auth-pin-form");
      if (pinForm) pinForm.hidden = true;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showInvalidToken() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = "";

      const pinForm = document.getElementById("auth-pin-form");
      if (pinForm) pinForm.hidden = true;

      const errEl = document.getElementById("auth-error");
      errEl.innerHTML = window.I18n
        ? window.I18n.t("auth.invalidToken")
        : "<strong>Ugyldig eller utløpt lenke.</strong><br>Kontakt 2GM Eiendom for å få en ny tilgangslenke.";
      errEl.hidden = false;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showNetworkError() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = "";

      const pinForm = document.getElementById("auth-pin-form");
      if (pinForm) pinForm.hidden = true;

      const errEl = document.getElementById("auth-error");
      errEl.innerHTML = window.I18n
        ? window.I18n.t("auth.networkError")
        : "<strong>Kunne ikke kontakte serveren.</strong><br>Sjekk internettforbindelsen og prøv igjen.";
      errEl.hidden = false;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showAuthScreen() {
      const sub = document.getElementById("auth-customer-sub");
      const t = window.I18n ? window.I18n.t : ((k) => k);
      sub.textContent = this.customer
        ? t("auth.loginAs", { name: this.customer.name })
        : t("auth.loginGeneric");

      const errEl = document.getElementById("auth-error");
      if (errEl) { errEl.hidden = true; errEl.textContent = ""; }

      const pinForm = document.getElementById("auth-pin-form");
      if (pinForm) pinForm.hidden = false;

      const pinInput = document.getElementById("auth-pin");
      if (pinInput) {
        pinInput.value = "";
        setTimeout(() => pinInput.focus(), 50);
      }

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    async _handlePinSubmit() {
      const pinEl = document.getElementById("auth-pin");
      const pin = String(pinEl.value || "").replace(/\D/g, "");

      if (pin.length !== 6) {
        return this._showError(window.I18n ? window.I18n.t("auth.codeMustBe6") : "PIN-koden må være 6 sifre.");
      }

      const submitBtn = document.querySelector('#auth-pin-form button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset._origText = submitBtn.textContent; submitBtn.textContent = "…"; }

      try {
        const result = await window.Api.validatePin(this.token, pin);
        if (result && result.ok) {
          // Lagre fersk stempel fra validate-pin-respons så sesjonen er
          // umiddelbart gyldig mot evt. PIN-endring som skjedde nå nettopp.
          if (result.tokenStamp) this._currentStamp = result.tokenStamp;
          this._completeLogin();
        } else {
          this._showError(window.I18n ? window.I18n.t("auth.pinWrong") : "Feil PIN. Prøv igjen.");
          if (pinEl) { pinEl.value = ""; pinEl.focus(); }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AUTH] PIN-validering feilet:", err);
        this._showError(window.I18n ? window.I18n.t("auth.networkError") : "Kunne ikke kontakte serveren.");
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitBtn.dataset._origText || (window.I18n ? window.I18n.t("auth.confirm") : "Logg inn"); }
      }
    },

    _completeLogin() {
      saveSession(this.token, this._currentStamp);

      document.getElementById("auth-screen").hidden = true;
      document.getElementById("portal").hidden = false;

      if (typeof this.onSuccess === "function") {
        try {
          this.onSuccess({
            customer: this.customer,
            token: this.token
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Feil under oppstart av portal:", err);
        }
      }
    },

    _showError(msg) {
      const errEl = document.getElementById("auth-error");
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  };

  window.Auth = Auth;
})();
