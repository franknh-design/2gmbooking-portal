# Andslimoen offentlig booking — Fase 2: Booking-orkestrator (design)

Dato: 2026-06-14
Status: Godkjent design, klar for implementeringsplan
Bygger på: `2026-06-12-andslimoen-offentlig-booking-design.md` (hovedspec) og Fase 1 (ledighets-fundament, levert).

## Mål

Bygge logikken som tar en privat gjest fra «velg datoer» til en `confirmed`
booking med tildelt rom — inkludert reservasjon/hold under betaling, auto-tildeling
av konkret rom, og tilstandsmaskinen for betaling + kode-generering. Betalings- og
lås-lagene er **mocket** i Fase 2 (ekte Vipps = Fase 4, ekte Yale/Tuya = Fase 5).

## Kjernebeslutninger (besluttet i brainstorming)

- **Hold = pending booking-rad** i `Booking`-lista (ikke separat KV/cron). Én
  sannhetskilde. Utløp håndteres **lazy** (ved ledighetsberegning og ved ny
  hold-opprettelse), ikke via scheduler.
- **Rom tildeles ved hold-opprettelse** (ikke ved bekreftelse). Pending-raden får
  et konkret `RoomLookupId` med en gang → bekreftelse er deterministisk, og admin
  ser rommet opptatt (ingen usynlige hold; ingen kollisjon med manuell
  firmatildeling).
- **To uavhengige statuser:** `PaymentStatus` (`pending → paid → refunded`) og
  `BookingStatus` (`pending → confirmed | cancelled`).
- **To tidsvinduer:** holdvindu (ubetalt) = **15 min**; kodevindu (betalt, retry
  før auto-refund) = **30 min**.

## Tilstandsmaskin

1. **Hold opprettes:** `BookingStatus=pending`, `PaymentStatus=pending`, konkret
   `RoomLookupId`, `Source=Public`, `HoldExpiry = now + 15 min`. Betaling startes
   (mock).
2. **Betaling bekreftet (mock):** `PaymentStatus=paid` → forsøk generer koder (mock):
   - koder OK → `BookingStatus=confirmed`
   - koder feiler → forblir `pending`/`paid`; retry innen kodevindu (30 min):
     - lykkes → `confirmed`
     - utløpt → `PaymentStatus=refunded` + `BookingStatus=cancelled` + frigjør rom
3. **Betaling feilet/avbrutt** (før `paid`) → `BookingStatus=cancelled`, frigjør rom.
4. **Hold utløper ubetalt** (`HoldExpiry` passert mens `PaymentStatus=pending`) →
   lazy `cancelled`, frigjør rom.

Invariant: et hold som er `paid` utløper ALDRI på holdvinduet — kun ubetalte hold
utløper. Betalte bookinger som mangler koder styres av kodevinduet.

## Arkitektur

Samme mønster som Fase 1: ren kjerne (enhetstestet med `node --test`) + tynne
env/store-bundne wrappere.

### Rene moduler (ingen I/O, ingen env)

- `functions/_utils/booking-allocation.js`
  - `pickRoomForPeriod({ rooms, bookings, fromMs, toMs })` → rom-id eller `null`.
    Velger et rom som er `publicBookable`, aktivt, ikke på long-term i perioden, og
    som ikke har en overlappende *tildelt* aktiv/upcoming booking (en booking med
    `RoomLookupId` satt) i `[fromMs, toMs]`. Deterministisk valg (laveste rom-id
    først) for forutsigbar testing.
- `functions/_utils/booking-state.js`
  - `isHoldExpired(booking, nowMs)` → true kun når `BookingStatus=pending`,
    `PaymentStatus=pending`, og `HoldExpiry < now`.
  - `isCodeWindowExpired(booking, nowMs)` → true kun når `PaymentStatus=paid`,
    `BookingStatus!=confirmed`, og `paidAt + 30 min < now`.
  - Overgangsfunksjoner som tar `(booking, ...)` og returnerer en **felt-patch**
    (rent objekt, ingen skriving): `onPaid`, `onCodesOk`, `onCodesFailedFinal`,
    `onPaymentFailed`, `onHoldExpired`.
- `functions/_utils/booking-holds.js`
  - `filterExpiredHolds(bookings, nowMs)` → ny liste uten utløpte ubetalte hold.
    Brukes både av ledigheten og av hold-opprettelsen.

### Tynne env/store-bundne moduler

- `functions/_utils/booking-orchestrator.js` — wirer de rene funksjonene til
  injiserte avhengigheter: en **store**, en **payment-provider**, en
  **lock-provider** og en **klokke** (`now()`). Operasjoner:
  - `createHold(deps, { fromISO, toISO, guest })` — beregner ledighet (med utløp
    anvendt), velger rom via `pickRoomForPeriod`, oppretter pending-rad, starter
    betaling, returnerer `{ bookingRef, paymentRef }` (eller en strukturert feil
    hvis fullt).
  - `confirmPayment(deps, bookingRef)` — setter `paid`, kaller `tryGenerateCodes`.
  - `tryGenerateCodes(deps, bookingRef)` — kaller lock-provider; ved suksess
    `confirmed`; ved feil lar raden stå for retry.
  - `releaseExpiredHolds(deps, propertyName)` — finner utløpte hold og skriver
    `cancelled`-patch (opportunistisk opprydding).
  - `expireCodeWindows(deps, propertyName)` — finner betalte bookinger forbi
    kodevinduet og kjører refund + cancel + frigjør.
- **Store-grensesnitt** (prod-impl over eksisterende `sharepoint.js`):
  `createBookingRow`, `updateBookingFields`, `getRoomsForProperty`,
  `getBookingsForProperty`. I test: in-memory implementasjon.
- **Provider-grensesnitt:**
  - payment: `initiate({ bookingRef, amount }) → { paymentRef, status }`.
  - lock: `generateGuestCodes({ booking }) → { entranceCode, roomCode }` (kaster ved feil).
  - Fase 2 leverer **mock**-implementasjoner; Fase 4/5 bytter inn ekte.

### Endepunkt (deployerbart i Fase 2)

- `POST /api/public-booking` — body `{ fromDate, toDate, guest: { name, phone, email? } }`.
  Validerer (gjenbruk telefon/e-post-reglene fra `submit-booking.js`), kjører
  `createHold` med prod-store + mock-providere, returnerer `{ bookingRef,
  paymentRef }` eller strukturert feil (`sold_out`, `invalid_dates`,
  `invalid_guest`, `public_booking_disabled`). Respekterer `PublicBookingEnabled`
  (av → 403/feil). Ingen token (anonymt).
- Den ekte Vipps-callbacken (som kaller `confirmPayment`) wires i Fase 4. I Fase 2
  testes `confirmPayment`/`tryGenerateCodes`/utløp via orkestratoren med mocks.

### Endring i Fase 1-koden

`calculatePublicAvailability` (`public-availability.js`) kjører booking-listen
gjennom `filterExpiredHolds(bookings, now)` FØR mapping/telling, så utløpte
ubetalte hold ikke teller som opptatt. Den rene `computePublicAvailability` og
`availability-math.js` er **uendret**.

## Datamodell (nye/brukte felt på `Booking`)

- `HoldExpiry` (dato/tid) — NY. Tidspunkt et ubetalt hold frigjøres.
- `PaidAt` (dato/tid) — NY. Settes ved `onPaid`; basis for kodevindu-utløp.
- `PaymentStatus` (Valg: `pending`/`paid`/`refunded`) — NY. Bærer den offentlige
  betalingstilstanden.
- **`BookingStatus`-mapping (besluttet):** vi innfører IKKE en ny `Status`-verdi
  (admin-appen forventer `Active`/`Upcoming`/`Cancelled` og kan mis-håndtere ukjente
  verdier). I stedet mappes den offentlige tilstanden til eksisterende felt:
  - **Hold (pending, ubetalt):** `Status=Upcoming`, `Pending_Confirmation=false`,
    `Source=Public`, `RoomLookupId` satt, `HoldExpiry` satt, `PaymentStatus=pending`.
  - **Confirmed:** `Status=Upcoming`, `Pending_Confirmation=false`,
    `PaymentStatus=paid` (koder satt i Fase 5).
  - **Cancelled** (utløpt/feilet/refundert): `Status=Cancelled`.
  `Pending_Confirmation=false` på ALLE privat-bookinger → de havner ALDRI i admins
  manuelle «AVVENTER ROMTILDELING»-kø (de er auto-tildelt). Privat-spesifikk
  tilstand leses fra `Source=Public` + `PaymentStatus`, ikke fra `Status`.
  - **«Koder generert»-markør (besluttet, ingen ny kolonne):** for å skille
    `paid+confirmed` fra `paid+venter-på-koder` brukes tilstedeværelse av det
    eksisterende `Door_Code`-feltet. I Fase 2 skriver mock-lock-laget en placeholder
    der; i Fase 5 skriver ekte Tuya-kode samme felt. Det rene laget eksponerer dette
    som en `codesGenerated`-boolean; store-laget mapper `codesGenerated ⇔ Door_Code`
    ikke-tom. `confirmed ⇔ PaymentStatus=paid && codesGenerated`.
- `PaymentRef` (tekst) — NY/planlagt.
- `Source` = `"Public"` — brukt til å skille privat fra firma (Fase 1 bruker dette).
- Kode-felt (`EntranceCode`/`RoomCode`) skrives først i Fase 5; Fase 2 lock er mock.

## Feilhåndtering

- **Fullt ved hold-opprettelse:** `pickRoomForPeriod` → `null` → `createHold`
  returnerer strukturert `sold_out` (ingen rad opprettes).
- **Betaling feiler/avbrytes:** `onPaymentFailed`-patch → `cancelled`, rom frigjøres.
- **Kode-generering feiler:** raden står `paid`/`pending`; retry innen kodevindu;
  ved utløp `onCodesFailedFinal` → refund (mock) + `cancelled` + frigjør.
- **Race (to gjester, samme siste rom):** `createHold` re-validerer ledighet og
  velger rom rett før skriving; den konservative tellingen (Fase 1) + at hold får
  konkret rom gjør at andre gjest får `sold_out`. (Graph har ikke transaksjoner;
  vinduet er lite. Akseptert restrisiko for v1, notert.)
- **Utløpt hold synlig for firma kort tid:** bedrifts-`calculateAvailability`
  kjører IKKE `filterExpiredHolds`, så et utløpt ubetalt hold (`Status=Upcoming`)
  teller som opptatt for firma til `releaseExpiredHolds` har markert det
  `Cancelled`. Sweepen kjører opportunistisk på privat-side-handlinger (ny
  hold-opprettelse / ledighetsoppslag), ikke fra firma-flyten. Holdvinduet er 15
  min, så dette er en kort transient. Akseptert for v1; en valgfri cron-sweep
  (utenfor Fase 2) ville fjernet den helt.

## Testing

- **`booking-allocation` (ren):** velger ledig rom; hopper over tildelte/long-term/
  ikke-`PublicBookable`; returnerer `null` når fullt; respekterer overlapp-perioden;
  deterministisk valg.
- **`booking-state` (ren):** `isHoldExpired` (pending+ubetalt+utløpt → true; `paid`
  aldri; `confirmed`/`cancelled` aldri); `isCodeWindowExpired`; hver overgangs-patch.
- **`booking-holds` (ren):** `filterExpiredHolds` dropper utløpte ubetalte hold,
  beholder betalte og uutløpte.
- **Orkestrator (in-memory store + mock payment/lock + injisert klokke):** happy-path
  (`createHold → confirmPayment → koder OK → confirmed`); betaling-feilet → frigjør;
  koder-feiler-så-retry-OK; koder-feiler-endelig → refund + cancel + frigjør;
  hold-utløp → release; `sold_out` når fullt. Tid drives med injisert klokke (ingen
  `sleep`).
- **Ingen live betalings-test** (Fase 4). Prosjektet bruker `node --test` med `.mjs`
  (ingen test-framework, ingen package.json) — samme som Fase 1.

## Utenfor Fase 2

- Ekte Vipps-callback + `/api/public-payment-callback` (Fase 4).
- Ekte Yale Access + Tuya/Flask kode-generering (Fase 5).
- Frontend / gjeste-UI (Fase 3).
- Cron-sweep av utløpte hold (valgfri senere opprydding; lazy utløp dekker v1).
- Kvitterings-/bekreftelses-e-post til gjest (kan tas i Fase 3/4).

## Forutsetninger å verifisere før implementering

- **SharePoint-felt:** `HoldExpiry`, `PaidAt`, `PaymentStatus`, `PaymentRef` må
  opprettes på `Booking`-lista (Fase 1 la til Rooms/Properties-felt; disse er nye).
- **BookingStatus-mapping:** avklar i planen hvordan `pending/confirmed/cancelled`
  representeres mot eksisterende `Status`/`Pending_Confirmation` uten å forstyrre
  admin-appen.
