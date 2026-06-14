# Andslimoen offentlig booking — Fase 4: Stripe-betaling + depositum + vilkår (design)

Dato: 2026-06-14
Status: Godkjent design, klar for implementeringsplan
Bygger på: hovedspec (`2026-06-12`), Fase 1 (ledighet), Fase 2 (orkestrator + betalingsabstraksjon), Fase 3 (frontend). Alle levert.

## Mål

Erstatte den mockede betalingen med ekte **Stripe**, slik at en privat gjest betaler oppholdet ved booking, godtar vilkår, og får kortet lagret for en eventuell depositum-belastning ved manglende/ødelagt utstyr. Lås-laget forblir mock (ekte Yale/Tuya = Fase 5). Alt bygges og testes i **Stripe testmodus** — ikke blokkert av at riggen er fysisk i drift.

## Hvorfor Stripe først (besluttet 2026-06-14)

Frank snudde rekkefølgen: Stripe er primær provider i Fase 4 (kort/Apple Pay/Google Pay/utland, enklere oppsett + testmiljø, ren `setup_future_usage` for kort-lagring). Vipps legges på senere som provider nr. 2 bak den samme Fase 2-abstraksjonen.

## Besluttede valg

- **Integrasjon:** Stripe **Checkout** (Stripe-hostet side, redirect) — kort + Apple Pay + Google Pay, null PCI-ansvar på oss, minst kode.
- **Betaling:** full oppholdspris ved booking. Checkout Session med `payment_intent_data.setup_future_usage: 'off_session'` så kortet lagres samtidig.
- **Depositum:** ingen penger holdes ved booking. Kortet lagres; ved manglende/ødelagt utstyr belaster du **faktisk beløp per prisliste** off-session på det lagrede kortet (løser Stripes ~7-dagers auth-grense for bookinger langt fram).
- **Prisliste (manglende/ødelagt utstyr):** liten håndduk 100, stor håndduk 150, pute 400, dyne 700, sengesett 400 kr. Maks (alt borte) = **1750 kr**; oppgis i vilkår som «inntil 1750 kr per prisliste».
- **Avbestilling:** gratis (full refusjon) inntil **24 timer** før innsjekk; senere / no-show → behold **1 natt** (= `nightlyRate`, 650 kr), refunder resten. Manuell håndtering i v1 (Stripe-dashboard / admin).
- **Vilkår:** obligatorisk avkrysning ved booking; lagres som `TermsAcceptedAt` (+ `TermsVersion`). Egen vilkårsside + lenke.
- **Bekreftelses-e-post:** kvittering til gjest via Resend etter betalt.
- **Utløser for depositum-belastning:** knapp i **admin-appen** (Fase 4b); backend off-session-belastning i portalen (Fase 4a).

## Dekomponering

- **Fase 4a (portal — hoveddelen):** Stripe Checkout, webhook, kort-lagring, vilkår, avbestilling/refusjon, bekreftelses-e-post, `charge-missing-items`-endepunkt. Bytter `mockPayment` → ekte Stripe-provider bak Fase 2-abstraksjonen.
- **Fase 4b (admin-appen `2gmbooking` — mindre):** «Belast for manglende utstyr»-UI på offentlige bookinger; huker av items fra prislisten → sum → kaller portal-endepunktet.

Hver får sin egen plan. 4a først (4b avhenger av 4a-endepunktet).

## Flyt (Fase 4a)

1. Gjest fyller skjema + **huker av vilkår** → `POST /api/public-booking` (utvidet): validerer (inkl. at vilkår er akseptert), oppretter pending-hold som i dag, oppretter en **Stripe Checkout Session** (beløp = oppholdspris, `setup_future_usage: off_session`, `metadata.bookingRef`), lagrer session-id i `PaymentRef`, og returnerer Checkout-URL.
2. Frontend **redirecter** gjesten til Checkout-URL-en (Stripe-hostet).
3. Gjest betaler → Stripe redirecter til **success-URL** (`/andslimoen?ok=<ref>`) → frontend viser bekreftelse. **Cancel-URL** (`/andslimoen?avbrutt=1`) → gjest avbrøt; holdet utløper av seg selv (15 min, lazy).
4. **Stripe webhook** `POST /api/stripe-webhook` (signatur-verifisert med `whsec_…`) på `checkout.session.completed`:
   - finn booking via `metadata.bookingRef`
   - hent `customer` + `payment_method` fra sessionen → lagre `StripeCustomerId` + `StripePaymentMethodId`
   - kall eksisterende `confirmPayment` (markerer `paid`, genererer koder — **mock i Fase 4** → `confirmed`)
   - send bekreftelses-e-post (Resend, fire-and-forget)

Webhook er sannhetskilden for «betalt» (ikke success-redirecten, som kan hoppes over).

## Stripe-provider bak Fase 2-abstraksjonen

Fase 2 definerte `payment.initiate({bookingRef, amount})` / `payment.refund({paymentRef})`. Fase 4 legger til en ekte `stripePayment`-implementasjon + en ny operasjon for off-session-belastning:
- `initiate(...)` → oppretter Checkout Session, returnerer `{ paymentRef: sessionId, checkoutUrl }`.
- `refund({ paymentRef, amount? })` → refunderer (helt/delvis, for avbestilling).
- `chargeSavedCard({ customerId, paymentMethodId, amount, description })` → off-session PaymentIntent (depositum).
`createHold` (orkestrator) utvides til å returnere `checkoutUrl` ut til endepunktet/frontend.

## charge-missing-items (Fase 4a-endepunkt, brukt av 4b)

`POST /api/charge-missing-items` (beskyttet — kun admin; auth avklares i planen, f.eks. delt hemmelighet/Graph-token):
- body `{ bookingRef, items: ["liten_handduk", "dyne", ...] }`
- ren `sumMissingItems(items)` (prisliste) → totalbeløp (avvis hvis > 1750 / ukjent item)
- `stripePayment.chargeSavedCard(...)` på bookingens lagrede kort
- skriv `DepositChargedAt`, `DepositChargeAmount`, `DepositChargeItems`
- returnerer `{ ok, amount }` eller strukturert feil

## Datamodell (nye `Booking`-felt — opprettet i SharePoint av Frank)

`StripeCustomerId`, `StripePaymentMethodId` (tekst); `TermsAcceptedAt` (dato/tid), `TermsVersion` (tekst); `DepositChargedAt` (dato/tid), `DepositChargeAmount` (tall), `DepositChargeItems` (flere linjer tekst). Gjenbruk: `PaymentRef` (Stripe session/PaymentIntent-id), `PaymentStatus`, `Source`, `HoldExpiry`, `PaidAt`.

## Vilkår — UTKAST (til Franks godkjenning)

Vises som egen side (`andslimoen-vilkar.html`) + lenke ved avkrysningen. Tospråklig (NO/EN, samme i18n-mønster).

**Norsk (utkast):**
> **Vilkår for booking — Rigg Andslimoen**
> 1. **Betaling:** Hele oppholdet betales ved booking med kort via Stripe.
> 2. **Hva er inkludert:** Rom med eget bad/dusj og toalett, lite og stort håndkle, og sengetøy. Felles kjøkken og vaskerom.
> 3. **Depositum / manglende utstyr:** Det belastes ingen depositum ved booking, men kortet lagres trygt hos Stripe. Manglende eller ødelagt utstyr ved utsjekk belastes per prisliste: liten håndduk 100 kr, stor håndduk 150 kr, pute 400 kr, dyne 700 kr, sengesett 400 kr — inntil 1750 kr.
> 4. **Avbestilling:** Gratis avbestilling inntil 24 timer før innsjekk (full refusjon). Ved senere avbestilling eller manglende oppmøte beholdes prisen for 1 natt; resten refunderes.
> 5. **Inn-/utsjekk:** Innsjekk fra kl. 15:00 (tidligere hvis rommet er klart — gi beskjed). Utsjekk innen kl. 12:00.
> 6. **Ansvar:** Gjesten er ansvarlig for rommet og utstyret i oppholdsperioden.

**English (draft):**
> **Booking terms — Rigg Andslimoen**
> 1. **Payment:** The full stay is paid at booking by card via Stripe.
> 2. **Included:** Room with private bathroom/shower and toilet, a small and large towel, and bedding. Shared kitchen and laundry.
> 3. **Deposit / missing items:** No deposit is charged at booking, but your card is securely saved with Stripe. Missing or damaged items at checkout are charged per price list: small towel NOK 100, large towel NOK 150, pillow NOK 400, duvet NOK 700, bedding set NOK 400 — up to NOK 1750.
> 4. **Cancellation:** Free cancellation up to 24 hours before check-in (full refund). For later cancellation or no-show, the price of 1 night is retained; the rest is refunded.
> 5. **Check-in/out:** Check-in from 15:00 (earlier if the room is ready — let us know). Check-out by 12:00.
> 6. **Responsibility:** The guest is responsible for the room and equipment during the stay.

(Frank fyller inn inn-/utsjekk-tidspunkter og justerer ordlyd.)

## Feilhåndtering

- **Vilkår ikke godtatt:** `/api/public-booking` returnerer `terms_not_accepted` (400); frontend peker på avkrysningen.
- **Gjest avbryter Checkout:** ingen `confirmPayment`; holdet utløper lazy (15 min). Ingen rad-opprydding nødvendig utover eksisterende.
- **Webhook-signatur ugyldig:** 400, ingen tilstandsendring.
- **Webhook dobbelt (Stripe retryr):** `confirmPayment` er idempotent (Fase 2) — andre gang er no-op.
- **Off-session-belastning feiler** (kort avvist): endepunktet returnerer feil; admin ser det og følger opp manuelt.
- **Refusjon (avbestilling):** manuell i v1 via Stripe-dashboard; `refund()`-operasjonen finnes for senere selvbetjening.

## Testing

- **Stripe testmodus** hele veien (test-nøkler, test-kort `4242…`). Live-nøkler først når riggen åpner.
- **Webhook:** Stripe CLI sender test-eventer (`checkout.session.completed`) mot endepunktet; signatur-sjekk verifiseres (avviser usignerte/uekte).
- **Rene enhetstester (`node --test`):** `sumMissingItems(items)` (prisliste-summering, ukjent item → feil, > 1750 → avvist), oppholdspris (`totalPrice` finnes), avbestillingsgebyr (1 natt).
- **Off-session-belastning:** mot lagret test-kort i testmodus.
- **Vilkår:** backend avviser booking uten `TermsAcceptedAt`.
- **Lås fortsatt mock** — `confirmPayment` → betalt → mock-koder → confirmed.

## Forutsetninger

- **Stripe-konto + test-nøkler:** `pk_test_…`, `sk_test_…` (Cloudflare-secrets); `whsec_…` genereres ved webhook-oppsett.
- **SharePoint-felt:** opprettet (gjort av Frank 2026-06-14).
- **Vipps:** utenfor Fase 4 — legges på senere bak samme abstraksjon.
- **Yale/Tuya ekte koder:** Fase 5.
- **Cleaner-drevet auto-belastning:** utenfor v1 (manuell admin-knapp i 4b); kan automatiseres med vaskeflyten senere.

## Utenfor Fase 4

- Vipps som provider nr. 2.
- Selvbetjent avbestilling (v1 = manuell refusjon).
- Automatisk depositum-belastning fra vaskerens utsjekk-registrering.
- Ekte Yale/Tuya-koder (Fase 5).
