# 2gm.no inngangsside (/start) — design

Dato: 2026-06-17. Repo: `2gmbooking-portal` (Cloudflare Pages).

## Mål

Én inngangsside for rombestilling på **2gm.no**. Når privat booking er aktiv → vis **Bedrift | Privat**-valg. Når privat er slått av → hopp rett til firma-siden (`/company`).

## Beslutninger (godkjent av Frank 2026-06-17)

- **Privat på/av = avledet** fra lokasjonene — ingen ny bryter. Privat er «på» hvis minst én eiendom har `PublicBookingEnabled=true` OG `PublicNightlyRate>0` (samme «åpen»-regel som `getPrivateConfig` og admin-bryteren). I dag = kun Andslimoen.
- **Egen frittstående side** `start.html` (URL `/start`). Token-innloggingen på `/` er uberørt. Frank peker domenet 2gm.no → /start (DNS/Cloudflare — hans del, utenfor scope).

## Komponenter

1. **`functions/_utils/availability-math.js`** — ny ren funksjon `isPrivateOpen(fields)` → `fields.PublicBookingEnabled === true && (Number(fields.PublicNightlyRate)||0) > 0`. Én sannhetskilde for «åpen»-regelen; brukes av både `getPrivateConfig` og den nye `isAnyPrivateEnabled`. Node-testbar.
2. **`functions/_utils/sharepoint.js`** — refaktorer `getPrivateConfig` til å bruke `isPrivateOpen`. Ny `isAnyPrivateEnabled(env)` → henter Properties (SELECT_PUBLIC_CONFIG) og returnerer `items.some(it => isPrivateOpen(it.fields||{}))`.
3. **`functions/api/private-enabled.js`** — `GET /api/private-enabled` → `{ privateEnabled: bool }` (200). Ved feil: 500 → frontend behandler det som «vis valget».
4. **`start.html`** — frittstående, tospråklig (NO/EN, samme bryter-mønster som /private og /company), inline stiler i 2GM-blå (#1B4F72). Innhold skjult til sjekken er ferdig (spinner).

## Flyt (start.html)

1. Last → vis spinner (innhold skjult) → `fetch('/api/private-enabled')`.
2. `ok && privateEnabled===true` → vis **Bedrift | Privat**-valg (to kort → `/company` og `/private`).
3. `ok && privateEnabled===false` → `location.replace('/company')` (ingen valg vises).
4. Fetch-feil / ikke-ok → vis valget (begge knapper). Begge målsidene håndterer egen åpen/stengt-tilstand, så ingen blindvei.

## Feilhåndtering

- Endepunkt fail-soft: ved Graph-feil returneres 500; frontend faller til «vis valget».
- `isPrivateOpen` håndterer manglende felt/rad (returnerer false).

## Test

- `isPrivateOpen` enhetstestes (`node --test`): enabled+rate>0 → true; enabled+rate=0 → false; disabled → false; tom/undefined → false.
- Manuell live: privat på → /start viser valget; slå av Andslimoen i admin → /start går rett til /company; gamle `?token=`-lenker på `/` uberørt.

## Ikke i scope

- DNS-peking av 2gm.no (Frank gjør).
- Lokasjonsvalg på /private (kun aktuelt ved flere private rigger senere).
- «Allerede bedriftskunde? logg inn»-lenke (mulig senere nicety).
