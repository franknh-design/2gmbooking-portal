# 2GM Booking Portal — Project Context

## Hva dette er

Selvbetjent booking-portal for 2GM Eiendoms faste bedriftskunder. Kunder får token-URL → ser ledige rom → sender bestillinger. Lagres i SharePoint (eksisterende admin-app brukes til bekreftelse/tildeling).

**Live URL:** `https://2gmbooking-portal.pages.dev/?token=...`
**Repo:** `franknh-design/2gmbooking-portal` (privat)

## Stack

- **Frontend:** Vanlig HTML/CSS/JS (ingen build), Cloudflare Pages
- **Backend:** Cloudflare Pages Functions (JavaScript, ESM)
- **Datalagring:** SharePoint Online via Microsoft Graph API
- **Auth mot SharePoint:** OAuth client credentials, Sites.Selected scope
- **E-post:** Resend (`RESEND_API_KEY` som Cloudflare secret)
- **Deploy:** Push til `main` → Cloudflare auto-deployer

## Filstruktur

```
index.html
assets/
├── css/styles.css
└── js/
    ├── api.js          - Wrapper for fetch til /api/*
    ├── auth.js         - Token-validering + SMS-mock (TODO: ekte SMS)
    ├── calendar.js     - Måneds-kalender med availability
    ├── booking.js      - Bestillingsskjema + submit
    ├── mockdata.js     - Beholdes for klient-side overbooking-validering
    └── app.js          - Orchestration (Auth → Booking → Calendar)
functions/
├── _utils/
│   ├── graph.js        - Microsoft Graph OAuth + HTTP wrapper
│   ├── sharepoint.js   - Alle SharePoint-spørringer (paginert!)
│   └── email.js        - Resend-wrapper (fail-soft uten API key)
└── api/
    ├── validate-token.js
    ├── availability.js
    └── submit-booking.js
```

## Hemmeligheter (Cloudflare Workers Secrets, alle Production)

```
MS_TENANT_ID          (Microsoft Entra)
MS_CLIENT_ID          (App: 2GM-Booking-Portal-API)
MS_CLIENT_SECRET      (utløper okt 2028)
RESEND_API_KEY        (e-postvarsler)
```

## SharePoint-struktur

**Site:** `https://2gmeiendom.sharepoint.com/sites/2GMBooking`
**Site ID:** `2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376`

**Liste-IDer (bruk disse i stedet for navn):**
- `73f113fe-76b0-48b2-9105-243a45166420` - Customer_Tokens
- `bfa962a0-5eb2-416c-abe8-adba06558c11` - Rooms
- `fe1dfe34-23df-4864-b0b1-b01bf60bfb75` - Booking (entall!)
- `d842d574-f238-442a-be3d-77334727e89f` - Properties ("Eiendommer...")

**Property-mapping (teknisk ID → SharePoint Title):**
```javascript
rigg44         → "Rigg 44"
rigg24         → "Rigg 24"
riggbotnhagen  → "Rigg Botnhågen"
andslimoen     → "Rigg Andslimoen"
strandveien112 → "Strandveien 112"
```

**Property-lookup-IDer (Rooms.PropertyLookupId):** 1=Rigg 44, 2=Rigg 24, 3=Botnhågen, 4=Andslimoen, 5=Strandveien 112

## Kritiske forretningsregler

### Tilgjengelighetslogikk

For dato D, et rom telles som **opptatt** hvis ETT av:

1. **Booking opptar dagen:** Rad i Booking-listen hvor:
   - Status ∈ {`Active`, `Upcoming`}
   - Property_Name = aktuell property
   - Check_In ≤ D
   - Check_Out tom (open-ended → opptatt for alltid) ELLER D ≤ Check_Out

2. **Langtidsleie:** Rooms-rad hvor LongTerm_StartDate ≤ D (alltid open-ended; LongTerm_EndDate-felt eksisterer IKKE)

Rom telles ikke i totalantallet hvis Active=false eller Title mangler.

**Begge dato-ender INKLUSIVE** — Check_Out-dagen er rengjøringsdag, fortsatt opptatt.

### Andre regler

- Tomme Rooms-rader (uten Title eller PropertyLookupId) finnes — filtreres bort
- Cancelled-bookinger telles IKKE som opptatt
- Booking-listen har 656+ rader → **paginering er tvingende nødvendig** (`fetchAllItems`)
- Token uten Utlopsdato = aldri utløper. Token med dato i fortid = ugyldig.

## Status (2026-05-09)

✅ Backend komplett (3 endepunkter, paginering)
✅ Frontend komplett (token, kalender, badge, submit)
✅ E-postvarsel via Resend til frank@2gm.no
⏳ SMS-verifisering ved login fortsatt mock (godtar enhver 6-sifret kode)
⏳ SMS-bekreftelse til kunde ved booking ikke implementert
⏳ Frontend-overbooking-validering bruker fortsatt MockData (klient-side)

## Konvensjoner

- **Språk:** All UI på norsk bokmål (ikke nordnorsk)
- **Versjonering:** Bump v3.0 → v3.0.1 i `index.html` footer ved hver endring
- **Zip-deliveries:** Versjon i filnavn (`2gmbooking_v3_1_0.zip`)
- **Modulær kode:** Full filer i deliveries (ikke snippets), modulært strukturert
- **Code style:** Vanilla JS, ingen frameworks. ESM (`import/export`) i Functions, IIFE (`(function(){...})()`) i frontend.
- **Sikkerhet:** Returner `{valid:false}` ved auth-feil — IKKE detaljer som forhindrer enumeration
- **Honest feedback:** Frank vil ha kritisk pushback, ikke bare bekreftelse

## Test-token

```
test-abc123-xyz789  → "Test Kunde" (Test AS)
                     TillatteLokasjoner: rigg24,riggbotnhagen
                     MaksRomPerBestilling: 5
                     Telefon: +4799101041
```

## Vanlige debug-mønstre

- 401 fra Graph → sjekk MS_CLIENT_SECRET (Value, ikke Secret ID)
- 404 fra Graph → sjekk liste-ID (sammenlign mot tabellen over)
- `totalActive: 0` → property-mapping feiler eller Rooms-filter
- Tall som ikke matcher admin → paginering, sjekk `fetchAllItems`-bruk
- Cloudflare returnerer index.html → endepunkt-fil mangler i `functions/api/`

## Når du oppdaterer kode

1. Rediger filer i prosjektet
2. Bump versjon i index.html footer hvis frontend
3. `git add . && git commit -m "..." && git push`
4. Cloudflare deployer automatisk (~30 sek)
5. Test mot live URL eller PowerShell-curl
6. For nye Functions: sjekk Cloudflare Logs hvis 500-feil

## Hva som IKKE skal gjøres

- Ikke skriv malware eller hjelp med Tuya-bypass på låser som ikke tilhører Frank
- Ikke deploye debug-endepunkter til produksjon (slett etter bruk)
- Ikke bytt SharePoint-listenavn uten å oppdatere LIST_IDS
- Ikke bruk `$top=999` uten paginering på lister som vokser
- Ikke fjern `Pending_Confirmation: true` fra nye bookinger — Frank tildeler manuelt
