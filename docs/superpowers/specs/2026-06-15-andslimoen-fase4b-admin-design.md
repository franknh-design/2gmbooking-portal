# Andslimoen offentlig booking — Fase 4b: Admin (design)

Dato: 2026-06-15
Status: Godkjent design, klar for implementeringsplan
Bygger på: Fase 4a (Stripe + `/api/charge-missing-items` + Persons-felt). Spenner over TO repo.

## Mål

Gi 2GM admin-verktøyet to ting for privat-bookinger: (A) en knapp for å belaste det lagrede kortet for manglende/ødelagt utstyr, og (B) skille mellom firma- og privat-gjester i gjestelista (Persons), med privat-gjester automatisk lagt inn ved bekreftet booking.

## To deler / to repo

- **Del A — «Belast manglende utstyr»-knapp:** i admin-appen (`2gmbooking`). Kaller portalens `/api/charge-missing-items` (bygget i Fase 4a).
- **Del B — Gjester `Firma|Privat`:** filter i admin-appen (`2gmbooking`) + en liten portal-side endring (`2gmbooking-portal`) som legger privat-gjester i Persons ved bekreftelse.

Hver del får sin egen del i implementeringsplanen.

## Del A — Belast manglende utstyr (admin-app)

**Sikkerhetsmodell (besluttet):** admin-appen er en ren klient-side MSAL-app, og MSAL-tokenet er et Graph-token (feil audience for portalen). `/api/charge-missing-items` er beskyttet med en delt hemmelighet (`X-Admin-Secret`). Admin-appen henter hemmeligheten fra `localStorage`; første gang knappen brukes og verdien mangler, blir Frank bedt om å lime den inn (`window.prompt`), og den lagres i `localStorage` (aldri i committet kode). Enbruker-internt verktøy → lav risiko. Kan oppgraderes til ekte token-verifisering senere hvis flere admin-brukere kommer til.

**Plassering & synlighet:** knappen vises i booking-detalj-panelet KUN for privat-bookinger — dvs. `Source === "Public"` OG `StripeCustomerId` satt (lagret kort finnes). Bedrifts-bookinger har ikke lagret kort → ingen knapp.

**Flyt:**
1. «Belast manglende utstyr» → liten dialog med avkrysning per prislinje: liten håndduk 100, stor håndduk 150, pute 400, dyne 700, sengesett 400 kr. Viser løpende sum.
2. «Belast {sum} kr» → `POST {PORTAL_BASE}/api/charge-missing-items` med header `X-Admin-Secret` + body `{ bookingRef, items: [<nøkler>] }`.
3. Svar:
   - `ok` → kvittering («Belastet {amount} kr»); reflekter `DepositChargedAt`/`DepositChargeAmount` på raden (knappen viser «Belastet {amount} kr {dato}» hvis allerede gjort).
   - `unauthorized` (401) → hemmeligheten er feil/utløpt; tøm `localStorage`-verdien og be om ny.
   - `no_saved_card` (409) → meld «ingen lagret kort på denne bookingen».
   - `not_found`/`invalid` → vis feilmelding.

**Beløp bestemmes server-side** (prislisten i portalen). Admin sender kun item-nøkler, aldri beløp. Endepunktet er idempotent (samme booking+item-sett → ingen dobbelt-belastning).

**Item-nøkler** (må matche portalens `deposit.js` PRICE_LIST): `liten_handduk`, `stor_handduk`, `pute`, `dyne`, `sengesett`.

**Portal-base-URL** i admin: konfigurerbar konstant (f.eks. `https://2gmbooking-portal.pages.dev`), på linje med hvordan admin allerede peker på Tuya-proxy-en.

## Del B — Gjester Firma | Privat

**Markør:** ny kolonne `GuestType` på **Persons**-lista (Valg: `Firma` / `Privat`). Opprettes i SharePoint av Frank. Eksisterende personer uten verdi behandles som `Firma` i filteret (de stammer alle fra bedrifts-flyten).

**Privat inn i Persons (portal-side, `2gmbooking-portal`):** når en privat booking bekreftes (i `stripe-webhook.js`, etter `confirmPayment`), kaller portalen den eksisterende `upsertPersonForBooking` med gjestens navn/telefon/e-post, tom `Company`, og `GuestType=Privat`. Best-effort (fail-soft, bryter aldri webhooken). `upsertPersonForBooking` må utvides til å skrive `GuestType` ved opprettelse (og sette `Privat` hvis den lages fra privat-flyten). Kun på bekreftet booking — aldri på ubetalte hold.

**Filter (admin-side, `2gmbooking`):** Gjester-visningen (`persons.js`) får en toggle **Alle · Firma · Privat** som filtrerer den viste lista på `GuestType` (tom verdi = Firma). Ingen endring i hvordan personer lagres fra admin (in-house forblir Firma-implisitt).

## Datamodell

- **Persons-lista (ny):** `GuestType` (Valg: `Firma`/`Privat`). 
- Portalens `upsertPersonForBooking` skriver `GuestType` på nye private Person-rader.

## Feilhåndtering

- **Charge:** se Del A svar-håndtering (401 → re-prompt secret; 409 → no_saved_card; andre → feilmelding). Nettverksfeil → «prøv igjen».
- **Privat→Persons:** fail-soft i webhooken (logges, bryter ikke bekreftelsen). Idempotent: `upsertPersonForBooking` matcher på navn og oppdaterer kun tomme felt.
- **Filter:** rent klient-side på allerede-hentet Persons-data; ingen ny fetch.

## Testing

- **Portal-side (`node --test`):** verifiser at `upsertPersonForBooking` skriver `GuestType` korrekt der det er enhetstestbart (ev. en ren mapping-hjelper). Webhook-integrasjonen verifiseres live.
- **Admin-app:** ingen test-rigg (manuelt/live, som resten av admin-appen). Verifiser: knapp vises kun for privat m/ lagret kort; dialog summerer riktig; charge lykkes i Stripe testmodus og reflekteres; 401 re-prompter; filter viser riktig delmengde.
- **Live (Stripe testmodus):** krever Fase 4a-secrets satt + en bekreftet test-booking med lagret kort.

## Forutsetninger

- Fase 4a live (charge-endepunkt deployet, `ADMIN_CHARGE_SECRET` satt i Cloudflare).
- Ny SharePoint-kolonne `Persons.GuestType` (Valg: Firma/Privat) — opprettes av Frank.
- `PublicBookingEnabled=Ja` + en betalt test-booking for live-test av charge.

## Utenfor Fase 4b

- Ekte token-verifisering for charge-endepunktet (localStorage-secret holder for v1).
- «Annet beløp»/fritekst-item på charge (kun fast prisliste i v1).
- Automatisk charge fra vaskerens utsjekk-registrering (fortsatt manuell knapp).
- Ekte Yale/Tuya (Fase 5).
