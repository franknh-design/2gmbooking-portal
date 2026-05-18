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

        // v3.10.30: Anvende kontaktens standardspråk hvis satt i admin (Sprak).
        // Kun hvis brukeren ikke allerede har valgt språk manuelt (localStorage),
        // for å ikke overstyre eget valg. Sprak='nb'|'en' fra Customer_Tokens.
        try {
          const contactLang = String(result.language || '').toLowerCase();
          if ((contactLang === 'nb' || contactLang === 'en') && window.I18n) {
            const stored = localStorage.getItem('2gm_portal_lang');
            if (!stored && window.I18n.getLang() !== contactLang) {
              window.I18n.setLang(contactLang);
            }
          }
        } catch (_) {}

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

      this._wirePinBoxes();
    },

    // v3.13.0: 6 separate sifferbokser med auto-advance, backspace-til-forrige,
    // paste som sprer sifrene utover, og auto-submit når alle 6 er fylt.
    _wirePinBoxes() {
      const boxes = this._getPinBoxes();
      if (!boxes.length) return;

      boxes.forEach((box, idx) => {
        box.addEventListener("input", (e) => {
          // Filtrer bort alt som ikke er siffer (norske tastaturer kan sende
          // f.eks. "²"/"³" via Shift+tall, og iOS-autofyll av OTP sender hele
          // koden inn i én boks — vi sprer den utover under).
          const raw = String(box.value || "");
          const digits = raw.replace(/\D/g, "");

          if (digits.length > 1) {
            this._spreadDigits(digits, idx);
            return;
          }

          box.value = digits;
          if (digits && idx < boxes.length - 1) {
            boxes[idx + 1].focus();
            boxes[idx + 1].select();
          }
          this._maybeAutoSubmit();
        });

        box.addEventListener("keydown", (e) => {
          if (e.key === "Backspace" && !box.value && idx > 0) {
            // Hopp til forrige boks og tøm den så bruker kan rette uten å
            // måtte klikke seg bakover manuelt.
            e.preventDefault();
            const prev = boxes[idx - 1];
            prev.value = "";
            prev.focus();
          } else if (e.key === "ArrowLeft" && idx > 0) {
            e.preventDefault();
            boxes[idx - 1].focus();
            boxes[idx - 1].select();
          } else if (e.key === "ArrowRight" && idx < boxes.length - 1) {
            e.preventDefault();
            boxes[idx + 1].focus();
            boxes[idx + 1].select();
          }
        });

        box.addEventListener("paste", (e) => {
          const text = (e.clipboardData || window.clipboardData).getData("text") || "";
          const digits = text.replace(/\D/g, "");
          if (!digits) return;
          e.preventDefault();
          this._spreadDigits(digits, idx);
        });

        box.addEventListener("focus", () => {
          // Select så neste tastetrykk overskriver eksisterende siffer.
          setTimeout(() => box.select(), 0);
        });
      });
    },

    _getPinBoxes() {
      return Array.from(document.querySelectorAll("#auth-pin-boxes .pin-box"));
    },

    _getPin() {
      return this._getPinBoxes().map(b => b.value || "").join("");
    },

    _clearPin() {
      const boxes = this._getPinBoxes();
      boxes.forEach(b => { b.value = ""; });
      if (boxes[0]) boxes[0].focus();
    },

    _focusFirstPin() {
      const boxes = this._getPinBoxes();
      if (boxes[0]) {
        setTimeout(() => boxes[0].focus(), 50);
      }
    },

    _spreadDigits(digits, startIdx) {
      const boxes = this._getPinBoxes();
      let i = startIdx;
      for (const ch of digits) {
        if (i >= boxes.length) break;
        boxes[i].value = ch;
        i++;
      }
      const nextFocusIdx = Math.min(i, boxes.length - 1);
      boxes[nextFocusIdx].focus();
      boxes[nextFocusIdx].select();
      this._maybeAutoSubmit();
    },

    _maybeAutoSubmit() {
      if (this._submitting) return;
      const pin = this._getPin();
      if (pin.length === 6) {
        this._submitting = true;
        // Liten delay så siste tastetrykk er fullt synlig før vi sender.
        setTimeout(() => this._handlePinSubmit(), 80);
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

      this._clearPin();
      this._focusFirstPin();

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    async _handlePinSubmit() {
      const pin = this._getPin().replace(/\D/g, "");

      if (pin.length !== 6) {
        this._submitting = false;
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
        } else if (result && result.locked) {
          // v3.8.8: backend signaliserer at token er midlertidig låst pga.
          // for mange mislykkede PIN-forsøk. Vi tømmer feltet og forteller
          // kunden at de må vente — lockout-vinduet er 1 time.
          this._showError(window.I18n ? window.I18n.t("auth.pinLocked") : "For mange mislykkede forsøk. Prøv igjen om en time.");
          this._clearPin();
          this._getPinBoxes().forEach(b => b.blur());
        } else {
          this._showError(window.I18n ? window.I18n.t("auth.pinWrong") : "Feil PIN. Prøv igjen.");
          this._clearPin();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AUTH] PIN-validering feilet:", err);
        this._showError(window.I18n ? window.I18n.t("auth.networkError") : "Kunne ikke kontakte serveren.");
      } finally {
        this._submitting = false;
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
      // v3.9.0: bruk innerHTML så <strong>/<br> i i18n-meldinger rendres som
      // HTML i stedet for ren tekst. Trygt fordi alle msg-verdier kommer fra
      // statiske i18n-keys (ingen brukerinput) — bekreftet av kallesteder
      // som alle bruker tx("auth.xyz").
      const errEl = document.getElementById("auth-error");
      errEl.innerHTML = msg;
      errEl.hidden = false;
    }
  };

  window.Auth = Auth;
})();
