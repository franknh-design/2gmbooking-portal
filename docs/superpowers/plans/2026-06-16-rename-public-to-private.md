# Omdøping public → private — implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Døpe om Andslimoen-bookingen fra «public» til «private» (filer, ruter, endepunkter, kode-identifikatorer, `Source`-verdi, `/andslimoen`→`/private`) uten å endre oppførsel.

**Architecture:** Mekanisk omdøping i `2gmbooking-portal` (+ to small endringer i admin `2gmbooking`). SharePoint-feltnavn (`PublicBookingEnabled`/`PublicNightlyRate`) beholdes som lagring. Eksisterende enhetstester (`node --test`) er sikkerhetsnettet — de må forbli grønne etter hvert steg. Gamle URL-er slettes (ingen redirect).

**Tech Stack:** Cloudflare Pages Functions (ESM), `node --test`, admin vanilla JS.

---

## Bakgrunn / verifisert kart
- `git mv` brukes for filer (bevarer historikk). Etter hvert task: `node --test tests/*.test.mjs` skal være grønn.
- Eksisterende «Public»-touchpoints (fra explore): `functions/api/public-availability.js`, `functions/api/public-booking.js`, `functions/_utils/public-availability.js`, `getPublicConfig`/`createPublicHoldRow` (sharepoint.js), `computePublicAvailability`/`publicPoolSize`/`publicOccupied`/`isPublic` (availability-math.js + wrapper + tester), `source==="Public"` (booking-state.js, wrapper), `Source:"Public"` (createPublicHoldRow), frontend `andslimoen.*` + `assets/img/andslimoen/`, admin `render.js` (`Source==='Public'`) + `invoicing.js` label.
- IKKE rør: SP-feltnavn `PublicBookingEnabled`/`PublicNightlyRate`, side-tekst «Rigg Andslimoen», `booking-*`-filnavn, historiske docs.

---

## Task 1: Pure-laget (availability-math + booking-state) + tester

**Files:** `functions/_utils/availability-math.js`, `functions/_utils/booking-state.js`, `tests/availability-math.test.mjs`, `tests/booking-state.test.mjs`, `tests/booking-holds.test.mjs`, `tests/booking-orchestrator.test.mjs`

- [ ] **Step 1:** I `functions/_utils/availability-math.js`, rename eksport + interne felt (replace_all i fila): `computePublicAvailability`→`computePrivateAvailability`, `publicPoolSize`→`privatePoolSize`, `publicOccupied`→`privateOccupied`, `isPublic`→`isPrivate`. (Behold `parseDateUtcMs`/`isInRangeInclusive`.)
- [ ] **Step 2:** I `functions/_utils/booking-state.js`, endre `Source`-verdi-sjekkene: `b.source === "Public"` → `b.source === "Private"` (i `isHoldExpired` og `isCodeWindowExpired`).
- [ ] **Step 3:** Oppdater testene (replace_all per fil):
  - `tests/availability-math.test.mjs`: `computePublicAvailability`→`computePrivateAvailability`, `publicPoolSize`→`privatePoolSize`, `publicOccupied`→`privateOccupied`, `isPublic`→`isPrivate`.
  - `tests/booking-state.test.mjs`, `tests/booking-holds.test.mjs`, `tests/booking-orchestrator.test.mjs`: `source: "Public"`→`source: "Private"` (alle forekomster) og evt. `isPublic`→`isPrivate` / `"Public"`-strenger i fixtures.
- [ ] **Step 4:** `node --test tests/*.test.mjs` → 0 fail (alle de rene testene grønne med nye navn).
- [ ] **Step 5: Commit** — `git add functions/_utils/availability-math.js functions/_utils/booking-state.js tests/availability-math.test.mjs tests/booking-state.test.mjs tests/booking-holds.test.mjs tests/booking-orchestrator.test.mjs && git commit -m "refactor: rename public->private in pure availability/state layer"`

## Task 2: Service-laget (sharepoint + wrapper + store)

**Files:** `git mv functions/_utils/public-availability.js functions/_utils/private-availability.js`; modify `functions/_utils/sharepoint.js`, `functions/_utils/private-availability.js`, `functions/_utils/booking-store.js`

- [ ] **Step 1:** `git mv functions/_utils/public-availability.js functions/_utils/private-availability.js`.
- [ ] **Step 2:** I `functions/_utils/sharepoint.js`: rename `getPublicConfig`→`getPrivateConfig` og `createPublicHoldRow`→`createPrivateHoldRow` (replace_all). I `createPrivateHoldRow`, endre `Source: "Public"` → `Source: "Private"`. (Behold `f.PublicBookingEnabled`/`f.PublicNightlyRate`-lesingen — SP-navn.)
- [ ] **Step 3:** I `functions/_utils/private-availability.js`: rename `calculatePublicAvailability`→`calculatePrivateAvailability`; import `computePrivateAvailability` (fra availability-math.js); i booking-mappingen `isPublic: b.source === "Public"` → `isPrivate: b.source === "Private"` (matcher Task 1-feltnavnet).
- [ ] **Step 4:** I `functions/_utils/booking-store.js`: oppdater importen `createPublicHoldRow`→`createPrivateHoldRow` og kallet i `createHold`. (Source leses kun gjennom; ingen verdi-endring her.)
- [ ] **Step 5:** Verifiser import: `node -e "Promise.all(['./functions/_utils/private-availability.js','./functions/_utils/sharepoint.js','./functions/_utils/booking-store.js'].map(p=>import(p))).then(([a,b])=>console.log(typeof a.calculatePrivateAvailability, typeof b.getPrivateConfig)).catch(e=>{console.error(e);process.exit(1)})"` → `function function`. `node --test tests/*.test.mjs` → 0 fail.
- [ ] **Step 6: Commit** — `git add -A functions/_utils && git commit -m "refactor: rename public->private in sharepoint/wrapper/store"`

## Task 3: Endepunkter

**Files:** `git mv functions/api/public-availability.js functions/api/private-availability.js`; `git mv functions/api/public-booking.js functions/api/private-booking.js`; modify those + `functions/api/charge-missing-items.js` og `functions/api/stripe-webhook.js` ved behov

- [ ] **Step 1:** `git mv functions/api/public-availability.js functions/api/private-availability.js` og `git mv functions/api/public-booking.js functions/api/private-booking.js`.
- [ ] **Step 2:** I `functions/api/private-availability.js`: oppdater import `calculatePublicAvailability`→`calculatePrivateAvailability` (fra `../_utils/private-availability.js`) og `getPublicConfig`→`getPrivateConfig`. Kommentar-header → «private».
- [ ] **Step 3:** I `functions/api/private-booking.js`: oppdater importer `getPublicConfig`→`getPrivateConfig`; behold `createSharePointStore`/`createStripePayment`/`createHold`. Kommentar-header → «private». (Rute blir `/api/private-booking`.)
- [ ] **Step 4:** Sjekk `functions/api/stripe-webhook.js` og `functions/api/charge-missing-items.js` for importer av omdøpte navn (`getPublicConfig`/`createPublicHoldRow`/`public-availability`). Oppdater hvis de finnes. (Forventet: webhook bruker `confirmPayment`/`createSharePointStore`/`retrievePaymentIntent`; charge bruker `getDepositPrices`/`sumMissingItems` — ingen «public»-import. Verifiser med grep.)
- [ ] **Step 5:** Import-sjekk: `node -e "Promise.all(['./functions/api/private-availability.js','./functions/api/private-booking.js','./functions/api/stripe-webhook.js','./functions/api/charge-missing-items.js'].map(p=>import(p))).then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"` → `ok`. Full suite grønn.
- [ ] **Step 6: Commit** — `git add -A functions/api && git commit -m "refactor: rename public->private endpoints (/api/private-*)"`

## Task 4: Frontend (private.html + assets + bilder)

**Files:** `git mv` for `andslimoen.html`, `andslimoen-vilkar.html`, `assets/css/andslimoen.css`, `assets/js/andslimoen.mjs`, `assets/js/andslimoen-format.mjs`, `assets/js/andslimoen-i18n.mjs`, `assets/img/andslimoen/` → `private`-navn; modify `private.html` + `private.mjs`

- [ ] **Step 1:** `git mv` filene:
  ```bash
  git mv andslimoen.html private.html
  git mv andslimoen-vilkar.html private-vilkar.html
  git mv assets/css/andslimoen.css assets/css/private.css
  git mv assets/js/andslimoen.mjs assets/js/private.mjs
  git mv assets/js/andslimoen-format.mjs assets/js/private-format.mjs
  git mv assets/js/andslimoen-i18n.mjs assets/js/private-i18n.mjs
  git mv assets/img/andslimoen assets/img/private
  ```
- [ ] **Step 2:** I `private.html`: `assets/css/andslimoen.css`→`assets/css/private.css`; `assets/js/andslimoen.mjs`→`assets/js/private.mjs`; vilkår-lenke `andslimoen-vilkar.html`→`private-vilkar.html`; bilde-`src` `assets/img/andslimoen/`→`assets/img/private/` (hovedbildet). (Behold tekst «Rigg Andslimoen».)
- [ ] **Step 3:** I `private.mjs`: importer `./private-format.mjs` + `./private-i18n.mjs`; `GALLERY`-stier `assets/img/andslimoen/`→`assets/img/private/`; fetch-URL-er `/api/public-availability`→`/api/private-availability` og `/api/public-booking`→`/api/private-booking`.
- [ ] **Step 4:** I `private-i18n.mjs`/`private-format.mjs`: ingen funksjonelle URL-er, men oppdater evt. `andslimoen`/`public` i kommentarer (kosmetisk). `node --check assets/js/private.mjs assets/js/private-format.mjs assets/js/private-i18n.mjs`.
- [ ] **Step 5:** Full suite (`node --test tests/*.test.mjs`) grønn — merk: `tests/andslimoen-format.test.mjs` og `tests/andslimoen-i18n.test.mjs` importerer fra `../assets/js/andslimoen-*.mjs`. **`git mv` disse testfilene** til `tests/private-format.test.mjs` / `tests/private-i18n.test.mjs` og oppdater import-stiene til `../assets/js/private-format.mjs` / `../assets/js/private-i18n.mjs`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor: rename Andslimoen booking frontend public->private (/private)"`

## Task 5: Admin (render.js Source-sjekk + Portal-booking-label)

**Files (repo `C:/dev/2gmbooking`):** `js/render.js`, `js/invoicing.js` (+ evt. i18n)

- [ ] **Step 1:** I `js/render.js` (charge-knappen, Fase 4b): `String(booking.Source||'')==='Public'` → `==='Private'`.
- [ ] **Step 2:** I `js/invoicing.js` Portal-booking-fanen: endre brukervendt label «Offentlig booking» → «Privat booking» (`rates.portal.col.open`/`rates.portal.title`-tekst eller fallback). Behold `PublicBookingEnabled`/`PublicNightlyRate`-lesing (SP-navn).
- [ ] **Step 3:** `node --check js/render.js js/invoicing.js`. Bump admin-versjon (index.html + version.txt). Commit i admin-repo: `git commit -am "vX — privat-booking: Source=Private + label"`.

## Task 6: Full suite + grep-audit + push + live-verifisering

- [ ] **Step 1:** `node --test tests/*.test.mjs` (portal) → 0 fail.
- [ ] **Step 2: Grep-audit (portal)** — `grep -rniE "public-availability|public-booking|getPublicConfig|createPublicHoldRow|computePublicAvailability|andslimoen\.(html|mjs|css)|assets/img/andslimoen|/api/public-" functions/ assets/ private*.html` → forventet INGEN treff (kun historiske docs). `grep -rn "Public" functions/_utils/sharepoint.js` skal kun treffe `PublicBookingEnabled`/`PublicNightlyRate` (SP-felt). `Source.*Public`-treff skal være borte.
- [ ] **Step 3: Push begge repo.** Cloudflare deployer portal; admin via GitHub Pages.
- [ ] **Step 4: Live-verifisering:** `curl -sL -o /dev/null -w "%{http_code}" https://2gmbooking-portal.pages.dev/private` → 200; `/private`-HTML har `private.mjs`/`private.css`; `/assets/img/private/rom.jpg` → 200; gammel `/andslimoen` → 404; `/api/private-availability` (POST) svarer (enabled:false hvis toggle av). Admin: Portal-booking-fanen + charge-knapp uendret oppførsel.

---

## Self-review (utført)
- **Dekning:** filer (Task 2/3/4), identifikatorer (Task 1/2/3), Source-verdi (Task 1/2 + admin Task 5), frontend-URL-er (Task 4), admin (Task 5), grep-audit (Task 6). Alle map-punkter dekket.
- **Type-konsistens:** `computePrivateAvailability` + `privatePoolSize`/`privateOccupied`/`isPrivate` (Task 1) brukt i wrapper (Task 2) + tester (Task 1). `getPrivateConfig`/`createPrivateHoldRow` (Task 2) importert i endepunkter (Task 3) + store (Task 2). `Source="Private"` skrives (Task 2) og leses (Task 1 booking-state, Task 2 wrapper, Task 5 admin). Frontend fetch-URL-er (Task 4) matcher endepunkt-rutene (Task 3).
- **Test-import-felle:** `tests/andslimoen-format.test.mjs`/`-i18n.test.mjs` må flyttes + import-sti oppdateres (Task 4 steg 5) ellers ryker suiten.
- **Bevisst:** SP-feltnavn beholdes; «Rigg Andslimoen»-tekst beholdes.

## Forutsetninger
- `PublicBookingEnabled=Nei` under arbeidet. Ingen ekte privat-rader (Source trygt å endre).
