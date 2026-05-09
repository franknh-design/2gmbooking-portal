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
        const lblNew = document.getElementById("updateBannerNewVer");
        const lblOld = document.getElementById("updateBannerOldVer");
        if (lblNew) lblNew.textContent = "v" + remote;
        if (lblOld) lblOld.textContent = "v" + runningVersion;
      }
      const banner = document.getElementById("updateBanner");
      if (banner) banner.classList.add("show");
    } catch (e) {
      // Stille — offline / nettverksglipp / 404 før første deploy med version.txt.
    }
  }

  function applyUpdate() {
    const v = newVersionAvailable || Date.now();
    location.replace(location.pathname + "?v=" + v);
  }

  window.applyUpdate = applyUpdate;

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 60000);
  });
})();
