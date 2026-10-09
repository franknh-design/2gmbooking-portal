/* site.js v1.0 — språkbryter NO/EN for de offentlige informasjonssidene.
   Norsk står i HTML-en (det er den Google indekserer). Engelsk ligger i
   window.SITE_EN (per side) + COMMON under. Første bytte tar vare på den
   norske teksten, så man kan bytte fram og tilbake. Samme localStorage-nøkkel
   som /start og /company, så valget følger med mellom sidene. */
(function () {
  'use strict';
  var COMMON = {
    'nav.login': 'Customer login',
    'nav.call': '📞 +47 99 10 10 41',
    'foot.hours': 'Usually available weekdays 07:00–15:00',
    'foot.rigs': 'Our rigs',
    'cta.title': 'Need rooms for your crew?',
    'cta.text': 'Register your company and book in your own portal — or call us and we will sort it out.',
    'cta.register': 'Register company',
    'cta.call': 'Call +47 99 10 10 41',
    'crumb.back': '← All rigs',
    'per.night': 'per night',
    'checkout.fee': 'plus NOK 750 cleaning fee at check-out',
  };
  var EN = Object.assign({}, COMMON, window.SITE_EN || {});
  var nbCache = new Map();

  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'nb' || q === 'en') return q;
    try { var s = localStorage.getItem('entry_lang'); if (s === 'nb' || s === 'en') return s; } catch (e) {}
    return 'nb';
  }
  function apply(lang) {
    lang = lang === 'en' ? 'en' : 'nb';
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (!nbCache.has(el)) nbCache.set(el, el.innerHTML);
      if (lang === 'en' && EN[k] != null) el.innerHTML = EN[k];
      else el.innerHTML = nbCache.get(el);
    });
    if (window.SITE_TITLE) document.title = window.SITE_TITLE[lang] || document.title;
    document.querySelectorAll('#lang-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    try { localStorage.setItem('entry_lang', lang); } catch (e) {}
  }
  var t = document.getElementById('lang-toggle');
  if (t) t.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (b) apply(b.getAttribute('data-lang'));
  });
  apply(pickLang());

  // Privat booking-lenke vises bare når minst én rigg er åpen for privat booking.
  var pl = document.getElementById('private-link');
  if (pl) {
    fetch('/api/private-enabled')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.privateEnabled) pl.hidden = false; })
      .catch(function () {});
  }
})();
