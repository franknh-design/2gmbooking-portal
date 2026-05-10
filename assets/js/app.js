/* =========================================================
   App-bootstrap.
   - Starter Auth-flyten.
   - Når innlogget: setter opp Calendar + Booking og kobler dem sammen.
   - Håndterer to-klikks-velging i kalenderen:
       1. klikk = fra-dato, 2. klikk = til-dato, 3. klikk = ny start.
       Klikk på dato før gjeldende fra-dato → starter ny periode.
   ========================================================= */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    window.Auth.init((session) => {
      const customer = session.customer;

      // Vis kunde i topbar-badge
      document.getElementById("customer-badge").textContent =
        customer ? customer.name : "Ukjent kunde";

      const locations = window.MockData.getLocationsForCustomer(customer);
      const initialLocId = locations.length > 0 ? locations[0].id : null;

      // App.js holder kun "klikk-stadiet"; selve verdiene leses fra Booking.
      // pickStage = "from"  → neste klikk setter fra-dato (og tømmer til)
      // pickStage = "to"    → neste klikk setter til-dato
      let pickStage = "from";

      const syncCalendarFromBooking = () => {
        const { from, to } = window.Booking.getDateRange();
        window.Calendar.setRange(from, to);
      };

      // Booking først (fyller dropdown), deretter kalender (bruker valgt lokasjon).
      window.Booking.init({
        customer,
        onLocationChange: (locId) => {
          window.Calendar.setLocation(locId);
        },
        onDateChange: ({ from, to }) => {
          // Bruker redigerte input-feltene direkte → bestem klikk-stadiet
          // ut fra hva som faktisk er fylt inn.
          if (from && to) pickStage = "from";       // ferdig periode → neste klikk starter ny
          else if (from)  pickStage = "to";          // mangler kun til
          else            pickStage = "from";
          window.Calendar.setRange(from, to);
        }
      });

      // Liste under kalender: kundens egne bookinger (alle lokasjoner)
      // Kun når vi har en ekte token — i demo-modus uten token er det
      // ingen kunde i SharePoint å hente fra.
      if (window.MyBookings && session.token) {
        window.MyBookings.init({ token: session.token });
      }

      // v3.7.2: Ledige rom under kalenderen — kun for kunder som eier rom
      // (long-term/full-tenant). Tom respons = skjult seksjon.
      if (session.token) {
        loadCustomerFreeRooms(session.token);
        // Re-load periodisk + ved språkbytte så lista holdes fersk.
        setInterval(() => loadCustomerFreeRooms(session.token), 5 * 60 * 1000);
        document.addEventListener("i18n:change", () => loadCustomerFreeRooms(session.token));
      }

      window.Calendar.init({
        locationId: initialLocId,
        onSelect: (iso /* , avail */) => {
          // Open-ended: bare én dato — hver klikk setter ny fra.
          if (window.Booking.isOpenEnded()) {
            window.Booking.setDateRange(iso, "");
            pickStage = "from"; // forblir én-dato-modus
            syncCalendarFromBooking();
            return;
          }

          if (pickStage === "from") {
            // 1. eller 3. klikk → start ny periode
            window.Booking.setDateRange(iso, "");
            pickStage = "to";
          } else {
            // 2. klikk → sett til-dato
            const { from } = window.Booking.getDateRange();
            if (!from || iso < from) {
              // Klikk før gjeldende fra → behandle som ny start i stedet
              window.Booking.setDateRange(iso, "");
              pickStage = "to";
            } else {
              window.Booking.setDateRange(undefined, iso);
              pickStage = "from"; // periode komplett, neste klikk starter ny
            }
          }
          syncCalendarFromBooking();
        }
      });
    });
  });

  async function loadCustomerFreeRooms(token) {
    const section = document.getElementById("customerFreeRoomsSection");
    const list = document.getElementById("customerFreeRoomsList");
    if (!section || !list || !window.Api || !window.Api.getCustomerFreeRooms) return;
    try {
      const res = await window.Api.getCustomerFreeRooms(token);
      const rooms = res && res.ok && Array.isArray(res.rooms) ? res.rooms : [];
      if (!rooms.length) {
        section.hidden = true;
        list.innerHTML = "";
        return;
      }
      const t = window.I18n ? window.I18n.t : (k) => k;
      // Oppdater tittel ved språkbytte
      const titleEl = section.querySelector(".customer-free-rooms-title");
      if (titleEl) titleEl.textContent = t("freeRooms.title");
      list.innerHTML = rooms.map(r => {
        const when = r.currentlyFree
          ? `<span class="customer-free-rooms-pill-now">${escapeHtml(t("freeRooms.now"))}</span>`
          : `<span>${escapeHtml(t("freeRooms.from", { date: formatIsoDate(r.freeFrom) }))}</span>`;
        const until = r.nextBookingCheckIn
          ? ` <span>${escapeHtml(t("freeRooms.until", { date: formatIsoDate(r.nextBookingCheckIn) }))}</span>`
          : "";
        return `<li>
          <span class="customer-free-rooms-room">${escapeHtml(r.title || "?")}</span>
          <span class="customer-free-rooms-prop">· ${escapeHtml(r.property || "")}</span>
          <span class="customer-free-rooms-when">${when}${until}</span>
        </li>`;
      }).join("");
      section.hidden = false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[free-rooms] load failed:", err);
      section.hidden = true;
    }
  }

  function formatIsoDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    if (!y || !m || !d) return iso;
    return `${d}.${m}.${y}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
