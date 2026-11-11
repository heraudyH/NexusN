/* =====================================================================
   NEXUS NUMÉRIQUE — Les pôles du site public, pilotés depuis l'application de gestion
   - pôle ACTIF   : carte complète, formulaires et boutons liés visibles
   - pôle BIENTÔT : carte discrète « Bientôt », sans bouton
   - pôle EN VEILLE : invisible partout (carte, schéma, menu, boutons, liste du devis)
   SÉCURITÉ : si la base ne répond pas ou renvoie une liste vide, RIEN ne change :
   le site garde le contenu écrit dans index.html. Fichier nécessaire : gestion-config.js
   ===================================================================== */
(function () {
  'use strict';
  var C = window.NEXUS_CONFIG;
  if (!C || !C.SUPABASE_URL || !C.SUPABASE_KEY || !window.fetch) return;
  var BASE = C.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/';
  var NUMS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
  var SVG_SLUGS = ['numerique', 'communication', 'agriculture', 'environnement', 'batiment'];

  function $(id) { return document.getElementById(id); }
  function call(fn) {
    return fetch(BASE + fn, { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { if (!r.ok) throw new Error(fn); return r.json(); });
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function validPole(p) {
    return p && typeof p.slug === 'string' && typeof p.name === 'string' && p.name &&
      (p.status === 'actif' || p.status === 'bientot') && /^#[0-9a-fA-F]{6}$/.test(p.accent || '');
  }
  function hideSection(id) {
    if (!/^[a-z0-9-]{2,30}$/.test(id || '')) return;
    var s = $(id); if (s) s.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('a[href="#' + id + '"]'), function (a) { a.hidden = true; });
  }
  function waLink(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = '225' + d;
    return d.length >= 8 ? 'https://wa.me/' + d : '';
  }

  function card(p) {
    var soon = p.status === 'bientot';
    var c = el('div', 'pole-card' + (soon ? ' pole-card--soon' : ''));
    c.style.setProperty('--accent', p.accent);
    c.appendChild(el('span', 'status', soon ? 'Bientôt' : '● Actif'));
    c.appendChild(el('span', 'num', 'Pôle'));
    c.appendChild(el('h3', null, p.name));
    var pills = el('div', 'pill-list');
    (p.tags || []).forEach(function (t) { pills.appendChild(el('span', 'pill', t)); });
    c.appendChild(pills);
    if (p.manager_name) {
      var m = el('div', 'manager', 'Responsable : ' + p.manager_name);
      var wa = !soon && waLink(p.manager_phone);
      if (wa) { m.appendChild(document.createTextNode(' · ')); var a = el('a', null, 'Contacter'); a.href = wa; a.target = '_blank'; a.rel = 'noopener noreferrer'; m.appendChild(a); }
      c.appendChild(m);
    }
    return c;
  }

  function apply(poles, hiddenSections) {
    var actifs = poles.filter(function (p) { return p.status === 'actif'; });
    var bientot = poles.filter(function (p) { return p.status === 'bientot'; });

    // Cartes
    var ga = $('poles-active'), gs = $('poles-soon'), ts = $('poles-soon-title');
    if (ga) { ga.textContent = ''; actifs.forEach(function (p) { ga.appendChild(card(p)); }); ga.hidden = !actifs.length; }
    if (gs) { gs.textContent = ''; bientot.forEach(function (p) { gs.appendChild(card(p)); }); gs.hidden = !bientot.length; }
    if (ts) ts.hidden = !bientot.length;
    var title = $('poles-title'); if (title && !actifs.length) title.textContent = 'Nos pôles';

    // Liste « Maintenant »
    var now = $('now-pills');
    if (now) { now.textContent = ''; poles.forEach(function (p) { now.appendChild(el('span', 'pill', p.short_name || p.name)); }); }

    // Phrase et titre d'accueil
    if (poles.length >= 2) {
      var ph = poles.map(function (p) { return p.lead_phrase; }).filter(Boolean);
      var lead = $('hero-lead');
      if (lead && ph.length >= 2) lead.textContent = 'Nexus Numérique relie ' + ph.slice(0, -1).join(', ') + ' et ' + ph[ph.length - 1] + ' en une seule plateforme de services de proximité.';
      var h1 = $('hero-title');
      if (h1 && poles.length <= 10) { h1.textContent = ''; h1.appendChild(document.createTextNode('Une seule activité')); h1.appendChild(document.createElement('br')); h1.appendChild(document.createTextNode('fait travailler ' + NUMS[poles.length] + ' pôles.')); }
    }

    // Schéma : seuls les pôles présents (non en veille) restent dessinés
    var present = {}; poles.forEach(function (p) { present[p.slug] = true; });
    SVG_SLUGS.forEach(function (slug) {
      Array.prototype.forEach.call(document.querySelectorAll('#hub-svg [data-pole="' + slug + '"]'), function (n) { n.style.display = present[slug] ? '' : 'none'; });
    });

    // Sections, menus et boutons liés à un pôle qui n'est pas actif
    poles.forEach(function (p) { if (p.section_id && p.status !== 'actif') hideSection(p.section_id); });
    (hiddenSections || []).forEach(function (h) { hideSection(h && h.section_id); });

    // Liste « Pôle concerné » du devis
    var sel = $('devis-pole');
    if (sel) {
      sel.textContent = '';
      poles.filter(function (p) { return p.quote_label; }).forEach(function (p) { var o = el('option', null, p.quote_label); sel.appendChild(o); });
      sel.appendChild(el('option', null, 'Autre demande'));
    }
  }

  Promise.all([call('public_poles'), call('public_hidden_sections').catch(function () { return []; })])
    .then(function (res) {
      var poles = Array.isArray(res[0]) ? res[0].filter(validPole) : [];
      if (!poles.length) return;                 // base vide : on garde le site tel quel
      apply(poles, Array.isArray(res[1]) ? res[1] : []);
    })
    .catch(function () { /* base injoignable ou script pas encore lancé : le site reste inchangé */ });
})();
