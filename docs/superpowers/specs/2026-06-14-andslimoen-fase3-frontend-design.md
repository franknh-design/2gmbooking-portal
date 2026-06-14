# Andslimoen offentlig booking — Fase 3: Frontend (design)

Dato: 2026-06-14
Status: Godkjent design, klar for implementeringsplan
Bygger på: hovedspec (`2026-06-12`), Fase 1 (ledighet, levert) og Fase 2 (orkestrator + endepunkter, levert).

## Mål

En frittstående, mobil-først offentlig bookingside for Rigg Andslimoen med eget
polert forbruker-uttrykk. Hele gjestereisen bygges: galleri → datovelger → ledighet
→ gjesteskjema → reservasjon, og ender i en «hold opprettet»-bekreftelse. Vipps-
redirecten plugges inn i selve betalingssteget i Fase 4 — ingen midlertidige
mock-knapper.

## Besluttede valg

- **Leveranse:** Full booking-UI som ender i «hold opprettet»-bekreftelse (kaller
  `/api/public-booking`, viser booking-ref + «betaling kommer»). Fase 4 bytter kun
  betalingssteget.
- **Plassering:** Frittstående side i portal-repoet, ingen token, adskilt fra den
  token-gated `index.html`.
- **Uttrykk:** Eget, polert forbruker-/hotell-aktig design, mobil-først, med diskret
  2GM-logo. Egen CSS — rører ikke `styles.css`.
- **Bilder:** Placeholdere nå i `assets/img/andslimoen/` med faste filnavn; ekte foto
  byttes inn senere ved å overskrive filene (ingen kode-endring).
- **Språk:** Norsk bokmål (forbruker-rettet). Ingen i18n i v1 (YAGNI).
- **Teknikk:** Vanilla JS, ingen build. Den frittstående siden bruker
  `<script type="module">` (bevisst, isolert avvik fra portalens IIFE-mønster) så de
  rene hjelperne kan enhetstestes med `node --test`.

## Side-struktur (ovenfra og ned)

1. **Header** — diskret 2GM-logo + «Rigg Andslimoen».
2. **Galleri** — ett hovedbilde + 5 thumbnails (rom · bad/dusj · vaskerom · kjøkken ·
   riggen i sin helhet). Placeholdere i v1.
3. **Intro + pris** — kort beskrivelse + «<nightlyRate> kr / natt» (fra
   `/api/public-availability`).
4. **Datovelger** — innsjekk/utsjekk. Ved valg: ledighet + totalpris for perioden.
5. **Gjesteskjema** — navn, telefon (8 siffer), e-post (valgfritt).
6. **«Reserver»-knapp** → `POST /api/public-booking` → bekreftelsesskjerm med ref.

Én rute, ingen innlogging.

## Filer

| Fil | Ansvar |
|-----|--------|
| `andslimoen.html` (repo-rot) | Markup + `<script type="module" src="assets/js/andslimoen.mjs">`. |
| `assets/css/andslimoen.css` | Eget mobil-først forbruker-uttrykk. Egen fil. |
| `assets/js/andslimoen-format.mjs` | RENE hjelpere: `nightsBetween`, `totalPrice`, `formatKr`, `isValidNoPhone`, `isValidEmail`. Ingen DOM → node-testbar. |
| `assets/js/andslimoen.mjs` | DOM-orkestrering: galleri, datovelger, fetch til de to endepunktene, tilstands-rendering. Importerer format-modulen. |
| `assets/img/andslimoen/` | 5 placeholder-bilder: `rom.jpg`, `bad.jpg`, `vaskerom.jpg`, `kjokken.jpg`, `rigg.jpg`. |
| `_redirects` (endre) | Legg til `/andslimoen → /andslimoen.html` for ren URL. |
| `tests/andslimoen-format.test.mjs` | Enhetstester for de rene hjelperne. |

## Dataflyt

1. **Ved last:** `POST /api/public-availability` med et default-vindu (f.eks. inneværende
   + neste 30 dager) → `{ enabled, nightlyRate, days }`. `enabled=false` → vis stengt-
   tilstand i stedet for skjema; ellers vis pris.
2. **Ved datovalg:** `POST /api/public-availability` for valgt `[innsjekk, utsjekk]` →
   ta **minimum** `available` over datoene oppholdet OPPTAR (innsjekk t.o.m. utsjekk,
   inklusiv — utsjekk-dagen teller som opptatt/vask i ledighetsmodellen). Et rom må
   være ledig på alle disse datoene. → «X rom ledige» + totalpris, der «netter» =
   utsjekk − innsjekk (antall netter gjesten sover), regnet i format-modulen.
3. **Ved «Reserver»:** `POST /api/public-booking` med `{ fromDate, toDate, guest }` →
   `{ ok:true, bookingRef, paymentRef }` → bekreftelsesskjerm; eller strukturert feil →
   vennlig melding.

Ingen nye backend-endepunkter — Fase 1/2 dekker alt.

## Tilstander & feilhåndtering

- **Stengt** (`enabled:false`): rolig «Booking er midlertidig stengt», ingen skjema.
- **Fullt** (`available:0` i perioden): «Ingen ledige rom disse datoene», behold
  datovelger.
- **Ugyldig input:** inline feltvalidering før innsending (dato-rekkefølge, telefon 8
  siffer, e-post-format hvis utfylt), speiler endepunktets regler.
- **Endepunkt-feil:** `sold_out` → «Noen var raskere — prøv andre datoer»;
  `public_booking_disabled` → stengt-melding; `invalid_*` → pek på feltet;
  nettverk/`internal_error` → «Noe gikk galt, prøv igjen». Aldri råe feildetaljer.
- **Underveis:** «Reserver»-knappen disables + spinner under kall (hindrer dobbel-
  innsending / dobbelt hold).

## Testing

- **Enhetstest (`node --test tests/andslimoen-format.test.mjs`):** `nightsBetween`
  (inkl. samme-dag og reversert), `totalPrice` (netter × sats), `formatKr`
  (tusenskille, avrunding), `isValidNoPhone` (8 siffer, +47/0047-prefiks, separatorer),
  `isValidEmail`. Speiler reglene som backend bruker.
- **Manuell/live (som portalen ellers):** last `/andslimoen`, velg datoer → ledighet +
  pris vises; fyll skjema → reservasjon → bekreftelse med ref; verifiser mobil-bredde
  og stengt-tilstand. DOM-glue verifiseres i nettleser (ingen frontend-test-rigg i
  prosjektet).

## Utenfor Fase 3

- Ekte Vipps-betaling + redirect (Fase 4) — erstatter «betaling kommer»-steget.
- Rate-limit / Turnstile på skrive-endepunktet (Fase 4).
- Ekte foto (byttes inn i `assets/img/andslimoen/` når klart).
- i18n / flerspråklig.
- Yale/Tuya-koder i bekreftelse/e-post (Fase 5).

## Forutsetninger

- Fase 1/2-endepunktene er live (de er det). `PublicBookingEnabled=Ja` for at siden
  skal vise booking (kan stå `Nei` til frontend + rate-limit er klare — da viser siden
  stengt-tilstand, som er korrekt oppførsel).
