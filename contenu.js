/* =====================================================================
   NEXUS NUMÉRIQUE — Contenu du site piloté depuis l'application de gestion
   Textes principaux, actualités et questions fréquentes.
   SÉCURITÉ : tout est inséré comme TEXTE (jamais comme code). Si la base ne répond pas,
   le site garde les textes écrits dans index.html. Fichier nécessaire : gestion-config.js
   ===================================================================== */
(function () {
  'use strict';
  var C = window.NEXUS_CONFIG;
  if (!C || !C.SUPABASE_URL || !C.SUPABASE_KEY || !window.fetch) return;
  var BASE = C.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/';
  function call(fn) {
    return fetch(BASE + fn, { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { if (!r.ok) throw new Error(fn); return r.json(); });
  }
  function el(tag, txt) { var e = document.createElement(tag); if (txt != null) e.textContent = txt; return e; }
  function show(id) { var s = document.getElementById(id); if (s) s.hidden = false; }
  function showNav(id) { var a = document.getElementById(id); if (a) a.hidden = false; }
  function fr(d) { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } }

  call('public_site_content').then(function (rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach(function (r) {
      if (!r || typeof r.key !== 'string' || typeof r.value !== 'string' || !r.value.trim()) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-cms]'), function (n) {
        if (n.getAttribute('data-cms') === r.key) n.textContent = r.value;
      });
    });
  }).catch(function () { /* texte d'origine conservé */ });

  call('public_news').then(function (rows) {
    var box = document.getElementById('news-list');
    if (!box || !Array.isArray(rows)) return;
    rows = rows.filter(function (n) { return n && typeof n.title === 'string' && typeof n.body === 'string'; });
    if (!rows.length) return;
    rows.forEach(function (n) {
      var c = el('article'); c.className = 'news-card';
      var t = el('time', fr(n.published_at)); c.appendChild(t);
      c.appendChild(el('h3', n.title)); c.appendChild(el('p', n.body));
      box.appendChild(c);
    });
    show('actualites'); showNav('nav-news');
  }).catch(function () { /* section simplement cachée */ });

  call('public_faq').then(function (rows) {
    var box = document.getElementById('faq-list');
    if (!box || !Array.isArray(rows)) return;
    rows = rows.filter(function (q) { return q && typeof q.question === 'string' && typeof q.answer === 'string'; });
    if (!rows.length) return;
    rows.forEach(function (q) {
      var d = el('details'); d.appendChild(el('summary', q.question)); d.appendChild(el('p', q.answer)); box.appendChild(d);
    });
    show('faq'); showNav('nav-faq');
  }).catch(function () { /* section simplement cachée */ });
})();
