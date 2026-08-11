/* ============================================================================
   STEVE — Global command palette  (command.js)
   ⌘K / Ctrl-K opens a search-anywhere palette: jump to any project, purchase
   order, vendor, library item, page, or quick action. Self-installing.
   Reuses host globals: projects, vendorPOs, suppliers, activeProject, nav,
   openProject, viewPO, openAddProject, openAddSupplier, openNewVPO, openNewPA,
   _libCollect, escHtml.
   ============================================================================ */
(function () {
  'use strict';

  var ICONS = {
    project: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
    po: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h4"/>',
    vendor: '<path d="M4 4h16l1 5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0z"/><path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/>',
    item: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    page: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    action: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };
  var KIND_ORDER = ['action', 'page', 'project', 'po', 'vendor', 'item'];
  var KIND_LABEL = { action: 'Actions', page: 'Pages', project: 'Projects', po: 'Purchase Orders', vendor: 'Vendors', item: 'Library' };

  var overlay, input, results, activeIndex = 0, flat = [];

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function navTo(page) { var a = document.querySelector('nav a[data-page="' + page + '"]'); if (a && typeof nav === 'function') nav(a); }

  function buildIndex() {
    var idx = [];
    var hasProj = (typeof activeProject !== 'undefined' && activeProject);

    // Actions
    if (typeof openAddProject === 'function') idx.push({ kind: 'action', title: 'New project', sub: 'Create a project', run: openAddProject });
    if (typeof openAddSupplier === 'function') idx.push({ kind: 'action', title: 'Add vendor', sub: 'Create a vendor', run: openAddSupplier });
    if (hasProj && typeof openNewVPO === 'function') idx.push({ kind: 'action', title: 'New purchase order', sub: 'In ' + activeProject.name, run: openNewVPO });
    if (hasProj && typeof openNewPA === 'function') idx.push({ kind: 'action', title: 'New purchase authorization', sub: 'In ' + activeProject.name, run: openNewPA });

    // Pages (global)
    [['projects', 'Projects'], ['suppliers', 'Vendors'], ['library', 'Library'], ['import', 'Import / Export'], ['help', 'Help & Guide']]
      .forEach(function (p) { idx.push({ kind: 'page', title: p[1], sub: 'Go to page', run: function () { navTo(p[0]); } }); });
    // Project pages
    if (hasProj) {
      [['budget-tracker', 'Procurement Tracker'], ['delivery', 'Delivery & Expediting'], ['prelim-budget', 'Preliminary Budgets'], ['doc-budget', 'AI Budget'], ['closeout', 'Close-Out'], ['purchase-auth', 'Purchase Authorizations'], ['vendor-pos', 'Purchase Orders'], ['credit-card-auth', 'Credit Card Auth'], ['approvals', 'Client Approvals'], ['reports', 'Reports'], ['owner-statement', 'Owner Statement'], ['cash-flow', 'Cash-Flow Projection']]
        .forEach(function (p) { idx.push({ kind: 'page', title: p[1], sub: activeProject.name, run: function () { navTo(p[0]); } }); });
    }

    // Projects
    (typeof projects !== 'undefined' ? projects : []).forEach(function (p) {
      idx.push({ kind: 'project', title: p.name, sub: (p.client || '') + (p.status ? ' · ' + p.status : ''), run: function () { if (typeof openProject === 'function') openProject(p.id); } });
    });

    // Purchase orders
    (typeof vendorPOs !== 'undefined' ? vendorPOs : []).forEach(function (po) {
      idx.push({ kind: 'po', title: po.itemHeadline || po.itemName || po.poNum || '(untitled PO)', sub: (po.poNum ? po.poNum + ' · ' : '') + (po.mfrName || '') + (po.project ? ' · ' + po.project : ''), run: function () { if (typeof viewPO === 'function') viewPO(po.id); } });
    });

    // Vendors
    (typeof suppliers !== 'undefined' ? suppliers : []).forEach(function (v) {
      idx.push({ kind: 'vendor', title: v.name, sub: (v.category || '') + (v.email ? ' · ' + v.email : ''), run: function () {
        navTo('suppliers'); setTimeout(function () { var s = document.getElementById('supplier-search'); if (s) { s.value = v.name; if (typeof renderSuppliers === 'function') renderSuppliers(); } }, 30);
      } });
    });

    // Library items
    if (typeof _libCollect === 'function') {
      try {
        _libCollect().forEach(function (i) {
          idx.push({ kind: 'item', title: i.name, sub: (i.mfr || '') + (i.project ? ' · ' + i.project : ''), run: function () {
            navTo('library'); setTimeout(function () { var s = document.getElementById('library-search'); if (s) { s.value = i.name; if (typeof libRender === 'function') libRender(); } }, 30);
          } });
        });
      } catch (e) {}
    }
    return idx;
  }

  function score(item, q) {
    var hay = (item.title + ' ' + (item.sub || '')).toLowerCase();
    if (hay.indexOf(q) === -1) return -1;
    var t = item.title.toLowerCase();
    if (t === q) return 100;
    if (t.indexOf(q) === 0) return 60;
    if (t.indexOf(q) !== -1) return 40;
    return 10;
  }

  function renderResults() {
    var q = input.value.trim().toLowerCase();
    var idx = buildIndex();
    var matched;
    if (!q) {
      matched = idx.filter(function (i) { return i.kind === 'action' || i.kind === 'page'; });
    } else {
      matched = idx.map(function (i) { return { i: i, s: score(i, q) }; }).filter(function (x) { return x.s >= 0; })
        .sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.i; });
    }

    // group, cap per group
    var groups = {}; matched.forEach(function (m) { (groups[m.kind] = groups[m.kind] || []).push(m); });
    flat = []; var html = '';
    KIND_ORDER.forEach(function (k) {
      var arr = groups[k]; if (!arr || !arr.length) return;
      var cap = q ? (k === 'item' || k === 'po' ? 6 : 8) : 20;
      arr = arr.slice(0, cap);
      html += '<div class="cmd-group-label">' + KIND_LABEL[k] + '</div>';
      arr.forEach(function (m) {
        var fi = flat.length; flat.push(m);
        html += '<div class="cmd-item" data-i="' + fi + '" onmousemove="cmdHover(' + fi + ')" onclick="cmdRun(' + fi + ')">' +
          '<span class="cmd-item-ic"><svg viewBox="0 0 24 24">' + (ICONS[k] || ICONS.page) + '</svg></span>' +
          '<span class="cmd-item-body"><span class="cmd-item-title">' + esc(m.title) + '</span>' +
          (m.sub ? '<span class="cmd-item-sub">' + esc(m.sub) + '</span>' : '') + '</span>' +
          '<span class="cmd-item-kind">' + (KIND_LABEL[k] || '').replace(/s$/, '') + '</span></div>';
      });
    });
    results.innerHTML = html || '<div class="cmd-empty">No matches. Try a project, PO number, vendor, or product.</div>';
    activeIndex = 0; paint();
  }

  function paint() {
    var els = results.querySelectorAll('.cmd-item');
    els.forEach(function (el, n) { el.classList.toggle('active', n === activeIndex); });
    var act = els[activeIndex]; if (act) act.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!overlay) build();
    overlay.classList.add('open');
    input.value = ''; renderResults();
    setTimeout(function () { input.focus(); }, 20);
  }
  function close() { if (overlay) overlay.classList.remove('open'); }
  function isOpen() { return overlay && overlay.classList.contains('open'); }

  function run(i) {
    var m = flat[i]; if (!m) return;
    close();
    setTimeout(function () { try { m.run(); } catch (e) {} }, 10);
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'cmd-overlay';
    overlay.innerHTML =
      '<div class="cmd-box" role="dialog" aria-label="Command palette">' +
      '<div class="cmd-input-row"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input class="cmd-input" id="cmd-input" placeholder="Search projects, POs, vendors, products, pages\u2026" autocomplete="off" spellcheck="false" />' +
      '<span class="cmd-hint">Esc</span></div>' +
      '<div class="cmd-results" id="cmd-results"></div>' +
      '<div class="cmd-foot"><span><b>\u2191\u2193</b> navigate</span><span><b>\u21B5</b> open</span><span><b>\u2318K</b> toggle</span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('#cmd-input');
    results = overlay.querySelector('#cmd-results');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(flat.length - 1, activeIndex + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(activeIndex); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  window.cmdHover = function (i) { activeIndex = i; paint(); };
  window.cmdRun = run;
  window.openCommandPalette = open;

  function installTrigger() {
    var bar = document.querySelector('.topbar'); if (!bar || document.getElementById('cmd-trigger')) return;
    var actions = document.getElementById('topbar-actions');
    var btn = document.createElement('button');
    btn.id = 'cmd-trigger'; btn.className = 'cmd-trigger'; btn.title = 'Search everything (\u2318K)';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span><span class="k">\u2318K</span>';
    btn.addEventListener('click', open);
    if (actions) bar.insertBefore(btn, actions); else bar.appendChild(btn);
  }

  function init() {
    installTrigger();
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); isOpen() ? close() : open(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
