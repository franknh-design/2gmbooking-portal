# Andslimoen offentlig booking — status & overlevering

Sist oppdatert: 2026-06-14. Repo: `franknh-design/2gmbooking-portal` (Cloudflare Pages, auto-deploy fra `main`).

> **VIKTIG:** Rigg Andslimoen er **ikke i drift enda**. Alt er bygget i forkant og skal stå **AV** (`PublicBookingEnabled = Nei` på Andslimoen-raden i Properties-lista) til riggen faktisk åpner. Ingen ekte gjester før den skrus på.

## Hva er live nå

Offentlig bookingside: **https://2gmbooking-portal.pages.dev/andslimoen**
(inert / viser «stengt» når `PublicBookingEnabled = Nei` — som den skal stå nå)

| Fase | Hva | Status |
|------|-----|--------|
| 1 | Ledighet — konservativ telling + `/api/public-availability` | ✅ live |
| 2 | Booking-orkestrator — hold/tilstandsmaskin, mock betaling/lås, `/api/public-booking` | ✅ live (inert) |
| 3 | Frontend — tospråklig (NO/EN), flatpickr-kalender, galleri (placeholder-bilder) | ✅ live |
| 4 | Stripe-betaling + depositum + vilkår | 📋 spec skrevet, ikke bygget |
| 4b | Admin-knapp «belast manglende utstyr» (i `2gmbooking`-repoet) | 📋 venter på 4a |
| 5 | Ekte Yale (ytterdør) + Tuya (rom) per-gjest-koder | ⏳ krever fysiske låser |

## Dokumenter (i repoet)

- Hovedspec: `docs/superpowers/specs/2026-06-12-andslimoen-offentlig-booking-design.md`
- Fase 1 plan: `docs/superpowers/plans/2026-06-13-andslimoen-public-availability-fase1.md`
- Fase 2 spec/plan: `docs/superpowers/specs|plans/2026-06-14-andslimoen-fase2-booking-orchestrator*`
- Fase 3 spec/plan: `docs/superpowers/specs|plans/2026-06-14-andslimoen-fase3-frontend*`
- **Fase 4 spec (til din gjennomgang):** `docs/superpowers/specs/2026-06-14-andslimoen-fase4-stripe-design.md`

## NESTE STEG

1. **Les Fase 4-spec'en** — særlig **vilkårsutkastet** (NO/EN, punkt 1–6). Si fra om ordlyd / inn-/utsjekk-tider skal endres.
2. **Opprett Stripe-konto** og hent **test-nøkler** (Dashboard → Developers → API keys): `pk_test_…` + `sk_test_…`. (`whsec_…` lages ved webhook-oppsett.) Disse legges som Cloudflare-secrets ved bygging.
3. Når spec'en er godkjent → vi lager **Fase 4a-planen** og bygger mot Stripe testmodus (ikke blokkert av at riggen er fysisk klar).

## Nøkkelbeslutninger (Fase 4)

- **Stripe først** (Vipps som provider nr. 2 senere, bak samme abstraksjon).
- **Stripe Checkout** (redirect), full oppholdspris betales ved booking, kortet lagres (`setup_future_usage`).
- **Depositum:** ingen penger holdes. Kort lagres → ved manglende/ødelagt utstyr belastes faktisk beløp off-session per prisliste:
  - liten håndduk 100 · stor håndduk 150 · pute 400 · dyne 700 · sengesett 400 — **maks 1750 kr**.
- **Avbestilling:** gratis inntil 24t før innsjekk; senere / no-show → behold **1 natt** (650 kr), resten refunderes (manuell refusjon i v1).
- **Vilkår:** obligatorisk avkrysning ved booking.
- **Belast-knapp:** i admin-appen (`2gmbooking`), kaller portal-endepunkt (Fase 4b).

## SharePoint — gjort

Booking-lista har fått (opprettet av Frank 2026-06-14): `StripeCustomerId`, `StripePaymentMethodId` (tekst), `TermsAcceptedAt` (dato/tid), `TermsVersion` (tekst), `DepositChargedAt` (dato/tid), `DepositChargeAmount` (tall), `DepositChargeItems` (flere linjer).
Fra før (Fase 1/2): Rooms.`PublicBookable`; Properties.`PublicBookingEnabled` + `PublicNightlyRate`; Booking.`HoldExpiry`/`PaidAt`/`PaymentStatus`/`PaymentRef`/`Source`. Andslimoen = 52 rom, alle PublicBookable, 650 kr/natt.

## Parkert

- **OTA-er (Airbnb/Booking.com/Hotels.com):** post-launch. Airbnb+Vrbo = DIY iCal-sync; Booking.com + Hotels.com/Expedia = channel manager (Beds24/Smoobu/Lodgify/Hospitable). Forbehold: kommisjon, OTA håndterer betaling (vår depositum/vilkår gjelder ikke der).

## Utvikler-notater (gotchas)

- **Kjør tester:** `node --test tests/*.test.mjs` (IKKE `node --test tests/` — feiler på dir-lasting i Node 24). 63 tester grønne nå.
- **Ingen build/framework.** Vanilla JS. Functions = ESM. Frontend-siden bruker `<script type="module">`.
- **Ikke** legg `/andslimoen`-rewrite i `_redirects` — Cloudflare Pages serverer `.html` på clean URL automatisk; en eksplisitt rewrite lager 308-loop.
- **Deploy:** push til `main` → Cloudflare ~30–60 sek. Sjekk live med `curl`.
- **`calculateAvailability` (bedrift) teller kun bookinger med tildelt rom.** Privat-siden har egen konservativ telling (alle aktive/upcoming rader). Ikke bland disse.
- **Bilder:** placeholdere i `assets/img/andslimoen/` — overskriv filene (`rom/bad/vaskerom/kjokken/rigg.jpg`) med ekte foto, ingen kode-endring.
- **Arbeidsflyt:** `git fetch` + sjekk remote FØR du koder (Frank pusher fra jobb); commit+push automatisk etter hver ferdig endring.
