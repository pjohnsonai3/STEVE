/* ============================================================================
   STEVE — Home dashboard  (home.js)
   Firm-wide front door: needs-attention triage (late deliveries, pending
   approvals, draft POs, flagged items), budget-variance & contingency alerts,
   active-project rollup, and a recent-activity feed.
   Reuses host globals: projects, pas, vendorPOs, budgetTrackers, activeProject,
   ensureBudgetTracker, calcPATotal, btGetClientTotalReceived, _dashItemFlag,
   fmt, escHtml, openProject, nav. Plus dlSummary, getActivity, DB.
   ============================================================================ */
(function () {
  'use strict';
  var INSTALL_CATS = ['Installation', 'Drapery (Measure & Install)', 'Installation (Drapery)'];
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(n) { return (typeof fmt === 'function') ? fmt(n) : '$' + Math.round(n || 0).toLocaleString(); }
  function pct(a, b) { return b > 0 ? a / b * 100 : 0; }

  function approvalsStore() { try { return DB.load('fp11_approvals', {}); } catch (e) { return {}; } }

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    var d = Math.floor(s / 86400); if (d < 7) return d + 'd ago';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function gather() {
    var data = { active: [], portfolio: 0, late: [], approvals: [], draftPOs: [], flagged: [], variance: [], contingency: [] };
    var aStore = approvalsStore();
    projects.forEach(function (p) { try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(p.name); } catch (e) {} });

    projects.forEach(function (p) {
      var pa = pas.find(function (x) { return x.project === p.name; });
      var paTotal = pa ? (typeof calcPATotal === 'function' ? calcPATotal(pa) : (p.budget || 0)) : (p.budget || 0);
      data.portfolio += paTotal;
      if (p.status === 'Active') data.active.push({ p: p, pa: pa, paTotal: paTotal });

      // Late deliveries
      if (typeof dlSummary === 'function') {
        var s = dlSummary(p.name);
        (s.late || []).forEach(function (r) { data.late.push({ proj: p.name, name: r.name, vendor: r.vendor, eta: r.eta }); });
      }
      // Pending approvals
      if (pa) {
        var rec = aStore[pa.id] || { status: 'draft' };
        if (rec.status !== 'approved') data.approvals.push({ proj: p.name, paNum: pa.paNum, status: rec.status, total: paTotal });
      }
      // Draft POs
      (typeof vendorPOs !== 'undefined' ? vendorPOs : []).filter(function (v) { return v.project === p.name && (v.status === 'Draft'); })
        .forEach(function (v) { data.draftPOs.push({ proj: p.name, poNum: v.poNum, name: v.itemHeadline || v.itemName }); });

      // Flagged items + variance + contingency
      var bt = budgetTrackers[p.name]; if (!bt) return;
      var cur = '', goods = 0;
      bt.items.forEach(function (it) {
        if (it.isCategory) { cur = it.name; return; }
        if (INSTALL_CATS.indexOf(cur) === -1) goods += (it.qty || 0) * (it.estPrice || 0);
        if (typeof _dashItemFlag === 'function') { var f = _dashItemFlag(it); if (f) data.flagged.push({ proj: p.name, name: it.name, reason: f.reason || (typeof f === 'string' ? f : ''), sev: f.sev || 'med' }); }
        if (it.actualPrice > 0 && it.estPrice > 0) {
          var est = (it.qty || 0) * (it.estPrice || 0), act = (it.qty || 0) * (it.actualPrice || 0);
          if (act - est > 0.5) data.variance.push({ proj: p.name, name: it.name, est: est, act: act, over: act - est });
        }
      });
      var pool = goods * ((bt.contPct || 0) / 100);
      var consumed = 0; data.variance.filter(function (v) { return v.proj === p.name; }).forEach(function (v) { consumed += v.over; });
      data.contingency.push({ proj: p.name, pool: pool, consumed: consumed, remaining: pool - consumed });
    });
    data.variance.sort(function (a, b) { return b.over - a.over; });
    return data;
  }

  function homeGo(projName, page) {
    var p = projects.find(function (x) { return x.name === projName; });
    if (p && typeof openProject === 'function') { openProject(p.id); }
    if (page) setTimeout(function () { var a = document.querySelector('nav a[data-page="' + page + '"]'); if (a && typeof nav === 'function') nav(a); }, 60);
  }
  function homeNav(page) { var a = document.querySelector('nav a[data-page="' + page + '"]'); if (a && typeof nav === 'function') nav(a); }

  function kpiCard(label, value, sub, color, accent) {
    return '<div class="rp-kpi' + (accent ? ' accent' : '') + '"><div class="rp-kpi-label">' + label + '</div>' +
      '<div class="rp-kpi-value sm"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div>' +
      (sub ? '<div class="rp-kpi-sub">' + sub + '</div>' : '') + '</div>';
  }

  function attnRow(icon, iconColor, title, sub, onclick) {
    return '<div class="hm-attn" onclick="' + onclick + '"><span class="hm-attn-ic" style="background:' + iconColor + '22;color:' + iconColor + '">' + icon + '</span>' +
      '<div class="hm-attn-body"><div class="hm-attn-title">' + title + '</div><div class="hm-attn-sub">' + sub + '</div></div>' +
      '<span class="hm-attn-go">›</span></div>';
  }

  function render() {
    var host = document.getElementById('page-home'); if (!host) return;
    var d = gather();
    var attnCount = d.late.length + d.approvals.length + d.draftPOs.length + d.flagged.length;

    var greeting = (function () { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
    var dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    var kpis = '<div class="rp-kpi-row k5">' +
      kpiCard('Portfolio value', money(d.portfolio), d.active.length + ' active project' + (d.active.length !== 1 ? 's' : ''), '', true) +
      kpiCard('Needs attention', String(attnCount), attnCount ? 'items to action' : 'all clear', attnCount ? 'var(--amber)' : 'var(--green)') +
      kpiCard('Late deliveries', String(d.late.length), 'past estimated arrival', d.late.length ? 'var(--red)' : 'var(--green)') +
      kpiCard('Awaiting approval', String(d.approvals.length), 'authorizations', d.approvals.length ? 'var(--amber)' : 'var(--green)') +
      kpiCard('Draft POs', String(d.draftPOs.length), 'not yet issued', d.draftPOs.length ? 'var(--blue)' : 'var(--green)') +
      '</div>';

    // Needs attention list
    var attn = '';
    d.approvals.slice(0, 6).forEach(function (a) {
      attn += attnRow('\u270D', 'var(--amber)', esc(a.paNum || 'Authorization') + ' awaiting client approval', esc(a.proj) + ' · ' + money(a.total) + ' · ' + (a.status === 'changes' ? 'changes requested' : a.status === 'sent' ? 'sent' : 'not sent'), "homeGo('" + esc(a.proj).replace(/'/g, "\\'") + "','approvals')");
    });
    d.late.slice(0, 6).forEach(function (a) {
      attn += attnRow('\u26A0', 'var(--red)', esc(a.name) + ' is late', esc(a.proj) + (a.vendor ? ' · ' + esc(a.vendor) : '') + (a.eta ? ' · ETA ' + esc(a.eta) : ''), "homeGo('" + esc(a.proj).replace(/'/g, "\\'") + "','delivery')");
    });
    d.draftPOs.slice(0, 4).forEach(function (a) {
      attn += attnRow('\uD83D\uDCC4', 'var(--blue)', 'Draft PO ' + esc(a.poNum || '') + ' not issued', esc(a.proj) + (a.name ? ' · ' + esc(a.name) : ''), "homeGo('" + esc(a.proj).replace(/'/g, "\\'") + "','vendor-pos')");
    });
    d.flagged.slice(0, 5).forEach(function (a) {
      attn += attnRow('\u25CF', 'var(--amber)', esc(a.name), esc(a.proj) + (a.reason ? ' · ' + esc(a.reason) : ''), "homeGo('" + esc(a.proj).replace(/'/g, "\\'") + "','budget-tracker')");
    });
    if (!attn) attn = '<div class="rp-empty">Nothing needs attention. Every order, approval, and PO is on track.</div>';
    var attnPanel = '<div class="rp-panel"><div class="rp-panel-head"><div class="rp-panel-title">Needs attention</div><div class="rp-panel-hint">' + attnCount + ' items</div></div><div class="rp-panel-body" style="padding:6px 10px">' + attn + '</div></div>';

    // Activity feed
    var acts = (typeof getActivity === 'function') ? getActivity() : [];
    var feed = acts.length ? acts.slice(0, 12).map(function (e) {
      return '<div class="hm-act"><span class="hm-act-dot"></span><div class="hm-act-body"><div class="hm-act-label">' + esc(e.label) + '</div>' +
        '<div class="hm-act-meta">' + (e.project ? esc(e.project) + ' · ' : '') + timeAgo(e.ts) + '</div></div></div>';
    }).join('') : '<div class="rp-empty" style="padding:24px">No activity recorded yet. Changes you make will show here.</div>';
    var feedPanel = '<div class="rp-panel"><div class="rp-panel-head"><div class="rp-panel-title">Recent activity</div></div><div class="rp-panel-body" style="padding:6px 14px 12px">' + feed + '</div></div>';

    // Budget variance / contingency
    var contRows = d.contingency.map(function (c) {
      var p = pct(c.consumed, c.pool);
      var col = c.remaining < 0 ? 'var(--red)' : p > 80 ? 'var(--amber)' : 'var(--green)';
      return '<div style="padding:11px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span style="color:var(--text)">' + esc(c.proj) + '</span>' +
        '<span style="color:' + col + ';font-weight:600">' + money(Math.max(0, c.remaining)) + (c.remaining < 0 ? ' over' : ' left') + '</span></div>' +
        '<div class="rp-bar-track"><div class="rp-bar-fill" style="width:' + Math.min(100, Math.max(1, p)) + '%;background:' + col + '"></div></div>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:4px">' + money(c.consumed) + ' used of ' + money(c.pool) + ' contingency</div></div>';
    }).join('');
    var varList = d.variance.length ? d.variance.slice(0, 6).map(function (v) {
      return '<div class="hm-attn" onclick="homeGo(\'' + esc(v.proj).replace(/'/g, "\\'") + "','budget-tracker')\" style=\"cursor:pointer\"><span class=\"hm-attn-ic\" style=\"background:var(--red-bg);color:var(--red)\">\u25B2</span>" +
        '<div class="hm-attn-body"><div class="hm-attn-title">' + esc(v.name) + '</div><div class="hm-attn-sub">' + esc(v.proj) + ' · est ' + money(v.est) + ' \u2192 actual ' + money(v.act) + '</div></div>' +
        '<span style="color:var(--red);font-weight:700;font-size:12.5px">+' + money(v.over) + '</span></div>';
    }).join('') : '<div style="font-size:12.5px;color:var(--text3);padding:10px 2px">No cost overruns recorded — actuals are matching estimates.</div>';
    var variancePanel = '<div class="rp-panel"><div class="rp-panel-head"><div class="rp-panel-title">Budget variance &amp; contingency</div></div><div class="rp-panel-body">' +
      '<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);font-weight:600;margin-bottom:2px">Cost overruns</div>' + varList +
      '<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);font-weight:600;margin:16px 0 4px">Contingency health</div>' + (contRows || '<div style="font-size:12.5px;color:var(--text3)">No data.</div>') + '</div></div>';

    // Active projects rollup
    var projRows = d.active.map(function (a) {
      var paid = 0; var bt = budgetTrackers[a.p.name]; if (bt) bt.items.forEach(function (i) { if (!i.isCategory) paid += i.amtPaid || 0; });
      var pr = pct(paid, a.paTotal); var col = pr > 85 ? 'var(--red)' : pr > 55 ? 'var(--amber)' : 'var(--green)';
      return '<div class="hm-proj" onclick="homeGo(\'' + esc(a.p.name).replace(/'/g, "\\'") + '\')"><div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px"><div><div class="hm-proj-name">' + esc(a.p.name) + '</div><div class="hm-proj-meta">' + esc(a.p.client || '') + (a.p.end ? ' · due ' + esc(a.p.end) : '') + '</div></div><div style="text-align:right"><div style="font-size:13px;font-weight:700;color:var(--text)">' + money(a.paTotal) + '</div></div></div>' +
        '<div class="rp-bar-track"><div class="rp-bar-fill" style="width:' + Math.max(1, pr) + '%;background:' + col + '"></div></div></div>';
    }).join('') || '<div class="rp-empty">No active projects.</div>';
    var projPanel = '<div class="rp-panel"><div class="rp-panel-head"><div class="rp-panel-title">Active projects</div><div class="rp-panel-hint"><a onclick="homeNav(\'projects\')" style="color:var(--accent-ink);cursor:pointer">All projects ›</a></div></div><div class="rp-panel-body" style="padding:6px 14px 12px">' + projRows + '</div></div>';

    var header = '<div style="margin-bottom:18px"><div style="font-size:22px;font-weight:700;color:var(--text);letter-spacing:-0.01em">' + greeting + '</div><div style="font-size:13px;color:var(--text3);margin-top:2px">' + dateStr + ' · here\u2019s where things stand</div></div>';

    host.innerHTML = '<div class="rp-wrap">' + header + kpis +
      '<div class="rp-grid g-2-1">' + attnPanel + feedPanel + '</div>' +
      '<div class="rp-grid g-2-1">' + variancePanel + projPanel + '</div></div>';
  }

  window.renderHome = render;
  window.homeGo = homeGo;
  window.homeNav = homeNav;

  function init() { try { var h = document.getElementById('page-home'); if (h && h.classList.contains('active')) render(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setTimeout(init, 600);
})();
