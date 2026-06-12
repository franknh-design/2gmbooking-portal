# Andslimoen offentlig booking — design

Dato: 2026-06-12
Status: Godkjent design, klar for implementeringsplan

## Mål

En offentlig bookingside der privatpersoner («vanlige folk») kan booke rom på
Rigg Andslimoen (property-ID 4 i 2GM) med betaling via Vipps. Siden lever i
`2gmbooking-portal` og skriver til samme SharePoint som bedriftsbookingen, slik
at én sannhetskilde gjelder for alle bookinger.

## Kjernemodell: ett felles rom-lager, to priser

Alle aktive rom på Andslimoen er **én delt pool**. Både firma og privat booker
fra samme beholdning — vi ønsker å leie ut rom uansett segment. Eneste forskjell
er **pris**:

- **Firma** → eksisterende firmapris (uendret)
- **Privat** → felles `PublicNightlyRate`

Dette er en bevisst forenkling: rommene er IKKE fysisk delt mellom segmentene.

## Besluttede valg

- **Datakilde:** Eksisterende SharePoint. Offentlige bookinger skrives til samme
  `Booking`-liste som portalen bruker, vises i admin-appen og behandles likt.
  Ingen separat database.
- **Rom-modell:** Delt pool. Alle rom er like; gjesten velger ikke spesifikt rom
  — systemet auto-tildeler et ledig rom ved bekreftelse (kreves for å lage
  Tuya-romkode).
- **Prising:** Segment-pris. Felles `PublicNightlyRate` for privat; firmapris
  separat og uendret.
- **Av/på (to nivåer):**
  - Global `PublicBookingEnabled` — skrur hele publikum-siden av/på. Formål:
    kapasitetsstyring — ved høy firmaetterspørsel skrus privat av så firma får
    rommene.
  - Per-rom `PublicBookable` — `false` tar rommet ut av **publikum**-poolen
    (holdes til firma), men firma kan fortsatt booke det. Flagget begrenser
    KUN privat-siden; bedriftslogikken røres ikke.
- **Romlåser:** Tuya per-gjest-koder via eksisterende Flask-flyt.
- **Ytterdør:** Yale Doorman med per-gjest, tidsbegrensede PIN-koder via Yale
  Access / August API. Gir tilgangslogg på ytterdøra.
- **Betaling:** Vipps i v1. Tynt betalingsabstraksjons-lag gjør at Stripe kan
  kobles på senere (v2) uten å endre bookingflyten.
- **Bekreftelse:** Booking blir `pending` etter betaling. Koder genereres
  automatisk med retry; lykkes det ikke innen tidsvinduet → auto-refund + avlyst.
- **Hosting:** Ny offentlig seksjon i `2gmbooking-portal` (Cloudflare Pages +
  Functions). Offentlige ruter er tydelig adskilt fra interne portal-ruter.

## Påvirkning på eksisterende system (isolasjon)

Designet er bevisst lav-påvirkning på portalen og admin-appen:

- **Bedrifts-ledighet røres ikke.** Firma fortsetter å se og booke alle rom via
  eksisterende `calculateAvailability` / `checkCapacityConflict`. Ingen endring i
  den funksjonen.
- **Nye filer er additive** — offentlige ruter, betalingslag og lås-lag rører
  ikke `submit-booking.js`, `availability.js` eller admin-appens kode.
- **Nye SharePoint-kolonner er additive.** Eksisterende spørringer bruker
  eksplisitt `$select`, så nye felt brekker ingenting.
- **Admin-appen viser** de offentlige bookingene (den leser hele `Booking`-lista)
  som ferdig-bekreftede, auto-tildelte rader — de havner IKKE i den manuelle
  «AVVENTER ROMTILDELING»-køen.

## Ledighet for privat-siden

VIKTIG om eksisterende logikk: `calculateAvailability` teller kun bookinger som
har et tildelt `RoomLookupId` ([sharepoint.js:1006](../../../functions/_utils/sharepoint.js)).
Nyopprettede bookinger får IKKE romtildeling automatisk — firma tildeles manuelt
i admin. Derfor reduserer ikke ventende, ikke-tildelte firmabookinger den
eksisterende `overallAvailable`. Privat-siden kan ikke stole på den.

Privat-siden får derfor sin **egen, konservative** beregning som teller ALLE
aktive/upcoming bookinger på riggen (tildelt eller ikke), målt som antall
booking-rader som overlapper datoen. Den gjenbruker datahentingen
(`getRoomsForProperty`, `getBookingsForProperty`) men ikke firma-tellingen.

```
publicAvailable(dato) = min(
  physicalRooms − allBookingsOccupying(dato),       // KONSERVATIV: teller også ikke-tildelte
  publicPoolSize − publicBookingsOccupying(dato)
)
```

- `physicalRooms` — antall tellbare rom på riggen (Active, ikke på long-term den
  datoen), samme rom-grunnlag som eksisterende logikk.
- `allBookingsOccupying` — antall aktive/upcoming booking-rader (uansett
  romtildeling) som overlapper datoen. Konservativt: en ikke-tildelt firmabooking
  teller som etterspørsel etter ett rom.
- `publicPoolSize` — antall rom med `PublicBookable=true` og `Active=true`.
- `publicBookingsOccupying` — antall `Source`-er privat-bookinger som opptar
  datoen.

Den ytre `min`-en garanterer at privat aldri kan overbooke fysisk; den indre
kapper privat til sin egen underpool. Konsekvens: privat kan vise «fullt» når
firma har ventende ikke-tildelte bookinger — bevisst, trygt valg (privat
overbooker aldri).

## Versjoner

### v1 (første ekte booking)
- Datovelger-først bookingside med felles bildegalleri
- Delt rom-pool, segment-pris (privat `PublicNightlyRate`)
- Kun Vipps koblet på (abstraksjon klar for Stripe)
- Per-gjest Yale (ytterdør) + Tuya (rom) koder, tidsbegrenset
- Pending → retry → confirmed / auto-refund tilstandsmaskin
- Global `PublicBookingEnabled` + per-rom `PublicBookable`

### v2 (senere)
- Stripe live ved siden av Vipps, gjest velger betalingsmåte
- **Automatisk buffer** — skru av privat når færre enn N rom er ledige, så Frank
  slipper å huske den manuelle bryteren ved høy firmaetterspørsel
- Mulig: dynamisk prising (helg/sesong), rabattkoder, automatiske
  påminnelser/utsjekk, bildedokumentasjon ved utsjekk

Alt i v1 er en delmengde av v2 — ingenting kastes ved utvidelse.

## Arkitektur

Lag med isolerte ansvar:

1. **Offentlig bookingside (frontend)** — galleri + pris øverst, datovelger,
   ledighetsvisning, gjesteskjema, betalingsstart.
2. **Betalingslag (abstraksjon)** — `initiatePayment()` / `handleCallback()`.
   Vipps-implementasjon i v1; Stripe-grensesnitt definert men ikke koblet på.
3. **Bookingflyt-orkestrator** — tilstandsmaskin: tilgjengelighet → reservasjon →
   betaling → kode-generering → bekreftelse, med pending/retry/refund.
4. **Lås-lag** — `generateGuestCodes()` som kaller Yale Access API (ytterdør) +
   Tuya/Flask (rom).

## Datamodell (SharePoint)

**Rooms-lista (per rom):**
- `PublicBookable` (ja/nei) — standard ja; nei holder rommet unna privat-poolen

**Global innstilling:**
- `PublicBookingEnabled` (master av/på for hele publikum-siden)
- `PublicNightlyRate` (privatmarked-nattsats)

**Booking-lista (per booking):**
- `Source` (`public` / `corporate`)
- `PaymentProvider` (`vipps` / `stripe`)
- `PaymentStatus` (`pending` / `paid` / `refunded`)
- `BookingStatus` (`pending` / `confirmed` / `cancelled`)
- `PaymentRef`
- Referanser til genererte koder (`EntranceCode` / `RoomCode` eller tilsvarende)

## Bookingflyt & tilstandsmaskin

Gjesteflyt:
1. Galleri + privatmarked-pris vises øverst.
2. Gjest velger innsjekk/utsjekk → siden beregner `publicAvailable` og viser
   «X av Y rom ledige» + totalpris.
3. Gjest fyller inn navn/e-post/tlf → starter Vipps-betaling.
4. Booking opprettes: `BookingStatus=pending`, `PaymentStatus=pending`, et ledig
   rom **reservert** (holdt) for perioden med kort timeout (f.eks. 15 min) så to
   gjester ikke kan kjøpe samme rom samtidig.

Etter betaling (Vipps-callback):

```
betalt → forsøk generer koder (Yale ytterdør + Tuya rom)
  ├─ koder OK      → BookingStatus=confirmed, send koder til gjest
  ├─ feil → retry (backoff) innenfor tidsvindu (f.eks. 30 min)
  │     ├─ lykkes  → confirmed, send koder
  │     └─ aldri   → auto-refund + BookingStatus=cancelled + frigjør rom + varsle drift
```

Auto-tildeling (ved bekreftelse) velger et `PublicBookable`-rom som ikke har en
overlappende **tildelt** booking i perioden. Siden privat-bookinger alltid får et
konkret rom, ser admin dem tildelt og dobbelt-tildeler aldri en ventende
firmabooking til samme rom.

Av/på:
- `PublicBookingEnabled=false` → hele siden viser «stengt».
- Rom med `PublicBookable=false` tas ut av privat-poolen (men firma kan booke det).

## Bildegalleri

Fem motiver vises øverst på bookingsiden (over datovelgeren):
rom-eksempel · bad/dusj · vaskerom · kjøkken · riggen i sin helhet.

Siden alle rom er like, vises ett representativt sett bilder for hele riggen,
ikke per rom. For v1 legges bildene som statiske filer i `2gmbooking-portal`
(serveres direkte av Cloudflare Pages). SharePoint-bibliotek kan vurderes senere
hvis bilder skal byttes uten deploy.

## Gjenbruk fra gravebooking

`C:\dev\gravebooking` (Express + SQLite) har nesten samme mønster: offentlig
kalender-booking + Vipps med callback + automatisk låskode + bildedok. Gjenbruk
**mønsteret** for Vipps (initiate → callback → capture/refund) og
kode-generering, tilpasset Yale Access + Tuya/Flask. Lagringen gjenbrukes IKKE —
denne bruker SharePoint, ikke SQLite.

## Testing

- Betalingslag og tilstandsmaskin testes isolert med mock Vipps-callbacks
  (betalt / feilet) og mock kode-API (suksess / feil / timeout), slik at retry-
  og auto-refund-stiene verifiseres uten ekte penger eller låser.
- Ledighetsformelen testes mot mock `Booking`-data: at en ikke-tildelt
  firmabooking (uten `RoomLookupId`) reduserer `publicAvailable` (konservativ
  telling), at `PublicBookable=false` reduserer poolen, at `publicAvailable`
  aldri overstiger fysisk kapasitet, og dobbeltbooking-kanttilfellet.
- Auto-tildeling testes mot rom med overlappende tildelte bookinger.
- Vipps testes i testmiljø før live.

## Forutsetninger å verifisere før implementering

- **Yale Access API:** Krever at en Yale Connect Wi-Fi-bro er montert og at låsen
  er lagt til i Yale Access-appen. Må bekreftes før lås-laget bygges.
- **SharePoint-felt:** Nye felt (`PublicBookable` på Rooms; `PublicBookingEnabled`,
  `PublicNightlyRate` som global innstilling; `Source`, `PaymentProvider`,
  `PaymentStatus`, `BookingStatus`, `PaymentRef`, kode-referanser på Booking) må
  opprettes i listene.
- **Vipps-konto/nøkler:** Testmiljø- og produksjonsnøkler for Vipps.
