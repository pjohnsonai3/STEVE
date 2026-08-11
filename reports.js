/* ============================================================================
   STEVE — Reports & Analytics  (reports.js)
   Reads the live app state (projects, pas, vendorPOs, budgetTrackers) and the
   host helpers (ensureBudgetTracker, calcPATotal, btGetClientTotalReceived,
   fmt, escHtml). Renders three switchable layouts of one analytics page.
   ============================================================================ */
(function () {
  'use strict';

  // Curated, on-brand categorical palette — cool slates/teals anchored on the
  // dusty-blue accent, with two warm accents for separation. No rainbow.
  var RP_PALETTE = [
    '#4A6E7E', '#7DA3B3', '#3F606D', '#4E7E6C', '#A1C0CB', '#5A6B73',
    '#6E9C8A', '#B0895F', '#324B55', '#8FA7AE', '#C4914A', '#9C6F6A'
  ];
  var INSTALL_CATS = ['Installation', 'Drapery (Measure & Install)', 'Installation (Drapery)'];

  function $(id) { return document.getElementById(id); }
  function money(n) { return (typeof fmt === 'function') ? fmt(n) : '$' + Math.round(n || 0).toLocaleString(); }
  function money0(n) { return '$' + Math.round(n || 0).toLocaleString(); }
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function pct(part, whole) { return whole > 0 ? (part / whole * 100) : 0; }

  function parseLeadWeeks(s) {
    if (!s) return null;
    var m = String(s).match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (/day/i.test(s)) return n / 7;
    if (/month/i.test(s)) return n * 4.3;
    return n; // assume weeks
  }

  // ── Metrics engine ────────────────────────────────────────────────────────
  function reportMetrics(scopeName) {
    var scope = (scopeName && scopeName !== 'all')
      ? projects.filter(function (p) { return p.name === scopeName; })
      : projects.slice();

    scope.forEach(function (p) { try { ensureBudgetTracker(p.name); } catch (e) {} });

    var m = {
      goods: 0, install: 0, fee: 0, cont: 0, freight: 0, tariff: 0, tax: 0,
      paTotal: 0, paid: 0, taxPaid: 0, freightPaid: 0, clientReceived: 0,
      itemCount: 0, orderedCount: 0, orderedExt: 0,
      catMap: {}, vendorMap: {}, perProject: [], actions: [],
      leadBuckets: [
        { label: '≤ 8 wk', n: 0 }, { label: '9–12 wk', n: 0 },
        { label: '13–16 wk', n: 0 }, { label: '17+ wk', n: 0 }, { label: 'No data', n: 0 }
      ],
      projectCount: scope.length,
      activeCount: scope.filter(function (p) { return p.status === 'Active'; }).length
    };

    scope.forEach(function (p) {
      var bt = budgetTrackers[p.name];
      if (!bt) return;
      var cur = '';
      var pGoods = 0, pInstall = 0, pPaid = 0, pItems = 0, pOrdered = 0, pOrderedExt = 0;
      var feeP = (bt.feePct || 0) / 100, contP = (bt.contPct || 0) / 100,
          frP = (bt.freightPct || 0) / 100, taP = (bt.tariffPct || 0) / 100, txP = (bt.taxPct || 0) / 100;

      bt.items.forEach(function (it) {
        if (it.isCategory) { cur = it.name; return; }
        var ext = (it.qty || 0) * (it.estPrice || 0);
        var isInstall = INSTALL_CATS.indexOf(cur) !== -1;
        if (isInstall) { m.install += ext; pInstall += ext; }
        else { m.goods += ext; pGoods += ext; }
        m.paid += it.amtPaid || 0; pPaid += it.amtPaid || 0;
        m.taxPaid += it.taxPaid || 0; m.freightPaid += it.freightPaid || 0;
        m.itemCount++; pItems++;
        var ordered = !!(it.orderNo || (it.amtPaid > 0));
        if (ordered) { m.orderedCount++; pOrdered++; m.orderedExt += ext; pOrderedExt += ext; }

        var ck = cur || 'Uncategorized';
        var c = m.catMap[ck] || (m.catMap[ck] = { est: 0, paid: 0, count: 0, install: isInstall });
        c.est += ext; c.paid += it.amtPaid || 0; c.count++;

        if (it.vendor) {
          var v = m.vendorMap[it.vendor] || (m.vendorMap[it.vendor] = { est: 0, paid: 0, count: 0 });
          v.est += ext; v.paid += it.amtPaid || 0; v.count++;
        }

        var wk = parseLeadWeeks(it.leadTime);
        if (wk == null) m.leadBuckets[4].n++;
        else if (wk <= 8) m.leadBuckets[0].n++;
        else if (wk <= 12) m.leadBuckets[1].n++;
        else if (wk <= 16) m.leadBuckets[2].n++;
        else m.leadBuckets[3].n++;

        if (it.statusRemarks) {
          var r = it.statusRemarks.toUpperCase();
          var sev = /NEED|PENDING|APPROVE|CONFIRM/.test(r) ? 'high' : 'med';
          m.actions.push({ proj: p.name, num: it.itemNum, name: it.name, vendor: it.vendor, remark: it.statusRemarks, sev: sev, ext: ext, lead: it.leadTime });
        }
      });

      var feeAmt = pGoods * feeP, contAmt = pGoods * contP, frAmt = pGoods * frP,
          taAmt = pGoods * taP, txAmt = (pGoods + frAmt) * txP;
      m.fee += feeAmt; m.cont += contAmt; m.freight += frAmt; m.tariff += taAmt; m.tax += txAmt;

      var pa = pas.find(function (x) { return x.project === p.name; });
      var paTotal = pa ? calcPATotal(pa) : (p.budget || 0);
      m.paTotal += paTotal;
      var cr = (typeof btGetClientTotalReceived === 'function') ? btGetClientTotalReceived(p.name) : null;
      var crv = cr || 0; m.clientReceived += crv;

      m.perProject.push({
        name: p.name, client: p.client, status: p.status, end: p.end,
        paTotal: paTotal, paid: pPaid, goods: pGoods, install: pInstall,
        items: pItems, ordered: pOrdered, orderedExt: pOrderedExt, clientReceived: crv
      });
    });

    m.outstanding = Math.max(0, m.orderedExt - m.paid);
    m.notOrdered = Math.max(0, (m.goods + m.install) - m.orderedExt);
    m.feeEarned = m.fee;
    m.heldInTrust = Math.max(0, m.clientReceived - m.paid - m.taxPaid - m.freightPaid);
    m.actions.sort(function (a, b) { return (a.sev === b.sev) ? b.ext - a.ext : (a.sev === 'high' ? -1 : 1); });
    return m;
  }

  // ── Small render helpers ────────────────────────────────────────────────
  function kpi(label, value, sub, opts) {
    opts = opts || {};
    var cls = 'rp-kpi' + (opts.accent ? ' accent' : '');
    var vcls = 'rp-kpi-value' + (opts.sm ? ' sm' : '');
    var spark = opts.spark != null
      ? '<div class="rp-kpi-spark"><i style="width:' + Math.max(0, Math.min(100, opts.spark)) + '%;background:' + (opts.sparkColor || 'var(--accent)') + '"></i></div>'
      : '';
    return '<div class="' + cls + '">' +
      '<div class="rp-kpi-label">' + label + '</div>' +
      '<div class="' + vcls + '"' + (opts.color ? ' style="color:' + opts.color + '"' : '') + '>' + value + '</div>' +
      (sub ? '<div class="rp-kpi-sub">' + sub + '</div>' : '') + spark +
      '</div>';
  }

  function panel(title, hint, body, attrs) {
    return '<div class="rp-panel"' + (attrs || '') + '>' +
      '<div class="rp-panel-head"><div class="rp-panel-title">' + title + '</div>' +
      (hint ? '<div class="rp-panel-hint">' + hint + '</div>' : '') + '</div>' +
      '<div class="rp-panel-body">' + body + '</div></div>';
  }

  function sortedCats(m) {
    return Object.keys(m.catMap).map(function (k, i) {
      return { name: k, est: m.catMap[k].est, paid: m.catMap[k].paid, count: m.catMap[k].count, install: m.catMap[k].install };
    }).filter(function (c) { return c.est > 0; }).sort(function (a, b) { return b.est - a.est; })
      .map(function (c, i) { c.color = RP_PALETTE[i % RP_PALETTE.length]; return c; });
  }

  function sortedVendors(m) {
    return Object.keys(m.vendorMap).map(function (k) {
      return { name: k, est: m.vendorMap[k].est, paid: m.vendorMap[k].paid, count: m.vendorMap[k].count };
    }).sort(function (a, b) { return b.est - a.est; });
  }

  // Donut SVG from segments [{value,color}]
  function donut(segments, total, centerVal, centerLabel, size) {
    size = size || 168;
    var r = size / 2 - 13, cx = size / 2, c = 2 * Math.PI * r, off = 0;
    var ring = segments.filter(function (s) { return s.value > 0; }).map(function (s) {
      var len = c * (s.value / (total || 1));
      var seg = '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + s.color +
        '" stroke-width="22" stroke-dasharray="' + len + ' ' + (c - len) + '" stroke-dashoffset="' + (-off) + '"></circle>';
      off += len; return seg;
    }).join('');
    return '<div class="rp-donut" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--surface2)" stroke-width="22"></circle>' +
      ring + '</svg>' +
      '<div class="rp-donut-center"><div class="v">' + centerVal + '</div><div class="l">' + centerLabel + '</div></div></div>';
  }

  function hbars(rows, max, fmtVal) {
    return '<div class="rp-bars">' + rows.map(function (row) {
      return '<div class="rp-bar"><div class="rp-bar-top">' +
        '<div class="rp-bar-name">' + row.name + '</div>' +
        '<div class="rp-bar-val">' + fmtVal(row) + '</div></div>' +
        '<div class="rp-bar-track"><div class="rp-bar-fill" style="width:' + Math.max(1.5, pct(row.value, max)) + '%;background:' + (row.color || 'var(--accent)') + '"></div></div></div>';
    }).join('') + '</div>';
  }

  // Composition (fee waterfall) stacked bar + legend
  function compositionBlock(m) {
    var parts = [
      { nm: 'Goods (merchandise)', vl: m.goods, c: RP_PALETTE[0] },
      { nm: 'Installation', vl: m.install, c: RP_PALETTE[3] },
      { nm: 'Procurement fee', vl: m.fee, c: RP_PALETTE[1] },
      { nm: 'Contingency', vl: m.cont, c: RP_PALETTE[7] },
      { nm: 'Freight', vl: m.freight, c: RP_PALETTE[5] },
      { nm: 'Tariff / duty', vl: m.tariff, c: RP_PALETTE[10] },
      { nm: 'Sales tax', vl: m.tax, c: RP_PALETTE[9] }
    ].filter(function (p) { return p.vl > 0; });
    var total = m.paTotal || parts.reduce(function (a, p) { return a + p.vl; }, 0);
    var stack = '<div class="rp-stack">' + parts.map(function (p) {
      return '<div class="rp-stack-seg" title="' + p.nm + ' — ' + money(p.vl) + '" style="width:' + pct(p.vl, total) + '%;background:' + p.c + '"></div>';
    }).join('') + '</div>';
    var legend = '<div class="rp-stack-legend">' + parts.map(function (p) {
      return '<div class="rp-comp-row"><span class="sw" style="background:' + p.c + '"></span>' +
        '<span class="nm">' + p.nm + '</span><span class="vl">' + money(p.vl) + '</span></div>';
    }).join('') +
      '<div class="rp-comp-row total"><span class="nm">Authorized total</span><span class="vl">' + money(total) + '</span></div></div>';
    return stack + legend;
  }

  // Procurement progress 3-segment bar
  function progressBlock(m) {
    var base = m.goods + m.install || 1;
    var segs = [
      { nm: 'Paid to vendors', v: m.paid, c: 'var(--green)' },
      { nm: 'Ordered · unpaid', v: m.outstanding, c: 'var(--amber)' },
      { nm: 'Not yet ordered', v: m.notOrdered, c: 'var(--border2)' }
    ];
    var stack = '<div class="rp-prog-stack">' + segs.map(function (s) {
      return '<div class="rp-prog-seg" style="width:' + pct(s.v, base) + '%;background:' + s.c + '"></div>';
    }).join('') + '</div>';
    var legend = '<div class="rp-prog-legend">' + segs.map(function (s) {
      return '<div class="rp-prog-item"><div class="d"><span class="sw" style="background:' + s.c + '"></span>' + s.nm + '</div>' +
        '<div class="v">' + money(s.v) + '</div></div>';
    }).join('') + '</div>';
    return stack + legend;
  }

  function leadBlock(m) {
    var max = Math.max.apply(null, m.leadBuckets.map(function (b) { return b.n; }).concat([1]));
    return '<div class="rp-vbars">' + m.leadBuckets.map(function (b, i) {
      var col = i >= 3 ? 'var(--amber)' : (i === 4 ? 'var(--border2)' : 'var(--accent)');
      return '<div class="rp-vbar"><div class="rp-vbar-count">' + b.n + '</div>' +
        '<div class="rp-vbar-fill" style="height:' + pct(b.n, max) + '%;background:' + col + '"></div>' +
        '<div class="rp-vbar-label">' + b.label + '</div></div>';
    }).join('') + '</div>';
  }

  function catTableRows(cats, total, showBar) {
    return cats.map(function (c) {
      return '<tr><td><div class="rp-cat-cell"><span class="sw" style="background:' + c.color + '"></span>' + esc(c.name) +
        (c.install ? ' <span class="rp-muted">· install</span>' : '') + '</div></td>' +
        '<td>' + money(c.est) + (showBar ? '<span class="rp-mini-track"><i style="width:' + pct(c.est, total) + '%;background:' + c.color + '"></i></span>' : '') + '</td>' +
        '<td>' + pct(c.est, total).toFixed(1) + '%</td>' +
        '<td>' + c.count + '</td>' +
        '<td>' + (c.paid > 0 ? money(c.paid) : '<span class="rp-muted">—</span>') + '</td></tr>';
    }).join('');
  }

  function actionsBlock(m, limit) {
    var list = m.actions.slice(0, limit || 8);
    if (!list.length) return '<div class="rp-empty">No open action items. Every line is clear.</div>';
    return '<div class="rp-actions">' + list.map(function (a) {
      return '<div class="rp-action"><span class="dot ' + a.sev + '"></span><div class="rp-action-body">' +
        '<div class="rp-action-title"><span class="num">№ ' + esc(a.num || '—') + '</span> · ' + esc(a.name) + '</div>' +
        '<div class="rp-action-sub">' + esc(a.remark) + '</div>' +
        '<div class="rp-action-vendor">' + esc(a.vendor || 'No vendor') + (a.lead ? ' · ' + esc(a.lead) + ' lead' : '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  // ── View A: Executive ─────────────────────────────────────────────────────
  function viewExecutive(m) {
    var clientPct = pct(m.clientReceived, m.paTotal);
    var paidPct = pct(m.paid, m.orderedExt || (m.goods + m.install));
    var kpis = '<div class="rp-kpi-row k5">' +
      kpi('Portfolio value', money(m.paTotal), '<b>' + m.activeCount + '</b> active · ' + m.projectCount + ' total', { accent: true }) +
      kpi('Received from client', money(m.clientReceived), clientPct.toFixed(0) + '% of authorized', { color: 'var(--green)', spark: clientPct, sparkColor: 'var(--green)' }) +
      kpi('Paid to vendors', money(m.paid), m.orderedCount + ' of ' + m.itemCount + ' lines ordered', { spark: paidPct, sparkColor: 'var(--accent-ink)' }) +
      kpi('Outstanding to vendors', money(m.outstanding), 'On ordered items', { color: m.outstanding > 0 ? 'var(--red)' : 'var(--green)' }) +
      kpi('Held in trust', money(m.heldInTrust), 'Client funds not yet disbursed', { color: 'var(--accent-ink)' }) +
      '</div>';

    var health = panel('Project health', m.activeCount + ' active',
      '<div class="rp-proj">' + m.perProject.map(function (p) {
        var prog = pct(p.paid, p.paTotal);
        var col = prog > 85 ? 'var(--red)' : prog > 50 ? 'var(--amber)' : 'var(--green)';
        return '<div class="rp-proj-row"><div class="rp-proj-head"><div>' +
          '<div class="rp-proj-name">' + esc(p.name) + '</div>' +
          '<div class="rp-proj-meta">' + esc(p.client || '—') + ' · ' + esc(p.status || '') + (p.end ? ' · due ' + esc(p.end) : '') + '</div></div>' +
          '<div class="rp-proj-fig"><div class="v">' + money(p.paTotal) + '</div><div class="l">' + p.ordered + ' / ' + p.items + ' ordered</div></div></div>' +
          '<div class="rp-bar-track"><div class="rp-bar-fill" style="width:' + Math.max(1.5, prog) + '%;background:' + col + '"></div></div>' +
          '<div class="rp-proj-meta" style="margin-top:5px">' + money(p.paid) + ' paid · ' + money(p.clientReceived) + ' received from client</div></div>';
      }).join('') + '</div>');

    var comp = panel('What makes up the authorized total', 'Goods + fees + tax',
      compositionBlock(m));

    return kpis +
      '<div class="rp-grid g-2-1">' + health + comp + '</div>' +
      '<div class="rp-grid g2">' +
      panel('Procurement progress', money(m.goods + m.install) + ' merchandise', progressBlock(m)) +
      panel('Lead-time exposure', m.itemCount + ' lines', leadBlock(m) +
        '<div class="rp-panel-hint" style="margin-top:12px">' + (m.leadBuckets[2].n + m.leadBuckets[3].n) + ' lines carry 13+ week lead times — the long pole for installation.</div>') +
      '</div>';
  }

  // ── View B: Operational ───────────────────────────────────────────────────
  function viewOperational(m) {
    var cats = sortedCats(m);
    var vendors = sortedVendors(m);
    var totalEst = m.goods + m.install;
    var highCount = m.actions.filter(function (a) { return a.sev === 'high'; }).length;

    var kpis = '<div class="rp-kpi-row k5">' +
      kpi('Merchandise est.', money(totalEst), m.itemCount + ' line items', { sm: true }) +
      kpi('Ordered', money(m.orderedExt), m.orderedCount + ' lines', { sm: true, color: 'var(--accent-ink)' }) +
      kpi('Paid', money(m.paid), pct(m.paid, totalEst).toFixed(1) + '% of est.', { sm: true, color: 'var(--green)' }) +
      kpi('Outstanding', money(m.outstanding), 'Unpaid on orders', { sm: true, color: m.outstanding > 0 ? 'var(--red)' : 'var(--green)' }) +
      kpi('Open actions', String(m.actions.length), highCount + ' high priority', { sm: true, color: m.actions.length ? 'var(--amber)' : 'var(--green)' }) +
      '</div>';

    var catTable = panel('Spend by category', money(totalEst) + ' total',
      '<table class="rp-table"><thead><tr><th>Category</th><th>Estimate</th><th>% of total</th><th>Lines</th><th>Paid</th></tr></thead>' +
      '<tbody>' + catTableRows(cats, totalEst, true) +
      '<tr class="foot"><td>All categories</td><td>' + money(totalEst) + '</td><td>100%</td><td>' + m.itemCount + '</td><td>' + money(m.paid) + '</td></tr>' +
      '</tbody></table>');

    var vendorTable = panel('Vendor exposure', vendors.length + ' vendors',
      '<table class="rp-table"><thead><tr><th>Vendor</th><th>Committed</th><th>Lines</th><th>Paid</th><th>Balance</th></tr></thead>' +
      '<tbody>' + vendors.slice(0, 10).map(function (v) {
        var bal = Math.max(0, v.est - v.paid);
        return '<tr><td>' + esc(v.name) + '</td><td>' + money(v.est) + '</td><td>' + v.count + '</td>' +
          '<td>' + (v.paid > 0 ? money(v.paid) : '<span class="rp-muted">—</span>') + '</td>' +
          '<td' + (bal > 0 ? ' style="color:var(--red)"' : '') + '>' + money(bal) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (vendors.length > 10 ? '<div class="rp-panel-hint" style="margin-top:10px">+ ' + (vendors.length - 10) + ' more vendors</div>' : ''));

    var actions = panel('Needs attention', m.actions.length + ' items', actionsBlock(m, 10));

    return kpis +
      '<div class="rp-grid g-2-1">' + catTable + actions + '</div>' +
      vendorTable;
  }

  // ── View C: Visual ────────────────────────────────────────────────────────
  function viewVisual(m) {
    var cats = sortedCats(m);
    var totalEst = m.goods + m.install;
    var vendors = sortedVendors(m);
    var vmax = Math.max.apply(null, vendors.map(function (v) { return v.est; }).concat([1]));

    var kpis = '<div class="rp-kpi-row k4">' +
      kpi('Authorized', money(m.paTotal), 'Across ' + m.projectCount + ' project' + (m.projectCount !== 1 ? 's' : ''), { accent: true }) +
      kpi('Collected', money(m.clientReceived), pct(m.clientReceived, m.paTotal).toFixed(0) + '% in', { color: 'var(--green)', spark: pct(m.clientReceived, m.paTotal), sparkColor: 'var(--green)' }) +
      kpi('Disbursed', money(m.paid), 'To vendors', { spark: pct(m.paid, totalEst), sparkColor: 'var(--accent-ink)' }) +
      kpi('Fee earned', money(m.feeEarned), 'Procurement fee', { color: 'var(--accent-ink)' }) +
      '</div>';

    var donutSegs = cats.map(function (c) { return { value: c.est, color: c.color }; });
    var donutPanel = panel('Spend by category', money(totalEst),
      '<div class="rp-donut-wrap">' +
      donut(donutSegs, totalEst, '' + cats.length, 'categories') +
      '<div class="rp-legend">' + cats.slice(0, 8).map(function (c) {
        return '<div class="rp-legend-row"><span class="sw" style="background:' + c.color + '"></span>' +
          '<span class="nm">' + esc(c.name) + '</span><span class="vl">' + money(c.est) + '</span>' +
          '<span class="pc">' + pct(c.est, totalEst).toFixed(0) + '%</span></div>';
      }).join('') +
      (cats.length > 8 ? '<div class="rp-legend-row"><span class="sw" style="background:var(--border2)"></span><span class="nm rp-muted">+ ' + (cats.length - 8) + ' more</span></div>' : '') +
      '</div></div>');

    var vendorBars = panel('Top vendors by commitment', 'Estimated value',
      hbars(vendors.slice(0, 8).map(function (v) {
        return { name: '<b>' + esc(v.name) + '</b>', value: v.est, color: RP_PALETTE[1] };
      }), vmax, function (r) { return money(r.value); }));

    var comp = panel('Authorized total composition', 'Goods → fees → tax', compositionBlock(m));

    var cash = panel('Cash position', 'Client funds vs disbursed',
      '<div class="rp-gauge"><div><div class="rp-gauge-big">' + money(m.heldInTrust) + '</div>' +
      '<div class="rp-gauge-cap">held in trust — collected minus paid out</div></div>' +
      hbars([
        { name: 'Received from client', value: m.clientReceived, color: 'var(--green)' },
        { name: 'Paid to vendors', value: m.paid, color: RP_PALETTE[0] },
        { name: 'Tax + freight paid', value: m.taxPaid + m.freightPaid, color: RP_PALETTE[10] }
      ], Math.max(m.clientReceived, 1), function (r) { return money(r.value); }) + '</div>');

    var lead = panel('Lead-time distribution', m.itemCount + ' lines', leadBlock(m));

    return kpis +
      '<div class="rp-grid g2">' + donutPanel + vendorBars + '</div>' +
      '<div class="rp-grid g2">' + comp + cash + '</div>' +
      '<div class="rp-grid g2">' + progressPanel(m) + lead + '</div>';
  }

  function progressPanel(m) {
    return panel('Procurement progress', money(m.goods + m.install) + ' merchandise', progressBlock(m));
  }

  // ── Shell / orchestration ──────────────────────────────────────────────────
  var RP_VIEWS = { exec: viewExecutive, ops: viewOperational, visual: viewVisual };
  var RP_VIEW_LABELS = { exec: 'Executive', ops: 'Operational', visual: 'Visual' };

  function getView() { return localStorage.getItem('rp_view') || 'exec'; }
  function getScope() { return localStorage.getItem('rp_scope') || 'all'; }

  function renderReports() {
    var host = $('page-reports');
    if (!host) return;
    var view = getView(); if (!RP_VIEWS[view]) view = 'exec';
    var scope = getScope();
    // validate scope still exists
    if (scope !== 'all' && !projects.some(function (p) { return p.name === scope; })) scope = 'all';

    var scopeOptions = '<option value="all">All projects</option>' + projects.map(function (p) {
      return '<option value="' + esc(p.name) + '"' + (p.name === scope ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');

    var scopeLabel = scope === 'all' ? 'All projects' : scope;
    var today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    var toolbar = '<div class="rp-toolbar">' +
      '<div class="rp-toolbar-left">' +
      '<div class="rp-scope-name">' + esc(scopeLabel) + '</div>' +
      '<div class="rp-period">Snapshot as of ' + today + ' · ' + RP_VIEW_LABELS[view] + ' view</div>' +
      '</div>' +
      '<div class="rp-toolbar-right">' +
      '<select class="rp-scope-select" onchange="rpSetScope(this.value)">' + scopeOptions + '</select>' +
      '<div class="rp-seg">' +
      Object.keys(RP_VIEWS).map(function (k) {
        return '<button class="' + (k === view ? 'active' : '') + '" onclick="rpSetView(\'' + k + '\')">' + RP_VIEW_LABELS[k] + '</button>';
      }).join('') +
      '</div>' +
      '<button class="btn btn-sm" onclick="window.print()">⎙ Print</button>' +
      '</div></div>';

    var m = reportMetrics(scope);
    var body;
    if (!m.itemCount && !m.paTotal) {
      body = '<div class="rp-empty">No procurement data yet for this scope. Create a project and a Purchase Authorization to populate reports.</div>';
    } else {
      body = RP_VIEWS[view](m);
    }

    host.innerHTML = '<div class="rp-wrap">' + toolbar + '<div id="rp-content">' + body + '</div></div>';
  }

  function rpSetView(v) { localStorage.setItem('rp_view', v); renderReports(); }
  function rpSetScope(s) { localStorage.setItem('rp_scope', s); renderReports(); }

  window.renderReports = renderReports;
  window.rpSetView = rpSetView;
  window.rpSetScope = rpSetScope;
  window.reportMetrics = reportMetrics;
})();
