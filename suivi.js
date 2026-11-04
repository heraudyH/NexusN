/* =====================================================================
   NEXUS NUMÉRIQUE — Page de suivi pour le client (sans compte)
   Fichiers : suivi.html, suivi.js (+ gestion.css et gestion-config.js)

   Sécurité : le client n'accède à rien directement. Il passe par 3 fonctions
   de la base de données, qui exigent le code secret de SA commande (dans le
   lien). Toutes les valeurs affichées sont échappées.
   ===================================================================== */
(function () {
  'use strict';

  const C = window.NEXUS_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
  const app = document.getElementById('app');

  const STEPS = [
    ['devis_accepte', 'Commande confirmée'], ['acompte_recu', 'Acompte reçu'],
    ['visuel_validation', 'Visuel à valider'], ['visuel_valide', 'Visuel validé'],
    ['en_production', 'En production'], ['controle', 'Contrôle qualité'],
    ['prete', 'Commande prête'], ['livree', 'Livrée']
  ];
  const STATUS_LABEL = {
    devis_accepte: 'Commande confirmée', acompte_recu: 'Acompte reçu', visuel_validation: 'Visuel à valider',
    visuel_valide: 'Visuel validé', en_production: 'En production', controle: 'Contrôle qualité',
    prete: 'Commande prête', livree: 'Livrée', soldee: 'Livrée et soldée', terminee: 'Terminée', annulee: 'Annulée'
  };
  const PAY_KINDS = { acompte: 'Acompte', paiement: 'Paiement', solde: 'Solde' };

  let token = '';
  let toastTimer;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function money(n) { return fmt(n) + ' FCFA'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateOnly(s) { return s ? String(s).split('-').reverse().join('/') : ''; }
  function dateTime(s) {
    const d = new Date(s);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' à ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function visualUrl(path) {
    return C.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/visuels/' +
      String(path).split('/').map(encodeURIComponent).join('/');
  }
  function waLink(num) {
    let d = String(num || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 && d[0] === '0') d = '225' + d;
    return 'https://wa.me/' + d;
  }
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 4200);
  }
  function errText(e) {
    const m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Connexion internet indisponible. Réessayez.';
    return m || 'Une erreur est survenue. Réessayez.';
  }

  function head(title, sub) {
    return '<header class="sv-head"><div class="in"><div class="brand-mark">N</div><h1>' + esc(title) + '</h1>' +
      (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></header>';
  }
  function showProblem(msg) {
    app.innerHTML = head(C.COMPANY.name, 'Suivi de commande') +
      '<div class="sv-wrap"><div class="sv-card"><p class="sv-msg sv-bad">' + esc(msg) + '</p>' +
      '<p class="hint">Si le problème continue, contactez-nous sur WhatsApp au ' + esc(C.COMPANY.phone) + '.</p></div></div>';
  }

  /* ------------------------------ Affichage ------------------------------ */
  function renderSteps(d) {
    const cancelled = d.status === 'annulee';
    if (cancelled) return '<p class="sv-msg sv-bad">Cette commande a été annulée. Pour toute question, contactez-nous.</p>';
    let cur = STEPS.findIndex(function (s) { return s[0] === d.status; });
    if (d.status === 'soldee' || d.status === 'terminee') cur = STEPS.length;      // tout est terminé
    return '<ul class="steps">' + STEPS.map(function (s, i) {
      let cls = i < cur ? 'done' : (i === cur ? 'now' : '');
      if (s[0] === 'acompte_recu' && cls === '' && Number(d.paid) > 0) cls = 'done';
      return '<li class="' + cls + '"><span class="dot">' + (cls === 'done' ? '&#10003;' : '') + '</span>' + esc(s[1]) + '</li>';
    }).join('') + '</ul>';
  }

  function renderVisual(d) {
    const list = (d.visuals || []);
    const v = list[list.length - 1];
    if (!v) return '';
    const url = visualUrl(v.file_path);
    const isPdf = /\.pdf$/i.test(v.file_path);
    let html = '<section class="sv-card"><h2>Votre visuel</h2>' +
      (isPdf
        ? '<a class="sv-pdf" href="' + esc(url) + '" target="_blank" rel="noopener">Ouvrir le visuel (PDF)</a>'
        : '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="sv-visual" src="' + esc(url) + '" alt="Visuel de votre commande"></a>');

    if (v.status === 'valide') {
      html += '<p class="sv-msg sv-ok">&#10003; Visuel validé par <b>' + esc(v.client_name) + '</b> le ' + esc(dateTime(v.decided_at)) +
        '. Nous lançons la suite.</p>';
    } else if (v.status === 'modification_demandee') {
      html += '<p class="sv-msg sv-warn">Votre demande de modification a bien été envoyée le ' + esc(dateTime(v.decided_at)) +
        ' : « ' + esc(v.client_comment) + ' ». Nous vous enverrons une nouvelle version.</p>';
    } else if (d.status !== 'annulee') {
      html += '<p class="hint">Vérifiez bien le visuel (texte, orthographe, couleurs, emplacement). Une fois validé, il sera imprimé tel quel.</p>' +
        '<label class="f">Votre nom (pour confirmer)<input id="v-name" autocomplete="name" maxlength="100" placeholder="Nom et prénom"></label>' +
        '<div class="sv-actions"><button type="button" class="btn" id="v-ok">Je valide ce visuel</button></div>' +
        '<h2 style="margin-top:20px">Quelque chose à changer ?</h2>' +
        '<label class="f">Dites-nous quoi modifier<textarea id="v-com" rows="3" maxlength="1000" placeholder="Exemple : mettre le logo plus grand"></textarea></label>' +
        '<div class="sv-actions"><button type="button" class="btn btn-warn" id="v-chg">Demander une modification</button></div>';
    }
    return html + '</section>';
  }

  function renderPayments(d) {
    const pays = (d.payments || []).map(function (p) {
      return '<div class="pay-row"><div><b>' + money(p.amount) + '</b> · ' + esc(PAY_KINDS[p.kind] || p.kind) +
        '<div class="l-hint">' + esc(dateOnly(p.paid_at)) + ' · Reçu n° ' + esc(p.receipt_number) + '</div></div></div>';
    }).join('') || '<p class="hint">Aucun paiement enregistré pour le moment.</p>';
    return '<section class="sv-card"><h2>Paiements</h2>' +
      '<div class="totals"><div><span>Total de la commande</span><span>' + money(d.total) + '</span></div>' +
      '<div><span>Déjà payé</span><span>' + money(d.paid) + '</span></div>' +
      '<div class="grand"><span>Reste à payer</span><span>' + money(d.rest) + '</span></div></div>' +
      '<div style="margin-top:10px">' + pays + '</div></section>';
  }

  function render(d) {
    const items = (d.items || []).map(function (i) {
      return '<div class="pay-row"><div>' + esc(i.description) + '</div><b>× ' + esc(i.quantity) + '</b></div>';
    }).join('');
    const wa = waLink(C.COMPANY.phone);
    app.innerHTML = head('Commande ' + d.order_number, 'Bonjour ' + d.client_name) +
      '<div class="sv-wrap">' +
      '<section class="sv-card"><h2>Où en est votre commande ?</h2>' +
      '<p style="margin-bottom:8px"><span class="badge st-envoye">' + esc(STATUS_LABEL[d.status] || d.status) + '</span>' +
      (d.due_date ? ' <span class="l-hint">Livraison prévue : <b>' + esc(dateOnly(d.due_date)) + '</b></span>' : '') + '</p>' +
      renderSteps(d) + '</section>' +
      renderVisual(d) +
      '<section class="sv-card"><h2>Votre commande</h2>' + (items || '<p class="hint">Aucun article.</p>') + '</section>' +
      renderPayments(d) +
      '<p class="sv-foot">' + esc(C.COMPANY.name) + (C.COMPANY.address ? ' · ' + esc(C.COMPANY.address) : '') + '<br>' +
      (wa ? '<a class="link" href="' + esc(wa) + '" target="_blank" rel="noopener">Nous écrire sur WhatsApp</a>' : '') + '</p></div>';

    const ok = document.getElementById('v-ok');
    const chg = document.getElementById('v-chg');
    const last = (d.visuals || [])[(d.visuals || []).length - 1];
    if (ok && last) ok.addEventListener('click', function () { decide(ok, 'validate_visual', {
      p_token: token, p_visual_id: last.id, p_name: document.getElementById('v-name').value.trim()
    }, 'Merci ! Votre visuel est validé.'); });
    if (chg && last) chg.addEventListener('click', function () { decide(chg, 'request_visual_change', {
      p_token: token, p_visual_id: last.id, p_comment: document.getElementById('v-com').value.trim()
    }, 'Votre demande a été envoyée.'); });
  }

  async function decide(btn, fn, args, okMsg) {
    if (fn === 'validate_visual') {
      if (args.p_name.length < 2) { toast('Tapez votre nom pour confirmer.', true); return; }
      if (!window.confirm('Confirmer la validation de ce visuel ? Il sera imprimé tel quel.')) return;
    } else if (args.p_comment.length < 3) {
      toast('Expliquez ce qu\'il faut modifier.', true); return;
    }
    btn.disabled = true;
    const r = await sb.rpc(fn, args);
    if (r.error) { toast(errText(r.error), true); btn.disabled = false; await load(true); return; }
    await load(true);
    toast(okMsg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function load(silent) {
    const r = await sb.rpc('track_order', { p_token: token });
    if (r.error) { if (!silent) showProblem(errText(r.error)); else toast(errText(r.error), true); return; }
    if (!r.data) { showProblem('Ce lien n\'est pas valide ou a été remplacé. Demandez-nous le nouveau lien sur WhatsApp.'); return; }
    render(r.data);
  }

  token = (new URLSearchParams(window.location.search).get('t') || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    showProblem('Lien incomplet. Ouvrez le lien tel que nous vous l\'avons envoyé, en entier.');
  } else {
    load(false);
  }
})();
