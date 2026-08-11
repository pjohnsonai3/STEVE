/* ============================================================================
   STEVE — Cash-Flow Projection  (cash-flow.js)
   Project-scoped forward funding timeline, driven entirely by the Procurement
   Tracker and sequenced LONGEST-LEAD-ITEMS-FIRST.

   Model — a procurement buyout, not a billing schedule:
     • Funds already disbursed (Amt Paid / Tax Paid / Freight Paid) show as the
       current month's "funded" bar.
     • Every item still to buy carries a remaining need = balance due (if already
       ordered) or its full extension (if not yet ordered), plus proportional
       tax & freight.
     • To hit delivery, the items with the LONGEST lead times must be ordered
       first. So each un-ordered item is scheduled to be released at
         today + (maxLead − itemLead)
       — the longest-lead item releases now, shorter-lead items release later.
       A deposit is funded at release; the balance is funded at delivery
       (release + lead time). Already-ordered items schedule their outstanding
       balance into their real delivery month (last payment + lead time).

   The result is a front-loaded, taper-down curve: heavy early funding to get
   long-lead goods on order, lighter funding as the buyout completes.

   Reuses budgetTrackers, activeProject, parseLeadWeeks, escHtml, ensureBudgetTracker.
   ============================================================================ */
(function () {
  'use strict';

  var DEPOSIT_PCT = 0.5; // standard FF&E deposit at order; balance at delivery

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function num(v) { return parseFloat(v) || 0; }
  function m0(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('en-US'); }
  function mShort(v) { var n = Math.round(Number(v) || 0); if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M'; if (n >= 1000) return '$' + Math.round(n / 1000) + 'K'; return '$' + n; }
  function leadWeeks(lt) { return (typeof parseLeadWeeks === 'function') ? parseLeadWeeks(lt) : 0; }

  function trackerItems(name) { var bt = budgetTrackers[name]; return bt ? bt.items.filter(function (i) { return !i.isCategory; }) : []; }

  function parseISO(s) { if (!s) return null; var p = String(s).split('-'); if (p.length < 3) return null; var d = new Date(+p[0], +p[1] - 1, +p[2]); return isNaN(d) ? null : d; }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
  function firstOfMonth(d) { var x = new Date(d.getTime()); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
  function addWeeks(d, w) { var x = new Date(d.getTime()); x.setDate(x.getDate() + Math.round((w || 0) * 7)); return x; }

  // Walk the tracker once, tagging each line with the category it sits under so
  // installation/labor lines can be excluded from the % add-ons — exactly as the
  // Procurement Tracker, PAs and budgets do (via the shared isInstallCat helper).
  function trackerItemsTagged(name) {
    var bt = budgetTrackers[name]; if (!bt || !bt.items) return [];
    var cat = '', out = [];
    bt.items.forEach(function (it) {
      if (it.isCategory) { cat = it.name || ''; return; }
      var isInst = (typeof isInstallCat === 'function') ? isInstallCat(cat) : /install/i.test(cat);
      out.push(Object.assign({}, it, { _isInstall: isInst }));
    });
    return out;
  }

  function compute(name) {
    var bt = budgetTrackers[name] || {};
    var items = trackerItemsTagged(name);
    var feeP = num(bt.feePct) / 100, contP = num(bt.contPct) / 100,
        freightP = num(bt.freightPct) / 100, tariffP = num(bt.tariffPct) / 100, taxP = num(bt.taxPct) / 100;
    var today = firstOfMonth(new Date());
    var nowKey = monthKey(today);

    // Break a goods line into the components the client is billed: goods, the
    // procurement FEE (billed up front — see below), other ADD-ONS (contingency +
    // tariff, which ride with the item), freight, and tax (on goods + freight).
    // Installation lines are pass-through — goods only — so monthly totals
    // reconcile to the tracker's Customer Total.
    function components(it) {
      var ext = num(it.qty) * num(it.estPrice);
      if (ext <= 0) return null;
      if (it._isInstall) return { goods: ext, fee: 0, addons: 0, freight: 0, tax: 0 };
      var freight = ext * freightP;
      return { goods: ext, fee: ext * feeP, addons: ext * (contP + tariffP), freight: freight, tax: (ext + freight) * taxP };
    }
    function compTotal(c) { return c.goods + c.fee + c.addons + c.freight + c.tax; }

    var buckets = {}; // key -> {goods,fees,freight,tax,procFee,orders,maxLead}
    function bucket(key) { if (!buckets[key]) buckets[key] = { goods: 0, fees: 0, freight: 0, tax: 0, procFee: 0, orders: 0, maxLead: 0 }; return buckets[key]; }
    // Per-item placement: the procurement fee is intentionally NOT booked here —
    // it is pooled and billed in the first month instead. Only goods, the add-ons
    // (contingency + tariff), freight and tax follow the item to its month.
    function place(key, c, lead) {
      var b = bucket(key);
      b.goods += c.goods; b.fees += c.addons; b.freight += c.freight; b.tax += c.tax; b.orders += 1;
      if (lead > b.maxLead) b.maxLead = lead;
    }

    // ── 1. Already-funded portion → standalone "funded to date" total ───────
    // A line's funded fraction is how much of its goods cost has been paid to the
    // vendor; that fraction of its full customer value is treated as funded, so
    // funded + remaining always reconciles to the Customer Total.
    var funded = { goods: 0, fees: 0, freight: 0, tax: 0 };
    var needs = [];
    items.forEach(function (it) {
      var c = components(it); if (!c) return;
      var ext = num(it.qty) * num(it.estPrice);
      var paidFrac = ext > 0 ? Math.min(Math.max(num(it.amtPaid) / ext, 0), 1) : 0;
      var ordered = num(it.amtPaid) > 0.5 || !!String(it.orderNo || '').trim();
      if (paidFrac > 0) {
        funded.goods += c.goods * paidFrac; funded.fees += (c.fee + c.addons) * paidFrac;
        funded.freight += c.freight * paidFrac; funded.tax += c.tax * paidFrac;
      }
      var rem = 1 - paidFrac;
      if (rem > 0.0001 && compTotal(c) * rem > 0.5) {
        needs.push({ ordered: ordered, lead: leadWeeks(it.leadTime), datePaid: it.datePaid,
          c: { goods: c.goods * rem, fee: c.fee * rem, addons: c.addons * rem, freight: c.freight * rem, tax: c.tax * rem } });
      }
    });
    var fundedTotal = funded.goods + funded.fees + funded.freight + funded.tax;
    var fundedRow = fundedTotal > 0.5
      ? { key: '__funded__', label: monthLabel(nowKey), goods: funded.goods, fees: funded.fees, freight: funded.freight, tax: funded.tax, total: fundedTotal, funded: true, orders: 0, maxLead: 0 }
      : null;

    // Longest lead among un-ordered items drives the release sequence.
    var maxLead = needs.reduce(function (m, n) { return n.ordered ? m : Math.max(m, n.lead); }, 0);
    var noLeadCount = 0, noLeadValue = 0;
    var procFeePool = 0; // remaining procurement fee — billed in the first month

    // ── 2. Schedule each remaining need ─────────────────────────────────────
    needs.forEach(function (n) {
      procFeePool += n.c.fee; // pull the procurement fee out of the item's month
      if (n.ordered) {
        // Outstanding balance on an already-placed order → due at delivery.
        var base = parseISO(n.datePaid) || today;
        var due = firstOfMonth(addWeeks(base, n.lead));
        if (due < today) due = today;
        place(monthKey(due), n.c, n.lead);
      } else if (n.lead > 0) {
        // Not yet ordered, known lead time: release at today + (longest lead −
        // its lead) so the longest-lead goods get ordered first.
        var release = firstOfMonth(addWeeks(today, maxLead - n.lead));
        if (release < today) release = today;
        place(monthKey(release), n.c, n.lead);
      } else {
        // No lead time entered → book in the current month and flag it so the
        // user knows to add a lead time to schedule it properly.
        noLeadCount++; noLeadValue += compTotal(n.c);
        place(nowKey, n.c, 0);
      }
    });

    // ── 3. Bill the full remaining procurement fee in the FIRST month ───────
    // The design firm's procurement fee is invoiced up front, not spread across
    // deliveries. Pool it from every remaining line and drop it into the earliest
    // scheduled month (or the current month if nothing else is scheduled).
    if (procFeePool > 0.5) {
      var firstKey = Object.keys(buckets).sort()[0] || nowKey;
      var fb = bucket(firstKey);
      fb.fees += procFeePool; fb.procFee += procFeePool;
    }

    var keys = Object.keys(buckets).sort();
    var projRows = keys.map(function (k) {
      var b = buckets[k]; var total = b.goods + b.fees + b.freight + b.tax;
      return { key: k, label: monthLabel(k), goods: b.goods, fees: b.fees, freight: b.freight, tax: b.tax,
        procFee: b.procFee, total: total, funded: false, orders: b.orders, maxLead: b.maxLead };
    }).filter(function (r) { return r.total > 0.5; });
    var rows = projRows;
    var toFund = projRows.reduce(function (a, r) { return a + r.total; }, 0);
    var peak = projRows.slice().sort(function (a, b) { return b.total - a.total; })[0] || null;
    var last = projRows.length ? projRows[projRows.length - 1] : null;
    var hasLead = maxLead > 0;
    var unordered = needs.filter(function (n) { return !n.ordered; }).length;

    return { rows: rows, fundedTotal: fundedTotal, toFund: toFund, peak: peak, last: last,
      total: fundedTotal + toFund, hasLead: hasLead, unordered: unordered,
      noLeadCount: noLeadCount, noLeadValue: noLeadValue };
  }

  function render() {
    var host = document.getElementById('page-cash-flow');
    if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to project its cash flow.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var c = compute(proj.name);

    var bar = '<div class="rp-toolbar"><div class="rp-toolbar-left">' +
      '<div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">Funding need by month \u00b7 longest-lead items first</div></div>' +
      '<div class="rp-toolbar-right"><button class="btn btn-primary" onclick="cfExport()">\u2913 Export sheet</button></div></div>';

    var pctFunded = c.total > 0 ? Math.round(c.fundedTotal / c.total * 100) : 0;
    var monthsCount = c.rows.length;
    var kpis = '<div class="rp-kpi-row k4">' +
      kpi('Remaining to fund', mShort(c.toFund), c.toFund > 0.5 ? (monthsCount > 1 ? 'across ' + monthsCount + ' months' : 'still to buy') : 'fully funded') +
      kpi('Funded to date', mShort(c.fundedTotal), pctFunded + '% of ' + mShort(c.total)) +
      kpi('Peak month', c.peak ? c.peak.label : '\u2014', c.peak ? mShort(c.peak.total) + ' needed' : 'nothing outstanding') +
      kpi('All funding by', c.last ? c.last.label : '\u2014', c.last ? 'last order released' : 'fully funded') +
      '</div>';

    // Funded-vs-total progress (historical context, not a timeline bar)
    var progress = '<div class="card" style="padding:14px 18px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">' +
        '<span style="font-size:12.5px;color:var(--text2)">Funded to date vs total project</span>' +
        '<span style="font-size:13px;font-weight:700">' + m0(c.fundedTotal) + ' <span style="color:var(--text3);font-weight:400">/ ' + m0(c.total) + '</span></span></div>' +
      '<div style="background:var(--surface2);border-radius:6px;height:14px;overflow:hidden;display:flex">' +
        '<div style="height:100%;background:var(--green);width:' + Math.min(100, pctFunded) + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-top:5px">' +
        '<span>' + pctFunded + '% funded</span><span>' + m0(c.toFund) + ' remaining</span></div></div>';

    var max = c.rows.reduce(function (a, r) { return Math.max(a, r.total); }, 0) || 1;
    var rowsHtml = c.rows.length ? c.rows.map(function (r) {
      var pct = function (v) { return (v / max * 100).toFixed(2) + '%'; };
      var sub = '<small style="color:var(--text3)">' + (r.orders ? r.orders + (r.orders === 1 ? ' order' : ' orders') : 'projected') + (r.maxLead ? ' \u00b7 to ' + Math.round(r.maxLead) + ' wk lead' : '') + (r.procFee > 0.5 ? ' \u00b7 <span style="color:var(--accent-ink)">incl. procurement fee</span>' : '') + '</small>';
      return '<div style="display:grid;grid-template-columns:128px 1fr 120px;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:13px;font-weight:600">' + r.label + '<div>' + sub + '</div></div>' +
        '<div style="background:var(--surface2);border-radius:5px;height:30px;display:flex;overflow:hidden">' +
          '<div style="height:100%;background:var(--accent-ink);width:' + pct(r.goods) + '"></div>' +
          '<div style="height:100%;background:var(--text3);width:' + pct(r.fees) + '"></div>' +
          '<div style="height:100%;background:var(--accent);width:' + pct(r.freight) + '"></div>' +
          '<div style="height:100%;background:var(--warn);width:' + pct(r.tax) + '"></div>' +
        '</div>' +
        '<div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;font-size:13.5px">' + m0(r.total) + '<div style="font-weight:400;color:var(--text3);font-size:11px">to fund</div></div>' +
      '</div>';
    }).join('') : '<div class="rp-empty">No outstanding balances to project \u2014 every tracked item is funded.</div>';

    var legend = '<div style="display:flex;gap:16px;font-size:12px;color:var(--text2);margin-bottom:6px;flex-wrap:wrap">' +
      '<span style="display:flex;align-items:center;gap:6px"><i style="width:11px;height:11px;border-radius:3px;background:var(--accent-ink);display:inline-block"></i>Goods</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><i style="width:11px;height:11px;border-radius:3px;background:var(--text3);display:inline-block"></i>Fees</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><i style="width:11px;height:11px;border-radius:3px;background:var(--accent);display:inline-block"></i>Freight</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><i style="width:11px;height:11px;border-radius:3px;background:var(--warn);display:inline-block"></i>Tax</span></div>';

    // Prompt to add lead times — that's what spreads the buyout across months.
    var leadHint = '';
    if (!c.hasLead && c.unordered > 0) {
      leadHint = '<div style="margin-bottom:12px;padding:10px 14px;background:var(--warn-bg,rgba(214,154,0,.1));border:1px solid var(--warn,#d69a00);border-radius:var(--radius-sm);font-size:12.5px;color:var(--text2);line-height:1.5">' +
        '<b>Add lead times in the Procurement Tracker</b> to spread the remaining ' + m0(c.toFund) + ' across months. With no lead times, all ' + c.unordered + ' un-ordered item' + (c.unordered === 1 ? '' : 's') + ' fall into the current month. Lead times let STEVE sequence the longest-lead orders first.</div>';
    } else if (c.noLeadCount > 0) {
      leadHint = '<div style="margin-bottom:12px;padding:10px 14px;background:var(--warn-bg,rgba(214,154,0,.1));border:1px solid var(--warn,#d69a00);border-radius:var(--radius-sm);font-size:12.5px;color:var(--text2);line-height:1.5">' +
        '<b>' + c.noLeadCount + ' item' + (c.noLeadCount === 1 ? '' : 's') + ' (' + mShort(c.noLeadValue) + ') ' + (c.noLeadCount === 1 ? 'has' : 'have') + ' no lead time</b> and ' + (c.noLeadCount === 1 ? 'is' : 'are') + ' booked in the current month. Add lead times in the Procurement Tracker to schedule ' + (c.noLeadCount === 1 ? 'it' : 'them') + ' in the right month.</div>';
    }

    host.innerHTML = bar + kpis + progress + leadHint +
      '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div class="section-title" style="font-size:15px">Remaining funding need by month</div>' + legend + '</div>' +
        rowsHtml +
        '<div style="font-size:12px;color:var(--text3);margin-top:12px;line-height:1.55">Forward-looking from the <b>Procurement Tracker</b> &mdash; money already disbursed is shown as <b>funded to date</b> above, not in the timeline. ' +
        'Each item still to buy is sequenced <b>longest-lead first</b>: its purchase order must be released at <i>today + (longest lead \u2212 its lead)</i>, and the item\u2019s goods + contingency, tariff, freight &amp; tax are booked in that month. The <b>procurement fee is billed up front in the first month</b>. ' +
        'Totals reconcile to the tracker\u2019s Customer Total; installation lines carry no add-ons. Updates automatically as POs are issued and payments are logged.</div>' +
      '</div>';
  }

  function kpi(label, value, sub) {
    return '<div class="rp-kpi"><div class="rp-kpi-label">' + label + '</div><div class="rp-kpi-value sm">' + value + '</div><div class="rp-kpi-sub">' + sub + '</div></div>';
  }

  function cfExport() {
    var proj = activeProject; if (!proj) return;
    var c = compute(proj.name);
    var lines = [['Month', 'Goods', 'Fees', 'Freight', 'Tax', 'Total', 'Orders', 'Max lead (wk)']];
    if (c.fundedRow) { var fr = c.fundedRow; lines.push(['Funded to date', fr.goods.toFixed(2), fr.fees.toFixed(2), fr.freight.toFixed(2), fr.tax.toFixed(2), fr.total.toFixed(2), '', '']); }
    c.rows.forEach(function (r) { lines.push([r.label, r.goods.toFixed(2), r.fees.toFixed(2), r.freight.toFixed(2), r.tax.toFixed(2), r.total.toFixed(2), r.orders || 0, r.maxLead ? Math.round(r.maxLead) : '']); });
    var csv = lines.map(function (row) { return row.map(function (v) { return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'Cash-Flow Projection \u2014 ' + proj.name + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    if (typeof ai3Toast === 'function') ai3Toast('Cash-flow sheet exported');
  }

  window.renderCashFlow = render;
  window.cfExport = cfExport;
})();
