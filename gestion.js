/* =====================================================================
   NEXUS NUMÉRIQUE — Application de gestion, étape 1
   Contenu : connexion, clients, tarifs, devis (avec PDF).
   Fichiers : gestion.html, gestion.css, gestion-config.js, gestion.js

   Sécurité : ce code est public, mais la base de données applique des
   règles (RLS) : sans compte administrateur actif, aucune donnée n'est
   accessible. Toutes les valeurs saisies sont échappées avant affichage.
   ===================================================================== */
(function () {
  'use strict';

  const C = window.NEXUS_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);

  const CLIENT_TYPES = {
    particulier: 'Particulier', ecole: 'École', association: 'Association',
    club: 'Club', entreprise: 'Entreprise', autre: 'Autre'
  };
  const QUOTE_STATUS = {
    brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré'
  };
  const EDITABLE_STATUS = ['brouillon', 'envoye'];

  // Avancement d'une commande (le devis, lui, a ses propres statuts ci-dessus)
  const ORDER_STATUS = {
    devis_accepte: 'Devis accepté', acompte_recu: 'Acompte reçu', visuel_validation: 'Visuel en validation',
    visuel_valide: 'Visuel validé', en_production: 'En production', controle: 'Contrôle qualité',
    prete: 'Commande prête', livree: 'Livrée', soldee: 'Soldée', terminee: 'Terminée', annulee: 'Annulée'
  };
  const ORDER_CLOSED = ['livree', 'soldee', 'terminee', 'annulee'];   // plus de retard possible
  const PAY_METHODS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', autre: 'Autre' };
  const PAY_KINDS = { acompte: 'Acompte', paiement: 'Paiement', solde: 'Solde' };
  // Validation du visuel par le client
  const VISUAL_STATUS = {
    en_attente: 'En attente du client', valide: 'Validé par le client',
    modification_demandee: 'Modification demandée', remplace: 'Remplacé par une version plus récente'
  };
  const VISUAL_BADGE = { en_attente: 'st-envoye', valide: 'st-accepte', modification_demandee: 'st-expire', remplace: 'st-inactif' };
  const VISUAL_REOPENABLE = ['devis_accepte', 'acompte_recu', 'visuel_validation', 'visuel_valide'];  // avant la production
  const VISUAL_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const VISUAL_MAX = 5 * 1024 * 1024;   // 5 Mo

  const state = { user: null, profile: null, tab: 'devis', clients: [], tiers: [], quotes: [], orders: [], loginMsg: '' };

  /* ---------------------------- Outils ---------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  // Espaces ordinaires comme séparateurs de milliers (compatible PDF)
  function fmt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function money(n) { return fmt(n) + ' FCFA'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDateOnly(s) { return s ? String(s).split('-').reverse().join('/') : '-'; }
  function fmtDateTs(s) { const d = new Date(s); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function addDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
  function options(map, selected) {
    return Object.keys(map).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === selected ? ' selected' : '') + '>' + esc(map[k]) + '</option>';
    }).join('');
  }
  function waLink(num) {
    let d = String(num || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 && d[0] === '0') d = '225' + d;   // numéro ivoirien à 10 chiffres
    return 'https://wa.me/' + d;
  }
  function errMsg(e) {
    const m = (e && e.message) || '';
    if (/row-level security|permission denied/i.test(m)) return "Action non autorisée pour ce compte.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Connexion internet indisponible. Réessayez.";
    return m || 'Une erreur est survenue.';
  }
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3800);
  }

  /* ---------------------- Fenêtre (modale) générique ---------------------- */
  function openModal(title, bodyEl, opts) {
    opts = opts || {};
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    const form = document.createElement('form');
    form.innerHTML =
      '<div class="modal-head"><h3>' + esc(title) + '</h3>' +
      '<button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div>';
    $('.modal-body', form).appendChild(bodyEl);
    const foot = $('.modal-foot', form);
    (opts.buttons || []).forEach(function (b) { foot.appendChild(b); });
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Fermer';
    cancel.setAttribute('data-close', '');
    foot.appendChild(cancel);
    let submitBtn = null;
    if (opts.submitLabel) {
      submitBtn = document.createElement('button');
      submitBtn.type = 'submit'; submitBtn.className = 'btn'; submitBtn.textContent = opts.submitLabel;
      foot.appendChild(submitBtn);
    }
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    const close = function () { dlg.close(); };
    $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', close); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!opts.onSubmit) return;
      submitBtn.disabled = true;
      try {
        const ok = await opts.onSubmit();
        if (ok !== false) close();
      } catch (err) {
        toast(errMsg(err), true);
      } finally {
        submitBtn.disabled = false;
      }
    });
    dlg.showModal();
    return { dlg: dlg, close: close };
  }

  /* ---------------------------- Chargement des données ---------------------------- */
  async function loadClients() {
    const r = await sb.from('clients').select('*').order('name');
    if (r.error) throw r.error;
    state.clients = r.data;
  }
  async function loadTiers() {
    const r = await sb.from('price_tiers').select('*').order('client_type', { nullsFirst: true }).order('min_qty');
    if (r.error) throw r.error;
    state.tiers = r.data;
  }
  // Une relation « un à un » peut revenir sous forme d'objet ou de liste : on la normalise
  function one(v) { return Array.isArray(v) ? (v[0] || null) : (v || null); }

  async function loadQuotes() {
    const r = await sb.from('quotes')
      .select('*, clients(id,name,client_type,organization,contact_person,phone,whatsapp,address), quote_items(id,description,quantity,unit_price,price_override_reason), orders(id,order_number)')
      .order('created_at', { ascending: false });
    if (r.error) throw r.error;
    state.quotes = r.data.map(function (q) { q.order = one(q.orders); return q; });
  }
  async function loadOrders() {
    const r = await sb.from('orders')
      .select('*, clients(id,name,client_type,phone,whatsapp), order_items(id,description,quantity), payments(id,amount,kind,method,reference,paid_at,note,receipt_number,created_at), quotes(quote_number), order_visuals(id,version,file_path,file_name,status,client_name,client_comment,decided_at,created_at)')
      .order('created_at', { ascending: false });
    if (r.error) throw r.error;
    state.orders = r.data.map(function (o) { o.quote = one(o.quotes); return o; });
  }

  /* ---------------------- Visuels et lien de suivi ---------------------- */
  // Dernière version du visuel (celle que le client doit valider)
  function latestVisual(o) {
    const list = (o.order_visuals || []).filter(function (v) { return v.status !== 'remplace'; });
    return list.sort(function (a, b) { return b.version - a.version; })[0] || null;
  }
  function visualUrl(path) {
    return C.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/visuels/' + String(path).split('/').map(encodeURIComponent).join('/');
  }
  // Adresse de la page client : même dossier que cette page, fichier suivi.html
  function trackingUrl(o) {
    const u = new URL('suivi.html', window.location.href);
    u.search = '?t=' + o.tracking_token;
    u.hash = '';
    return u.toString();
  }
  function randomId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    const a = new Uint8Array(16);
    window.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ---------------------------- Calculs ---------------------------- */
  function subTotal(items) {
    return (items || []).reduce(function (s, i) { return s + Number(i.quantity) * Number(i.unit_price); }, 0);
  }
  function quoteTotal(q) { return subTotal(q.quote_items) - Number(q.discount || 0) + Number(q.extra_fees || 0); }
  function paidOf(o) { return (o.payments || []).reduce(function (s, p) { return s + Number(p.amount); }, 0); }
  function restOf(o) { return Number(o.total_amount) - paidOf(o); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function isLate(o) { return !!o.due_date && o.due_date < todayStr() && ORDER_CLOSED.indexOf(o.status) === -1; }

  // Tarif applicable : un tarif propre au type de client prime sur un tarif général
  function suggestTier(clientType, qty) {
    const q = Number(qty) || 0;
    const m = state.tiers.filter(function (t) {
      return t.active && (!t.client_type || t.client_type === clientType) &&
        q >= t.min_qty && (t.max_qty == null || q <= t.max_qty);
    });
    m.sort(function (a, b) {
      return (b.client_type ? 1 : 0) - (a.client_type ? 1 : 0) || b.min_qty - a.min_qty;
    });
    return m[0] || null;
  }

  /* ---------------------------- Écran de connexion ---------------------------- */
  function renderLogin(msg) {
    $('#app').innerHTML =
      '<div class="login-wrap"><form class="login-card" id="login-form">' +
      '<div class="brand-mark">N</div><h1>Nexus Numérique</h1>' +
      '<p class="sub">Espace de gestion — accès réservé à l\'équipe</p>' +
      (msg ? '<div class="msg">' + esc(msg) + '</div>' : '') +
      '<div class="form-grid" style="grid-template-columns:1fr">' +
      '<label class="f">Adresse email<input type="email" name="email" autocomplete="username" required></label>' +
      '<label class="f">Mot de passe<input type="password" name="password" autocomplete="current-password" required></label>' +
      '<button class="btn" type="submit">Se connecter</button></div></form></div>';
    $('#login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const f = e.target;
      const btn = $('button', f);
      btn.disabled = true; btn.textContent = 'Connexion…';
      const r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (r.error) {
        renderLogin('Email ou mot de passe incorrect.');
        return;
      }
      start();
    });
  }

  function logout(msg) {
    state.loginMsg = msg || '';
    state.user = null; state.profile = null;
    sb.auth.signOut();
  }

  /* ---------------------------- Mot de passe (admin et opérateur) ---------------------------- */
  function openPasswordModal() {
    const body = h('<div class="form-grid" style="grid-template-columns:1fr">' +
      '<label class="f">Nouveau mot de passe (8 caractères minimum)<input name="p1" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<label class="f">Retapez-le<input name="p2" type="password" autocomplete="new-password" minlength="8" required></label></div>');
    openModal('Changer mon mot de passe', body, {
      submitLabel: 'Enregistrer',
      onSubmit: async function () {
        const p1 = $('[name="p1"]', body).value, p2 = $('[name="p2"]', body).value;
        if (p1.length < 8) throw new Error('Le mot de passe doit avoir au moins 8 caractères.');
        if (p1 !== p2) throw new Error('Les deux mots de passe ne sont pas identiques.');
        const r = await sb.auth.updateUser({ password: p1 });
        if (r.error) throw r.error;
        toast('Mot de passe changé.');
      }
    });
  }

  /* ---------------------------- ÉCRAN OPÉRATEUR (production) ---------------------------- */
  // L'opérateur ne voit ni prix, ni paiements, ni téléphones : la base ne les lui envoie jamais.
  const PROD_GROUPS = [
    ['visuel_valide', 'À produire'], ['en_production', 'En production'], ['controle', 'Contrôle qualité'], ['prete', 'Prêtes']
  ];
  const PROD_ACTIONS = {   // statut actuel -> boutons [nouveau statut, libellé, principal ?]
    visuel_valide: [['en_production', 'Lancer la production', true]],
    en_production: [['controle', 'Passer au contrôle', true]],
    controle: [['prete', 'Marquer prête', true], ['en_production', 'Renvoyer en production', false]],
    prete: [['controle', 'Remettre en contrôle', false]]
  };

  function renderOperator() {
    $('#app').innerHTML =
      '<header class="topbar"><div class="brand"><div class="brand-mark">N</div>' +
      '<div><strong>Nexus Numérique</strong><small>Production</small></div></div>' +
      '<div class="user"><span>' + esc(state.profile.full_name || '') + '</span>' +
      '<button class="btn btn-ghost btn-small" id="pwd">Mot de passe</button>' +
      '<button class="btn btn-ghost btn-small" id="logout">Déconnexion</button></div></header>' +
      '<main id="view"><div class="view-head"><h2>Commandes à produire</h2>' +
      '<button class="btn btn-ghost btn-small" id="op-refresh">Actualiser</button></div><div id="op-list"><p class="empty">Chargement…</p></div></main>';
    $('#logout').addEventListener('click', function () { logout(); });
    $('#pwd').addEventListener('click', openPasswordModal);
    $('#op-refresh').addEventListener('click', loadOperator);
    $('#op-list').addEventListener('click', onOperatorClick);
    loadOperator();
  }

  async function loadOperator() {
    const box = $('#op-list');
    const r = await sb.rpc('operator_orders');
    if (r.error) { box.innerHTML = '<p class="empty">' + esc(errMsg(r.error)) + '</p>'; return; }
    state.prod = r.data || [];
    // On garde ce que l'opérateur est en train de taper dans une remarque pendant l'actualisation
    const drafts = {};
    $$('.op-note', box).forEach(function (t) { if (t.value !== t.defaultValue) drafts[t.getAttribute('data-id')] = t.value; });
    box.innerHTML = state.prod.length ? PROD_GROUPS.map(function (g) {
      const rows = state.prod.filter(function (o) { return o.status === g[0]; });
      if (!rows.length) return '';
      return '<h3 class="op-group">' + esc(g[1]) + ' <span class="badge">' + rows.length + '</span></h3>' + rows.map(prodCard).join('');
    }).join('') : '<p class="empty">Aucune commande à produire pour le moment.<br>Elles apparaissent ici dès que le client a validé son visuel et que l\'acompte est enregistré.</p>';
    Object.keys(drafts).forEach(function (id) {
      const t = $('.op-note[data-id="' + id + '"]', box); if (t) t.value = drafts[id];
    });
  }

  function prodCard(o) {
    const late = !!o.due_date && o.due_date < todayStr();
    const v = o.visual;
    const url = v ? visualUrl(v.file_path) : '';
    const isPdf = v && /\.pdf$/i.test(v.file_path);
    const items = (o.items || []).map(function (i) {
      return '<div class="pay-row"><div>' + esc(i.description) + '</div><b>× ' + esc(i.quantity) + '</b></div>';
    }).join('');
    const total = (o.items || []).reduce(function (s, i) { return s + Number(i.quantity); }, 0);
    const acts = (PROD_ACTIONS[o.status] || []).map(function (a) {
      return '<button type="button" class="btn btn-small' + (a[2] ? '' : ' btn-ghost') + '" data-act="status" data-id="' + esc(o.id) + '" data-to="' + esc(a[0]) + '">' + esc(a[1]) + '</button>';
    }).join('');
    return '<article class="card' + (late ? ' late' : '') + '"><div class="card-top"><strong>' + esc(o.order_number) + '</strong>' +
      (o.priority === 'urgente' ? '<span class="badge st-expire">Urgente</span>' : '') + '</div>' +
      '<div class="card-client">' + esc(o.client_name) + '</div>' +
      '<div class="card-meta"><span>Total : <b>' + esc(total) + ' pièce(s)</b></span>' +
      (o.due_date ? '<span' + (late ? ' class="late-text"' : '') + '>Livraison : <b>' + esc(fmtDateOnly(o.due_date)) + '</b>' + (late ? ' (en retard)' : '') + '</span>' : '') + '</div>' +
      (v ? '<div class="vis" style="border:none">' + (isPdf
        ? '<a class="vis-img vis-pdf" href="' + esc(url) + '" target="_blank" rel="noopener">PDF</a>'
        : '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="vis-img" src="' + esc(url) + '" alt="Visuel validé" loading="lazy"></a>') +
        '<div class="vis-info"><div class="l-hint">Visuel validé par le client (version ' + esc(v.version) + '). Touchez l\'image pour l\'ouvrir en grand.</div></div></div>' : '') +
      '<div style="margin-top:6px">' + items + '</div>' +
      '<label class="f" style="margin-top:10px">Remarque de production<textarea class="op-note" data-id="' + esc(o.id) + '" rows="2" maxlength="500" placeholder="Ex : il manque 5 t-shirts taille M">' + esc(o.production_note) + '</textarea></label>' +
      '<div class="card-actions"><button type="button" class="btn btn-small btn-ghost" data-act="note" data-id="' + esc(o.id) + '">Enregistrer la remarque</button>' + acts + '</div></article>';
  }

  async function onOperatorClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.getAttribute('data-id');
    if (b.getAttribute('data-act') === 'note') {
      b.disabled = true;
      const r = await sb.rpc('operator_set_note', { p_order_id: id, p_note: $('.op-note[data-id="' + id + '"]').value });
      b.disabled = false;
      if (r.error) { toast(errMsg(r.error), true); return; }
      toast('Remarque enregistrée.');
      return;
    }
    const to = b.getAttribute('data-to');
    const label = b.textContent;
    if (!window.confirm(label + ' ?')) return;
    b.disabled = true;
    const r = await sb.rpc('operator_set_status', { p_order_id: id, p_status: to });
    if (r.error) { toast(errMsg(r.error), true); b.disabled = false; await loadOperator(); return; }
    toast('C\'est fait : ' + (ORDER_STATUS[to] || to) + '.');
    await loadOperator();
  }

  /* ---------------------------- Structure administrateur ---------------------------- */
  function renderShell() {
    $('#app').innerHTML =
      '<header class="topbar"><div class="brand"><div class="brand-mark">N</div>' +
      '<div><strong>Nexus Numérique</strong><small>Gestion</small></div></div>' +
      '<div class="user"><span>' + esc(state.profile.full_name || '') + '</span>' +
      '<button class="btn btn-ghost btn-small" id="pwd">Mot de passe</button>' +
      '<button class="btn btn-ghost btn-small" id="logout">Déconnexion</button></div></header>' +
      '<nav class="tabs">' +
      '<button class="tab" data-tab="devis">Devis</button>' +
      '<button class="tab" data-tab="commandes">Commandes</button>' +
      '<button class="tab" data-tab="clients">Clients</button>' +
      '<button class="tab" data-tab="tarifs">Tarifs</button>' +
      '<button class="tab" data-tab="sauvegarde">Sauvegarde' + (backupOverdue() ? ' <span aria-label="à faire" title="Sauvegarde à faire">&#9888;</span>' : '') + '</button></nav>' +
      '<main id="view"></main>';
    $('#logout').addEventListener('click', function () { logout(); });
    $('#pwd').addEventListener('click', openPasswordModal);
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });
  }

  function showTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    if (tab === 'devis') renderQuotes();
    else if (tab === 'commandes') renderOrders();
    else if (tab === 'clients') renderClients();
    else if (tab === 'sauvegarde') renderBackup();
    else renderTiers();
  }

  /* ---------------------------- SAUVEGARDE ---------------------------- */
  const BACKUP_TABLES = ['clients', 'price_tiers', 'quotes', 'quote_items', 'orders', 'order_items',
    'payments', 'order_status_history', 'order_visuals', 'order_visual_events'];
  const BACKUP_KEY = 'nexus_last_backup';
  const BACKUP_DAYS = 7;

  function lastBackup() {
    try { const v = window.localStorage.getItem(BACKUP_KEY); return v ? new Date(v) : null; } catch (e) { return null; }
  }
  function markBackup() {
    try { window.localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) { /* sans importance */ }
  }
  function backupOverdue() {
    const d = lastBackup();
    return !d || (Date.now() - d.getTime()) > BACKUP_DAYS * 86400000;
  }
  // La base renvoie au plus 1000 lignes par demande : on lit page par page
  async function fetchAll(table) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const r = await sb.from(table).select('*').order('id').range(from, from + 999);
      if (r.error) throw r.error;
      rows.push.apply(rows, r.data);
      if (r.data.length < 1000) break;
    }
    return rows;
  }
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function csvCell(v) {
    if (v == null) return '';
    let t = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;   // évite qu'Excel exécute une formule
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function renderBackup() {
    const view = $('#view');
    const d = lastBackup();
    const overdue = backupOverdue();
    const when = d ? 'le ' + fmtDateTime(d.toISOString()) : 'jamais (sur cet appareil)';
    view.innerHTML =
      '<div class="view-head"><h2>Sauvegarde</h2></div>' +
      '<p class="sv-note ' + (overdue ? 'note' : 'ok-note') + '">Dernière sauvegarde : <b>' + esc(when) + '</b>.' +
      (overdue ? ' Faites-en une maintenant, puis une fois par semaine.' : '') + '</p>' +
      '<div class="card"><h3>Sauvegarde complète</h3>' +
      '<p class="hint">Un fichier avec tous vos clients, tarifs, devis, commandes, paiements et preuves de validation. À garder en lieu sûr (ordinateur, clé USB ou Drive personnel).</p>' +
      '<div class="card-actions"><button class="btn" id="bk-json">Télécharger la sauvegarde</button></div></div>' +
      '<div class="card"><h3>Paiements pour Excel</h3>' +
      '<p class="hint">La liste de tous les paiements encaissés (date, reçu, client, montant, mode), à ouvrir dans Excel pour votre comptabilité.</p>' +
      '<div class="card-actions"><button class="btn btn-ghost" id="bk-csv">Télécharger les paiements (Excel)</button></div></div>' +
      '<p class="hint">Attention : ces fichiers contiennent des informations privées de vos clients et les liens de suivi. Ne les envoyez à personne et ne les mettez jamais sur GitHub. ' +
      'Les images des visuels ne sont pas dans la sauvegarde : gardez aussi les fichiers d\'origine.</p>';

    $('#bk-json').addEventListener('click', async function () {
      const btn = this; btn.disabled = true; btn.textContent = 'Préparation…';
      try {
        const data = { app: 'Nexus Numérique', exported_at: new Date().toISOString(), tables: {} };
        for (const t of BACKUP_TABLES) data.tables[t] = await fetchAll(t);
        download('nexus-sauvegarde-' + stamp() + '.json', JSON.stringify(data, null, 2), 'application/json');
        markBackup();
        const n = BACKUP_TABLES.reduce(function (s, t) { return s + data.tables[t].length; }, 0);
        toast('Sauvegarde téléchargée (' + n + ' enregistrements).');
        renderShell(); showTab('sauvegarde');
      } catch (err) {
        toast('Sauvegarde impossible : ' + errMsg(err), true);
        btn.disabled = false; btn.textContent = 'Télécharger la sauvegarde';
      }
    });

    $('#bk-csv').addEventListener('click', async function () {
      const btn = this; btn.disabled = true;
      try {
        await loadOrders();
        const head = ['Date', 'N° reçu', 'Commande', 'Client', 'Type', 'Mode', 'Montant (FCFA)', 'Référence'];
        const rows = [];
        state.orders.forEach(function (o) {
          (o.payments || []).forEach(function (p) {
            rows.push([p.paid_at, p.receipt_number, o.order_number, o.clients ? o.clients.name : '',
              PAY_KINDS[p.kind] || p.kind, PAY_METHODS[p.method] || p.method, p.amount, p.reference || '']);
          });
        });
        rows.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
        const csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
        download('nexus-paiements-' + stamp() + '.csv', csv, 'text/csv;charset=utf-8');
        toast(rows.length + ' paiement(s) exporté(s).');
      } catch (err) {
        toast('Export impossible : ' + errMsg(err), true);
      } finally { btn.disabled = false; }
    });
  }

  /* ---------------------------- CLIENTS ---------------------------- */
  function renderClients() {
    const view = $('#view');
    view.innerHTML =
      '<div class="view-head"><h2>Clients</h2><button class="btn" id="new-client">+ Nouveau client</button></div>' +
      '<div class="filters" style="grid-template-columns:1fr"><input id="c-search" type="search" placeholder="Rechercher (nom, téléphone, organisation)"></div>' +
      '<div id="c-list"></div>';
    $('#new-client').addEventListener('click', function () { openClientModal(null); });
    $('#c-search').addEventListener('input', renderClientList);
    $('#c-list').addEventListener('click', function (e) {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      openClientModal(state.clients.find(function (c) { return c.id === b.getAttribute('data-id'); }));
    });
    renderClientList();
  }

  function renderClientList() {
    const term = $('#c-search').value.trim().toLowerCase();
    const rows = state.clients.filter(function (c) {
      if (!term) return true;
      return [c.name, c.phone, c.whatsapp, c.organization, c.contact_person]
        .some(function (v) { return (v || '').toLowerCase().includes(term); });
    });
    $('#c-list').innerHTML = rows.length ? rows.map(function (c) {
      const wa = waLink(c.whatsapp || c.phone);
      return '<article class="card"><div class="card-top"><strong>' + esc(c.name) + '</strong>' +
        '<span class="badge">' + esc(CLIENT_TYPES[c.client_type] || c.client_type) + '</span></div>' +
        (c.organization ? '<div class="card-client">' + esc(c.organization) + '</div>' : '') +
        '<div class="card-meta">' +
        (c.contact_person ? '<span>Responsable : <b>' + esc(c.contact_person) + '</b></span>' : '') +
        (c.phone ? '<span>Tél : <b>' + esc(c.phone) + '</b></span>' : '') +
        (wa ? '<a class="link" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
        '</div><div class="card-actions"><button class="btn btn-small btn-ghost" data-id="' + esc(c.id) + '">Modifier</button></div></article>';
    }).join('') : '<p class="empty">Aucun client. Appuyez sur « Nouveau client » pour commencer.</p>';
  }

  function openClientModal(client) {
    const c = client || { client_type: 'particulier' };
    const body = h(
      '<div class="form-grid">' +
      '<label class="f full">Nom ou organisation *<input name="name" required value="' + esc(c.name) + '"></label>' +
      '<label class="f">Type de client<select name="client_type">' + options(CLIENT_TYPES, c.client_type) + '</select></label>' +
      '<label class="f">École / association / club / entreprise<input name="organization" value="' + esc(c.organization) + '"></label>' +
      '<label class="f">Personne responsable<input name="contact_person" value="' + esc(c.contact_person) + '"></label>' +
      '<label class="f">Téléphone<input name="phone" inputmode="tel" value="' + esc(c.phone) + '"></label>' +
      '<label class="f">WhatsApp<input name="whatsapp" inputmode="tel" value="' + esc(c.whatsapp) + '"></label>' +
      '<label class="f full">Adresse<input name="address" value="' + esc(c.address) + '"></label>' +
      '<label class="f full">Notes<textarea name="notes" rows="2">' + esc(c.notes) + '</textarea></label></div>');
    const get = function (n) { return $('[name="' + n + '"]', body).value.trim(); };
    openModal(client ? 'Modifier le client' : 'Nouveau client', body, {
      submitLabel: 'Enregistrer',
      onSubmit: async function () {
        if (!get('name')) throw new Error('Le nom est obligatoire.');
        const payload = {
          name: get('name'), client_type: get('client_type'), organization: get('organization') || null,
          contact_person: get('contact_person') || null, phone: get('phone') || null,
          whatsapp: get('whatsapp') || null, address: get('address') || null, notes: get('notes') || null
        };
        const r = client ? await sb.from('clients').update(payload).eq('id', client.id)
          : await sb.from('clients').insert(payload);
        if (r.error) throw r.error;
        await loadClients();
        if (state.tab === 'clients') renderClients();
        toast('Client enregistré.');
      }
    });
  }

  /* ---------------------------- TARIFS ---------------------------- */
  function renderTiers() {
    const view = $('#view');
    view.innerHTML =
      '<div class="view-head"><h2>Tarifs</h2><button class="btn" id="new-tier">+ Nouveau tarif</button></div>' +
      '<p class="hint">Le prix unitaire se remplit tout seul dans les devis selon le type de client et la quantité. ' +
      'Un tarif sans type de client vaut pour tout le monde ; un tarif propre à un type prime sur lui. ' +
      'Vous pouvez toujours modifier le prix à la main dans un devis.</p><div id="t-list"></div>';
    $('#new-tier').addEventListener('click', function () { openTierModal(null); });
    $('#t-list').addEventListener('click', function (e) {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      openTierModal(state.tiers.find(function (t) { return t.id === b.getAttribute('data-id'); }));
    });
    $('#t-list').innerHTML = state.tiers.length ? state.tiers.map(function (t) {
      const range = t.max_qty == null ? t.min_qty + ' et plus' : t.min_qty + ' à ' + t.max_qty;
      return '<article class="card"><div class="card-top"><strong>' + esc(t.label) + '</strong>' +
        '<span class="badge ' + (t.active ? '' : 'st-inactif') + '">' + (t.active ? 'Actif' : 'Désactivé') + '</span></div>' +
        '<div class="card-meta"><span>Client : <b>' + esc(t.client_type ? CLIENT_TYPES[t.client_type] : 'Tous') + '</b></span>' +
        '<span>Quantité : <b>' + esc(range) + '</b></span><span>Prix : <b>' + money(t.unit_price) + ' / unité</b></span></div>' +
        '<div class="card-actions"><button class="btn btn-small btn-ghost" data-id="' + esc(t.id) + '">Modifier</button></div></article>';
    }).join('') : '<p class="empty">Aucun tarif.</p>';
  }

  function openTierModal(tier) {
    const t = tier || { active: true, min_qty: 1 };
    const typeOpts = '<option value="">Tous les clients</option>' + options(CLIENT_TYPES, t.client_type);
    const body = h(
      '<div class="form-grid">' +
      '<label class="f full">Nom du tarif *<input name="label" required value="' + esc(t.label) + '" placeholder="Ex : Tarif école 50 à 199"></label>' +
      '<label class="f full">Type de client<select name="client_type">' + typeOpts + '</select></label>' +
      '<label class="f">Quantité minimale<input name="min_qty" type="number" min="1" inputmode="numeric" value="' + esc(t.min_qty) + '"></label>' +
      '<label class="f">Quantité maximale (vide = sans limite)<input name="max_qty" type="number" min="1" inputmode="numeric" value="' + esc(t.max_qty) + '"></label>' +
      '<label class="f full">Prix unitaire (FCFA) *<input name="unit_price" type="number" min="0" inputmode="numeric" required value="' + esc(t.unit_price) + '"></label>' +
      '<label class="f check full"><input type="checkbox" name="active"' + (t.active ? ' checked' : '') + '> Tarif actif</label></div>');
    const get = function (n) { return $('[name="' + n + '"]', body); };
    openModal(tier ? 'Modifier le tarif' : 'Nouveau tarif', body, {
      submitLabel: 'Enregistrer',
      onSubmit: async function () {
        const label = get('label').value.trim();
        const min = parseInt(get('min_qty').value, 10);
        const maxRaw = get('max_qty').value.trim();
        const max = maxRaw === '' ? null : parseInt(maxRaw, 10);
        const price = parseInt(get('unit_price').value, 10);
        if (!label) throw new Error('Le nom du tarif est obligatoire.');
        if (!(min >= 1)) throw new Error('La quantité minimale doit être au moins 1.');
        if (max !== null && max < min) throw new Error('La quantité maximale doit être supérieure à la minimale.');
        if (!(price >= 0)) throw new Error('Indiquez un prix valide.');
        const payload = {
          label: label, client_type: get('client_type').value || null, min_qty: min, max_qty: max,
          unit_price: price, active: get('active').checked
        };
        const r = tier ? await sb.from('price_tiers').update(payload).eq('id', tier.id)
          : await sb.from('price_tiers').insert(payload);
        if (r.error) throw r.error;
        await loadTiers();
        if (state.tab === 'tarifs') renderTiers();
        toast('Tarif enregistré.');
      }
    });
  }

  /* ---------------------------- DEVIS : liste ---------------------------- */
  function renderQuotes() {
    const view = $('#view');
    view.innerHTML =
      '<div class="view-head"><h2>Devis</h2><button class="btn" id="new-quote">+ Nouveau devis</button></div>' +
      '<div class="filters"><input id="q-search" type="search" placeholder="Rechercher (numéro ou client)">' +
      '<select id="q-status"><option value="">Tous les statuts</option>' + options(QUOTE_STATUS, '') + '</select></div>' +
      '<div id="q-list"></div>';
    $('#new-quote').addEventListener('click', function () {
      if (!state.clients.length) { toast("Créez d'abord un client (onglet Clients).", true); return; }
      openQuoteModal(null);
    });
    $('#q-search').addEventListener('input', renderQuoteList);
    $('#q-status').addEventListener('change', renderQuoteList);
    $('#q-list').addEventListener('click', function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const q = state.quotes.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!q) return;
      if (b.getAttribute('data-act') === 'pdf') makePdf(q); else openQuoteModal(q);
    });
    renderQuoteList();
  }

  function renderQuoteList() {
    const term = $('#q-search').value.trim().toLowerCase();
    const st = $('#q-status').value;
    const rows = state.quotes.filter(function (q) {
      const name = ((q.clients && q.clients.name) || '').toLowerCase();
      return (!st || q.status === st) && (!term || (q.quote_number || '').toLowerCase().includes(term) || name.includes(term));
    });
    $('#q-list').innerHTML = rows.length ? rows.map(function (q) {
      return '<article class="card"><div class="card-top"><strong>' + esc(q.quote_number) + '</strong>' +
        '<span class="badge st-' + esc(q.status) + '">' + esc(QUOTE_STATUS[q.status] || q.status) + '</span></div>' +
        '<div class="card-client">' + esc(q.clients ? q.clients.name : '') + '</div>' +
        '<div class="card-meta"><span>Total : <b>' + money(quoteTotal(q)) + '</b></span>' +
        '<span>Valable jusqu\'au ' + esc(fmtDateOnly(q.valid_until)) + '</span>' +
        (q.order ? '<span>Commande : <b>' + esc(q.order.order_number) + '</b></span>' : '') + '</div>' +
        '<div class="card-actions"><button class="btn btn-small" data-act="open" data-id="' + esc(q.id) + '">Ouvrir</button>' +
        '<button class="btn btn-small btn-ghost" data-act="pdf" data-id="' + esc(q.id) + '">PDF</button></div></article>';
    }).join('') : '<p class="empty">Aucun devis pour le moment.</p>';
  }

  /* ---------------------------- DEVIS : éditeur ---------------------------- */
  function openQuoteModal(quote) {
    const isNew = !quote;
    const q = quote || {
      status: 'brouillon', discount: 0, extra_fees: 0, valid_until: addDays(C.QUOTE_VALIDITY_DAYS),
      delivery_estimate: C.DELIVERY_DEFAULT || '', notes: '', quote_items: [], client_id: ''
    };
    const locked = !isNew && EDITABLE_STATUS.indexOf(q.status) === -1;
    const dis = locked ? ' disabled' : '';

    const clientOpts = '<option value="">— Choisir un client —</option>' + state.clients.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === q.client_id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');

    const body = h(
      '<div>' +
      (locked ? '<div class="note">Ce devis est verrouillé (' + esc(QUOTE_STATUS[q.status]) + '). Pour le modifier, repassez-le d\'abord en « Envoyé » puis enregistrez.</div>' : '') +
      '<div class="form-grid">' +
      '<label class="f full">Client *<select name="client_id"' + dis + '>' + clientOpts + '</select></label>' +
      '<label class="f">Valable jusqu\'au<input type="date" name="valid_until" value="' + esc(q.valid_until) + '"' + dis + '></label>' +
      '<label class="f">Statut<select name="status">' + options(QUOTE_STATUS, q.status) + '</select></label>' +
      '<label class="f full">Délai estimatif<input name="delivery_estimate" value="' + esc(q.delivery_estimate) + '"' + dis + '></label></div>' +
      '<h4>Articles</h4><div id="lines"></div>' +
      (locked ? '' : '<button type="button" class="btn btn-ghost btn-small" id="add-line">+ Ajouter une ligne</button>') +
      '<div class="form-grid" style="margin-top:14px">' +
      '<label class="f">Remise (FCFA)<input type="number" name="discount" min="0" inputmode="numeric" value="' + esc(q.discount) + '"' + dis + '></label>' +
      '<label class="f">Frais supplémentaires (FCFA)<input type="number" name="extra_fees" min="0" inputmode="numeric" value="' + esc(q.extra_fees) + '"' + dis + '></label>' +
      '<label class="f full">Notes<textarea name="notes" rows="2"' + dis + '>' + esc(q.notes) + '</textarea></label></div>' +
      '<div class="totals"><div><span>Sous-total</span><span id="t-sub"></span></div>' +
      '<div><span>Remise</span><span id="t-disc"></span></div><div><span>Frais supplémentaires</span><span id="t-fees"></span></div>' +
      '<div class="grand"><span>Total</span><span id="t-total"></span></div></div></div>');

    const field = function (n) { return $('[name="' + n + '"]', body); };
    const linesBox = $('#lines', body);

    function currentClientType() {
      const c = state.clients.find(function (x) { return x.id === field('client_id').value; });
      return c ? c.client_type : null;
    }

    function readLine(el) {
      return {
        el: el,
        description: $('.l-desc', el).value.trim(),
        quantity: parseInt($('.l-qty', el).value, 10),
        unit_price: parseInt($('.l-price', el).value, 10),
        reason: $('.l-reason', el).value.trim()
      };
    }

    function updateTotals() {
      let sub = 0;
      $$('.line', linesBox).forEach(function (el) {
        const l = readLine(el);
        const tot = (l.quantity > 0 && l.unit_price >= 0) ? l.quantity * l.unit_price : 0;
        $('.l-total', el).textContent = 'Total ligne : ' + money(tot);
        sub += tot;
      });
      const disc = parseInt(field('discount').value, 10) || 0;
      const fees = parseInt(field('extra_fees').value, 10) || 0;
      $('#t-sub', body).textContent = money(sub);
      $('#t-disc', body).textContent = '- ' + money(disc);
      $('#t-fees', body).textContent = '+ ' + money(fees);
      $('#t-total', body).textContent = money(sub - disc + fees);
    }

    // Met à jour l'indication de tarif d'une ligne ; applique le prix si la ligne n'est pas modifiée à la main
    function refreshLine(el, applyPrice) {
      const qty = parseInt($('.l-qty', el).value, 10);
      const priceInput = $('.l-price', el);
      const hint = $('.l-hint', el);
      const reason = $('.l-reason', el);
      if (!field('client_id').value) {
        hint.textContent = 'Choisissez un client pour appliquer le tarif automatiquement.';
        reason.classList.add('hidden');
        return;
      }
      const tier = suggestTier(currentClientType(), qty);
      if (!tier) {
        hint.textContent = 'Aucun tarif correspondant : saisissez le prix à la main.';
        reason.classList.add('hidden');
        el.dataset.manual = '';
        return;
      }
      if (applyPrice && !el.dataset.manual) priceInput.value = tier.unit_price;
      const price = parseInt(priceInput.value, 10);
      const overridden = price !== tier.unit_price;
      el.dataset.manual = overridden ? '1' : '';
      hint.textContent = 'Tarif : ' + tier.label + ' (' + money(tier.unit_price) + ' / unité)' + (overridden ? ' — prix modifié à la main' : '');
      reason.classList.toggle('hidden', !overridden);
    }

    function addLine(data) {
      const d = data || { quantity: 1, description: '' };
      const el = h(
        '<div class="line">' +
        '<label class="f">Description<input class="l-desc" value="' + esc(d.description) + '" placeholder="Ex : T-shirt blanc, flocage 1 couleur"' + dis + '></label>' +
        '<div class="line-nums">' +
        '<label class="f">Quantité<input class="l-qty" type="number" min="1" inputmode="numeric" value="' + esc(d.quantity) + '"' + dis + '></label>' +
        '<label class="f">Prix unitaire (FCFA)<input class="l-price" type="number" min="0" inputmode="numeric" value="' + esc(d.unit_price) + '"' + dis + '></label>' +
        '<div class="l-total"></div></div>' +
        '<div class="l-hint"></div>' +
        '<input class="l-reason hidden" placeholder="Raison du changement de prix (facultatif)" value="' + esc(d.price_override_reason) + '"' + dis + '>' +
        (locked ? '' : '<div class="card-actions"><button type="button" class="btn btn-small btn-ghost l-del">Retirer la ligne</button></div>') +
        '</div>');
      $('.l-qty', el).addEventListener('input', function () { refreshLine(el, true); updateTotals(); });
      $('.l-price', el).addEventListener('input', function () {
        el.dataset.manual = '1';          // le prix a été saisi : refreshLine recalcule l'état réel
        refreshLine(el, false); updateTotals();
      });
      const del = $('.l-del', el);
      if (del) del.addEventListener('click', function () {
        if ($$('.line', linesBox).length > 1) { el.remove(); updateTotals(); } else toast('Il faut au moins une ligne.', true);
      });
      linesBox.appendChild(el);
      refreshLine(el, !d.unit_price && d.unit_price !== 0);
      updateTotals();
    }

    (q.quote_items.length ? q.quote_items : [null]).forEach(function (it) { addLine(it); });
    const addBtn = $('#add-line', body);
    if (addBtn) addBtn.addEventListener('click', function () { addLine(null); });
    field('client_id').addEventListener('change', function () {
      $$('.line', linesBox).forEach(function (el) { refreshLine(el, true); });
      updateTotals();
    });
    field('discount').addEventListener('input', updateTotals);
    field('extra_fees').addEventListener('input', updateTotals);

    const buttons = [];
    let modalRef = null;
    if (!isNew) {
      const pdfBtn = document.createElement('button');
      pdfBtn.type = 'button'; pdfBtn.className = 'btn btn-ghost'; pdfBtn.textContent = 'PDF (version enregistrée)';
      pdfBtn.addEventListener('click', function () { makePdf(q); });
      buttons.push(pdfBtn);
      // Devis accepté et pas encore converti : bouton de conversion en commande
      if (q.status === 'accepte' && !q.order) {
        const convBtn = document.createElement('button');
        convBtn.type = 'button'; convBtn.className = 'btn'; convBtn.textContent = 'Convertir en commande';
        convBtn.addEventListener('click', async function () {
          if (!window.confirm('Créer la commande à partir de ' + q.quote_number + ' ?\nLe montant du devis sera figé dans la commande.')) return;
          convBtn.disabled = true;
          const r = await sb.rpc('convert_quote_to_order', { p_quote_id: q.id });
          if (r.error) { toast(errMsg(r.error), true); convBtn.disabled = false; return; }
          try { await Promise.all([loadQuotes(), loadOrders()]); } catch (e) { toast(errMsg(e), true); }
          if (modalRef) modalRef.close();
          toast('Commande créée.');
          showTab('commandes');
        });
        buttons.push(convBtn);
      }
    }

    modalRef = openModal(isNew ? 'Nouveau devis' : q.quote_number, body, {
      buttons: buttons,
      submitLabel: 'Enregistrer',
      onSubmit: async function () {
        // Devis verrouillé : seul le statut peut changer
        if (locked) {
          if (q.order && field('status').value !== q.status) {
            throw new Error('Ce devis a déjà une commande (' + q.order.order_number + ') : son statut ne peut plus changer.');
          }
          const r0 = await sb.from('quotes').update({ status: field('status').value }).eq('id', q.id);
          if (r0.error) throw r0.error;
          await loadQuotes(); renderQuotes(); toast('Statut mis à jour.');
          return true;
        }
        const clientId = field('client_id').value;
        if (!clientId) throw new Error('Choisissez un client.');
        const lines = $$('.line', linesBox).map(readLine);
        lines.forEach(function (l, i) {
          if (!l.description) throw new Error('Ligne ' + (i + 1) + ' : ajoutez une description.');
          if (!(l.quantity >= 1)) throw new Error('Ligne ' + (i + 1) + ' : la quantité doit être au moins 1.');
          if (!(l.unit_price >= 0)) throw new Error('Ligne ' + (i + 1) + ' : indiquez le prix unitaire.');
        });
        const discount = parseInt(field('discount').value, 10) || 0;
        const fees = parseInt(field('extra_fees').value, 10) || 0;
        const sub = lines.reduce(function (s, l) { return s + l.quantity * l.unit_price; }, 0);
        if (discount > sub + fees) throw new Error('La remise ne peut pas dépasser le montant du devis.');

        const header = {
          client_id: clientId, status: field('status').value,
          valid_until: field('valid_until').value || null,
          delivery_estimate: field('delivery_estimate').value.trim() || null,
          discount: discount, extra_fees: fees, notes: field('notes').value.trim() || null
        };
        const items = function (quoteId) {
          return lines.map(function (l) {
            const manual = !!l.el.dataset.manual;
            return {
              quote_id: quoteId, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
              price_override_reason: manual && l.reason ? l.reason : null
            };
          });
        };

        let saved;
        if (isNew) {
          const r = await sb.from('quotes').insert(header).select().single();
          if (r.error) throw r.error;
          saved = r.data;
          const ri = await sb.from('quote_items').insert(items(saved.id));
          if (ri.error) {
            await sb.from('quotes').delete().eq('id', saved.id);   // évite un devis vide
            throw ri.error;
          }
        } else {
          const r = await sb.from('quotes').update(header).eq('id', q.id).select().single();
          if (r.error) throw r.error;
          saved = r.data;
          const oldIds = q.quote_items.map(function (i) { return i.id; });
          const ri = await sb.from('quote_items').insert(items(q.id));   // nouvelles lignes d'abord
          if (ri.error) throw ri.error;
          if (oldIds.length) {
            const rd = await sb.from('quote_items').delete().in('id', oldIds);
            if (rd.error) throw rd.error;
          }
        }
        await loadQuotes();
        renderQuotes();
        toast('Devis enregistré : ' + saved.quote_number);
        return true;
      }
    });
  }

  /* ---------------------------- DEVIS : PDF ---------------------------- */
  function makePdf(q) {
    if (!window.jspdf) { toast('Le module PDF n\'a pas pu se charger. Vérifiez votre connexion.', true); return; }
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15, green = [31, 107, 70], ink = [23, 38, 30], gray = [102, 122, 112];
    const client = q.clients || {};
    const items = q.quote_items || [];

    // En-tête
    doc.setFillColor(green[0], green[1], green[2]); doc.rect(0, 0, W, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(C.COMPANY.name, M, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(C.COMPANY.tagline || '', M, 23);
    doc.text([C.COMPANY.address, C.COMPANY.phone, C.COMPANY.email].filter(Boolean).join('   |   '), M, 30);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('DEVIS', W - M, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(q.quote_number || '', W - M, 23, { align: 'right' });
    doc.text('Date : ' + fmtDateTs(q.created_at), W - M, 30, { align: 'right' });

    // Client
    let y = 48;
    doc.setTextColor(gray[0], gray[1], gray[2]); doc.setFontSize(9); doc.text('CLIENT', M, y);
    doc.setTextColor(ink[0], ink[1], ink[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    y += 6; doc.text(client.name || '', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    [client.organization, client.contact_person ? 'À l\'attention de : ' + client.contact_person : '',
      client.phone ? 'Tél : ' + client.phone : '', client.address].filter(Boolean).forEach(function (l) {
      y += 5; doc.text(String(l), M, y);
    });

    // Tableau des articles
    y += 12;
    const colQty = 118, colPrice = 156, colTot = W - M - 2;
    function tableHead() {
      doc.setFillColor(230, 244, 236); doc.rect(M, y, W - 2 * M, 8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(green[0], green[1], green[2]);
      doc.text('Description', M + 2, y + 5.5);
      doc.text('Qté', colQty, y + 5.5, { align: 'right' });
      doc.text('Prix unitaire', colPrice, y + 5.5, { align: 'right' });
      doc.text('Total', colTot, y + 5.5, { align: 'right' });
      y += 8;
    }
    tableHead();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(ink[0], ink[1], ink[2]);
    items.forEach(function (it) {
      const lines = doc.splitTextToSize(String(it.description), 88);
      const rowH = lines.length * 5 + 3;
      if (y + rowH > 262) { doc.addPage(); y = 20; tableHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(ink[0], ink[1], ink[2]); }
      doc.text(lines, M + 2, y + 5);
      doc.text(String(it.quantity), colQty, y + 5, { align: 'right' });
      doc.text(fmt(it.unit_price), colPrice, y + 5, { align: 'right' });
      doc.text(fmt(it.quantity * it.unit_price), colTot, y + 5, { align: 'right' });
      y += rowH;
      doc.setDrawColor(219, 230, 223); doc.line(M, y, W - M, y);
    });

    // Totaux
    if (y > 235) { doc.addPage(); y = 20; }
    y += 8;
    const sub = subTotal(items);
    function totalLine(label, value, bold) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 10);
      doc.text(label, 128, y); doc.text(value, colTot, y, { align: 'right' }); y += bold ? 7 : 6;
    }
    totalLine('Sous-total', fmt(sub) + ' FCFA', false);
    if (Number(q.discount) > 0) totalLine('Remise', '- ' + fmt(q.discount) + ' FCFA', false);
    if (Number(q.extra_fees) > 0) totalLine('Frais supplémentaires', fmt(q.extra_fees) + ' FCFA', false);
    doc.setDrawColor(green[0], green[1], green[2]); doc.line(128, y - 3, colTot, y - 3); y += 2;
    doc.setTextColor(green[0], green[1], green[2]);
    totalLine('TOTAL', fmt(quoteTotal(q)) + ' FCFA', true);
    doc.setTextColor(ink[0], ink[1], ink[2]);

    // Conditions
    y += 6;
    const cond = [
      ['Conditions de paiement', C.PAYMENT_TERMS],
      ['Délai estimatif', q.delivery_estimate],
      ['Validité du devis', q.valid_until ? 'Valable jusqu\'au ' + fmtDateOnly(q.valid_until) : ''],
      ['Remarques', q.notes]
    ].filter(function (c) { return c[1]; });
    cond.forEach(function (c) {
      const txt = doc.splitTextToSize(String(c[1]), W - 2 * M - 4);
      if (y + txt.length * 5 + 8 > 280) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(c[0], M, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.text(txt, M + 2, y); y += txt.length * 5 + 3;
    });

    // Pied de page
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFontSize(8); doc.setTextColor(gray[0], gray[1], gray[2]);
      doc.text(C.COMPANY.name + ' - ' + (q.quote_number || '') + ' - Page ' + p + '/' + pages, W / 2, 290, { align: 'center' });
    }
    doc.save((q.quote_number || 'devis') + '.pdf');
  }

  /* ---------------------------- COMMANDES ---------------------------- */
  function fmtDateTime(s) { const d = new Date(s); return fmtDateTs(s) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function orderBadge(st) {
    if (st === 'annulee') return 'st-refuse';
    if (['livree', 'soldee', 'terminee'].indexOf(st) !== -1) return 'st-accepte';
    return 'st-envoye';
  }

  function renderOrders() {
    const view = $('#view');
    const open = state.orders.filter(function (o) { return ORDER_CLOSED.indexOf(o.status) === -1; });
    const late = state.orders.filter(isLate);
    const toCash = state.orders.reduce(function (s, o) { return s + (o.status === 'annulee' ? 0 : Math.max(restOf(o), 0)); }, 0);
    view.innerHTML =
      '<div class="view-head"><h2>Commandes</h2></div>' +
      '<p class="hint">Une commande se crée depuis un devis accepté : ouvrez le devis (onglet Devis) puis « Convertir en commande ».</p>' +
      '<div class="stats">' +
      '<div class="stat-box"><span>En cours</span><b>' + open.length + '</b></div>' +
      '<div class="stat-box' + (late.length ? ' bad' : '') + '"><span>En retard</span><b>' + late.length + '</b></div>' +
      '<div class="stat-box"><span>Reste à encaisser</span><b>' + money(toCash) + '</b></div></div>' +
      '<div class="filters"><input id="o-search" type="search" placeholder="Rechercher (numéro ou client)">' +
      '<select id="o-status"><option value="">Tous les statuts</option><option value="__retard">En retard</option>' + options(ORDER_STATUS, '') + '</select></div>' +
      '<div id="o-list"></div>';
    $('#o-search').addEventListener('input', renderOrderList);
    $('#o-status').addEventListener('change', renderOrderList);
    $('#o-list').addEventListener('click', function (e) {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const o = state.orders.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (o) openOrderModal(o);
    });
    renderOrderList();
  }

  function renderOrderList() {
    const term = $('#o-search').value.trim().toLowerCase();
    const st = $('#o-status').value;
    const rows = state.orders.filter(function (o) {
      const name = ((o.clients && o.clients.name) || '').toLowerCase();
      const okSt = !st || (st === '__retard' ? isLate(o) : o.status === st);
      return okSt && (!term || (o.order_number || '').toLowerCase().includes(term) || name.includes(term));
    });
    $('#o-list').innerHTML = rows.length ? rows.map(function (o) {
      const rest = restOf(o);
      const late = isLate(o);
      const wa = o.clients ? waLink(o.clients.whatsapp || o.clients.phone) : '';
      const lv = latestVisual(o);
      return '<article class="card' + (late ? ' late' : '') + '"><div class="card-top"><strong>' + esc(o.order_number) + '</strong>' +
        '<span class="badge ' + orderBadge(o.status) + '">' + esc(ORDER_STATUS[o.status] || o.status) + '</span></div>' +
        '<div class="card-client">' + esc(o.clients ? o.clients.name : '') + (o.priority === 'urgente' ? ' <span class="badge st-expire">Urgente</span>' : '') +
        (lv ? ' <span class="badge ' + VISUAL_BADGE[lv.status] + '">Visuel : ' + esc(lv.status === 'valide' ? 'validé' : lv.status === 'en_attente' ? 'en attente' : 'modification demandée') + '</span>' : '') + '</div>' +
        '<div class="card-meta"><span>Total : <b>' + money(o.total_amount) + '</b></span>' +
        '<span>Payé : <b>' + money(paidOf(o)) + '</b></span>' +
        '<span>Reste : <b>' + money(rest) + '</b></span>' +
        (o.due_date ? '<span' + (late ? ' class="late-text"' : '') + '>Livraison : <b>' + esc(fmtDateOnly(o.due_date)) + '</b>' + (late ? ' (en retard)' : '') + '</span>' : '') +
        (wa ? '<a class="link" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</div>' +
        '<div class="card-actions"><button class="btn btn-small" data-id="' + esc(o.id) + '">Ouvrir</button></div></article>';
    }).join('') : '<p class="empty">Aucune commande pour le moment.</p>';
  }

  function openOrderModal(order) {
    const o = order;
    const rest = restOf(o);
    const canPay = o.status !== 'annulee' && rest > 0;
    const pays = (o.payments || []).slice().sort(function (a, b) {
      return String(a.created_at).localeCompare(String(b.created_at));
    });

    const payRows = pays.length ? pays.map(function (p) {
      return '<div class="pay-row"><div><b>' + money(p.amount) + '</b> · ' + esc(PAY_KINDS[p.kind] || p.kind) + ' · ' + esc(PAY_METHODS[p.method] || p.method) +
        '<div class="l-hint">' + esc(fmtDateOnly(p.paid_at)) + ' · ' + esc(p.receipt_number) + (p.reference ? ' · Réf. ' + esc(p.reference) : '') + '</div></div>' +
        '<button type="button" class="btn btn-small btn-ghost" data-receipt="' + esc(p.id) + '">Reçu</button></div>';
    }).join('') : '<p class="hint">Aucun paiement enregistré.</p>';

    const items = (o.order_items || []).map(function (i) {
      return '<div class="pay-row"><div>' + esc(i.description) + '</div><b>× ' + esc(i.quantity) + '</b></div>';
    }).join('');

    const payForm = canPay
      ? '<div class="line"><div class="form-grid">' +
        '<label class="f">Type<select class="p-kind">' + options(PAY_KINDS, paidOf(o) === 0 ? 'acompte' : 'paiement') + '</select></label>' +
        '<label class="f">Montant (FCFA)<input class="p-amount" type="number" min="1" inputmode="numeric" placeholder="Reste : ' + fmt(rest) + '"></label>' +
        '<label class="f">Mode de paiement<select class="p-method">' + options(PAY_METHODS, 'especes') + '</select></label>' +
        '<label class="f">Référence (facultatif)<input class="p-ref" placeholder="N° de transaction"></label>' +
        '<label class="f">Date du paiement<input class="p-date" type="date" value="' + todayStr() + '"></label></div>' +
        '<div class="card-actions"><button type="button" class="btn btn-small" id="pay-add">Ajouter le paiement</button></div></div>'
      : '<p class="hint">' + (o.status === 'annulee' ? 'Commande annulée : aucun paiement à ajouter.' : 'Commande entièrement payée.') + '</p>';

    /* --- Visuel à faire valider par le client --- */
    const visuals = (o.order_visuals || []).slice().sort(function (a, b) { return b.version - a.version; });
    const visRows = visuals.length ? visuals.map(function (v) {
      const url = visualUrl(v.file_path);
      const isPdf = /\.pdf$/i.test(v.file_path);
      const old = v.status === 'remplace';
      const canReopen = (v.status === 'valide' || v.status === 'modification_demandee') && VISUAL_REOPENABLE.indexOf(o.status) !== -1;
      const thumb = old ? '' : (isPdf
        ? '<a class="vis-img vis-pdf" href="' + esc(url) + '" target="_blank" rel="noopener">PDF</a>'
        : '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="vis-img" src="' + esc(url) + '" alt="Visuel version ' + esc(v.version) + '" loading="lazy"></a>');
      let proof = '';
      if (v.status === 'valide') {
        proof = '<div class="proof">Validé par <b>' + esc(v.client_name) + '</b> le ' + esc(fmtDateTime(v.decided_at)) + '</div>';
      } else if (v.status === 'modification_demandee') {
        proof = '<div class="proof warn">Le client demande : « ' + esc(v.client_comment) + ' » (' + esc(fmtDateTime(v.decided_at)) + ')</div>';
      }
      return '<div class="vis' + (old ? ' old' : '') + '">' + thumb + '<div class="vis-info">' +
        '<div><b>Version ' + esc(v.version) + '</b> <span class="badge ' + VISUAL_BADGE[v.status] + '">' + esc(VISUAL_STATUS[v.status]) + '</span></div>' +
        '<div class="l-hint">' + esc(v.file_name || '') + ' · envoyé le ' + esc(fmtDateTime(v.created_at)) + '</div>' + proof +
        (canReopen ? '<button type="button" class="btn btn-small btn-ghost" data-reopen="' + esc(v.id) + '">Rouvrir la validation</button>' : '') +
        '</div></div>';
    }).join('') : '<p class="hint">Aucun visuel envoyé pour le moment.</p>';
    const visualSection = '<h4>Visuel à valider</h4><div id="vis-list">' + visRows + '</div>' +
      (o.status === 'annulee' ? '' :
        '<div class="line"><label class="f">' + (visuals.length ? 'Envoyer une nouvelle version (remplace la précédente)' : 'Envoyer le visuel (PNG, JPG, WEBP ou PDF, 5 Mo maximum)') +
        '<input type="file" id="vis-file" accept="image/png,image/jpeg,image/webp,application/pdf"></label>' +
        '<div class="card-actions"><button type="button" class="btn btn-small" id="vis-send">Envoyer le visuel</button></div></div>');

    /* --- Lien de suivi à envoyer au client --- */
    const trkUrl = trackingUrl(o);
    const waNum = o.clients ? waLink(o.clients.whatsapp || o.clients.phone) : '';
    const waMsg = 'Bonjour ' + (o.clients ? o.clients.name : '') + ', voici le lien pour suivre votre commande ' + o.order_number +
      ' chez ' + C.COMPANY.name + ' et valider votre visuel : ' + trkUrl;
    const waHref = (waNum || 'https://wa.me/') + '?text=' + encodeURIComponent(waMsg);
    const linkSection = '<h4>Lien de suivi pour le client</h4>' +
      '<p class="hint">Le client n\'a pas besoin de compte : il ouvre ce lien pour voir l\'avancement, valider son visuel et retrouver ses reçus. Ne l\'envoyez qu\'à lui.</p>' +
      '<div class="line"><input id="trk-url" readonly value="' + esc(trkUrl) + '">' +
      '<div class="card-actions"><button type="button" class="btn btn-small" id="trk-copy">Copier le lien</button>' +
      '<a class="btn btn-small btn-ghost" id="trk-wa" href="' + esc(waHref) + '" target="_blank" rel="noopener">Envoyer par WhatsApp</a>' +
      '<button type="button" class="btn btn-small btn-ghost" id="trk-regen">Changer le lien</button></div></div>';

    const body = h(
      '<div>' +
      '<div class="totals"><div><span>Total de la commande</span><span>' + money(o.total_amount) + '</span></div>' +
      '<div><span>Déjà payé</span><span>' + money(paidOf(o)) + '</span></div>' +
      '<div class="grand"><span>Reste à payer</span><span>' + money(rest) + '</span></div></div>' +
      '<div class="card-meta" style="margin-top:8px"><span>Client : <b>' + esc(o.clients ? o.clients.name : '') + '</b></span>' +
      (o.quote ? '<span>Devis : <b>' + esc(o.quote.quote_number) + '</b></span>' : '') + '</div>' +
      '<h4>Suivi</h4><div class="form-grid">' +
      '<label class="f">Statut<select name="status">' + options(ORDER_STATUS, o.status) + '</select></label>' +
      '<label class="f">Livraison souhaitée<input type="date" name="due_date" value="' + esc(o.due_date) + '"></label>' +
      '<label class="f">Priorité<select name="priority"><option value="normale"' + (o.priority === 'normale' ? ' selected' : '') + '>Normale</option>' +
      '<option value="urgente"' + (o.priority === 'urgente' ? ' selected' : '') + '>Urgente</option></select></label>' +
      '<label class="f full">Notes<textarea name="notes" rows="2">' + esc(o.notes) + '</textarea></label></div>' +
      (o.production_note ? '<p class="note" style="margin-top:12px"><b>Remarque de production :</b> ' + esc(o.production_note) + '</p>' : '') +
      visualSection + linkSection +
      '<h4>Articles</h4>' + (items || '<p class="hint">Aucun article.</p>') +
      '<h4>Paiements</h4><div id="pay-list">' + payRows + '</div>' + payForm +
      '<h4>Historique</h4><div id="hist" class="hint">Chargement…</div></div>');

    const field = function (n) { return $('[name="' + n + '"]', body); };
    let modalRef = null;

    // La touche Entrée dans le formulaire de paiement ne doit pas enregistrer la commande
    $$('.line input', body).forEach(function (i) {
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    });

    body.addEventListener('click', function (e) {
      const rb = e.target.closest('[data-receipt]');
      if (!rb) return;
      const p = (o.payments || []).find(function (x) { return x.id === rb.getAttribute('data-receipt'); });
      if (p) makeReceipt(o, p);
    });

    const addBtn = $('#pay-add', body);
    if (addBtn) addBtn.addEventListener('click', async function () {
      const amount = parseInt($('.p-amount', body).value, 10);
      if (!(amount >= 1)) { toast('Indiquez un montant valide.', true); return; }
      if (amount > rest) { toast('Le montant dépasse le reste à payer (' + money(rest) + ').', true); return; }
      addBtn.disabled = true;
      const r = await sb.from('payments').insert({
        order_id: o.id, amount: amount, kind: $('.p-kind', body).value, method: $('.p-method', body).value,
        reference: $('.p-ref', body).value.trim() || null, paid_at: $('.p-date', body).value || todayStr()
      }).select().single();
      if (r.error) { toast(errMsg(r.error), true); addBtn.disabled = false; return; }
      try { await loadOrders(); } catch (err) { toast(errMsg(err), true); }
      if (modalRef) modalRef.close();
      if (state.tab === 'commandes') renderOrders();
      const fresh = state.orders.find(function (x) { return x.id === o.id; });
      if (fresh) openOrderModal(fresh);
      toast('Paiement enregistré : ' + r.data.receipt_number);
    });

    // Recharge les données puis rouvre la fenêtre de la commande
    async function refreshAndReopen(msg) {
      try { await loadOrders(); } catch (err) { toast(errMsg(err), true); }
      if (modalRef) modalRef.close();
      if (state.tab === 'commandes') renderOrders();
      const fresh = state.orders.find(function (x) { return x.id === o.id; });
      if (fresh) openOrderModal(fresh);
      if (msg) toast(msg);
    }

    // Envoi d'un visuel : fichier -> stockage, puis enregistrement via la fonction sécurisée
    const visBtn = $('#vis-send', body);
    if (visBtn) visBtn.addEventListener('click', async function () {
      const f = $('#vis-file', body).files[0];
      if (!f) { toast('Choisissez d\'abord un fichier.', true); return; }
      const ext = VISUAL_MIME[f.type];
      if (!ext) { toast('Format non accepté. Utilisez PNG, JPG, WEBP ou PDF.', true); return; }
      if (f.size > VISUAL_MAX) { toast('Fichier trop lourd (5 Mo maximum).', true); return; }
      visBtn.disabled = true; visBtn.textContent = 'Envoi…';
      const path = o.id + '/' + randomId() + '.' + ext;
      const up = await sb.storage.from('visuels').upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) { toast(errMsg(up.error), true); visBtn.disabled = false; visBtn.textContent = 'Envoyer le visuel'; return; }
      const r = await sb.rpc('add_visual', { p_order_id: o.id, p_path: path, p_name: f.name });
      if (r.error) {
        await sb.storage.from('visuels').remove([path]);   // on ne garde pas un fichier orphelin
        toast(errMsg(r.error), true); visBtn.disabled = false; visBtn.textContent = 'Envoyer le visuel'; return;
      }
      await refreshAndReopen('Visuel envoyé. Envoyez maintenant le lien de suivi au client.');
    });

    // Rouvrir une validation
    $$('[data-reopen]', body).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!window.confirm('Rouvrir la validation ? Le client pourra valider ou demander une modification à nouveau. L\'historique est conservé.')) return;
        b.disabled = true;
        const r = await sb.rpc('reopen_visual', { p_visual_id: b.getAttribute('data-reopen') });
        if (r.error) { toast(errMsg(r.error), true); b.disabled = false; return; }
        await refreshAndReopen('Validation rouverte.');
      });
    });

    // Lien de suivi : copier / changer
    $('#trk-copy', body).addEventListener('click', async function () {
      const inp = $('#trk-url', body);
      try { await navigator.clipboard.writeText(inp.value); toast('Lien copié.'); }
      catch (err) { inp.focus(); inp.select(); toast('Sélectionnez le lien et copiez-le.', true); }
    });
    $('#trk-regen', body).addEventListener('click', async function () {
      if (!window.confirm('Changer le lien ? L\'ancien lien ne fonctionnera plus : il faudra renvoyer le nouveau au client.')) return;
      const r = await sb.rpc('regenerate_tracking_token', { p_order_id: o.id });
      if (r.error) { toast(errMsg(r.error), true); return; }
      await refreshAndReopen('Nouveau lien créé.');
    });

    modalRef = openModal(o.order_number, body, {
      submitLabel: 'Enregistrer',
      onSubmit: async function () {
        const status = field('status').value;
        if (status !== o.status) {
          if ((status === 'soldee' || status === 'terminee') && rest > 0) {
            throw new Error('Impossible : il reste ' + money(rest) + ' à payer. Enregistrez d\'abord le paiement.');
          }
          if (['en_production', 'controle', 'prete', 'livree'].indexOf(status) !== -1 && paidOf(o) === 0) {
            if (!window.confirm('Aucun paiement n\'est enregistré pour cette commande. Continuer quand même ?')) return false;
          }
          if (status === 'annulee' && paidOf(o) > 0) {
            if (!window.confirm('Des paiements (' + money(paidOf(o)) + ') ont déjà été encaissés. Annuler quand même la commande ?')) return false;
          }
        }
        // Le statut n'est envoyé que s'il a été changé ici : sinon on risquerait d'écraser
        // une validation faite entre-temps par le client.
        const changes = {
          due_date: field('due_date').value || null, priority: field('priority').value,
          notes: field('notes').value.trim() || null
        };
        if (status !== o.status) changes.status = status;
        const r = await sb.from('orders').update(changes).eq('id', o.id);
        if (r.error) throw r.error;
        await loadOrders();
        if (state.tab === 'commandes') renderOrders();
        toast('Commande mise à jour.');
        return true;
      }
    });

    // Historique des changements de statut (chargé après l'ouverture)
    sb.from('order_status_history').select('status,changed_at').eq('order_id', o.id).order('changed_at')
      .then(function (r) {
        const box = $('#hist', body);
        if (!box) return;
        if (r.error || !r.data || !r.data.length) { box.textContent = 'Aucun changement enregistré.'; return; }
        box.className = '';
        box.innerHTML = r.data.map(function (x) {
          return '<div class="pay-row"><div>' + esc(ORDER_STATUS[x.status] || x.status) + '</div><span class="l-hint">' + esc(fmtDateTime(x.changed_at)) + '</span></div>';
        }).join('');
      });
  }

  /* ---------------------------- REÇU DE PAIEMENT (PDF) ---------------------------- */
  function makeReceipt(o, p) {
    if (!window.jspdf) { toast('Le module PDF n\'a pas pu se charger. Vérifiez votre connexion.', true); return; }
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a5' });
    const W = 148, M = 12, green = [31, 107, 70], ink = [23, 38, 30], gray = [102, 122, 112];
    const client = o.clients || {};

    // Total payé jusqu'à ce paiement inclus (dans l'ordre d'enregistrement)
    const sorted = (o.payments || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    let paidUpTo = 0;
    for (let i = 0; i < sorted.length; i++) { paidUpTo += Number(sorted[i].amount); if (sorted[i].id === p.id) break; }
    const left = Number(o.total_amount) - paidUpTo;

    doc.setFillColor(green[0], green[1], green[2]); doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(C.COMPANY.name, M, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text([C.COMPANY.address, C.COMPANY.phone, C.COMPANY.email].filter(Boolean).join('  |  '), M, 20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('REÇU DE PAIEMENT', W - M, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(p.receipt_number || '', W - M, 20, { align: 'right' });
    doc.text('Date : ' + fmtDateOnly(p.paid_at), W - M, 25, { align: 'right' });

    let y = 42;
    function row(label, value, bold) {
      doc.setTextColor(gray[0], gray[1], gray[2]); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(label, M, y);
      doc.setTextColor(ink[0], ink[1], ink[2]); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 11 : 10);
      const lines = doc.splitTextToSize(String(value), 80);
      doc.text(lines, W - M, y, { align: 'right' });
      y += Math.max(lines.length, 1) * 5.5 + 2;
    }
    row('Reçu de', client.name || '');
    row('Commande', o.order_number);
    row('Type de paiement', PAY_KINDS[p.kind] || p.kind);
    row('Mode de paiement', PAY_METHODS[p.method] || p.method);
    if (p.reference) row('Référence', p.reference);
    y += 2;
    doc.setDrawColor(green[0], green[1], green[2]); doc.line(M, y, W - M, y); y += 8;
    doc.setTextColor(green[0], green[1], green[2]);
    row('MONTANT REÇU', fmt(p.amount) + ' FCFA', true);
    y += 2;
    row('Total de la commande', fmt(o.total_amount) + ' FCFA');
    row('Total payé à ce jour', fmt(paidUpTo) + ' FCFA');
    row('Reste à payer', fmt(left) + ' FCFA', true);

    y += 12;
    doc.setTextColor(gray[0], gray[1], gray[2]); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Cachet et signature', W - M, y, { align: 'right' });
    doc.setFontSize(8);
    doc.text(C.COMPANY.name + ' - ' + (p.receipt_number || ''), W / 2, 200, { align: 'center' });
    doc.save((p.receipt_number || 'recu') + '.pdf');
  }

  /* ---------------------------- Démarrage ---------------------------- */
  async function start() {
    const s = await sb.auth.getSession();
    const session = s.data && s.data.session;
    if (!session) { renderLogin(state.loginMsg); state.loginMsg = ''; return; }
    state.user = session.user;
    const p = await sb.from('profiles').select('full_name, role, active').eq('id', session.user.id).maybeSingle();
    if (p.error || !p.data || !p.data.active) {
      logout('Ce compte est désactivé ou introuvable. Contactez l\'administrateur.');
      return;
    }
    state.profile = p.data;
    if (p.data.role !== 'admin') { renderOperator(); return; }
    renderShell();
    $('#view').innerHTML = '<p class="empty">Chargement…</p>';
    try {
      await Promise.all([loadClients(), loadTiers(), loadQuotes(), loadOrders()]);
    } catch (e) {
      toast(errMsg(e), true);
    }
    showTab(state.tab);
  }

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') { renderLogin(state.loginMsg); state.loginMsg = ''; }
  });
  start();
})();
