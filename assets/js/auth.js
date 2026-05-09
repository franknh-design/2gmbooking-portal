/* =========================================================
   SMS-verifisering (mock) + ekte token-validering mot API.
   v2.1
   - Leser ?token= fra URL.
   - Kaller window.Api.validateToken() for å validere mot SharePoint.
   - Hvis gyldig: viser SMS-flyt (fortsatt mock).
   - Hvis ugyldig: viser feilmelding, blokkerer portal.
   - Steg 1: telefonnummer → "send" engangskode (mock).
   - Steg 2: 6-sifret kode → bekreft og vis portalen.
   - v2.1: Husker SMS-verifiseringen i localStorage 24t per token, så
     reload ikke tvinger ny SMS-flyt. Logg ut-knapp i topbar tømmer.
   ========================================================= */
(function () {
  "use strict";

  // ---- Session-persistering ----
  const SESSION_PREFIX = "2gm_portal_auth_";
  const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 timer

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

  function saveSession(token, phone) {
    if (!token) return;
    try {
      localStorage.setItem(SESSION_PREFIX + token, JSON.stringify({
        verifiedAt: Date.now(),
        phone: phone || null,
      }));
    } catch (_) {
      // localStorage kan være disabled (private mode etc.) — feil stille,
      // verste fall må kunden gjennom SMS-steget igjen ved reload.
    }
  }

  function clearSession(token) {
    if (!token) return;
    try { localStorage.removeItem(SESSION_PREFIX + token); }
    catch (_) {}
  }

  const Auth = {
    customer: null,
    token: null,
    phone: null,
    mockOtp: null,
    onSuccess: null,

    async init(onSuccess) {
      this.onSuccess = onSuccess;

      const params = new URLSearchParams(window.location.search);
      const tokenParam = params.get("token");

      this.token = tokenParam || null;

      this._wireUpUi();

      // Hvis ingen token i URL → "demo"-modus med mock-kunde,
      // slik at portalen er browseable for utvikling.
      if (!this.token) {
        // eslint-disable-next-line no-console
        console.log("[AUTH] Ingen token i URL, bruker demo-kunde.");
        this.customer = window.MockData.getCustomer("demo");
        this._showAuthScreen();
        return;
      }

      // Vis spinner mens vi validerer
      this._showLoading();

      try {
        const result = await window.Api.validateToken(this.token);

        if (!result.valid) {
          this._showInvalidToken();
          return;
        }

        // Konverter API-respons til samme form som MockData.getCustomer()
        // returnerer, slik at resten av appen ikke trenger å vite at
        // dataen kommer fra en ekte API.
        this.customer = {
          id: this.token, // bruker token som id
          name: result.firma,
          contactName: result.kontaktperson,
          phoneMasked: result.telefon_maskert,
          locations: result.tillatte_lokasjoner || [],
          maxRooms: result.maks_rom || 1
        };

        // eslint-disable-next-line no-console
        console.log("[AUTH] Token gyldig for:", this.customer.name);

        // Hvis kunden allerede har en gyldig sesjon, hopp over SMS-flyten.
        const session = loadSession(this.token);
        if (session) {
          // eslint-disable-next-line no-console
          console.log("[AUTH] Gyldig sesjon (24t) — hopper over SMS.");
          this.phone = session.phone || null;
          this._completeLogin();
          return;
        }

        this._showAuthScreen();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AUTH] Feil under validering:", err);
        this._showNetworkError();
      }
    },

    _wireUpUi() {
      const phoneForm = document.getElementById("auth-phone-form");
      const codeForm  = document.getElementById("auth-code-form");
      const backBtn   = document.getElementById("auth-back");
      const skipBtn   = document.getElementById("auth-skip");
      const logoutBtn = document.getElementById("btn-logout");

      if (logoutBtn) {
        // Skjul i demo-modus (ingen ekte sesjon å logge ut av).
        logoutBtn.hidden = !this.token;
        logoutBtn.addEventListener("click", () => {
          clearSession(this.token);
          location.reload();
        });
      }

      phoneForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this._handlePhoneSubmit();
      });

      codeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this._handleCodeSubmit();
      });

      backBtn.addEventListener("click", () => {
        this._showStep("phone");
      });

      if (skipBtn) {
        skipBtn.addEventListener("click", () => {
          // eslint-disable-next-line no-console
          console.log("[MOCK] Hopper over verifisering.");
          this._completeLogin();
        });
      }
    },

    _showLoading() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = "Verifiserer tilgang…";

      // Skjul begge skjemaer mens vi laster
      document.getElementById("auth-phone-form").hidden = true;
      document.getElementById("auth-code-form").hidden = true;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showInvalidToken() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = "";

      document.getElementById("auth-phone-form").hidden = true;
      document.getElementById("auth-code-form").hidden = true;

      const errEl = document.getElementById("auth-error");
      errEl.innerHTML =
        "<strong>Ugyldig eller utløpt lenke.</strong><br>" +
        "Kontakt 2GM Eiendom for å få en ny tilgangslenke.";
      errEl.hidden = false;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showNetworkError() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = "";

      document.getElementById("auth-phone-form").hidden = true;
      document.getElementById("auth-code-form").hidden = true;

      const errEl = document.getElementById("auth-error");
      errEl.innerHTML =
        "<strong>Kunne ikke kontakte serveren.</strong><br>" +
        "Sjekk internettforbindelsen og prøv igjen.";
      errEl.hidden = false;

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
    },

    _showAuthScreen() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = this.customer
        ? `Innlogging for ${this.customer.name}`
        : "Innlogging";

      // Vis hint om hvilket nummer SMS-en sendes til (hvis vi har det)
      const phoneInput = document.getElementById("auth-phone");
      if (this.customer && this.customer.phoneMasked) {
        phoneInput.placeholder = this.customer.phoneMasked;
        phoneInput.title = `SMS sendes til ${this.customer.phoneMasked}`;
      }

      document.getElementById("auth-screen").hidden = false;
      document.getElementById("portal").hidden = true;
      this._showStep("phone");
    },

    _showStep(step) {
      const phoneForm = document.getElementById("auth-phone-form");
      const codeForm  = document.getElementById("auth-code-form");
      const errEl     = document.getElementById("auth-error");

      errEl.hidden = true;
      errEl.textContent = "";

      if (step === "phone") {
        phoneForm.hidden = false;
        codeForm.hidden = true;
        document.getElementById("auth-phone").focus();
      } else {
        phoneForm.hidden = true;
        codeForm.hidden = false;
        document.getElementById("auth-code").value = "";
        document.getElementById("auth-code").focus();
      }
    },

    _handlePhoneSubmit() {
      const phoneEl = document.getElementById("auth-phone");
      const phoneRaw = (phoneEl.value || "").trim();
      // I mock-modus tillater vi tomt nummer også — bare gå videre.
      const phone = phoneRaw || "+47 00000000";

      this.phone = phone;
      this.mockOtp = window.MockData.generateMockOtp();

      // eslint-disable-next-line no-console
      console.log(`[MOCK SMS] Engangskode til ${phone}: ${this.mockOtp}`);
      const hint = document.getElementById("auth-mock-hint");
      hint.textContent =
        `Mock-modus: skriv ${this.mockOtp} — eller hva som helst på 6 sifre.`;

      this._showStep("code");
    },

    _handleCodeSubmit() {
      const codeEl = document.getElementById("auth-code");
      // Strip alt som ikke er sifre (mellomrom, bindestreker, osv.)
      const code = String(codeEl.value || "").replace(/\D/g, "");

      // eslint-disable-next-line no-console
      console.log("[MOCK] Bekrefter kode:", code, "(forventet:", this.mockOtp, ")");

      if (code.length !== 6) {
        return this._showError("Koden må være 6 sifre.");
      }

      // Mock-modus: enhver 6-sifret kode godkjennes.
      this._completeLogin();
    },

    _completeLogin() {
      // Lagre sesjonen så reload (innen 24t) hopper SMS-steget.
      saveSession(this.token, this.phone);

      document.getElementById("auth-screen").hidden = true;
      document.getElementById("portal").hidden = false;

      if (typeof this.onSuccess === "function") {
        try {
          this.onSuccess({
            customer: this.customer,
            token: this.token,
            phone: this.phone
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
