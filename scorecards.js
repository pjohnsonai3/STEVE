/* ============================================================================
   STEVE — Vendor scorecards  (scorecards.js)
   Adds a Directory / Scorecards toggle to the Vendors page. Scorecards roll up,
   per vendor: committed value, lines, paid-to-date, open POs, lead time, late
   deliveries, and rating. Non-destructive: wraps renderSuppliers.
   ============================================================================ */
(function () {
  'use strict';
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(n) { return (typeof fmt === 'function') ? fmt(n) : '$' + Math.round(n || 0).toLocaleString(); }
  function mode() { return localStorage.getItem('vsc_mode') || 'directory'; }

  function metricsByVendor() {
    var m = {};
    function row(name) { if (!name) return null; return m[name] || (m[name] = { committed: 0, paid: 0, lines: 0, pos: 0, late: 0, projects: {} }); }
    projects.forEach(function (p) { try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(p.name); } catch (e) {} });
    projects.forEach(function (p) {
      var bt = budgetTrackers[p.name]; if (!bt) return;
      bt.items.forEach(function (it) {
        if (it.isCategory || !it.vendor) return;
        var r = row(it.vendor); if (!r) return;
        r.committed += (it.qty || 0) * (it.estPrice || 0); r.paid += it.amtPaid || 0; r.lines++; r.projects[p.name] = 1;
      });
      if (typeof dlSummary === 'function') { (dlSummary(p.name).late || []).forEach(function (lt) { var r = row(lt.vendor); if (r) r.late++; }); }
    });
    (typeof vendorPOs !== 'undefined' ? vendorPOs : []).forEach(function (po) {
      var mn = po.mfrName || ''; if (!mn) return;
      Object.keys(m).forEach(function (name) {
        var a = name.toLowerCase(), b = mn.toLowerCase();
        if (a && (b.indexOf(a) !== -1 || a.indexOf(b) !== -1)) m[name].pos++;
      });
    });
    return m;
  }

  function stars(r) {
    r = r || 0; var full = Math.round(r); var out = '';
    for (var i = 1; i <= 5; i++) out += '<span style="color:' + (i <= full ? 'var(--amber)' : 'var(--border2)') + '">\u2605</span>';
    return out;
  }

  function renderCards() {
    var wrap = document.getElementById('vsc-cards'); if (!wrap) return;
    var q = ((document.getElementById('supplier-search') || {}).value || '').trim().toLowerCase();
    var sf = (document.getElementById('supplier-filter') || {}).value || '';
    var m = metricsByVendor();
    var maxCommit = Math.max.apply(null, Object.keys(m).map(function (k) { return m[k].committed; }).concat([1]));
    var list = (typeof suppliers !== 'undefined' ? suppliers : []).filter(function (v) {
      if (sf && v.status !== sf) return false;
      if (q && [v.name, v.category, v.country, v.email, v.notes].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    // sort: active vendors with commitment first
    list.sort(function (a, b) { return (m[b.name] ? m[b.name].committed : 0) - (m[a.name] ? m[a.name].committed : 0) || a.name.localeCompare(b.name); });

    var withData = list.filter(function (v) { return m[v.name]; }).length;
    var shown = q ? list : list.filter(function (v) { return m[v.name]; });
    var hidden = list.length - shown.length;
    var head = '<div style="font-size:12.5px;color:var(--text2);margin:0 0 14px">' + (q ? shown.length + ' match' + (shown.length !== 1 ? 'es' : '') : withData + ' vendor' + (withData !== 1 ? 's' : '') + ' active on current projects') + ' of ' + list.length + ' total. Scorecards roll up committed value, payments, and delivery performance.</div>';

    var cards = shown.map(function (v) {
      var d = m[v.name] || { committed: 0, paid: 0, lines: 0, pos: 0, late: 0, projects: {} };
      var bal = Math.max(0, d.committed - d.paid);
      var statusCls = v.status === 'Active' ? 'st-recv' : v.status === 'Pending' ? 'st-prod' : 'st-none';
      var lateChip = d.late > 0 ? '<span class="dl-late-pill" style="margin-left:6px">' + d.late + ' late</span>' : '';
      var spendBar = d.committed > 0 ? '<div class="rp-bar-track" style="margin-top:9px"><div class="rp-bar-fill" style="width:' + Math.max(2, d.committed / maxCommit * 100) + '%;background:var(--accent)"></div></div>' : '';
      return '<div class="vsc-card">' +
        '<div class="vsc-card-head"><div style="min-width:0"><div class="vsc-name">' + esc(v.name) + lateChip + '</div>' +
        '<div class="vsc-cat">' + esc(v.category || 'Uncategorized') + (v.country ? ' · ' + esc(v.country) : '') + '</div></div>' +
        '<span class="dl-badge ' + statusCls + '"><span class="d"></span>' + esc(v.status || '—') + '</span></div>' +
        '<div class="vsc-stars">' + ((typeof window.starWidgetHTML === 'function') ? window.starWidgetHTML(v.rating, 'vendor', v.id) : (stars(v.rating) + '<span class="vsc-rating">' + (v.rating ? v.rating.toFixed(1) : '\u2014') + '</span>')) +
        '<span class="vsc-lead">' + (v.lead ? v.lead + ' day lead' : 'lead n/a') + '</span></div>' +
        '<div class="vsc-metrics">' +
        '<div class="vsc-metric"><div class="v">' + money(d.committed) + '</div><div class="l">Committed</div></div>' +
        '<div class="vsc-metric"><div class="v" style="color:var(--green)">' + money(d.paid) + '</div><div class="l">Paid</div></div>' +
        '<div class="vsc-metric"><div class="v"' + (bal > 0 ? ' style="color:var(--red)"' : '') + '>' + money(bal) + '</div><div class="l">Balance</div></div>' +
        '<div class="vsc-metric"><div class="v">' + d.lines + '</div><div class="l">Lines</div></div>' +
        '</div>' + spendBar +
        '<div class="vsc-foot">' + (Object.keys(d.projects).length ? Object.keys(d.projects).length + ' project' + (Object.keys(d.projects).length !== 1 ? 's' : '') : 'No active commitments') + (d.pos ? ' · ' + d.pos + ' PO' + (d.pos !== 1 ? 's' : '') : '') + '</div>' +
        '</div>';
    }).join('');
    var note = (!q && hidden > 0) ? '<div style="font-size:12px;color:var(--text3);margin-top:16px">+ ' + hidden + ' more vendors with no current project activity — search by name to find them.</div>' : '';
    wrap.innerHTML = head + '<div class="vsc-grid">' + (cards || '<div class="rp-empty">No vendors match.</div>') + '</div>' + note;
  }

  function enhance() {
    var page = document.getElementById('page-suppliers'); if (!page) return;
    if (!document.getElementById('vsc-bar')) {
      var bar = document.createElement('div');
      bar.id = 'vsc-bar';
      bar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:12px';
      bar.innerHTML = '<div class="rp-seg"><button id="vsc-b-dir" onclick="vscSet(\'directory\')">Directory</button><button id="vsc-b-card" onclick="vscSet(\'scorecards\')">Scorecards</button></div>';
      page.insertBefore(bar, page.firstChild);
      var cards = document.createElement('div'); cards.id = 'vsc-cards'; cards.style.display = 'none';
      page.appendChild(cards);
    }
    apply();
  }

  function apply() {
    var page = document.getElementById('page-suppliers'); if (!page) return;
    var card = page.querySelector('.card'); // the directory table card
    var cards = document.getElementById('vsc-cards');
    var m = mode();
    var bd = document.getElementById('vsc-b-dir'), bc = document.getElementById('vsc-b-card');
    if (bd) bd.classList.toggle('active', m === 'directory');
    if (bc) bc.classList.toggle('active', m === 'scorecards');
    if (m === 'scorecards') { if (card) card.style.display = 'none'; if (cards) { cards.style.display = ''; } renderCards(); }
    else { if (card) card.style.display = ''; if (cards) cards.style.display = 'none'; }
  }

  window.vscSet = function (mo) { localStorage.setItem('vsc_mode', mo); apply(); };

  function install() {
    if (typeof window.renderSuppliers === 'function' && !window.renderSuppliers._vscWrapped) {
      var orig = window.renderSuppliers;
      var w = function () { var r = orig.apply(this, arguments); try { enhance(); } catch (e) {} return r; };
      w._vscWrapped = true; window.renderSuppliers = w;
    }
    // also enhance live search/filter in scorecard mode
    ['supplier-search', 'supplier-filter'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el._vscHook) { el._vscHook = true; el.addEventListener('input', function () { if (mode() === 'scorecards') renderCards(); }); el.addEventListener('change', function () { if (mode() === 'scorecards') renderCards(); }); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  setTimeout(install, 1200);
})();
