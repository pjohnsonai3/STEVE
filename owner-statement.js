/* ============================================================================
   STEVE — Owner Statement  (owner-statement.js)
   Project-scoped monthly statement to the Owner: PO status, a funds-in-trust
   reconciliation, and the advance funding request for outstanding balances.
   100% derived from existing data — Procurement Tracker (payments, tax, freight,
   client deposits), the Invoice Register, and Purchase Orders. Read-only +
   one-click PDF. Reuses budgetTrackers, vendorPOs, pas, invoiceLedger,
   activeProject, escHtml, fmtD, poTotal, calcPATotal, statusBadge, printPreview.
   ============================================================================ */
(function () {
  'use strict';

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function num(v) { return parseFloat(v) || 0; }
  function m2(v) { var n = Number(v) || 0; return '$' + ((typeof fmtD === 'function') ? fmtD(n) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function m0(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('en-US'); }

  function trackerItems(name) { var bt = budgetTrackers[name]; return bt ? bt.items.filter(function (i) { return !i.isCategory; }) : []; }
  function projInvoices(name) { try { return (invoiceLedger || []).filter(function (i) { return i.project === name && i.status !== 'Void'; }); } catch (e) { return []; } }

  function periodInput() {
    var saved = '';
    try { saved = localStorage.getItem('os_period') || ''; } catch (e) {}
    if (!saved) saved = new Date().toISOString().slice(0, 7);
    return saved;
  }
  function setPeriod(v) { try { localStorage.setItem('os_period', v); } catch (e) {} render(); }

  function periodLabel(ym) {
    if (!ym) return '';
    var p = ym.split('-'); var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  function nextPeriodLabel(ym) {
    var p = ym.split('-'); var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10), 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function compute(name) {
    var items = trackerItems(name);
    var bt = budgetTrackers[name] || {};
    var deposits = (bt.clientPayments || []).reduce(function (a, p) { return a + num(p.amount); }, 0);
    var goods = items.reduce(function (a, i) { return a + num(i.amtPaid); }, 0);
    var tax = items.reduce(function (a, i) { return a + num(i.taxPaid); }, 0);
    var freight = items.reduce(function (a, i) { return a + num(i.freightPaid); }, 0);
    var held = Math.max(0, deposits - goods - tax - freight);

    var pos = (typeof vendorPOs !== 'undefined' ? vendorPOs : []).filter(function (p) { return p.project === name && p.status !== 'Cancelled'; });
    var committed = pos.reduce(function (a, p) { return a + poTotal(p); }, 0);

    // Outstanding balances → anticipated funding (goods + proportional tax/freight)
    var antRows = [];
    items.forEach(function (i) {
      var bal = num(i.balanceDue);
      if (bal <= 0.5) return;
      var paid = num(i.amtPaid);
      var txR = paid > 0 ? num(i.taxPaid) / paid : 0;
      var frR = paid > 0 ? num(i.freightPaid) / paid : 0;
      antRows.push({ name: (i.itemNum ? i.itemNum + ' — ' : '') + (i.name || '(untitled)'), vendor: i.vendor || '—',
        goods: bal, tax: bal * txR, freight: bal * frR });
    });
    antRows.sort(function (a, b) { return b.goods - a.goods; });
    var antGoods = antRows.reduce(function (a, r) { return a + r.goods; }, 0);
    var antTax = antRows.reduce(function (a, r) { return a + r.tax; }, 0);
    var antFreight = antRows.reduce(function (a, r) { return a + r.freight; }, 0);
    var antTotal = antGoods + antTax + antFreight;
    var requested = Math.max(0, antTotal - held);

    var pa = (typeof pas !== 'undefined') ? pas.find(function (p) { return p.project === name; }) : null;
    var budget = pa && typeof calcPATotal === 'function' ? calcPATotal(pa) : ((activeProject && activeProject.budget) || 0);

    return { items: items, deposits: deposits, goods: goods, tax: tax, freight: freight, held: held,
      pos: pos, committed: committed, antRows: antRows, antGoods: antGoods, antTax: antTax, antFreight: antFreight,
      antTotal: antTotal, requested: requested, budget: budget };
  }

  function statementHtml(proj, c, ym) {
    var inv = num(proj.projNumber);
    var stmtNo = (proj.projNumber ? proj.projNumber : 'PRJ') + '-' + (ym || '').replace('-', '');
    var poRows = c.pos.length ? c.pos.map(function (p) {
      var tot = poTotal(p), paid = num(p.amtPaid), bal = Math.max(0, tot - paid);
      return '<tr><td style="font-weight:600;color:#4A6E7E">' + esc(p.poNum || p.id) + '</td><td>' + esc(p.supplier || '—') + '</td>' +
        '<td style="text-align:right">' + m0(tot) + '</td><td style="text-align:right">' + m0(paid) + '</td>' +
        '<td style="text-align:right">' + m0(bal) + '</td><td>' + (typeof statusBadge === 'function' ? statusBadge(p.status || 'Draft') : esc(p.status || '')) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="color:#93A1A8;padding:14px">No purchase orders recorded for this project yet.</td></tr>';

    var antRows = c.antRows.length ? c.antRows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.vendor) + '</td>' +
        '<td style="text-align:right">' + m0(r.goods) + '</td>' +
        '<td style="text-align:right">' + (r.tax ? m0(r.tax) : '—') + '</td>' +
        '<td style="text-align:right">' + (r.freight ? m0(r.freight) : '—') + '</td>' +
        '<td style="text-align:right;font-weight:600">' + m0(r.goods + r.tax + r.freight) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="color:#93A1A8;padding:14px">No outstanding balances — all tracker lines are paid in full.</td></tr>';

    var th = 'text-align:left;padding:9px 12px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#93A1A8;font-weight:600;border-bottom:1px solid #E4E8EB;background:#F2F5F7';
    var thR = th + ';text-align:right';
    var td = 'padding:9px 12px;border-bottom:1px solid #EEF1F3;font-size:12.5px';
    var sec = 'font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#4A6E7E;font-weight:700;padding-bottom:7px;border-bottom:1px solid #E4E8EB;margin:26px 0 10px';
    var recRow = function (l, v, strong) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;' + (strong ? 'border-top:1px solid #E4E8EB;margin-top:4px;font-weight:700;font-size:15px' : 'font-size:13px;color:#5C6B72') + '"><span>' + l + '</span><span style="font-variant-numeric:tabular-nums;' + (strong ? 'color:#1A1A1A' : 'font-weight:600') + '">' + v + '</span></div>'; };

    return '' +
      '<div style="max-width:860px;margin:0 auto;font-family:\'Source Sans 3\',Arial,sans-serif;color:#1A1A1A">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A1A1A;padding-bottom:18px">' +
          '<div><div style="font-weight:800;font-size:20px;letter-spacing:.03em">ai3, Inc.</div><div style="font-size:10px;letter-spacing:.16em;color:#93A1A8;font-weight:600;margin-top:2px">FF&amp;E PURCHASING AGENT</div></div>' +
          '<div style="text-align:right"><div style="font-size:17px;font-weight:700">Monthly Owner Statement</div><div style="font-size:12px;color:#5C6B72;margin-top:3px">&amp; Advance Funding Request</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:22px">' +
          metaCell('Owner', proj.client || '—') + metaCell('Project', proj.name) + metaCell('Statement period', periodLabel(ym)) +
          metaCell('Approved FF&E budget', c.budget ? m0(c.budget) : '—') + metaCell('Committed on POs', m0(c.committed)) + metaCell('Statement no.', stmtNo) +
        '</div>' +

        '<div style="' + sec + '">A · Purchase order status</div>' +
        '<table style="width:100%;border-collapse:collapse"><thead><tr>' +
          '<th style="' + th + '">PO</th><th style="' + th + '">Vendor</th><th style="' + thR + '">PO total</th><th style="' + thR + '">Paid to date</th><th style="' + thR + '">Balance</th><th style="' + th + '">Status</th>' +
        '</tr></thead><tbody>' + poRows + '</tbody></table>' +

        '<div style="' + sec + '">B · Funds reconciliation (project to date)</div>' +
        '<div style="max-width:460px;margin-left:auto">' +
          recRow('Funds deposited by Owner', m2(c.deposits)) +
          recRow('Disbursed to vendors — goods', m2(c.goods)) +
          recRow('Disbursed — sales tax', m2(c.tax)) +
          recRow('Disbursed — freight', m2(c.freight)) +
          recRow('Held in trust', m2(c.held), true) +
        '</div>' +

        '<div style="' + sec + '">C · Advance funding request — ' + nextPeriodLabel(ym) + '</div>' +
        '<table style="width:100%;border-collapse:collapse"><thead><tr>' +
          '<th style="' + th + '">Outstanding line</th><th style="' + th + '">Vendor</th><th style="' + thR + '">Goods</th><th style="' + thR + '">Tax</th><th style="' + thR + '">Freight</th><th style="' + thR + '">Amount</th>' +
        '</tr></thead><tbody>' + antRows + '</tbody>' +
        '<tfoot><tr><td colspan="2" style="padding:9px 12px;font-weight:700;border-top:2px solid #C6CFD4">Anticipated balances</td>' +
          '<td style="text-align:right;padding:9px 12px;font-weight:700;border-top:2px solid #C6CFD4">' + m0(c.antGoods) + '</td>' +
          '<td style="text-align:right;padding:9px 12px;font-weight:700;border-top:2px solid #C6CFD4">' + m0(c.antTax) + '</td>' +
          '<td style="text-align:right;padding:9px 12px;font-weight:700;border-top:2px solid #C6CFD4">' + m0(c.antFreight) + '</td>' +
          '<td style="text-align:right;padding:9px 12px;font-weight:700;border-top:2px solid #C6CFD4">' + m0(c.antTotal) + '</td></tr></tfoot></table>' +

        '<div style="background:#EEF3F5;border:1px solid #7DA3B3;border-radius:6px;padding:16px 18px;margin-top:16px;display:flex;justify-content:space-between;align-items:center">' +
          '<div style="max-width:520px"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#4A6E7E;font-weight:700">Funds requested from Owner</div>' +
            '<div style="font-size:12px;color:#5C6B72;margin-top:3px">Anticipated balances (' + m0(c.antTotal) + ') less funds currently held in trust (' + m0(c.held) + ').</div></div>' +
          '<div style="font-size:28px;font-weight:800;color:#4A6E7E;font-variant-numeric:tabular-nums">' + m0(c.requested) + '</div>' +
        '</div>' +
      '</div>';
  }
  function metaCell(k, v) { return '<div><div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#93A1A8;margin-bottom:3px">' + k + '</div><div style="font-size:13.5px;font-weight:600">' + esc(v) + '</div></div>'; }

  function render() {
    var host = document.getElementById('page-owner-statement');
    if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to generate its Owner Statement.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var ym = periodInput();
    var c = compute(proj.name);

    var bar = '<div class="rp-toolbar"><div class="rp-toolbar-left">' +
      '<div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">Statement &amp; advance funding request</div></div>' +
      '<div class="rp-toolbar-right">' +
        '<label style="font-size:12px;color:var(--text2)">Period <input type="month" value="' + ym + '" onchange="osSetPeriod(this.value)" style="margin-left:6px;padding:6px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-family:inherit"></label>' +
        '<button class="btn btn-primary" onclick="osPrint()">\u2399 Generate PDF</button>' +
      '</div></div>';

    host.innerHTML = bar +
      '<div class="card" style="padding:34px 38px"><div id="os-doc">' + statementHtml(proj, c, ym) + '</div></div>';
  }

  function osPrint() {
    var proj = activeProject; if (!proj) return;
    if (typeof printPreview === 'function') printPreview('os-doc', 'Owner Statement — ' + proj.name, '@page{margin:0.6in 0.7in}', 'Owner Statement — ' + proj.name);
  }

  window.renderOwnerStatement = render;
  window.osSetPeriod = setPeriod;
  window.osPrint = osPrint;
})();
