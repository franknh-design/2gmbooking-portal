#!/usr/bin/env python3
"""Genererer stedssidene på www.2gm.no: /overnatting-bardufoss og /overnatting-finnsnes.

Kjør fra repo-rota:  python3 tools/site/gen_steder.py
Laget 13.10.2026 fordi Frank vil synes på søk som «overnatting Bardufoss»,
«boplass Bardufoss», «losji Finnsnes» osv. Søkeordene står i tittel, overskrift
og vanlig tekst — ikke gjentatt kunstig (Google straffer det). Bare bekreftede
fakta (se presentasjonene / memory 2gm-rigg-presentasjoner).
"""
import html, json, os, urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
e = html.escape
IMG = "/assets/img/company"

RIGS = {
    "botn": dict(name="Rigg Botnhågen", url="/rigg-botnhagen", addr="Industriveien 4, 9308 Finnsnes", rooms=44, price=450,
                 img=f"{IMG}/riggbotnhagen/outside.jpg", w=1600, h=2133, pos="center 60%",
                 facts=["44 enkeltrom med eget bad og minikjøleskap", "Felleskjøkken i hver etasje",
                        "Vaskerom med vaskemaskiner og tørketromler", "Wi-Fi i hele riggen"]),
    "r24": dict(name="Rigg 24", url="/rigg-24", addr="Aspeveien 2, 9300 Finnsnes", rooms=24, price=350,
                img=f"{IMG}/rigg24/utvendig.jpg", w=1600, h=1200, pos=None,
                facts=["24 enkeltrom med eget bad", "Felleskjøkken for hele riggen",
                       "Låst hovedinngang med egen kode", "Wi-Fi i hele riggen"]),
    "andsl": dict(name="Rigg Andslimoen", url="/rigg-andslimoen", addr="Industriveien 22, 9325 Bardufoss", rooms=52, price=550,
                  img=f"{IMG}/andslimoen/utvendig.jpg", w=1600, h=1066, pos=None,
                  facts=["52 enkeltrom med eget bad", "Felleskjøkken i hver etasje, med egen kode",
                         "Låst hovedinngang med egen kode", "Wi-Fi i hele riggen"]),
}

STEDER = [
    dict(
        slug="overnatting-bardufoss", sted="Bardufoss", kommune="Målselv", rigs=["andsl"],
        other=("Finnsnes", "/overnatting-finnsnes", "Jobber dere på Senja? Vi har også to rigger på Finnsnes."),
        title="Overnatting og boplass på Bardufoss for arbeidere | 2GM Eiendom",
        desc="Overnatting og boplass på Bardufoss: 52 enkeltrom med eget bad, felleskjøkken og Wi-Fi på Rigg Andslimoen. Losji for arbeidslag og innleide, korte og lange opphold. 550 kr per natt.",
        h1="Overnatting og boplass på Bardufoss",
        lead="Trenger du et sted å bo på Bardufoss i forbindelse med jobb? Rigg Andslimoen i Industriveien 22 har 52 enkeltrom med eget bad, felleskjøkken og Wi-Fi – for én person eller hele arbeidslaget.",
        body=[
            ("Rom til leie for arbeidere på Bardufoss",
             "<p>Rigg Andslimoen er bygget for folk som jobber i Målselv og trenger et praktisk sted å bo. Alle rommene er enkeltrom med eget bad, seng med sengetøy og digital dørlås. Hver etasje har sitt eget felleskjøkken med egen kode, så etasjene holdes adskilt.</p>"
             "<p>Det er Wi-Fi i hele riggen, og hovedinngangen er låst med egen kode. Rommene vaskes hver uke, med nye håndklær hver uke og nytt sengetøy annenhver uke.</p>"),
            ("Losji og innkvartering for hele laget",
             "<p>Vi leier ut til firma som trenger boplass til egne ansatte, innleide eller underentreprenører. Firmaet får sin egen bestillingsportal der dere ser ledige rom, bestiller for hele laget og legger inn prosjektnummer for fakturaen.</p>"
             "<p>Hver gjest får sin egen dørkode på SMS før ankomst, så det er ingen nøkler å hente eller levere. Bekreftelsen kommer på e-post, på norsk eller engelsk.</p>"),
            ("Korte og lange opphold",
             "<p>Dere kan leie rom for noen netter eller for flere måneder. Prisen er 550 kr per rom per natt, pluss 750 kr i utvask ved utreise. Innsjekk er fra kl. 15:00 og utsjekk innen kl. 12:00.</p>"),
            ("Trygt å bo",
             "<p>Brannvarslingsanlegget er koblet direkte til brannvesenet, og alle fellesområder har kameraovervåking.</p>"),
        ],
        faq=[
            ("Hva koster overnatting på Bardufoss hos 2GM?", "550 kr per rom per natt, pluss 750 kr i utvask ved utreise."),
            ("Har rommene eget bad?", "Ja. Alle de 52 rommene på Rigg Andslimoen er enkeltrom med eget bad."),
            ("Kan vi lage mat selv?", "Ja. Hver etasje har sitt eget felleskjøkken, med egen kode."),
            ("Hvordan får vi tilgang til rommet?", "Hver gjest får sin egen dørkode på SMS før ankomst. Det er ingen nøkler å hente."),
            ("Hvordan bestiller vi rom?", "Registrer firmaet på www.2gm.no/company, så får dere egen bestillingsportal. Dere kan også ringe Frank Haugan på +47 99 10 10 41."),
            ("Hvor ligger riggen?", "Rigg Andslimoen ligger i Industriveien 22, 9325 Bardufoss, i Målselv kommune."),
        ],
    ),
    dict(
        slug="overnatting-finnsnes", sted="Finnsnes", kommune="Senja", rigs=["botn", "r24"],
        other=("Bardufoss", "/overnatting-bardufoss", "Jobber dere i Målselv? Vi har også en rigg på Bardufoss."),
        title="Overnatting og boplass på Finnsnes for arbeidere | 2GM Eiendom",
        desc="Overnatting og boplass på Finnsnes: 68 enkeltrom med eget bad i to rigger – Rigg Botnhågen og Rigg 24. Losji for arbeidslag og innleide på Senja, korte og lange opphold. Fra 350 kr per natt.",
        h1="Overnatting og boplass på Finnsnes",
        lead="Trenger du et sted å bo på Finnsnes i forbindelse med jobb? Vi har to rigger med til sammen 68 enkeltrom med eget bad, felleskjøkken og Wi-Fi – for én person eller hele arbeidslaget.",
        body=[
            ("Rom til leie for arbeidere på Finnsnes",
             "<p><a href=\"/rigg-botnhagen\">Rigg Botnhågen</a> i Industriveien 4 har 44 enkeltrom med eget bad og minikjøleskap, felleskjøkken i hver etasje og eget vaskerom. "
             "<a href=\"/rigg-24\">Rigg 24</a> i Aspeveien 2 har 24 enkeltrom med eget bad, felleskjøkken og låst hovedinngang med egen kode.</p>"
             "<p>Begge riggene har Wi-Fi, seng med sengetøy og digital dørlås på alle rom. Rommene vaskes hver uke, med nye håndklær hver uke og nytt sengetøy annenhver uke.</p>"),
            ("Losji og innkvartering for hele laget",
             "<p>Vi leier ut til firma som trenger boplass på Senja til egne ansatte, innleide eller underentreprenører. Firmaet får sin egen bestillingsportal der dere ser ledige rom, bestiller for hele laget og legger inn prosjektnummer for fakturaen.</p>"
             "<p>Hver gjest får sin egen dørkode på SMS før ankomst, så det er ingen nøkler å hente eller levere. Bekreftelsen kommer på e-post, på norsk eller engelsk.</p>"),
            ("Korte og lange opphold",
             "<p>Dere kan leie rom for noen netter eller for flere måneder. Prisen er 450 kr per natt på Rigg Botnhågen og 350 kr per natt på Rigg 24, pluss 750 kr i utvask ved utreise. Innsjekk er fra kl. 15:00 og utsjekk innen kl. 12:00.</p>"),
            ("Trygt å bo",
             "<p>Brannvarslingsanleggene er koblet direkte til brannvesenet, og alle fellesområder har kameraovervåking.</p>"),
        ],
        faq=[
            ("Hva koster overnatting på Finnsnes hos 2GM?", "450 kr per natt på Rigg Botnhågen og 350 kr per natt på Rigg 24, pluss 750 kr i utvask ved utreise."),
            ("Har rommene eget bad?", "Ja. Alle 68 rommene på begge riggene er enkeltrom med eget bad."),
            ("Kan vi lage mat selv?", "Ja. Rigg Botnhågen har felleskjøkken i hver etasje, og Rigg 24 har felleskjøkken for hele riggen."),
            ("Kan vi vaske klær?", "Rigg Botnhågen har eget vaskerom med vaskemaskiner, tørketromler og tørkeskap."),
            ("Hvordan bestiller vi rom?", "Registrer firmaet på www.2gm.no/company, så får dere egen bestillingsportal. Dere kan også ringe Frank Haugan på +47 99 10 10 41."),
            ("Hvor ligger riggene?", "Rigg Botnhågen ligger i Industriveien 4, 9308 Finnsnes, og Rigg 24 i Aspeveien 2, 9300 Finnsnes – begge i Senja kommune."),
        ],
    ),
]

HEADER = '''  <header class="site-header">
    <a href="/"><img class="brand-logo" src="/assets/img/2gm-logo.png" alt="2GM Eiendom" width="148" height="22"></a>
    <nav><a class="login" href="/#allerede-kunde">Kundeinnlogging</a></nav>
  </header>
  <div class="contact-bar">
    <a href="tel:+4799101041">📞 +47 99 10 10 41</a>
    <a href="mailto:frank@2gm.no">✉️ frank@2gm.no</a>
  </div>'''

FOOTER = '''  <footer class="site-footer">
    <div class="inner">
      <div><b>2GM Eiendom AS</b><br>Org.nr. 922 263 418<br>Strandveien 112, 9300 Finnsnes</div>
      <div><b>Frank Haugan</b><br><a href="tel:+4799101041">+47 99 10 10 41</a> · <a href="mailto:frank@2gm.no">frank@2gm.no</a><br>Normalt tilgjengelig hverdager kl. 07–15</div>
      <div><b>Våre rigger</b><br><a href="/rigg-botnhagen">Rigg Botnhågen</a> · <a href="/rigg-24">Rigg 24</a> · <a href="/rigg-andslimoen">Rigg Andslimoen</a><br><a href="/overnatting-finnsnes">Overnatting Finnsnes</a> · <a href="/overnatting-bardufoss">Overnatting Bardufoss</a></div>
    </div>
  </footer>'''


def card(r):
    pos = f' style="object-position:{r["pos"]}"' if r["pos"] else ""
    facts = "".join(f"<li>{e(f)}</li>" for f in r["facts"])
    return (f'<a class="rig-card" href="{r["url"]}"><img src="{r["img"]}" alt="{e(r["name"])} sett utenfra" width="{r["w"]}" height="{r["h"]}" loading="lazy"{pos}>'
            f'<div class="body"><h3>{e(r["name"])}</h3><div class="addr">{e(r["addr"])}</div><ul class="facts">{facts}</ul>'
            f'<div class="price">{r["price"]} kr <small>per natt</small></div><span class="more">Les mer →</span></div></a>')


def page(s):
    url = f"https://www.2gm.no/{s['slug']}"
    rigs = [RIGS[k] for k in s["rigs"]]
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in s["faq"]]}
    crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "2GM Eiendom", "item": "https://www.2gm.no/"},
        {"@type": "ListItem", "position": 2, "name": s["h1"], "item": url}]}
    body = "\n".join(f"      <h2>{e(h)}</h2>\n      {t}" for h, t in s["body"])
    faq = "\n".join(f"      <details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in s["faq"])
    grid_style = ' style="grid-template-columns:repeat(2,1fr)"' if len(rigs) == 2 else ' style="grid-template-columns:minmax(0,420px)"'
    o_name, o_url, o_txt = s["other"]
    hero = rigs[0]
    hero_pos = f' style="object-position:{hero["pos"]}"' if hero["pos"] else ""
    return f'''<!DOCTYPE html>
<!-- {s["slug"]} v1.0 — stedsside for www.2gm.no, generert av tools/site/gen_steder.py (ikke rediger for hånd) -->
<html lang="nb">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#1B4F72" />
  <title>{e(s["title"])}</title>
  <meta name="description" content="{e(s["desc"])}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{e(s["h1"])}" />
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
{HEADER}

  <section class="hero">
    <img src="{hero["img"]}" alt="" width="{hero["w"]}" height="{hero["h"]}"{hero_pos}>
    <div class="hero-inner">
      <p class="eyebrow">Overnatting · boplass · losji · {e(s["sted"])}, {e(s["kommune"])}</p>
      <h1>{e(s["h1"])}</h1>
      <p class="lead">{e(s["lead"])}</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="/company">Registrer firma</a>
        <a class="btn btn-ghost" href="tel:+4799101041">Ring +47 99 10 10 41</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="rig-grid"{grid_style}>
      {"".join(card(r) for r in rigs)}
    </div>
  </section>

  <section class="band">
    <div class="section prose">
{body}
    </div>
  </section>

  <section class="section">
    <div class="prose faq">
      <h2 style="margin-top:0">Spørsmål og svar om overnatting på {e(s["sted"])}</h2>
{faq}
    </div>
    <p class="note">{e(o_txt)} <a href="{o_url}">Se overnatting på {e(o_name)} →</a></p>

    <div class="cta" style="margin-top:28px">
      <div>
        <h2>Trenger laget ditt rom på {e(s["sted"])}?</h2>
        <p>Registrer firmaet og bestill i egen portal – eller ring oss, så ordner vi det.</p>
      </div>
      <div class="btn-row">
        <a class="btn btn-primary" href="/company">Registrer firma</a>
        <a class="btn btn-ghost" href="tel:+4799101041">Ring +47 99 10 10 41</a>
      </div>
    </div>
  </section>

{FOOTER}
</body>
</html>
'''


for s in STEDER:
    p = os.path.join(ROOT, s["slug"] + ".html")
    open(p, "w").write(page(s))
    print("ok", p)
