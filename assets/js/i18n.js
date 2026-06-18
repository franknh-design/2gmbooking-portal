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
      "auth.newCustomer":     "Ny kunde?",
      "auth.registerLink":    "Registrer firmaet ditt her",
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
      "calendar.weekColShort": "Uke",
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
      "booking.guestPhone": "Gjestens mobil (m/ landkode)",
      "booking.guestPhoneHint":"(Norsk)",
      "booking.guestEmail": "Gjestens e-post (valgfritt)",
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
      "booking.errAllPhones":"Fyll inn norsk telefonnr for alle gjester.",
      "booking.errPhoneInvalid":"Rom {n} («{name}»): ugyldig norsk telefonnr (8 sifre, evt. med +47).",
      "booking.errEmailInvalid":"Rom {n} («{name}»): ugyldig e-postadresse.",
      "booking.errNoFrom":  "{who} mangler fra-dato.",
      "booking.errNoTo":    "Rom {n} («{name}») mangler til-dato — eller huk av for «Vet ikke utflyttingsdato».",
      "booking.errBadOrder":"Rom {n} («{name}»): til-dato må være etter fra-dato.",
      "booking.sharedPeriod":"Fellesperioden",
      "booking.errGeneric": "Noe gikk galt. Vennligst kontakt 2GM Eiendom på +47 99 10 10 41.",
      "booking.errCapacityExceeded": "Ikke nok ledige rom i valgt periode. Reduser antall eller velg en annen periode.",
      "booking.errCapacityCheckFailed": "Kunne ikke verifisere ledighet akkurat nå. Prøv igjen om et øyeblikk.",
      "booking.overbookingTitle": "Ikke nok ledige rom på valgt periode",
      "booking.overbookingLead": "Reduser antall rom eller velg en annen periode. Trenger du å bestille flere rom enn det er ledig — ta kontakt med 2GM Eiendom direkte på +47 99 10 10 41.",
      "booking.overbookingClose": "OK, jeg endrer",
      "booking.warningPrefix":"Obs:",
      "booking.warningSentence":"{dates} har bare {available} ledige rom — du trenger {needed} rom.",
      "booking.warningSuffix":"2GM vil kontakte deg.",
      "booking.thanksTitle": "Takk for bestillingen!",
      "booking.thanksLead":  "Vi har mottatt bestillingen din.",
      "booking.thanksRef":   "Referanse: <strong>{ref}</strong>",
      "booking.thanksSub":   "2GM Eiendom tar kontakt med deg så snart vi har bekreftet rom og perioder.",
      "booking.thanksFoot":  "Du kan lukke vinduet.",
      "booking.thanksSeeBooking": "Se din booking ↓",
      "booking.thanksNewBooking": "+ Ny bestilling",
      "booking.joinAnd":     "og",

      // Mine bookinger
      "mybookings.title":         "Mine bookinger",
      "mybookings.loading":       "Laster…",
      "mybookings.error":         "Kunne ikke hente bookinger. Prøv å laste siden på nytt.",
      "mybookings.empty":         "Du har ingen aktive eller kommende bookinger.",
      "mybookings.countSingular": "1 booking",
      "mybookings.countPlural":   "{n} bookinger",
      "mybookings.demoBanner":    "👀 Eksempelvisning — slik vil dine bookinger vises her. Forsvinner når du har gjort din første bestilling.",
      "mybookings.demoInfoTitle": "Slik administrerer du dine bookinger",
      "mybookings.demoInfoIntro": "Når denne bookingen er ekte, kan du klikke på kortet og velge mellom disse handlingene:",
      "mybookings.demoInfoExtend":"Be om en lengre periode. Vi sender forespørselen til 2GM Eiendom som godkjenner.",
      "mybookings.demoInfoEnd":   "Avslutt oppholdet tidligere enn planlagt. Du oppgir ny utflyttingsdato.",
      "mybookings.demoInfoSms":   "Send dørkoden på SMS direkte til gjesten. Koster 5 kr og legges på neste faktura.",
      "mybookings.demoInfoClose": "Skjønner",
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
      "mybookings.cancelBooking": "Kanseller bestillingen",
      "mybookings.smsDoorcode":   "📱 Send dørkoden til gjesten",
      "mybookings.smsCostHint":   "5 kr pr SMS",
      "mybookings.actionsTitle":  "Hva vil du gjøre?",
      "mybookings.noLocation":    "Uten lokasjon",
      "mybookings.print":         "🖨 Skriv ut",
      "mybookings.printEmpty":    "Ingen bookinger å skrive ut.",

      // SMS-dørkode-dialog (v3.10.16/17)
      "sms.confirm":         "Send dørkode til {guest}?",
      "sms.costNote":        "💳 Tjenesten koster 5 kr og belastes rommet på neste faktura.",
      "sms.success":         "✓ Dørkode sendt til {phone}\n\n5 kr lagt til på neste faktura.",
      "sms.errNoCode":       "Ingen dørkode er tildelt ennå.",
      "sms.errNoRoom":       "Bookingen har ikke fått rom ennå.",
      "sms.errNotYours":     "Bookingen tilhører ikke ditt firma.",
      "sms.errExpired":      "Sesjonen er utløpt — last siden på nytt.",
      "sms.errFailed":       "Kunne ikke sende SMS ({err}).",
      "sms.manualTitle":     "Telefonnummer mangler",
      "sms.manualPrompt":    "{guest} har ikke registrert telefonnummer i registeret. Tast inn nummeret manuelt for å sende dørkoden:",
      "sms.manualLabel":     "Telefonnummer",
      "sms.manualPlaceholder":"+47…",
      "sms.manualSend":      "Send dørkode",
      "sms.manualCancel":    "Avbryt",
      "sms.manualInvalid":   "Telefonnummeret ser ikke gyldig ut. Skriv det med landkode (f.eks. +47 92345678).",

      // Send dørkode-knapp i banner — liste-modal (v3.10.25)
      "sendcode.btn":           "🔑 Send dørkode",
      "sendcode.title":         "Send dørkode på SMS",
      "sendcode.subList":       "Velg gjest og bekreft telefonnr — 5 kr per SMS belastes neste faktura.",
      "sendcode.colRoom":       "Rom",
      "sendcode.colLocation":   "Lokasjon",
      "sendcode.colGuest":      "Gjest",
      "sendcode.colCode":       "Kode",
      "sendcode.colPhone":      "Telefon",
      "sendcode.send":          "Send",
      "sendcode.close":         "Lukk",
      "sendcode.searching":     "Laster …",
      "sendcode.sending":       "Sender …",
      "sendcode.successInline": "✓ Sendt til {phone}",
      "sendcode.empty":         "Ingen aktive eller kommende bookinger.",
      "sendcode.demoBanner":    "👀 Eksempelvisning — fiktive gjester. Forsvinner når du har gjort din første bestilling.",
      "sendcode.demoRowMsg":    "Demo-booking — opprett en ekte bestilling for å sende SMS.",
      "sendcode.noCode":        "(ingen kode tildelt)",
      "sendcode.lookupError":   "Kunne ikke hente bookinger. Prøv igjen.",
      "sendcode.unsupported":   "Nettleseren støtter ikke dialog-vinduer.",

      // Hjelp-modal (v3.10.29)
      "help.btn":              "? Hjelp",
      "help.title":            "Slik bruker du portalen",
      "help.sub":              "Kort guide til vanlige oppgaver. Bytt mellom NO/EN øverst til høyre.",
      "help.close":            "Lukk",
      "help.welcome.title":    "Velkommen",
      "help.welcome.body":     "Dette er selvbetjent bestillingsportal for 2GM Eiendoms faste bedriftskunder. Du bestiller rom selv, ser status på opphold, sender dørkoder til gjestene dine og laster ned faktura-historikk — alt på ett sted.\n\nHver bedrift har sin egen tilgangslenke. Lenken kommer fra 2GM (Frank) når avtale er på plass.",
      "help.login.title":      "Logge inn",
      "help.login.body":       "Tilgang gis via en personlig URL + en 6-sifret PIN. Du får begge fra 2GM.\n\n**1.** Klikk på lenken (eller åpne den fra epost). Adressen ser ut som https://www.2gm.no/?token=…\n**2.** Skriv inn 6-sifret PIN. Portalen husker innloggingen i denne nettleseren.\n**3.** Etter 5 mislykkede PIN-forsøk blir tilgangen låst i 1 time. Kontakt 2GM hvis du må reset PIN.",
      "help.booking.title":    "Bestille rom",
      "help.booking.body":     "Naviger til **+ Ny bestilling**. Kalenderen viser ledighet per dag — grønn=ledig, gul=få igjen, rød=fullt.\n\n**1.** Velg lokasjon i nedtrekk-menyen.\n**2.** Klikk en dato i kalenderen (start), deretter sluttdato. Velg «Open-ended» hvis utflyttingsdato er ukjent.\n**3.** Sett antall rom og legg inn gjestenavn (én linje per gjest). Hver gjest kan ha avvikende datoer.\n**4.** Send bestillingen. 2GM bekrefter manuelt og tildeler rom — du ser oppdatering under «Mine bookinger».",
      "help.mybookings.title": "Mine bookinger",
      "help.mybookings.body":  "Alle aktive og kommende opphold listes her, gruppert per lokasjon. Hvert kort viser gjestens navn, datoer, romnummer og dørkode når admin har generert.\n\nFra et booking-kort kan du:\n- Be om forlengelse (sender forespørsel — admin godkjenner manuelt)\n- Be om å avslutte tidligere\n- Skrive ut hele lista (printer-vennlig versjon)",
      "help.sendcode.title":   "Send dørkode på SMS",
      "help.sendcode.body":    "Knappen **🔑 Send dørkode** i banneret åpner en liste med alle dine aktive/kommende bookinger med dørkode + telefonnr fra gjeste-registeret. Per rad:\n- Bekreft eller endre telefonnr (mobil, med landkode +47)\n- Klikk **Send** — SMS-en sendes med standard velkomst-mal (rom + kode + WiFi).\n\nHver SMS koster **5 kr**, summen legges automatisk på neste faktura. Bookinger uten dørkode er grået ut — admin må generere PIN først.",
      "help.invoices.title":   "Fakturaarkiv",
      "help.invoices.body":    "Tidligere opphold gruppert per måned. Søk og sorter etter periode, eiendom, sum eller netter. PDF/CSV-nedlasting per måned. Brukes til regnskapsavstemming og oppslag når det reises spørsmål.",
      "help.contact.title":    "Kontakt 2GM",
      "help.contact.body":     "Spørsmål om booking, PIN, faktura eller annet: ring eller send melding til Frank Haugan på +47 99 10 10 41 — eller send epost til frank@2gm.no.\n\nFeil/forslag i portalen: send detaljer på samme måte, gjerne med skjermbilde.",

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
      "extend.errAfterCurrent": "Bookingen har allerede utflytting {date} — velg en senere dato.",
      "extend.errBadFormat": "Ugyldig dato — bruk dato-velgeren.",
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
      "cancel.confirm": "Er du sikker på at du vil kansellere bestilling {ref}? Dette kan ikke angres.",
      "cancel.success": "Bestillingen er kansellert. Du får en bekreftelse på e-post.",
      "cancel.errFail": "Kunne ikke kansellere: {err}",
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

      // v3.10.0 — Mobil-redesign
      "mobile.continue":         "Fortsett",
      "mobile.openPeriod":       "Åpen periode",
      "mobile.oneNight":         "{n} natt",
      "mobile.manyNights":       "{n} netter",
      "mobile.pickEnd":          "Velg utdato",
      "mobile.guestLabel":       "Rom {n} · gjest",
      "mobile.guestPlaceholder": "Navn på gjest",
      "mobile.hideDeviating":    "− Skjul avvikende datoer",
      "booking.deviatingDates":  "+ Avvikende datoer",
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
      "auth.newCustomer":     "New customer?",
      "auth.registerLink":    "Register your company here",
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
      "calendar.weekColShort": "Wk",
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
      "booking.guestPhone": "Guest mobile (with country code)",
      "booking.guestPhoneHint":"(Norwegian)",
      "booking.guestEmail": "Guest email (optional)",
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
      "booking.errAllPhones":"Enter a Norwegian phone number for every guest.",
      "booking.errPhoneInvalid":"Room {n} (\"{name}\"): invalid Norwegian phone number (8 digits, optional +47).",
      "booking.errEmailInvalid":"Room {n} (\"{name}\"): invalid email address.",
      "booking.errNoFrom":  "{who} is missing a from-date.",
      "booking.errNoTo":    "Room {n} (\"{name}\") is missing a to-date — or check \"Don't know check-out date\".",
      "booking.errBadOrder":"Room {n} (\"{name}\"): to-date must be after from-date.",
      "booking.sharedPeriod":"The shared period",
      "booking.errGeneric": "Something went wrong. Please contact 2GM Eiendom at +47 99 10 10 41.",
      "booking.errCapacityExceeded": "Not enough free rooms in the selected period. Reduce the count or choose another period.",
      "booking.errCapacityCheckFailed": "Could not verify availability right now. Please try again in a moment.",
      "booking.overbookingTitle": "Not enough free rooms in the selected period",
      "booking.overbookingLead": "Reduce the number of rooms or choose another period. If you need more rooms than are available — please contact 2GM Eiendom directly at +47 99 10 10 41.",
      "booking.overbookingClose": "OK, I will adjust",
      "booking.warningPrefix":"Notice:",
      "booking.warningSentence":"{dates} only has {available} rooms available — you need {needed}.",
      "booking.warningSuffix":"2GM will contact you.",
      "booking.thanksTitle": "Thanks for the booking!",
      "booking.thanksLead":  "We have received your booking.",
      "booking.thanksRef":   "Reference: <strong>{ref}</strong>",
      "booking.thanksSub":   "2GM Eiendom will contact you as soon as we've confirmed rooms and dates.",
      "booking.thanksFoot":  "You may close this window.",
      "booking.thanksSeeBooking": "View your booking ↓",
      "booking.thanksNewBooking": "+ New booking",
      "booking.joinAnd":     "and",

      // My bookings
      "mybookings.title":         "My bookings",
      "mybookings.loading":       "Loading…",
      "mybookings.error":         "Could not load bookings. Try reloading the page.",
      "mybookings.empty":         "You have no active or upcoming bookings.",
      "mybookings.countSingular": "1 booking",
      "mybookings.countPlural":   "{n} bookings",
      "mybookings.demoBanner":    "👀 Preview — this is how your bookings will appear. Disappears when you make your first booking.",
      "mybookings.demoInfoTitle": "How to manage your bookings",
      "mybookings.demoInfoIntro": "When this booking is real, you can click the card and choose between these actions:",
      "mybookings.demoInfoExtend":"Request a longer period. We forward the request to 2GM Eiendom for approval.",
      "mybookings.demoInfoEnd":   "End the stay earlier than planned. You enter a new check-out date.",
      "mybookings.demoInfoSms":   "Send the door code by SMS directly to the guest. Costs 5 kr, added to next invoice.",
      "mybookings.demoInfoClose": "Got it",
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
      "mybookings.cancelBooking": "Cancel booking",
      "mybookings.smsDoorcode":   "📱 Send door code to guest",
      "mybookings.smsCostHint":   "NOK 5 per SMS",
      "mybookings.actionsTitle":  "What would you like to do?",
      "mybookings.noLocation":    "No location",
      "mybookings.print":         "🖨 Print",
      "mybookings.printEmpty":    "No bookings to print.",

      // SMS door-code dialog (v3.10.16/17)
      "sms.confirm":         "Send door code to {guest}?",
      "sms.costNote":        "💳 This service costs NOK 5 and is charged to the room on the next invoice.",
      "sms.success":         "✓ Door code sent to {phone}\n\nNOK 5 added to the next invoice.",
      "sms.errNoCode":       "No door code has been assigned yet.",
      "sms.errNoRoom":       "This booking has not been assigned a room yet.",
      "sms.errNotYours":     "This booking does not belong to your company.",
      "sms.errExpired":      "Session expired — please reload the page.",
      "sms.errFailed":       "Could not send SMS ({err}).",
      "sms.manualTitle":     "Phone number missing",
      "sms.manualPrompt":    "{guest} does not have a phone number on file. Enter the number manually to send the door code:",
      "sms.manualLabel":     "Phone number",
      "sms.manualPlaceholder":"+47…",
      "sms.manualSend":      "Send door code",
      "sms.manualCancel":    "Cancel",
      "sms.manualInvalid":   "The phone number doesn't look valid. Enter it with country code (e.g. +47 92345678).",

      // Banner Send door code button — list modal (v3.10.25)
      "sendcode.btn":           "🔑 Send door code",
      "sendcode.title":         "Send door code by SMS",
      "sendcode.subList":       "Pick a guest and confirm the phone number — NOK 5 per SMS, added to next invoice.",
      "sendcode.colRoom":       "Room",
      "sendcode.colLocation":   "Location",
      "sendcode.colGuest":      "Guest",
      "sendcode.colCode":       "Code",
      "sendcode.colPhone":      "Phone",
      "sendcode.send":          "Send",
      "sendcode.close":         "Close",
      "sendcode.searching":     "Loading …",
      "sendcode.sending":       "Sending …",
      "sendcode.successInline": "✓ Sent to {phone}",
      "sendcode.empty":         "No active or upcoming bookings.",
      "sendcode.demoBanner":    "👀 Preview — example guests. Disappears once you've made your first booking.",
      "sendcode.demoRowMsg":    "Demo booking — create a real booking to send SMS.",
      "sendcode.noCode":        "(no code assigned)",
      "sendcode.lookupError":   "Could not fetch bookings. Please try again.",
      "sendcode.unsupported":   "This browser does not support dialog windows.",

      // Help modal (v3.10.29)
      "help.btn":              "? Help",
      "help.title":            "How to use the portal",
      "help.sub":              "Short guide to the common tasks. Switch NO/EN in the top right.",
      "help.close":            "Close",
      "help.welcome.title":    "Welcome",
      "help.welcome.body":     "This is the self-service booking portal for 2GM Eiendom's regular corporate customers. Book rooms yourself, see the status of your stays, send door codes to your guests, and download invoice history — all in one place.\n\nEach company has its own access link. The link is sent by 2GM (Frank) once the agreement is in place.",
      "help.login.title":      "Logging in",
      "help.login.body":       "Access is granted via a personal URL + a 6-digit PIN. You receive both from 2GM.\n\n**1.** Click the link (or open it from email). The address looks like https://www.2gm.no/?token=…\n**2.** Enter the 6-digit PIN. The portal remembers the login in this browser.\n**3.** After 5 failed PIN attempts, access is locked for 1 hour. Contact 2GM if you need a PIN reset.",
      "help.booking.title":    "Booking a room",
      "help.booking.body":     "Go to **+ New booking**. The calendar shows availability per day — green=free, yellow=few left, red=full.\n\n**1.** Pick a location from the dropdown.\n**2.** Click a start date in the calendar, then an end date. Choose «Open-ended» if the check-out date is unknown.\n**3.** Set the number of rooms and enter guest names (one line per guest). Each guest can have differing dates.\n**4.** Submit the booking. 2GM confirms manually and assigns rooms — you'll see the update under «My bookings».",
      "help.mybookings.title": "My bookings",
      "help.mybookings.body":  "All active and upcoming stays are listed here, grouped by location. Each card shows the guest's name, dates, room number and door code once admin has generated it.\n\nFrom a booking card you can:\n- Request an extension (sends a request — admin must approve)\n- Request to end the stay earlier\n- Print the entire list (printer-friendly version)",
      "help.sendcode.title":   "Send door code by SMS",
      "help.sendcode.body":    "The **🔑 Send door code** button in the banner opens a list of all your active/upcoming bookings with door code + phone number from the guest registry. Per row:\n- Confirm or change the phone number (mobile, with country code +47)\n- Click **Send** — the SMS goes out with the standard welcome template (room + code + Wi-Fi).\n\nEach SMS costs **NOK 5**, charged automatically on the next invoice. Bookings without a door code are greyed out — admin must generate a PIN first.",
      "help.invoices.title":   "Invoice archive",
      "help.invoices.body":    "Past stays grouped by month. Search and sort by period, property, total or nights. PDF/CSV download per month. Use it for accounting reconciliation and follow-up questions.",
      "help.contact.title":    "Contact 2GM",
      "help.contact.body":     "Questions about bookings, PIN, invoicing or anything else: call or message Frank Haugan at +47 99 10 10 41 — or email frank@2gm.no.\n\nBugs/suggestions in the portal: send details the same way, ideally with a screenshot.",

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
      "extend.errAfterCurrent": "The booking already has check-out {date} — pick a later date.",
      "extend.errBadFormat": "Invalid date — use the date picker.",
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
      "cancel.confirm": "Are you sure you want to cancel booking {ref}? This cannot be undone.",
      "cancel.success": "The booking has been cancelled. You'll receive a confirmation by email.",
      "cancel.errFail": "Could not cancel: {err}",
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

      // v3.10.0 — Mobile redesign
      "mobile.continue":         "Continue",
      "mobile.openPeriod":       "Open period",
      "mobile.oneNight":         "{n} night",
      "mobile.manyNights":       "{n} nights",
      "mobile.pickEnd":          "Pick check-out",
      "mobile.guestLabel":       "Room {n} · guest",
      "mobile.guestPlaceholder": "Guest name",
      "mobile.hideDeviating":    "− Hide deviating dates",
      "booking.deviatingDates":  "+ Deviating dates",
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
    // Persistér valget på Customer_Tokens.Sprak (fire-and-forget) så
    // admin-utløste e-poster (notifyPortalEmail) plukker rett språkvariant
    // av templaten. Gjøres etter applyDom så UI-en aldri venter på nettverk.
    // Auth.token mangler i pre-login-fasen — da hopper Api.setLanguage av selv.
    try {
      if (window.Api && typeof window.Api.setLanguage === "function") {
        window.Api.setLanguage(lang);
      }
    } catch (_) {
      // Stille feil — språkbytte må aldri brytes av en API-feil
    }
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
