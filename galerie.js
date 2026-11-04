/* =====================================================================
   NEXUS NUMÉRIQUE — Galerie photos du site public
   Lit la liste des photos actives (réalisations et atelier) ajoutées depuis
   l'application de gestion. Si aucune photo n'existe, ou en cas de problème,
   les sections restent cachées : le reste du site n'est jamais affecté.
   Fichiers nécessaires : galerie.js + gestion-config.js
   ===================================================================== */
(function () {
  'use strict';
  var C = window.NEXUS_CONFIG;
  if (!C || !C.SUPABASE_URL || !C.SUPABASE_KEY) return;
  var base = C.SUPABASE_URL.replace(/\/+$/, '');

  function photoUrl(path) {
    return base + '/storage/v1/object/public/galerie/' + String(path).split('/').map(encodeURIComponent).join('/');
  }

  var box = document.getElementById('lightbox');
  var lbImg = box && box.querySelector('img');
  var lbCap = box && box.querySelector('.lb-cap');
  function openBox(src, cap) {
    lbImg.src = src; lbImg.alt = cap || 'Photo';
    lbCap.textContent = cap || '';
    box.classList.add('open');
  }
  function closeBox() { box.classList.remove('open'); lbImg.removeAttribute('src'); }
  if (box) {
    box.addEventListener('click', function (e) { if (e.target !== lbImg) closeBox(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBox(); });
  }

  function fill(items, gridId, sectionId, navId) {
    var grid = document.getElementById(gridId), section = document.getElementById(sectionId);
    if (!grid || !section || !items.length) return;
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'gal-item';
      var img = document.createElement('img');
      img.src = photoUrl(it.file_path); img.alt = it.caption || 'Photo Nexus Numérique';
      img.loading = 'lazy'; img.decoding = 'async';
      b.appendChild(img);
      if (it.caption) {
        var c = document.createElement('span');
        c.className = 'gal-cap'; c.textContent = it.caption;   // texte brut : jamais interprété comme du HTML
        b.appendChild(c);
      }
      b.addEventListener('click', function () { openBox(img.src, it.caption); });
      grid.appendChild(b);
    });
    section.hidden = false;
    var nav = navId && document.getElementById(navId);
    if (nav) nav.hidden = false;
  }

  fetch(base + '/rest/v1/rpc/public_gallery', {
    method: 'POST',
    headers: { 'apikey': C.SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}'
  }).then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      if (!Array.isArray(list)) return;
      fill(list.filter(function (x) { return x.category === 'realisation'; }), 'gal-realisations', 'realisations', 'nav-real');
      fill(list.filter(function (x) { return x.category === 'boutique'; }), 'gal-atelier', 'atelier', null);
    })
    .catch(function () { /* silencieux : le site fonctionne sans galerie */ });
})();
