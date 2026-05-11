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
      // v3.8.7: foretrukket default er "Rigg 44" hvis kunden har tilgang —
      // ellers falle tilbake til første lokasjon i lista.
      const initialLocId = pickDefaultLocationId(locations);

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
        preferredLocId: initialLocId,
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

      // v3.10.0: Fakturaarkiv — historiske opphold gruppert per måned.
      // Samme token-krav som Mine bookinger.
      if (window.Invoices && session.token) {
        window.Invoices.init({ token: session.token });
      }

      // v3.7.2: Ledige rom under kalenderen — kun for kunder som eier rom
      // (long-term/full-tenant). Tom respons = skjult seksjon.
      if (session.token) {
        loadCustomerFreeRooms(session.token);
        // Re-load periodisk + ved språkbytte så lista holdes fersk.
        setInterval(() => loadCustomerFreeRooms(session.token), 5 * 60 * 1000);
        document.addEventListener("i18n:change", () => loadCustomerFreeRooms(session.token));
      }

      // v3.7.3: "Tøm datoer"-knapp under Fra dato — nullstiller fra+til
       // og resetter kalender-valg så kunden kan starte velgingen på nytt.
      const clearBtn = document.getElementById("f-clear-dates");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          window.Booking.setDateRange("", "");
          window.Calendar.setRange(null, null);
          pickStage = "from";
        });
      }

      window.Calendar.init({
        locationId: initialLocId,
        onSelect: (iso /* , avail */) => {
          // Open-ended: bare én dato — hver klikk setter ny fra,
          // og klikk på samme dato igjen tømmer valget (toggle off).
          if (window.Booking.isOpenEnded()) {
            const { from: openFrom } = window.Booking.getDateRange();
            if (openFrom === iso) {
              window.Booking.setDateRange("", "");
            } else {
              window.Booking.setDateRange(iso, "");
            }
            pickStage = "from";
            syncCalendarFromBooking();
            return;
          }

          // v3.10.1: tre-stegs toggle på samme dato — Fra → 1 dag → tomt → Fra…
          // Etter at andre klikk har satt rangeTo === rangeFrom, sitter vi i
          // pickStage = "from" med begge endepunkter på samme dato. Tredje klikk
          // på den datoen tømmer hele valget i stedet for å starte ny "Fra".
          const cur = window.Booking.getDateRange();
          if (pickStage === "from" && cur.from === iso && cur.to === iso) {
            window.Booking.setDateRange("", "");
            pickStage = "from";
            syncCalendarFromBooking();
            return;
          }

          if (pickStage === "from") {
            // 1. klikk (eller etter en komplett periode på en annen dato)
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

  // v3.7.9: trekkspill-knapp på Ledige rom-headeren — samme mønster som
  // Mine bookinger. Wires én gang ved første kall.
  let _frToggleWired = false;
  function wireFreeRoomsToggle() {
    if (_frToggleWired) return;
    const toggle = document.getElementById("customerFreeRoomsToggle");
    const section = document.getElementById("customerFreeRoomsSection");
    if (!toggle || !section) return;
    toggle.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
    _frToggleWired = true;
  }

  async function loadCustomerFreeRooms(token) {
    const section = document.getElementById("customerFreeRoomsSection");
    const list = document.getElementById("customerFreeRoomsList");
    if (!section || !list || !window.Api || !window.Api.getCustomerFreeRooms) return;
    wireFreeRoomsToggle();
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
      // v3.8.2: count-summary skiller "ledig nå" fra "kommende" (rom som blir
      // ledig senere). Når en kategori har akkurat 1 element vises datoen i
      // parens (kort format DD.MM) — ellers bare antall.
      const countEl = document.getElementById("customerFreeRoomsCount");
      if (countEl) {
        const buckets = { roomsNow: [], roomsUp: [], aptsNow: [], aptsUp: [] };
        for (const r of rooms) {
          const isApt = classifyRoomType(r.title);
          if (r.currentlyFree) buckets[isApt ? "aptsNow"  : "roomsNow"].push(r);
          else                 buckets[isApt ? "aptsUp"   : "roomsUp"].push(r);
        }
        const parts = [];
        if (buckets.roomsNow.length) {
          const n = buckets.roomsNow.length;
          parts.push(t(n === 1 ? "freeRooms.countRoomsOne" : "freeRooms.countRoomsMany", { n }));
        }
        if (buckets.aptsNow.length) {
          const n = buckets.aptsNow.length;
          parts.push(t(n === 1 ? "freeRooms.countAptsOne" : "freeRooms.countAptsMany", { n }));
        }
        if (buckets.roomsUp.length) {
          const n = buckets.roomsUp.length;
          const date = n === 1 ? shortDate(buckets.roomsUp[0].freeFrom) : "";
          parts.push(t(n === 1 ? "freeRooms.countUpcomingRoomOne" : "freeRooms.countUpcomingRoomMany", { n, date }));
        }
        if (buckets.aptsUp.length) {
          const n = buckets.aptsUp.length;
          const date = n === 1 ? shortDate(buckets.aptsUp[0].freeFrom) : "";
          parts.push(t(n === 1 ? "freeRooms.countUpcomingAptOne" : "freeRooms.countUpcomingAptMany", { n, date }));
        }
        countEl.textContent = parts.join(" | ");
      }
      list.innerHTML = rooms.map(r => {
        const when = r.currentlyFree
          ? `<span class="customer-free-rooms-pill-now">${escapeHtml(t("freeRooms.now"))}</span>`
          : `<span>${escapeHtml(t("freeRooms.from", { date: formatIsoDate(r.freeFrom) }))}</span>`;
        const until = r.nextBookingCheckIn
          ? ` <span>${escapeHtml(t("freeRooms.until", { date: formatIsoDate(r.nextBookingCheckIn) }))}</span>`
          : "";
        // v3.8.3: ny linje under — viser hvem rommet er/blir opptatt av.
        // currentGuest tar prioritet (rommet er opptatt nå); ellers nextGuest.
        let guestLine = "";
        if (r.currentGuest || r.currentGuestCompany) {
          const who = formatGuest(r.currentGuestCompany, r.currentGuest);
          guestLine = `<span class="customer-free-rooms-guest">${escapeHtml(t("freeRooms.occupiedBy", { who }))}</span>`;
        } else if (r.nextGuest || r.nextGuestCompany) {
          const who = formatGuest(r.nextGuestCompany, r.nextGuest);
          guestLine = `<span class="customer-free-rooms-guest">${escapeHtml(t("freeRooms.nextGuest", { who }))}</span>`;
        }
        return `<li>
          <span class="customer-free-rooms-room">${escapeHtml(r.title || "?")}</span>
          <span class="customer-free-rooms-prop">· ${escapeHtml(r.property || "")}</span>
          <span class="customer-free-rooms-when">${when}${until}</span>
          ${guestLine}
        </li>`;
      }).join("");
      section.hidden = false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[free-rooms] load failed:", err);
      section.hidden = true;
    }
  }

  // Returnerer true hvis rom-tittelen indikerer en leilighet, false ellers.
  // Heuristikk: titler som starter med "L" + siffer (L201, L304) eller som
  // inneholder "leilighet" regnes som leilighet. Alt annet (Hybel, Rom 304,
  // osv.) regnes som "rom". Justér her hvis 2GM kategoriserer annerledes.
  function classifyRoomType(title) {
    const t = String(title || "").trim();
    if (!t) return false;
    if (/leilighet|apartment/i.test(t)) return true;
    if (/^L\s*\d/i.test(t)) return true;
    return false;
  }

  function formatIsoDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    if (!y || !m || !d) return iso;
    return `${d}.${m}.${y}`;
  }

  // v3.8.2: kort dato-format DD.MM for kompakt count-badge.
  function shortDate(iso) {
    const parts = String(iso || "").slice(0, 10).split("-");
    const m = parts[1], d = parts[2];
    return d && m ? `${d}.${m}` : "";
  }

  // v3.8.7: velg default-lokasjon — foretrekker "Rigg 44" hvis kunden har
  // tilgang, ellers første lokasjon i lista. Match er case-insensitive og
  // tolererer ekstra mellomrom (f.eks. "rigg  44").
  function pickDefaultLocationId(locations) {
    if (!locations || !locations.length) return null;
    const preferred = locations.find(l => /^\s*rigg\s*44\s*$/i.test(l.name || ""));
    return (preferred || locations[0]).id;
  }

  // v3.8.3: format gjest-info som "Company (Person)", eller bare ett av
  // feltene hvis det andre mangler.
  function formatGuest(company, person) {
    const c = (company || "").trim();
    const p = (person  || "").trim();
    if (c && p) return `${c} (${p})`;
    return c || p || "";
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
