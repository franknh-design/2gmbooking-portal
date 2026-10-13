#!/usr/bin/env python3
"""Genererer stedssidene på www.2gm.no: /overnatting-bardufoss og /overnatting-finnsnes.

Kjør fra repo-rota:  python3 tools/site/gen_steder.py
Laget 13.10.2026 fordi Frank vil synes på søk som «overnatting Bardufoss»,
«boplass Bardufoss», «losji Finnsnes» osv. Søkeordene står i tittel, overskrift
og vanlig tekst — ikke gjentatt kunstig (Google straffer det). Bare bekreftede
fakta (se presentasjonene / memory 2gm-rigg-presentasjoner).

v1.2: tospråklig. All tekst er (norsk, engelsk)-par. Norsk står i HTML-en (det
Google indekserer); engelsk ligger i window.SITE_EN og byttes inn av
assets/js/site.js når man trykker EN — samme mønster som riggsidene.
"""
import html, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
e = html.escape
IMG = "/assets/img/company"

RIGS = {
    "botn": dict(name="Rigg Botnhågen", url="/rigg-botnhagen", addr="Industriveien 4, 9308 Finnsnes", price=450,
                 img=f"{IMG}/riggbotnhagen/outside.jpg", w=1600, h=2133, pos="center 60%",
                 facts=[("44 enkeltrom med eget bad og minikjøleskap", "44 single rooms with private bathroom and mini fridge"),
                        ("Felleskjøkken i hver etasje", "A shared kitchen on each floor"),
                        ("Vaskerom med vaskemaskiner og tørketromler", "Laundry room with washing machines and dryers"),
                        ("Wi-Fi i hele riggen", "Wi-Fi throughout the rig")]),
    "r24": dict(name="Rigg 24", url="/rigg-24", addr="Aspeveien 2, 9300 Finnsnes", price=350,
                img=f"{IMG}/rigg24/utvendig.jpg", w=1600, h=1200, pos=None,
                facts=[("24 enkeltrom med eget bad", "24 single rooms with private bathroom"),
                       ("Felleskjøkken for hele riggen", "Shared kitchen for the whole rig"),
                       ("Låst hovedinngang med egen kode", "Locked main entrance with its own code"),
                       ("Wi-Fi i hele riggen", "Wi-Fi throughout the rig")]),
    "andsl": dict(name="Rigg Andslimoen", url="/rigg-andslimoen", addr="Industriveien 22, 9325 Bardufoss", price=550,
                  img=f"{IMG}/andslimoen/utvendig.jpg", w=1600, h=1066, pos=None,
                  facts=[("52 enkeltrom med eget bad", "52 single rooms with private bathroom"),
                         ("Felleskjøkken i hver etasje, med egen kode", "A shared kitchen on each floor, with its own code"),
                         ("Låst hovedinngang med egen kode", "Locked main entrance with its own code"),
                         ("Wi-Fi i hele riggen", "Wi-Fi throughout the rig")]),
}

STEDER = [
    dict(
        slug="overnatting-bardufoss", sted="Bardufoss", kommune="Målselv", rigs=["andsl"],
        other=("/overnatting-finnsnes",
               ("Jobber dere på Senja? Vi har også to rigger på Finnsnes.", "Working on Senja? We also have two rigs in Finnsnes."),
               ("Se overnatting på Finnsnes →", "See accommodation in Finnsnes →")),
        title=("Overnatting og boplass på Bardufoss for arbeidere | 2GM Eiendom",
               "Worker accommodation in Bardufoss | 2GM Eiendom"),
        desc="Overnatting og boplass på Bardufoss: 52 enkeltrom med eget bad, felleskjøkken og Wi-Fi på Rigg Andslimoen. Losji for arbeidslag og innleide, korte og lange opphold. 550 kr per natt.",
        eyebrow=("Overnatting · boplass · losji · Bardufoss, Målselv", "Accommodation · crew housing · Bardufoss, Målselv"),
        h1=("Overnatting og boplass på Bardufoss", "Accommodation and crew housing in Bardufoss"),
        lead=("Trenger du et sted å bo på Bardufoss i forbindelse med jobb? Rigg Andslimoen i Industriveien 22 har 52 enkeltrom med eget bad, felleskjøkken og Wi-Fi – for én person eller hele arbeidslaget.",
              "Need a place to stay in Bardufoss for work? Rigg Andslimoen at Industriveien 22 has 52 single rooms with private bathrooms, shared kitchens and Wi-Fi – for one person or the whole crew."),
        body=[
            (("Rom til leie for arbeidere på Bardufoss", "Rooms for workers in Bardufoss"),
             ("<p>Rigg Andslimoen er bygget for folk som jobber i Målselv og trenger et praktisk sted å bo. Alle rommene er enkeltrom med eget bad, seng med sengetøy og digital dørlås. Hver etasje har sitt eget felleskjøkken med egen kode, så etasjene holdes adskilt.</p>"
              "<p>Det er Wi-Fi i hele riggen, og hovedinngangen er låst med egen kode. Rommene vaskes hver uke, med nye håndklær hver uke og nytt sengetøy annenhver uke.</p>",
              "<p>Rigg Andslimoen is built for people working in Målselv who need a practical place to stay. Every room is a single room with a private bathroom, a bed with bed linen and a digital door lock. Each floor has its own shared kitchen with its own code, keeping the floors separate.</p>"
              "<p>There is Wi-Fi throughout the rig, and the main entrance is locked with its own code. Rooms are cleaned every week, with fresh towels every week and fresh bed linen every other week.</p>")),
            (("Losji og innkvartering for hele laget", "Accommodation for the whole crew"),
             ("<p>Vi leier ut til firma som trenger boplass til egne ansatte, innleide eller underentreprenører. Firmaet får sin egen bestillingsportal der dere ser ledige rom, bestiller for hele laget og legger inn prosjektnummer for fakturaen.</p>"
              "<p>Hver gjest får sin egen dørkode på SMS før ankomst, så det er ingen nøkler å hente eller levere. Bekreftelsen kommer på e-post, på norsk eller engelsk.</p>",
              "<p>We rent to companies that need housing for their own staff, hired workers or subcontractors. Your company gets its own booking portal where you can see available rooms, book for the whole crew and add a project number for the invoice.</p>"
              "<p>Each guest gets their own door code by SMS before arrival, so there are no keys to collect or return. The confirmation comes by email, in English or Norwegian.</p>")),
            (("Korte og lange opphold", "Short and long stays"),
             ("<p>Dere kan leie rom for noen netter eller for flere måneder. Prisen er 550 kr per rom per natt, pluss 750 kr i utvask ved utreise. Innsjekk er fra kl. 15:00 og utsjekk innen kl. 12:00.</p>",
              "<p>You can rent rooms for a few nights or for several months. The price is NOK 550 per room per night, plus a NOK 750 cleaning fee at check-out. Check-in is from 15:00 and check-out before 12:00.</p>")),
            (("Trygt å bo", "Safe to stay"),
             ("<p>Brannvarslingsanlegget er koblet direkte til brannvesenet, og alle fellesområder har kameraovervåking.</p>",
              "<p>The fire alarm system is connected directly to the fire service, and all shared areas have camera surveillance.</p>")),
        ],
        faq_title=("Spørsmål og svar om overnatting på Bardufoss", "Questions and answers about accommodation in Bardufoss"),
        faq=[
            (("Hva koster overnatting på Bardufoss hos 2GM?", "550 kr per rom per natt, pluss 750 kr i utvask ved utreise."),
             ("How much does accommodation in Bardufoss cost with 2GM?", "NOK 550 per room per night, plus a NOK 750 cleaning fee at check-out.")),
            (("Har rommene eget bad?", "Ja. Alle de 52 rommene på Rigg Andslimoen er enkeltrom med eget bad."),
             ("Do the rooms have a private bathroom?", "Yes. All 52 rooms at Rigg Andslimoen are single rooms with a private bathroom.")),
            (("Kan vi lage mat selv?", "Ja. Hver etasje har sitt eget felleskjøkken, med egen kode."),
             ("Can we cook our own meals?", "Yes. Each floor has its own shared kitchen, with its own code.")),
            (("Hvordan får vi tilgang til rommet?", "Hver gjest får sin egen dørkode på SMS før ankomst. Det er ingen nøkler å hente."),
             ("How do we get into the room?", "Each guest gets their own door code by SMS before arrival. There are no keys to collect.")),
            (("Hvordan bestiller vi rom?", "Registrer firmaet på www.2gm.no/company, så får dere egen bestillingsportal. Dere kan også ringe Frank Haugan på +47 99 10 10 41."),
             ("How do we book rooms?", "Register your company at www.2gm.no/company and you will get your own booking portal. You can also call Frank Haugan on +47 99 10 10 41.")),
            (("Hvor ligger riggen?", "Rigg Andslimoen ligger i Industriveien 22, 9325 Bardufoss, i Målselv kommune."),
             ("Where is the rig?", "Rigg Andslimoen is at Industriveien 22, 9325 Bardufoss, in Målselv municipality.")),
        ],
    ),
    dict(
        slug="overnatting-finnsnes", sted="Finnsnes", kommune="Senja", rigs=["botn", "r24"],
        other=("/overnatting-bardufoss",
               ("Jobber dere i Målselv? Vi har også en rigg på Bardufoss.", "Working in Målselv? We also have a rig in Bardufoss."),
               ("Se overnatting på Bardufoss →", "See accommodation in Bardufoss →")),
        gallery=(("Slik bor dere på Rigg Botnhågen", "What it looks like at Rigg Botnhågen"), "/rigg-botnhagen",
                 ("Se mer om Rigg Botnhågen →", "See more about Rigg Botnhågen →"), [
            ("riggbotnhagen/rom.jpg", "Enkeltrom med seng, skrivebord og vindu", ("Enkeltrom", "Single room")),
            ("riggbotnhagen/bad.jpg", "Eget bad med dusj og toalett", ("Eget bad", "Private bathroom")),
            ("riggbotnhagen/kjokken.jpg", "Felleskjøkken med lang benk og spisebord", ("Felleskjøkken", "Shared kitchen")),
            ("riggbotnhagen/vaskerom.jpg", "Vaskerom med vaskemaskiner og tørketromler", ("Vaskerom", "Laundry room")),
        ]),
        title=("Overnatting og boplass på Finnsnes for arbeidere | 2GM Eiendom",
               "Worker accommodation in Finnsnes | 2GM Eiendom"),
        desc="Overnatting og boplass på Finnsnes: 68 enkeltrom med eget bad i to rigger – Rigg Botnhågen og Rigg 24. Losji for arbeidslag og innleide på Senja, korte og lange opphold. Fra 350 kr per natt.",
        eyebrow=("Overnatting · boplass · losji · Finnsnes, Senja", "Accommodation · crew housing · Finnsnes, Senja"),
        h1=("Overnatting og boplass på Finnsnes", "Accommodation and crew housing in Finnsnes"),
        lead=("Trenger du et sted å bo på Finnsnes i forbindelse med jobb? Vi har to rigger med til sammen 68 enkeltrom med eget bad, felleskjøkken og Wi-Fi – for én person eller hele arbeidslaget.",
              "Need a place to stay in Finnsnes for work? We have two rigs with a total of 68 single rooms with private bathrooms, shared kitchens and Wi-Fi – for one person or the whole crew."),
        body=[
            (("Rom til leie for arbeidere på Finnsnes", "Rooms for workers in Finnsnes"),
             ("<p><a href=\"/rigg-botnhagen\">Rigg Botnhågen</a> i Industriveien 4 har 44 enkeltrom med eget bad og minikjøleskap, felleskjøkken i hver etasje og eget vaskerom. "
              "<a href=\"/rigg-24\">Rigg 24</a> i Aspeveien 2 har 24 enkeltrom med eget bad, felleskjøkken og låst hovedinngang med egen kode.</p>"
              "<p>Begge riggene har Wi-Fi, seng med sengetøy og digital dørlås på alle rom. Rommene vaskes hver uke, med nye håndklær hver uke og nytt sengetøy annenhver uke.</p>",
              "<p><a href=\"/rigg-botnhagen\">Rigg Botnhågen</a> at Industriveien 4 has 44 single rooms with private bathrooms and mini fridges, a shared kitchen on each floor and its own laundry room. "
              "<a href=\"/rigg-24\">Rigg 24</a> at Aspeveien 2 has 24 single rooms with private bathrooms, a shared kitchen and a locked main entrance with its own code.</p>"
              "<p>Both rigs have Wi-Fi, a bed with bed linen and a digital door lock in every room. Rooms are cleaned every week, with fresh towels every week and fresh bed linen every other week.</p>")),
            (("Losji og innkvartering for hele laget", "Accommodation for the whole crew"),
             ("<p>Vi leier ut til firma som trenger boplass på Senja til egne ansatte, innleide eller underentreprenører. Firmaet får sin egen bestillingsportal der dere ser ledige rom, bestiller for hele laget og legger inn prosjektnummer for fakturaen.</p>"
              "<p>Hver gjest får sin egen dørkode på SMS før ankomst, så det er ingen nøkler å hente eller levere. Bekreftelsen kommer på e-post, på norsk eller engelsk.</p>",
              "<p>We rent to companies that need housing on Senja for their own staff, hired workers or subcontractors. Your company gets its own booking portal where you can see available rooms, book for the whole crew and add a project number for the invoice.</p>"
              "<p>Each guest gets their own door code by SMS before arrival, so there are no keys to collect or return. The confirmation comes by email, in English or Norwegian.</p>")),
            (("Korte og lange opphold", "Short and long stays"),
             ("<p>Dere kan leie rom for noen netter eller for flere måneder. Prisen er 450 kr per natt på Rigg Botnhågen og 350 kr per natt på Rigg 24, pluss 750 kr i utvask ved utreise. Innsjekk er fra kl. 15:00 og utsjekk innen kl. 12:00.</p>",
              "<p>You can rent rooms for a few nights or for several months. The price is NOK 450 per night at Rigg Botnhågen and NOK 350 per night at Rigg 24, plus a NOK 750 cleaning fee at check-out. Check-in is from 15:00 and check-out before 12:00.</p>")),
            (("Trygt å bo", "Safe to stay"),
             ("<p>Brannvarslingsanleggene er koblet direkte til brannvesenet, og alle fellesområder har kameraovervåking.</p>",
              "<p>The fire alarm systems are connected directly to the fire service, and all shared areas have camera surveillance.</p>")),
        ],
        faq_title=("Spørsmål og svar om overnatting på Finnsnes", "Questions and answers about accommodation in Finnsnes"),
        faq=[
            (("Hva koster overnatting på Finnsnes hos 2GM?", "450 kr per natt på Rigg Botnhågen og 350 kr per natt på Rigg 24, pluss 750 kr i utvask ved utreise."),
             ("How much does accommodation in Finnsnes cost with 2GM?", "NOK 450 per night at Rigg Botnhågen and NOK 350 per night at Rigg 24, plus a NOK 750 cleaning fee at check-out.")),
            (("Har rommene eget bad?", "Ja. Alle 68 rommene på begge riggene er enkeltrom med eget bad."),
             ("Do the rooms have a private bathroom?", "Yes. All 68 rooms at both rigs are single rooms with a private bathroom.")),
            (("Kan vi lage mat selv?", "Ja. Rigg Botnhågen har felleskjøkken i hver etasje, og Rigg 24 har felleskjøkken for hele riggen."),
             ("Can we cook our own meals?", "Yes. Rigg Botnhågen has a shared kitchen on each floor, and Rigg 24 has a shared kitchen for the whole rig.")),
            (("Kan vi vaske klær?", "Rigg Botnhågen har eget vaskerom med vaskemaskiner, tørketromler og tørkeskap."),
             ("Can we do laundry?", "Rigg Botnhågen has its own laundry room with washing machines, tumble dryers and a drying cabinet.")),
            (("Hvordan bestiller vi rom?", "Registrer firmaet på www.2gm.no/company, så får dere egen bestillingsportal. Dere kan også ringe Frank Haugan på +47 99 10 10 41."),
             ("How do we book rooms?", "Register your company at www.2gm.no/company and you will get your own booking portal. You can also call Frank Haugan on +47 99 10 10 41.")),
            (("Hvor ligger riggene?", "Rigg Botnhågen ligger i Industriveien 4, 9308 Finnsnes, og Rigg 24 i Aspeveien 2, 9300 Finnsnes – begge i Senja kommune."),
             ("Where are the rigs?", "Rigg Botnhågen is at Industriveien 4, 9308 Finnsnes, and Rigg 24 at Aspeveien 2, 9300 Finnsnes – both in Senja municipality.")),
        ],
    ),
]

HEADER = '''  <header class="site-header">
    <a href="/"><img class="brand-logo" src="/assets/img/2gm-logo.png" alt="2GM Eiendom" width="148" height="22"></a>
    <nav>
      <a class="login" href="/#allerede-kunde" data-i18n="nav.login">Kundeinnlogging</a>
      <div class="lang" id="lang-toggle">
        <button type="button" data-lang="nb">NO</button>
        <button type="button" data-lang="en">EN</button>
      </div>
    </nav>
  </header>
  <div class="contact-bar">
    <a href="tel:+4799101041">📞 +47 99 10 10 41</a>
    <a href="mailto:frank@2gm.no">✉️ frank@2gm.no</a>
  </div>'''

FOOTER = '''  <footer class="site-footer">
    <div class="inner">
      <div><b>2GM Eiendom AS</b><br>Org.nr. 922 263 418<br>Strandveien 112, 9300 Finnsnes</div>
      <div><b>Frank Haugan</b><br><a href="tel:+4799101041">+47 99 10 10 41</a> · <a href="mailto:frank@2gm.no">frank@2gm.no</a><br><span data-i18n="foot.hours">Normalt tilgjengelig hverdager kl. 07–15</span></div>
      <div><b data-i18n="foot.rigs">Våre rigger</b><br><a href="/rigg-botnhagen">Rigg Botnhågen</a> · <a href="/rigg-24">Rigg 24</a> · <a href="/rigg-andslimoen">Rigg Andslimoen</a><br><a href="/overnatting-finnsnes" data-i18n="foot.placeF">Overnatting Finnsnes</a> · <a href="/overnatting-bardufoss" data-i18n="foot.placeB">Overnatting Bardufoss</a></div>
    </div>
  </footer>'''


def page(s):
    url = f"https://www.2gm.no/{s['slug']}"
    rigs = [RIGS[k] for k in s["rigs"]]
    en = {"foot.placeF": "Accommodation Finnsnes", "foot.placeB": "Accommodation Bardufoss", "more": "Read more →"}

    def t(key, pair, tag_attrs=""):
        """Returnerer «data-i18n="key">norsk» og registrerer engelsk."""
        en[key] = pair[1]
        return f'data-i18n="{key}">{pair[0]}'

    def te(key, pair):
        """Som t(), men HTML-escaper teksten (for ren tekst)."""
        en[key] = e(pair[1])
        return f'data-i18n="{key}">{e(pair[0])}'

    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "inLanguage": "nb",
              "mainEntity": [{"@type": "Question", "name": q[0], "acceptedAnswer": {"@type": "Answer", "text": q[1]}}
                             for q, _ in s["faq"]]}
    crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "2GM Eiendom", "item": "https://www.2gm.no/"},
        {"@type": "ListItem", "position": 2, "name": s["h1"][0], "item": url}]}

    cards = []
    for ri, r in enumerate(rigs):
        pos = f' style="object-position:{r["pos"]}"' if r["pos"] else ""
        facts = "".join(f'<li {te(f"r{ri}f{fi}", f)}</li>' for fi, f in enumerate(r["facts"]))
        cards.append(f'<a class="rig-card" href="{r["url"]}"><img src="{r["img"]}" alt="{e(r["name"])} sett utenfra" width="{r["w"]}" height="{r["h"]}" loading="lazy"{pos}>'
                     f'<div class="body"><h3>{e(r["name"])}</h3><div class="addr">{e(r["addr"])}</div><ul class="facts">{facts}</ul>'
                     f'<div class="price">{r["price"]} kr <small data-i18n="per.night">per natt</small></div><span class="more" data-i18n="more">Les mer →</span></div></a>')

    body = "\n".join(f'      <h2 {te(f"b{i}h", h)}</h2>\n      <div {t(f"b{i}t", txt)}</div>' for i, (h, txt) in enumerate(s["body"]))
    faq = "\n".join(f'      <details><summary {te(f"q{i}", (q[0], qe[0]))}</summary><p {te(f"a{i}", (q[1], qe[1]))}</p></details>'
                    for i, (q, qe) in enumerate(s["faq"]))

    gal = ""
    if s.get("gallery"):
        g_title, g_url, g_more, g_imgs = s["gallery"]
        figs = "".join(f'<figure><img src="{IMG}/{src}" alt="{e(alt)}" loading="lazy"><figcaption {te(f"g{i}", cap)}</figcaption></figure>'
                       for i, (src, alt, cap) in enumerate(g_imgs))
        gal = (f'\n    <h2 style="margin-top:36px" {te("gT", g_title)}</h2>\n    <div class="photo-row">{figs}</div>'
               f'\n    <p class="note"><a href="{g_url}" {te("gM", g_more)}</a></p>')

    o_url, o_txt, o_link = s["other"]
    hero = rigs[0]
    hero_pos = f' style="object-position:{hero["pos"]}"' if hero["pos"] else ""
    grid_cls = " two" if len(rigs) == 2 else " one"  # klasser, ikke inline-stil — inline overstyrte mobil-oppsettet
    sted = s["sted"]

    main = f'''{HEADER}

  <section class="hero">
    <img src="{hero["img"]}" alt="" width="{hero["w"]}" height="{hero["h"]}"{hero_pos}>
    <div class="hero-inner">
      <p class="eyebrow" {te("eyebrow", s["eyebrow"])}</p>
      <h1 {te("h1", s["h1"])}</h1>
      <p class="lead" {te("lead", s["lead"])}</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="/company" data-i18n="cta.register">Registrer firma</a>
        <a class="btn btn-ghost" href="tel:+4799101041" data-i18n="cta.call">Ring +47 99 10 10 41</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="rig-grid{grid_cls}">
      {"".join(cards)}
    </div>{gal}
  </section>

  <section class="band">
    <div class="section prose">
{body}
    </div>
  </section>

  <section class="section">
    <div class="prose faq">
      <h2 style="margin-top:0" {te("faqT", s["faq_title"])}</h2>
{faq}
    </div>
    <p class="note"><span {te("oT", o_txt)}</span> <a href="{o_url}" {te("oL", o_link)}</a></p>

    <div class="cta" style="margin-top:28px">
      <div>
        <h2 {te("ctaT", (f"Trenger laget ditt rom på {sted}?", f"Does your crew need rooms in {sted}?"))}</h2>
        <p data-i18n="cta.text">Registrer firmaet og bestill i egen portal – eller ring oss, så ordner vi det.</p>
      </div>
      <div class="btn-row">
        <a class="btn btn-primary" href="/company" data-i18n="cta.register">Registrer firma</a>
        <a class="btn btn-ghost" href="tel:+4799101041" data-i18n="cta.call">Ring +47 99 10 10 41</a>
      </div>
    </div>
  </section>

{FOOTER}'''

    return f'''<!DOCTYPE html>
<!-- {s["slug"]} v1.2 — stedsside for www.2gm.no, generert av tools/site/gen_steder.py (ikke rediger for hånd) -->
<html lang="nb">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#1B4F72" />
  <title>{e(s["title"][0])}</title>
  <meta name="description" content="{e(s["desc"])}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{e(s["h1"][0])}" />
  <meta property="og:description" content="{e(s["desc"])}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="https://www.2gm.no{hero["img"]}" />
  <meta property="og:locale" content="nb_NO" />
  <link rel="stylesheet" href="/assets/css/site.css" />
  <script type="application/ld+json">
{json.dumps(faq_ld, ensure_ascii=False, indent=2)}
  </script>
  <script type="application/ld+json">
{json.dumps(crumb_ld, ensure_ascii=False, indent=2)}
  </script>
</head>
<body>
{main}

  <script>
    window.SITE_TITLE = {json.dumps({"nb": s["title"][0], "en": s["title"][1]}, ensure_ascii=False)};
    window.SITE_EN = {json.dumps(en, ensure_ascii=False, indent=2)};
  </script>
  <script src="/assets/js/site.js"></script>
</body>
</html>
'''


for s in STEDER:
    p = os.path.join(ROOT, s["slug"] + ".html")
    open(p, "w").write(page(s))
    print("ok", p)
