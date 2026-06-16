# Omdøping: «public» → «private» (Andslimoen-booking) — design

Dato: 2026-06-16
Status: Godkjent design, klar for implementeringsplan
Repo: `2gmbooking-portal` (+ én label i admin `2gmbooking`).

## Mål

Døpe om den private-markeds-bookingen fra «public/offentlig» til «private» — fordi inngangssiden blir 2gm.no der gjesten velger **privat** eller **firma**, og de to URL-ene skal være `/private` og `/company`. Denne spec'en dekker KUN «private» (Andslimoen-bookingen). «company» (registreringen) tas i egen runde.

URL: `https://2gmbooking-portal.pages.dev/andslimoen` → `/private`. Ingen redirect — gamle URL-er slettes (siden er ikke i bruk av ekte gjester enda).

## Navne-map

### Filer (portal)
- `andslimoen.html` → `private.html` (URL `/private`)
- `andslimoen-vilkar.html` → `private-vilkar.html`
- `assets/js/andslimoen.mjs` → `assets/js/private.mjs`
- `assets/js/andslimoen-format.mjs` → `assets/js/private-format.mjs`
- `assets/js/andslimoen-i18n.mjs` → `assets/js/private-i18n.mjs`
- `assets/css/andslimoen.css` → `assets/css/private.css`
- `assets/img/andslimoen/` → `assets/img/private/` (5 bilder; oppdater `GALLERY`-stier i private.mjs)
- `functions/api/public-availability.js` → `functions/api/private-availability.js` (rute `/api/private-availability`)
- `functions/api/public-booking.js` → `functions/api/private-booking.js` (rute `/api/private-booking`)
- `functions/_utils/public-availability.js` → `functions/_utils/private-availability.js`
- Tester: `tests/availability-math.test.mjs` (behold filnavn) oppdateres for omdøpte eksporter; ingen `public-availability`-test finnes.

### Kode-identifikatorer (portal)
- `getPublicConfig` → `getPrivateConfig` (sharepoint.js)
- `createPublicHoldRow` → `createPrivateHoldRow` (sharepoint.js)
- `calculatePublicAvailability` → `calculatePrivateAvailability` (_utils/private-availability.js)
- `computePublicAvailability` → `computePrivateAvailability` (availability-math.js — behold filnavn, rene matte)
- `Source`-VERDIEN `"Public"` → `"Private"` (skrives i createPrivateHoldRow; leses i `isPublic`-sjekker → `isPrivate`/`source==="Private"`). Trygt: ingen ekte privat-rader finnes enda.
- Diverse «public/offentlig» i kommentarer/strenger → «private/privat».
- Frontend `private.mjs`: `fetch`-URL-ene → `/api/private-availability` + `/api/private-booking`; importene til `private-format.mjs`/`private-i18n.mjs`; `GALLERY`-stier → `assets/img/private/`.
- `private.html`: `<link>`/`<script>`-referanser → `private.css`/`private.mjs`; vilkår-lenke → `private-vilkar.html`.
- Webhook + charge-endepunkt: ingen rute-endring, men oppdater evt. importer hvis de peker på omdøpte `_utils`/funksjoner (de bruker `booking-store`/`booking-orchestrator`/`sharepoint`, ikke public-availability — verifiseres).

### Admin (`2gmbooking`)
- `render.js` charge-knapp: `String(booking.Source||'')==='Public'` → `'Private'`.
- `invoicing.js` Portal-booking-fane: label «Offentlig booking» → «Privat booking» (UI-tekst/i18n). Leser fortsatt `PublicBookingEnabled`/`PublicNightlyRate` (SP-navn uendret).

## Beholdes bevisst (IKKE omdøpes)
- **SharePoint-feltnavn** `PublicBookingEnabled`, `PublicNightlyRate` (interne navn er låst; usynlig lagring). `getPrivateConfig` leser dem fortsatt med disse navnene.
- **`booking-*`-filene** (booking-state/allocation/holds/orchestrator/store) — heter «booking», ikke «public»; kun `Source`-verdi-sjekkene (`"Public"`→`"Private"`) endres der.
- **Side-tekst** «Rigg Andslimoen» (det ER riggen) — kun fil/rute/identifikator-navn blir «private».
- **Stripe/depositum-felt**, `Deposit_Prices` osv. — uendret.

## Dataflyt (uendret, kun navn)
`/private` → `private.mjs` → `POST /api/private-availability` + `/api/private-booking` → orkestrator/store (uendret) → Stripe (uendret) → webhook (uendret). SP-feltene leses/skrives med uendrede interne navn.

## Feilhåndtering
Ren omdøping — ingen ny logikk. Risiko = dangling referanse (en `public-*`-import/URL som ikke ble oppdatert). Mitigeres ved: grep for «public»/«andslimoen» etter omdøping skal kun treffe SP-feltnavnene (`PublicBookingEnabled`/`PublicNightlyRate`), side-teksten «Andslimoen», og historiske spec/plan-dokumenter.

## Testing
- **`node --test tests/*.test.mjs`** grønn etter omdøping (oppdater `computePublicAvailability`→`computePrivateAvailability` i `availability-math.test.mjs`; `Source:"Public"`→`"Private"` i booking-state/holds/orchestrator-tester).
- **Import-kjede:** alle endepunkter + `private.mjs` laster (`node --check` / dynamisk import).
- **Live (etter deploy):** `https://2gmbooking-portal.pages.dev/private` gir 200 + assets 200; `/api/private-availability` svarer; gammel `/andslimoen` gir 404.
- Admin: charge-knapp + Portal-booking-fane fungerer mot omdøpte verdier (manuelt; del av samlet live-test).

## Forutsetninger
- Ingen ekte privat-bookinger finnes (Source-verdi trygt å endre).
- `PublicBookingEnabled=Nei` under omdøping (uansett).

## Utenfor denne spec'en
- «register» → «company» (egen runde).
- 2gm.no-landingssiden (Frank, separat) som lenker til `/private` + `/company`.
- Historiske spec/plan-dokumenter beholder «public»-navn (oppdateres ikke — historikk).
