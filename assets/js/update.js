/* =========================================================
   Versjons-polling.
   v1.0
   - Leser HTML-kommentar (<!-- v3.x.y -->) for kjørende versjon.
   - Poll'er /version.txt hvert 60. sek; viser sticky banner ved diff.
   - Banner forsvinner kun når brukeren klikker "Last inn på nytt"
     (reload med ?v=<ny> så HTML hentes fresh).
   ========================================================= */
(function () {
  "use strict";

  let runningVersion = null;
  let newVersionAvailable = null;

  // Hent kjørende versjon fra HTML-kommentar i toppen av dokumentet.
  // Slipper ekstra hardkodet konstant; samme mekanikk som admin-appen.
  for (const n of document.childNodes) {
    if (n.nodeType === 8) { // COMMENT_NODE
      const m = (n.data || "").match(/v(\d+\.\d+\.\d+)/);
      if (m) { runningVersion = m[1]; break; }
    }
  }

  async function checkForUpdate() {
    if (!runningVersion) return;
    try {
      const r = await fetch("version.txt?_=" + Date.now(), { cache: "no-cache" });
      if (!r.ok) return;
      const remote = (await r.text()).trim().replace(/^v/, "");
      if (!remote || remote === runningVersion) return;

      // Re-asserter .show ved hver poll så banneret forblir synlig
      // helt til brukeren faktisk klikker. Sticky by design.
      if (remote !== newVersionAvailable) {
        newVersionAvailable = remote;
        renderBannerText();
      }
      const banner = document.getElementById("updateBanner");
      if (banner) banner.classList.add("show");
    } catch (e) {
      // Stille — offline / nettverksglipp / 404 før første deploy med version.txt.
    }
  }

  function renderBannerText() {
    if (!newVersionAvailable) return;
    const span = document.getElementById("updateBannerText");
    if (!span) return;
    const t = window.I18n ? window.I18n.t : ((k) => k);
    span.innerHTML = t("update.text", {
      old: `<span style="font-weight:600">v${runningVersion}</span>`,
      new: `<span style="font-weight:600">v${newVersionAvailable}</span>`,
    });
  }

  function applyUpdate() {
    const v = newVersionAvailable || Date.now();
    // Behold eksisterende query params (spesielt ?token=...) — sett kun "v".
    // Tidligere kastet vi pathname+"?v=…" som strippet token og logget kunden ut.
    const url = new URL(location.href);
    url.searchParams.set("v", v);
    location.replace(url.toString());
  }

  window.applyUpdate = applyUpdate;

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 60000);
  });

  // Re-render bannertekst ved språkbytte (versjonsnumrene er allerede kjent).
  document.addEventListener("i18n:change", renderBannerText);
})();
