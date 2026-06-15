# Andslimoen offentlig booking — Fase 4c: Redigerbare løsøre-priser (design)

Dato: 2026-06-15
Status: Godkjent design, klar for implementeringsplan
Bygger på: Fase 4a (deposit.js, charge-missing-items) + Fase 4b (admin charge-knapp). Spenner over TO repo.

## Mål

Gjøre prislisten for manglende/ødelagt løsøre (liten/stor håndduk, pute, dyne, sengesett) **redigerbar fra admin** i stedet for hardkodet. Én global prisliste (samme overalt), lest autoritativt av portalens charge-endepunkt og vist i admin-dialogen.

## Bakgrunn

Fase 4a la prislisten som en hardkodet konstant (`PRICE_LIST` i `functions/_utils/deposit.js`, dupliert i admin `deposit_charge.js`). Frank vil justere prisene uten kodeendring — på linje med hvordan Portal-booking-fanen (`renderPortalPricing` i admin `invoicing.js`) allerede styrer av/på + nattpris per rigg via `updateListItem`.

## Lagring — ny SharePoint-liste `Deposit_Prices`

- **Liste-GUID:** `2790650c-bbdb-448b-b1e4-548146a229d8` (opprettet av Frank).
- **Kolonner:** `Title` (tekst — vare-nøkkel) + `Price` (tall).
- **5 rader (global prisliste):**
  | Title | Price |
  |---|---|
  | liten_handduk | 100 |
  | stor_handduk | 150 |
  | pute | 400 |
  | dyne | 700 |
  | sengesett | 400 |
- Labels (norske visningsnavn) blir værende i koden, keyet på `Title`-nøkkelen — kun prisene er data.

## Portal-side (`2gmbooking-portal`)

- **Ny `getDepositPrices(env)`** i `sharepoint.js`: leser `Deposit_Prices` → pris-map `{ liten_handduk: 100, ... }`. Ukjente/tomme priser hoppes over.
- **`sumMissingItems(items, priceMap)`** (`deposit.js`) endres til å ta pris-mappet som argument (forblir RENT + enhetstestbart). Validerer at hvert item finnes i mappet (ukjent → feil), summerer. «Taket» = summen av alle prisene i mappet (dynamisk; ingen fast `MAX_DEPOSIT`-konstant lenger). `deposit.js` beholder de 5 kjente nøklene (`ITEM_KEYS`) for validering/label-referanse.
- **`/api/charge-missing-items`** henter prisene (`getDepositPrices(env)`) og sender `priceMap` inn i `sumMissingItems`. Resten (auth, off-session-belastning, idempotency) uendret.

## Admin-side (`2gmbooking`)

- **Portal-booking-fanen** (`renderPortalPricing`, `invoicing.js`): ny «Løsøre-priser»-seksjon under rigg-tabellen. 5 redigerbare pris-inputs (mirror nattpris-inputen) som skriver til `Deposit_Prices` via `updateListItem('Deposit_Prices', rowId, { Price })`. Leser nåværende priser via `getListItems('Deposit_Prices')`.
- **Charge-dialogen** (`deposit_charge.js`): leser de live prisene (via Graph `getListItems('Deposit_Prices')`) i stedet for hardkodet `DEPOSIT_PRICE_LIST`, så løpende sum stemmer med det portalen faktisk belaster. (Beløpet er uansett server-autoritativt; dialogen er kun visning.)

## Vilkår

Vilkårssiden (`andslimoen-vilkar.html`) endres fra fast prisliste/«inntil 1750 kr» til: «manglende/ødelagt utstyr belastes per gjeldende prisliste». (Prisene er nå redigerbare, så et fast kronebeløp i vilkår ville gå ut på dato. Alternativt kan siden hente prisene live — men statisk «per gjeldende prisliste» er enklest for v1.)

## Datamodell

- **`Deposit_Prices`** (ny liste, GUID over): `Title` (vare-nøkkel) + `Price` (tall), 5 rader.
- Portal `LIST_IDS` får `DEPOSIT_PRICES: "2790650c-bbdb-448b-b1e4-548146a229d8"`.

## Feilhåndtering

- **Pris mangler/0:** hvis en vare mangler i `Deposit_Prices` (eller pris 0), behandler `getDepositPrices` den som fraværende → `sumMissingItems` avviser items uten gyldig pris (`unknown_item`). Charge-endepunktet returnerer 400. (Frank holder lista komplett.)
- **Tom liste / lesefeil:** `getDepositPrices` returnerer tomt map → all charge avvises (fail-closed; ingen belastning til feil pris).
- Admin-redigering: `updateListItem`-feil vises som i resten av Portal-booking-fanen.

## Testing

- **Portal (`node --test`):** `sumMissingItems(items, priceMap)` med injisert pris-map — kjente items summeres, ukjent/manglende pris avvises, tom map → avvist, tak = sum av mappet. (Oppdaterer eksisterende `deposit.test.mjs`.)
- **Admin:** manuelt/live (rediger pris → reflekteres i dialogens sum + i charge-beløpet).
- **Live (Stripe testmodus):** del av den utsatte samlede live-testen.

## Forutsetninger

- `Deposit_Prices`-lista opprettet (GUID `2790650c-bbdb-448b-b1e4-548146a229d8`) med `Price`-tallkolonne + de 5 radene.
- Fase 4a/4b kode deployet.

## Utenfor Fase 4c

- Per-rigg løsøre-priser (valgt globalt i v1).
- Live-vilkårsside som henter priser dynamisk (statisk «per prisliste» i v1).
- «Annet beløp»/fritekst-vare.
