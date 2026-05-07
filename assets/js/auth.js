/* =========================================================
   SMS-verifisering (mock).
   - Leser ?kunde= og ?token= fra URL.
   - Steg 1: telefonnummer → "send" engangskode.
   - Steg 2: 6-sifret kode → bekreft og vis portalen.
   ========================================================= */
(function () {
  "use strict";

  const Auth = {
    customer: null,
    token: null,
    phone: null,
    mockOtp: null,
    onSuccess: null,

    init(onSuccess) {
      this.onSuccess = onSuccess;

      const params = new URLSearchParams(window.location.search);
      const kundeParam = params.get("kunde");
      const tokenParam = params.get("token");

      this.token = tokenParam || null;
      this.customer = window.MockData.getCustomer(kundeParam);

      // Hvis ingen ?kunde= → bruk demo for at portalen skal være browseable.
      if (!this.customer) {
        this.customer = window.MockData.getCustomer("demo");
      }

      this._wireUpUi();
      this._showAuthScreen();
    },

    _wireUpUi() {
      const phoneForm = document.getElementById("auth-phone-form");
      const codeForm  = document.getElementById("auth-code-form");
      const backBtn   = document.getElementById("auth-back");
      const skipBtn   = document.getElementById("auth-skip");

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

    _showAuthScreen() {
      const sub = document.getElementById("auth-customer-sub");
      sub.textContent = this.customer
        ? `Innlogging for ${this.customer.name}`
        : "Innlogging";

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
