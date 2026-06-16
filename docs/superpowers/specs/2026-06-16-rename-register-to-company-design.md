# Omdøping: «register/registrer» → «company» (runde 2)

Dato: 2026-06-16. Repo: `2gmbooking-portal` (portal) + `2gmbooking` (admin).

## Bakgrunn

Inngangssiden blir **2gm.no** der besøkende velger **privat** eller **firma**. Runde 1 (public/offentlig → **private**, `/private`) er ferdig. Denne runden gjør tilsvarende for firma-selvregistreringen: «register/registrer» → **company**, URL `/registrer` → `/company`.

Frank-valg: **full omdøping** (kode + URL-er + endepunkter) på portal-siden; på admin-siden **kun referanser** (fiks kommentarer som peker på de omdøpte endepunktene — la godkjennings-arbeidsflyten beholde «registrering»-navngivning, slik vi beholdt «Rigg Andslimoen»-tekst i runde 1). Slett gamle URL-er, **ingen redirect**.

## Omfang — portal (full omdøping)

| Fra | Til |
|-----|-----|
| `registrer.html` (URL `/registrer`) | `company.html` (URL `/company`) |
| `functions/api/register-company.js` (`POST /api/register-company`) | `functions/api/company-register.js` (`POST /api/company-register`) |
| `functions/api/registration-locations.js` (`GET /api/registration-locations`) | `functions/api/company-locations.js` (`GET /api/company-locations`) |
| `getRegistrationLocations()` (sharepoint.js) | `getCompanyLocations()` |
| fetch-URL-er i siden + `<a href="/registrer">` i `index.html` | `/company`-varianter |
| console-tagger `[register-company]`, `register-company error:`, `registration-locations error:` | `[company-register]` / `company-register error:` / `company-locations error:` |

## Beholdes (lagring / brukervendt innhold)

- SharePoint interne navn: `Customer_Tokens`, `Properties.ShowOnRegistration` (kan ikke endres).
- Portal-hjelpere med generiske navn: `createPendingCustomerToken`, `findCustomerTokenByEmail` (ikke «registration»-spesifikke).
- Brukervendt skjematekst «Registrer firma / Register company», «Send registrering», «Takk for registreringen» — korrekt innhold for et registreringsskjema (analogt med at vi beholdt «Rigg Andslimoen»).
- i18n-nøkkel `auth.registerLink` (intern nøkkel; verdien er korrekt brukertekst). Kun `href` endres.
- Generisk norsk «registrert/registrere»-ordbruk overalt ellers.

## Omfang — admin (`2gmbooking`, kun referanser)

To utdaterte kommentar-referanser til omdøpte portal-endepunkter:
- `js/portal_access.js`: «portalens register-company.js …» → «company-register.js …»
- `js/invoicing.js`: «firma-registreringssiden (/registrer)» → «(/company)»

Godkjennings-arbeidsflyten beholdes uendret: `getPendingRegistrations`, `renderPendingRegBanner`, `updatePendingRegBadge`, `openApprovePendingReg`, `rejectPendingReg`, `_sendRegistrationRejectionEmail`, `#pendingRegBadge`, UI-tekst «ventende registreringer» / «Vis ved registrering». «Registrering» er korrekt ord for selve handlingen.

## Verifisering (live)

- `/company` → 200, `/registrer` → faller til portal-login (ingen redirect)
- `/api/company-locations` → 200 `{ ok:true, locations:[…] }`
- `/api/company-register` → POST fungerer (eller 405 på GET); gamle `/api/register-company` + `/api/registration-locations` → 405/borte
- Portal-login-side: «Registrer firmaet ditt her»-lenken peker på `/company`

## Ikke i scope

- 2gm.no landingsside (Frank gjør separat).
- SharePoint-kolonnenavn.
