# Andslimoen offentlig booking — design

Dato: 2026-06-12
Status: Godkjent design, klar for implementeringsplan

## Mål

En offentlig bookingside der privatpersoner («vanlige folk», ikke bedriftskunder)
kan booke rom på Rigg Andslimoen (property-ID 4 i 2GM) med betaling via Vipps.
Siden lever i `2gmbooking-portal` og skriver til samme SharePoint som
bedriftsbookingen, slik at én sannhetskilde gjelder for alle bookinger.

## Besluttede valg

- **Datakilde:** Eksisterende SharePoint. Offentlige bookinger skrives til samme
  `Booking`-liste som portalen bruker, vises i admin-appen og behandles likt.
  Ingen separat database.
- **Rom-modell:** Alle offentlige rom er like og utgjør en **pool**. Gjesten velger
  ikke et spesifikt rom — systemet auto-tildeler et ledig offentlig rom ved
  bekreftelse. Offentlige rom er strengt adskilt fra bedrifts-rom.
- **Prising:** Segment-pris, ikke per-rom-pris. Én felles **privatmarked-nattsats**
  (`PublicNightlyRate`) brukes av den offentlige siden. Firmapris er separat og
  uendret.
- **Av/på:** Både en global master-bryter (`PublicBookingEnabled`) for hele den
  offentlige siden, og et `PublicBookable`-flagg per rom for finkornet styring.
- **Romlåser:** Tuya per-gjest-koder via eksisterende Flask-flyt.
- **Ytterdør:** Yale Doorman med per-gjest, tidsbegrensede PIN-koder via Yale
  Access / August API. Gir tilgangslogg på ytterdøra.
- **Betaling:** Vipps i v1. Tynt betalingsabstraksjons-lag gjør at Stripe kan
  kobles på senere (v2) uten å endre bookingflyten.
- **Bekreftelse:** Booking blir `pending` etter betaling. Koder genereres
  automatisk med retry; lykkes det ikke innen tidsvinduet → auto-refund + avlyst.
- **Hosting:** Ny offentlig seksjon i `2gmbooking-portal` (Cloudflare Pages +
  Functions). Offentlige ruter er tydelig adskilt fra interne portal-ruter.

## Versjoner

### v1 (første ekte booking)
- Datovelger-først bookingside med felles bildegalleri
- Kun Vipps koblet på (abstraksjon klar for Stripe)
- Per-gjest Yale (ytterdør) + Tuya (rom) koder, tidsbegrenset
- Felles privatmarked-pris
- Pending → retry → confirmed / auto-refund tilstandsmaskin
- Global + per-rom av/på-bryter

### v2 (senere)
- Stripe live ved siden av Vipps, gjest velger betalingsmåte
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

**Rom-lista (per rom):**
- `PublicBookable` (ja/nei)

**Global innstilling:**
- `PublicBookingEnabled` (master av/på)
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
2. Gjest velger innsjekk/utsjekk → siden sjekker `Booking`-lista og viser
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

Auto-tildeling velger første ledige offentlige rom ved bekreftelse.

Av/på:
- `PublicBookingEnabled=false` → hele siden viser «stengt».
- Rom med `PublicBookable=false` tas ut av poolen.

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
- Ledighetssjekk + auto-tildeling testes mot mock `Booking`-data, inkludert
  dobbeltbooking-kanttilfelle.
- Vipps testes i testmiljø før live.

## Forutsetninger å verifisere før implementering

- **Yale Access API:** Krever at en Yale Connect Wi-Fi-bro er montert og at låsen
  er lagt til i Yale Access-appen. Må bekreftes før lås-laget bygges.
- **SharePoint-felt:** Nye felt (`PublicBookable`, `PublicBookingEnabled`,
  `PublicNightlyRate`, `Source`, `PaymentProvider`, `PaymentStatus`,
  `BookingStatus`, `PaymentRef`, kode-referanser) må opprettes i listene.
- **Vipps-konto/nøkler:** Testmiljø- og produksjonsnøkler for Vipps.
