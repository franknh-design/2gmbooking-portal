v3.0 Frontend - Booking-innsending mot ekte API
================================================

Filer å oppdatere (erstatt eksisterende):
  index.html                  (versjon v3.0)
  assets/js/api.js            (lagt til submitBooking)
  assets/js/booking.js        (kaller ekte API + viser takk-skjerm)

Fil å ENDRE manuelt:
  assets/css/styles.css       Lim innholdet av styles_addition_v3.css
                              på slutten av fila (etter v2.1-tillegg).

Filer som IKKE endres:
  assets/js/auth.js, calendar.js, app.js, mockdata.js
  (mockdata.js beholdes bare som backup - ingenting bruker den nå
   utenom overbooking-validering ved submit, som fortsatt er klient-side.)

ENDRINGER I FLYT:
  - Kunde åpner portal med token → token validert
  - SMS-flow (fortsatt mock) → portal vises
  - Velg lokasjon → kalender henter ekte data
  - Fyll inn skjema → "Send bestilling"
  - Bestilling sendes til /api/submit-booking
  - Ved suksess: PORTAL LÅSES, takk-skjerm med booking-ref
  - Ved feil: generisk feilmelding "Kontakt 2GM på +47 99 10 10 41"

E-POSTVARSEL:
  Frank får e-post via Resend (forutsatt RESEND_API_KEY er satt).
