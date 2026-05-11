/* =========================================================
   i18n — to-språks oversettelse (NB / EN).
   v1.0
   - Dictionary med alle synlige strenger.
   - I18n.t(key, vars) for slå opp + interpolere {placeholders}.
   - I18n.setLang(lang) bytter språk, lagrer i localStorage, applyer DOM.
   - I18n.applyDom() oppdaterer alle data-i18n* attributter:
       data-i18n             → innerText
       data-i18n-html        → innerHTML (brukes der vi vil tillate strong/br)
       data-i18n-placeholder → placeholder-attribut
       data-i18n-title       → title-attribut
       data-i18n-aria        → aria-label-attribut
   - "Andre moduler" lytter på 'i18n:change' for å re-rendre dynamisk innhold.
   ========================================================= */
(function () {
  "use strict";

  const STORAGE_KEY = "2gm_portal_lang";
  const SUPPORTED = ["nb", "en"];
  const DEFAULT_LANG = "nb";

  const DICT = {
    nb: {
      // Topbar
      "topbar.app":         "Bestillingsportal",
      "topbar.newBooking":  "+ Ny bestilling",
      "topbar.logout":      "Logg ut",

      // Nav (v3.10.8 / v3.10.9)
      "nav.booking":        "Bestilling",
      "nav.newBooking":     "+ Ny bestilling",
      "nav.mybookings":     "Mine bookinger",
      "nav.invoices":       "Fakturaarkiv",

      // Auth
      "auth.title":           "Bestillingsportal",
      "auth.loginAs":         "Innlogging for {name}",
      "auth.loginGeneric":    "Innlogging",
      "auth.loggingIn":       "Logger inn…",
      "auth.verifying":       "Verifiserer tilgang…",
      "auth.invalidToken":    "<strong>Ugyldig eller utløpt lenke.</strong><br>Kontakt 2GM Eiendom for å få en ny tilgangslenke.",
      "auth.networkError":    "<strong>Kunne ikke kontakte serveren.</strong><br>Sjekk internettforbindelsen og prøv igjen.",
      "auth.pinLabel":        "PIN-kode",
      "auth.pinPlaceholder":  "6 sifre",
      "auth.pinHint":         "PIN-koden får du av 2GM Eiendom.",
      "auth.confirm":         "Logg inn",
      "auth.codeMustBe6":     "PIN-koden må være 6 sifre.",
      "auth.pinWrong":        "Feil PIN. Prøv igjen.",
      "auth.pinLocked":       "<strong>For mange mislykkede forsøk.</strong><br>Prøv igjen om en time, eller kontakt 2GM Eiendom.",

      // Calendar
      "calendar.title":      "Tilgjengelighet",
      "calendar.legendFree": "Ledig",
      "calendar.legendFew":  "Få igjen",
      "calendar.legendFull": "Fullt",
      "calendar.prev":       "Forrige måned",
      "calendar.next":       "Neste måned",
      "calendar.full":       "Fullt",
      "calendar.available":  "{n} ledig",
      "calendar.loading":    "laster…",
      "mybookings.filterActive":   "Aktive",
      "mybookings.filterUpcoming": "Kommende",
      "mybookings.filterAll":      "Alle",
      "mybookings.emptyActive":    "Du har ingen aktive bookinger akkurat nå.",
      "mybookings.emptyUpcoming":  "Du har ingen kommende bookinger.",
      "mybookings.filterPending":  "{n} avventer",
      "mybookings.lastRefreshed":  "Sist oppdatert {time}",
      "freeRooms.title":     "Ledige rom",
      "freeRooms.now":       "Ledig nå",
      "freeRooms.from":      "Ledig fra {date}",
      "freeRooms.until":     "frem til {date}",
      "freeRooms.countRoomsOne":   "1 ledig rom",
      "freeRooms.countRoomsMany":  "{n} ledige rom",
      "freeRooms.countAptsOne":    "1 ledig leilighet",
      "freeRooms.countAptsMany":   "{n} ledige leiligheter",
      "freeRooms.countUpcomingRoomOne":  "1 kommende rom ({date})",
      "freeRooms.countUpcomingRoomMany": "{n} kommende rom",
      "freeRooms.countUpcomingAptOne":   "1 kommende leilighet ({date})",
      "freeRooms.countUpcomingAptMany":  "{n} kommende leiligheter",
      "freeRooms.occupiedBy":  "Opptatt av {who}",
      "freeRooms.nextGuest":   "Neste: {who}",
      "booking.clearDates":  "Tøm datoer",
      "calendar.footnote":   "Klikk på startdato, deretter sluttdato. Klikk på nytt for å starte over.",

      // Booking form
      "booking.title":      "Ny bestilling",
      "booking.pickDate":   "Velg dato",
      "booking.close":      "Lukk",
      "booking.fetching":   "Henter…",
      "booking.unknown":    "Ukjent",
      "booking.full":       "Fullt",
      "booking.fewLeft":    "Få igjen ({n})",
      "booking.nFree":      "{n} ledige",
      "booking.openSuffix": " · estimert {days} dager",
      "booking.location":   "Lokasjon",
      "booking.from":       "Fra dato",
      "booking.to":         "Til dato",
      "booking.openEnded":  "Vet ikke utflyttingsdato (open-ended)",
      "booking.rooms":      "Antall rom",
      "booking.fewerRooms": "Færre rom",
      "booking.moreRooms":  "Flere rom",
      "booking.guests":     "Navn på gjester",
      "booking.guestsHint": "Bruker fellesperioden over med mindre du klikker «Avvikende datoer».",
      "booking.guestName":  "Navn på gjest",
      "booking.guestRoom":  "Rom {n}",
      "booking.submit":     "Send bestilling",
      "booking.sending":    "Sender…",
      "booking.noLocations":"Ingen lokasjoner tilgjengelig",
      "booking.dontKnowOut":"Vet ikke utflyttingsdato",
      "booking.useShared":  "← Bruk fellesperioden i stedet",
      "booking.tabOwn":     "Egne datoer",
      "booking.tabDeviating":"Avvikende datoer",
      "booking.summaryOwn": "Egne datoer: {period}",
      "booking.summaryShared":"Bruker fellesperioden: {period}",
      "booking.summaryNotPicked":"Bruker fellesperioden (ikke valgt enda).",
      "booking.periodNotPicked":"ikke valgt",
      "booking.openPeriod": "{from} → open-ended ({days} d.)",
      "booking.fromOnly":   "{from} →",
      "booking.fullPeriod": "{from} – {to}",
      "booking.errPickLoc": "Velg lokasjon.",
      "booking.errAllNames":"Fyll inn navn for alle rom.",
      "booking.errNoFrom":  "{who} mangler fra-dato.",
      "booking.errNoTo":    "Rom {n} («{name}») mangler til-dato — eller huk av for «Vet ikke utflyttingsdato».",
      "booking.errBadOrder":"Rom {n} («{name}»): til-dato må være etter fra-dato.",
      "booking.sharedPeriod":"Fellesperioden",
      "booking.errGeneric": "Noe gikk galt. Vennligst kontakt 2GM Eiendom på +47 99 10 10 41.",
      "booking.warningPrefix":"Obs:",
      "booking.warningSentence":"{dates} har bare {available} ledige rom — du trenger {needed} rom.",
      "booking.warningSuffix":"2GM vil kontakte deg.",
      "booking.thanksTitle": "Takk for bestillingen!",
      "booking.thanksLead":  "Vi har mottatt bestillingen din.",
      "booking.thanksRef":   "Referanse: <strong>{ref}</strong>",
      "booking.thanksSub":   "2GM Eiendom tar kontakt med deg så snart vi har bekreftet rom og perioder.",
      "booking.thanksFoot":  "Du kan lukke vinduet.",
      "booking.thanksSeeBooking": "Se din booking ↓",
      "booking.joinAnd":     "og",

      // Mine bookinger
      "mybookings.title":         "Mine bookinger",
      "mybookings.loading":       "Laster…",
      "mybookings.error":         "Kunne ikke hente bookinger. Prøv å laste siden på nytt.",
      "mybookings.empty":         "Du har ingen aktive eller kommende bookinger.",
      "mybookings.rowsOne":       "{n} rad",
      "mybookings.rowsMany":      "{n} rader",
      "mybookings.unnamed":       "(uten navn)",
      "mybookings.openPeriod":    "åpen",
      "mybookings.statusPending": "Avventer bekreftelse",
      "mybookings.statusActive":  "Aktiv",
      "mybookings.statusUpcoming":"Bekreftet",
      "mybookings.statusCancelled":"Avlyst",
      "mybookings.room":          "Rom {n}",
      "mybookings.code":          "Dørkode {code}",
      "mybookings.nightsOne":     "{n} natt",
      "mybookings.nightsMany":    "{n} netter",
      "mybookings.lblAddress":    "Adresse",
      "mybookings.lblCheckIn":    "Innsjekk",
      "mybookings.lblCheckOut":   "Utsjekk",
      "mybookings.lblReference":  "Referanse",
      "mybookings.doorCodeLabel": "Dørkode",
      "mybookings.doorCodePending":"Kode kommer snart / eller er allerede gitt",
      "mybookings.extend":        "Forleng oppholdet",
      "mybookings.endRental":     "Avslutt leien",
      "mybookings.actionsTitle":  "Hva vil du gjøre?",
      "mybookings.noLocation":    "Uten lokasjon",

      // Forleng-dialog
      "extend.title":   "Forleng oppholdet",
      "extend.subPart": "Booking {ref}, nåværende utflytting {current}.",
      "extend.newDate": "Ny utflyttingsdato",
      "extend.cancel":  "Avbryt",
      "extend.send":    "Send forespørsel",
      "extend.sending": "Sender …",
      "extend.errPick": "Velg en dato.",
      "extend.errMin":  "Datoen må være {date} eller senere.",
      "extend.errFail": "Kunne ikke sende: {err}",
      "extend.success": "Takk! Forespørselen er sendt til 2GM. Du får tilbakemelding så snart admin har sett på den.",
      "extend.fallbackPrompt":"Ny utflyttingsdato for {ref} (YYYY-MM-DD), tidligst {min}:",
      "extend.fallbackFail":"Kunne ikke sende forespørselen ({err}).",

      // Avslutt-leien-dialog (v3.5.2)
      "end.title":      "Avslutt leien",
      "end.subPart":    "Booking {ref}, nåværende utflytting {current}.",
      "end.openEnded":  "ikke satt (åpent opphold)",
      "end.newDate":    "Utflyttingsdato",
      "end.send":       "Send forespørsel",
      "end.sending":    "Sender …",
      "end.errMin":     "Datoen må være {date} eller senere.",
      "end.errFail":    "Kunne ikke sende: {err}",
      "end.success":    "Takk! Forespørselen er sendt til 2GM. Du får tilbakemelding så snart admin har sett på den.",
      "end.fallbackPrompt":"Ønsket utflyttingsdato for {ref} (YYYY-MM-DD):",
      "end.fallbackFail":"Kunne ikke sende forespørselen ({err}).",

      // Update banner
      "update.text":   "🔄 Ny versjon tilgjengelig — kjører {old} → {new}",
      "update.reload": "Last inn på nytt",

      // Invoice archive
      "invoices.title":          "Fakturaarkiv",
      "invoices.search":         "Søk navn, rom eller måned…",
      "invoices.empty":          "Fakturaarkivet er tomt — ingen tidligere opphold registrert.",
      "invoices.loading":        "Laster fakturaarkiv…",
      "invoices.error":          "Kunne ikke laste arkiv. Prøv igjen senere.",
      "invoices.colPeriod":      "Periode",
      "invoices.colBookings":    "Bookinger",
      "invoices.colNights":      "Netter",
      "invoices.colProperty":    "Eiendom",
      "invoices.colActions":     "Last ned",
      "invoices.colGuest":       "Gjest",
      "invoices.colRoom":        "Rom",
      "invoices.colCheckIn":     "Innsjekk",
      "invoices.colCheckOut":    "Utsjekk",
      "invoices.colNightsOne":   "Netter",
      "invoices.btnPdf":         "📄 PDF",
      "invoices.btnXlsx":        "📊 XLSX",
      "invoices.expand":         "Vis detaljer",
      "invoices.collapse":       "Skjul detaljer",
      "invoices.searchNoMatch":  "Ingen treff for «{q}».",
      "invoices.summary":        "Oppsummering — {month}",
      "invoices.totalBookings":  "{n} bookinger",
      "invoices.totalNights":    "{n} netter",
      "invoices.openEnded":      "åpent",
      "invoices.guestSheet":     "Grunnlag — {guest}",
      "invoices.colRef":         "Bookingref.",
      "invoices.colStatus":      "Status",
      "invoices.colAmount":      "Sum",
      "invoices.colRate":        "Døgnpris",
      "invoices.close":          "Lukk",
      "invoices.viewSheet":      "Vis grunnlag",
      "invoices.totalAmount":    "{n} kr",
      "invoices.noRate":         "—",
      "invoices.amountNote":     "Beløp = netter × døgnpris (eks. gebyrer/mva)",
      "invoices.ongoingBadge":   "pågående",
      "invoices.ongoingNote":    "Pågående opphold — netter og sum oppdateres etter hvert som månedene går.",

      // Footer
      "footer.copy": "© 2GM Eiendom AS · Bestillingsportal",

      // Måneder + ukedager
      "months.long": [
        "januar","februar","mars","april","mai","juni",
        "juli","august","september","oktober","november","desember"
      ],
      "months.short": [
        "jan","feb","mar","apr","mai","jun",
        "jul","aug","sep","okt","nov","des"
      ],
      "weekdays.short": ["Man","Tir","Ons","Tor","Fre","Lør","Søn"],
    },

    en: {
      // Topbar
      "topbar.app":         "Booking Portal",
      "topbar.newBooking":  "+ New booking",
      "topbar.logout":      "Sign out",

      // Nav (v3.10.8 / v3.10.9)
      "nav.booking":        "Booking",
      "nav.newBooking":     "+ New booking",
      "nav.mybookings":     "My bookings",
      "nav.invoices":       "Invoice archive",

      // Auth
      "auth.title":           "Booking Portal",
      "auth.loginAs":         "Sign in for {name}",
      "auth.loginGeneric":    "Sign in",
      "auth.loggingIn":       "Signing in…",
      "auth.verifying":       "Verifying access…",
      "auth.invalidToken":    "<strong>Invalid or expired link.</strong><br>Contact 2GM Eiendom for a new access link.",
      "auth.networkError":    "<strong>Could not reach the server.</strong><br>Check your connection and try again.",
      "auth.pinLabel":        "PIN code",
      "auth.pinPlaceholder":  "6 digits",
      "auth.pinHint":         "You will get the PIN code from 2GM Eiendom.",
      "auth.confirm":         "Sign in",
      "auth.codeMustBe6":     "The PIN must be 6 digits.",
      "auth.pinWrong":        "Wrong PIN. Try again.",
      "auth.pinLocked":       "<strong>Too many failed attempts.</strong><br>Try again in an hour, or contact 2GM Eiendom.",

      // Calendar
      "calendar.title":      "Availability",
      "calendar.legendFree": "Available",
      "calendar.legendFew":  "Limited",
      "calendar.legendFull": "Full",
      "calendar.prev":       "Previous month",
      "calendar.next":       "Next month",
      "calendar.full":       "Full",
      "calendar.available":  "{n} free",
      "calendar.loading":    "loading…",
      "mybookings.filterActive":   "Active",
      "mybookings.filterUpcoming": "Upcoming",
      "mybookings.filterAll":      "All",
      "mybookings.emptyActive":    "You have no active bookings right now.",
      "mybookings.emptyUpcoming":  "You have no upcoming bookings.",
      "mybookings.filterPending":  "{n} pending",
      "mybookings.lastRefreshed":  "Last updated {time}",
      "freeRooms.title":     "Available rooms",
      "freeRooms.now":       "Free now",
      "freeRooms.from":      "Free from {date}",
      "freeRooms.until":     "until {date}",
      "freeRooms.countRoomsOne":   "1 free room",
      "freeRooms.countRoomsMany":  "{n} free rooms",
      "freeRooms.countAptsOne":    "1 free apartment",
      "freeRooms.countAptsMany":   "{n} free apartments",
      "freeRooms.countUpcomingRoomOne":  "1 upcoming room ({date})",
      "freeRooms.countUpcomingRoomMany": "{n} upcoming rooms",
      "freeRooms.countUpcomingAptOne":   "1 upcoming apartment ({date})",
      "freeRooms.countUpcomingAptMany":  "{n} upcoming apartments",
      "freeRooms.occupiedBy":  "Occupied by {who}",
      "freeRooms.nextGuest":   "Next: {who}",
      "booking.clearDates":  "Clear dates",
      "calendar.footnote":   "Click a start date, then an end date. Click again to start over.",

      // Booking form
      "booking.title":      "New booking",
      "booking.pickDate":   "Pick a date",
      "booking.close":      "Close",
      "booking.fetching":   "Loading…",
      "booking.unknown":    "Unknown",
      "booking.full":       "Full",
      "booking.fewLeft":    "Limited ({n})",
      "booking.nFree":      "{n} available",
      "booking.openSuffix": " · estimated {days} days",
      "booking.location":   "Location",
      "booking.from":       "From date",
      "booking.to":         "To date",
      "booking.openEnded":  "Don't know check-out date (open-ended)",
      "booking.rooms":      "Number of rooms",
      "booking.fewerRooms": "Fewer rooms",
      "booking.moreRooms":  "More rooms",
      "booking.guests":     "Guest names",
      "booking.guestsHint": "Uses the shared period above unless you click \"Custom dates\".",
      "booking.guestName":  "Guest name",
      "booking.guestRoom":  "Room {n}",
      "booking.submit":     "Submit booking",
      "booking.sending":    "Sending…",
      "booking.noLocations":"No locations available",
      "booking.dontKnowOut":"Don't know check-out date",
      "booking.useShared":  "← Use the shared period instead",
      "booking.tabOwn":     "Custom dates",
      "booking.tabDeviating":"Custom dates",
      "booking.summaryOwn": "Custom dates: {period}",
      "booking.summaryShared":"Using the shared period: {period}",
      "booking.summaryNotPicked":"Using the shared period (not picked yet).",
      "booking.periodNotPicked":"not picked",
      "booking.openPeriod": "{from} → open-ended ({days} d.)",
      "booking.fromOnly":   "{from} →",
      "booking.fullPeriod": "{from} – {to}",
      "booking.errPickLoc": "Pick a location.",
      "booking.errAllNames":"Enter a name for every room.",
      "booking.errNoFrom":  "{who} is missing a from-date.",
      "booking.errNoTo":    "Room {n} (\"{name}\") is missing a to-date — or check \"Don't know check-out date\".",
      "booking.errBadOrder":"Room {n} (\"{name}\"): to-date must be after from-date.",
      "booking.sharedPeriod":"The shared period",
      "booking.errGeneric": "Something went wrong. Please contact 2GM Eiendom at +47 99 10 10 41.",
      "booking.warningPrefix":"Notice:",
      "booking.warningSentence":"{dates} only has {available} rooms available — you need {needed}.",
      "booking.warningSuffix":"2GM will contact you.",
      "booking.thanksTitle": "Thanks for the booking!",
      "booking.thanksLead":  "We have received your booking.",
      "booking.thanksRef":   "Reference: <strong>{ref}</strong>",
      "booking.thanksSub":   "2GM Eiendom will contact you as soon as we've confirmed rooms and dates.",
      "booking.thanksFoot":  "You may close this window.",
      "booking.thanksSeeBooking": "View your booking ↓",
      "booking.joinAnd":     "and",

      // My bookings
      "mybookings.title":         "My bookings",
      "mybookings.loading":       "Loading…",
      "mybookings.error":         "Could not load bookings. Try reloading the page.",
      "mybookings.empty":         "You have no active or upcoming bookings.",
      "mybookings.rowsOne":       "{n} row",
      "mybookings.rowsMany":      "{n} rows",
      "mybookings.unnamed":       "(no name)",
      "mybookings.openPeriod":    "open",
      "mybookings.statusPending": "Awaiting confirmation",
      "mybookings.statusActive":  "Active",
      "mybookings.statusUpcoming":"Confirmed",
      "mybookings.statusCancelled":"Cancelled",
      "mybookings.room":          "Room {n}",
      "mybookings.code":          "Door code {code}",
      "mybookings.nightsOne":     "{n} night",
      "mybookings.nightsMany":    "{n} nights",
      "mybookings.lblAddress":    "Address",
      "mybookings.lblCheckIn":    "Check-in",
      "mybookings.lblCheckOut":   "Check-out",
      "mybookings.lblReference":  "Reference",
      "mybookings.doorCodeLabel": "Door code",
      "mybookings.doorCodePending":"Code coming soon / or already issued",
      "mybookings.extend":        "Extend stay",
      "mybookings.endRental":     "End rental",
      "mybookings.actionsTitle":  "What would you like to do?",
      "mybookings.noLocation":    "No location",

      // Extend dialog
      "extend.title":   "Extend stay",
      "extend.subPart": "Booking {ref}, current check-out {current}.",
      "extend.newDate": "New check-out date",
      "extend.cancel":  "Cancel",
      "extend.send":    "Send request",
      "extend.sending": "Sending …",
      "extend.errPick": "Pick a date.",
      "extend.errMin":  "Date must be {date} or later.",
      "extend.errFail": "Could not send: {err}",
      "extend.success": "Thanks! The request has been sent to 2GM. You'll hear back as soon as admin has reviewed it.",
      "extend.fallbackPrompt":"New check-out date for {ref} (YYYY-MM-DD), earliest {min}:",
      "extend.fallbackFail":"Could not send the request ({err}).",

      // End rental dialog (v3.5.2)
      "end.title":      "End rental",
      "end.subPart":    "Booking {ref}, current check-out {current}.",
      "end.openEnded":  "not set (open-ended stay)",
      "end.newDate":    "Check-out date",
      "end.send":       "Send request",
      "end.sending":    "Sending …",
      "end.errMin":     "Date must be {date} or later.",
      "end.errFail":    "Could not send: {err}",
      "end.success":    "Thanks! The request has been sent to 2GM. You'll hear back as soon as admin has reviewed it.",
      "end.fallbackPrompt":"Desired check-out date for {ref} (YYYY-MM-DD):",
      "end.fallbackFail":"Could not send the request ({err}).",

      // Update banner
      "update.text":   "🔄 New version available — running {old} → {new}",
      "update.reload": "Reload now",

      // Invoice archive
      "invoices.title":          "Invoice archive",
      "invoices.search":         "Search name, room or month…",
      "invoices.empty":          "Archive is empty — no previous stays on record.",
      "invoices.loading":        "Loading archive…",
      "invoices.error":          "Could not load archive. Please try again later.",
      "invoices.colPeriod":      "Period",
      "invoices.colBookings":    "Bookings",
      "invoices.colNights":      "Nights",
      "invoices.colProperty":    "Property",
      "invoices.colActions":     "Download",
      "invoices.colGuest":       "Guest",
      "invoices.colRoom":        "Room",
      "invoices.colCheckIn":     "Check-in",
      "invoices.colCheckOut":    "Check-out",
      "invoices.colNightsOne":   "Nights",
      "invoices.btnPdf":         "📄 PDF",
      "invoices.btnXlsx":        "📊 XLSX",
      "invoices.expand":         "Show details",
      "invoices.collapse":       "Hide details",
      "invoices.searchNoMatch":  "No matches for \"{q}\".",
      "invoices.summary":        "Summary — {month}",
      "invoices.totalBookings":  "{n} bookings",
      "invoices.totalNights":    "{n} nights",
      "invoices.openEnded":      "open",
      "invoices.guestSheet":     "Statement — {guest}",
      "invoices.colRef":         "Booking ref.",
      "invoices.colStatus":      "Status",
      "invoices.colAmount":      "Amount",
      "invoices.colRate":        "Rate / night",
      "invoices.close":          "Close",
      "invoices.viewSheet":      "View statement",
      "invoices.totalAmount":    "{n} kr",
      "invoices.noRate":         "—",
      "invoices.amountNote":     "Amount = nights × rate (excl. fees/VAT)",
      "invoices.ongoingBadge":   "ongoing",
      "invoices.ongoingNote":    "Ongoing stay — nights and amount will grow as months pass.",

      // Footer
      "footer.copy": "© 2GM Eiendom AS · Booking Portal",

      // Months + weekdays
      "months.long": [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ],
      "months.short": [
        "Jan","Feb","Mar","Apr","May","Jun",
        "Jul","Aug","Sep","Oct","Nov","Dec"
      ],
      "weekdays.short": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    },
  };

  let currentLang = pickInitialLang();

  function pickInitialLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch (_) {}
    const browser = (navigator.language || "nb").slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : DEFAULT_LANG;
  }

  function get(key) {
    const dict = DICT[currentLang] || DICT[DEFAULT_LANG];
    return Object.prototype.hasOwnProperty.call(dict, key)
      ? dict[key]
      : (DICT[DEFAULT_LANG][key] !== undefined ? DICT[DEFAULT_LANG][key] : key);
  }

  function interpolate(str, vars) {
    if (!vars || typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, (_, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
    );
  }

  function t(key, vars) {
    const v = get(key);
    return typeof v === "string" ? interpolate(v, vars) : v;
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    document.documentElement.lang = lang === "en" ? "en" : "nb";
    applyDom();
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
  }

  function applyDom(root) {
    const r = root || document;

    r.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    r.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    r.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    r.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    r.querySelectorAll("[data-i18n-aria]").forEach(el => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });

    // Oppdater språk-toggle visuelt
    document.querySelectorAll("[data-lang-btn]").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-lang-btn") === currentLang);
    });
  }

  function getLang() { return currentLang; }

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.lang = currentLang === "en" ? "en" : "nb";
    applyDom();
    document.querySelectorAll("[data-lang-btn]").forEach(btn => {
      btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang-btn")));
    });
  });

  window.I18n = { t, setLang, getLang, applyDom };
})();
