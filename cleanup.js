/* ============================================================================
   STEVE — UI cleanup behaviours  (cleanup.js)
   1) Collapsible workflow nav groups (state remembered).
   2) Project stage indicator on the Project Dashboard.
   Reuses host globals: projects, pas, vendorPOs, budgetTrackers, prelimBudgets,
   closeOuts, activeProject, nav, DB.
   ============================================================================ */
(function () {
  'use strict';

  // ── Collapsible nav groups ────────────────────────────────────────────────
  function collapsedMap() { try { return JSON.parse(localStorage.getItem('nav_collapsed') || '{}'); } catch (e) { return {}; } }
  function saveCollapsed(m) { try { localStorage.setItem('nav_collapsed', JSON.stringify(m)); } catch (e) {} }

  window.navToggleGroup = function (grp) {
    var el = document.querySelector('.nav-group[data-grp="' + grp + '"]'); if (!el) return;
    var m = collapsedMap();
    var nowCollapsed = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', nowCollapsed);
    m[grp] = nowCollapsed; saveCollapsed(m);
  };
  function restoreNav() {
    var m = collapsedMap();
    // Default: groups start COLLAPSED. Only a group the user has explicitly
    // expanded (saved as false) stays open; everything else collapses on load.
    document.querySelectorAll('.nav-group[data-grp]').forEach(function (el) {
      var grp = el.getAttribute('data-grp');
      if (m[grp] === false) el.classList.remove('collapsed');
      else el.classList.add('collapsed');
    });
  }

  // ── Project stage indicator ───────────────────────────────────────────────
  var STAGES = [
    { k: 'Budgeted', page: 'prelim-budget' },
    { k: 'Authorized', page: 'purchase-auth' },
    { k: 'Approved', page: 'approvals' },
    { k: 'Ordered', page: 'vendor-pos' },
    { k: 'Received', page: 'receiving' },
    { k: 'Closed', page: 'closeout' }
  ];

  function computeStages(proj) {
    var name = proj.name;
    var bt = (typeof budgetTrackers !== 'undefined') ? budgetTrackers[name] : null;
    var btItems = bt && bt.items ? bt.items.filter(function (i) { return !i.isCategory; }) : [];
    var budgeted = ((typeof prelimBudgets !== 'undefined' ? prelimBudgets : []) || []).some(function (b) { return b.project === name; }) || btItems.length > 0;
    var pa = ((typeof pas !== 'undefined' ? pas : []) || []).find(function (p) { return p.project === name; });
    var authorized = !!pa;
    var approved = false; try { var s = DB.load('fp11_approvals', {}); if (pa && s[pa.id] && s[pa.id].status === 'approved') approved = true; } catch (e) {}
    var ordered = ((typeof vendorPOs !== 'undefined' ? vendorPOs : []) || []).some(function (v) { return v.project === name && v.status && v.status !== 'Draft'; })
      || btItems.some(function (i) { return i.orderNo || i.amtPaid > 0; });
    var received = false; try { var r = (DB.load('fp11_receiving', {})[name]) || {}; received = Object.keys(r).some(function (k) { return r[k].cond === 'ok' || r[k].cond === 'installed'; }); } catch (e) {}
    var closed = (['Completed', 'Closed', 'Complete'].indexOf(proj.status) !== -1) || (typeof closeOuts !== 'undefined' && closeOuts && closeOuts[name] && Object.keys(closeOuts[name]).length);
    var done = [budgeted, authorized, approved, ordered, received, !!closed];
    return STAGES.map(function (s, i) { return { k: s.k, page: s.page, done: done[i] }; });
  }

  function renderStage(projId) {
    var host = document.getElementById('pd-stage-strip'); if (!host) return;
    // Stage strip removed at user request — keep it hidden.
    host.style.display = 'none'; host.innerHTML = ''; return; // eslint-disable-line
    var fin = document.getElementById('pd-financial');
    // Only show for the financial (PO) dashboard, not spec projects
    if (fin && fin.style.display === 'none') { host.style.display = 'none'; host.innerHTML = ''; return; }
    var proj = (typeof projects !== 'undefined' ? projects : []).find(function (p) { return p.id === projId; }) || (typeof activeProject !== 'undefined' ? activeProject : null);
    if (!proj) { host.style.display = 'none'; return; }
    var steps = computeStages(proj);
    // current = first not-done step (or last if all done)
    var curIdx = steps.findIndex(function (s) { return !s.done; });
    if (curIdx === -1) curIdx = steps.length;
    var html = '';
    steps.forEach(function (s, i) {
      var cls = s.done ? 'done' : (i === curIdx ? 'current' : '');
      var dot = s.done ? '\u2713' : (i + 1);
      html += '<div class="stg-step ' + cls + '" onclick="stageGo(\'' + s.page + '\')" title="Go to ' + s.k + '">' +
        '<span class="stg-dot">' + dot + '</span><span class="stg-label">' + s.k + '</span></div>';
      if (i < steps.length - 1) html += '<span class="stg-conn' + (s.done ? ' done' : '') + '"></span>';
    });
    host.style.display = '';
    host.innerHTML = html;
  }

  window.stageGo = function (page) { var a = document.querySelector('nav a[data-page="' + page + '"]'); if (a && typeof nav === 'function') nav(a); };
  window.renderStage = renderStage;

  function wrap(fnName) {
    if (typeof window[fnName] === 'function' && !window[fnName]._stgWrapped) {
      var orig = window[fnName];
      var w = function (id) { var r = orig.apply(this, arguments); try { renderStage(typeof id === 'number' ? id : (activeProject && activeProject.id)); } catch (e) {} return r; };
      w._stgWrapped = true; window[fnName] = w;
    }
  }

  function install() { restoreNav(); wrap('openProject'); wrap('openProjectDetail'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  setTimeout(install, 1000);
})();
