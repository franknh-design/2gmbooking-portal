/* =========================================================
   App-bootstrap.
   - Starter Auth-flyten.
   - Når innlogget: setter opp Calendar + Booking og kobler dem sammen.
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

      // Booking først (fyller dropdown), deretter kalender (bruker valgt lokasjon).
      window.Booking.init({
        customer,
        onLocationChange: (locId) => {
          window.Calendar.setLocation(locId);
        },
        onDateChange: (iso) => {
          window.Calendar.setSelected(iso);
        }
      });

      window.Calendar.init({
        locationId: initialLocId,
        onSelect: (iso, avail) => {
          if (avail.level === "red") return; // ikke velg fulle dager
          // Forhåndsutfyll fra-dato (og til-dato hvis tom)
          const toEl = document.getElementById("f-to");
          const currentTo = toEl.value;
          window.Booking.setDateRange(iso, currentTo && currentTo >= iso ? currentTo : iso);
          window.Calendar.setSelected(iso);
        }
      });
    });
  });
})();
