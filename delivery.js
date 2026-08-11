/* ============================================================================
   STEVE — Delivery & Expediting tracker  (delivery.js)
   Project-scoped. Projects every line item's lead time into an ETA, tracks
   ship status, flags late items. Views: Schedule · Timeline · Board.
   Schedule supports bulk multi-select actions. Exposes dlGetRows / dlSummary
   for the Home dashboard.
   ============================================================================ */
(function () {
  'use strict';

  var STATUSES = [
    { k: 'none',  label: 'Not Ordered',  cls: 'st-none',  bar: 'var(--border2)' },
    { k: 'order', label: 'Ordered',      cls: 'st-order', bar: 'var(--blue)' },
    { k: 'prod',  label: 'In Production', cls: 'st-prod', bar: 'var(--amber)' },
    { k: 'ship',  label: 'Shipped',      cls: 'st-ship',  bar: 'var(--accent-ink)' },
    { k: 'recv',  label: 'Received',     cls: 'st-recv',  bar: 'var(--green)' }
  ];
  function stMeta(k) { return STATUSES.find(function (s) { return s.k === k; }) || STATUSES[0]; }

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function leadWk(s) { try { return (typeof parseLeadWeeks === 'function') ? parseLeadWeeks(s) : 0; } catch (e) { return 0; } }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseD(s) { if (!s) return null; var p = String(s).split('-'); if (p.length < 3) return null; var d = new Date(+p[0], +p[1] - 1, +p[2]); return isNaN(d) ? null : d; }
  function addDays(iso, n) { var d = parseD(iso); if (!d) return ''; d.setDate(d.getDate() + n); return toISO(d); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtDate(iso) { var d = parseD(iso); if (!d) return '—'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  function store() { try { return DB.load('fp11_delivery', {}); } catch (e) { return {}; } }
  function saveStore(s) { try { DB.save('fp11_delivery', s); } catch (e) {} }

  var dlProj = null;
  var dlSel = {};   // selection in schedule view {id:true}
  function getView() { return localStorage.getItem('dl_view') || 'schedule'; }

  function defaultOrdered(proj) {
    if (proj && proj.start) return proj.start;
    var bt = budgetTrackers[proj && proj.name];
    if (bt && bt.clientPayments && bt.clientPayments[0]) return bt.clientPayments[0].date;
    return '';
  }

  function getRows(projName) {
    var bt = budgetTrackers[projName]; if (!bt) return [];
    var proj = projects.find(function (p) { return p.name === projName; });
    var st = store(); var ps = st[projName] || {};
    var base = defaultOrdered(proj);
    var t = today(); var cur = ''; var rows = [];
    bt.items.forEach(function (it) {
      if (it.isCategory) { cur = it.name; return; }
      var saved = ps[it.id] || {};
      var lw = leadWk(it.leadTime);
      var status = saved.status || ((it.orderNo || it.amtPaid > 0) ? 'order' : 'none');
      var ordered = saved.ordered != null ? saved.ordered : (status !== 'none' ? base : '');
      var eta = saved.eta != null ? saved.eta : (ordered && lw ? addDays(ordered, Math.round(lw * 7)) : '');
      var install = saved.install != null ? saved.install : (proj && proj.end) || '';
      var note = it.statusRemarks || saved.note || '';
      var etaD = parseD(eta);
      var late = !!(etaD && status !== 'recv' && etaD < t);
      var dueSoon = !!(etaD && status !== 'recv' && !late && daysBetween(t, etaD) <= 21);
      rows.push({ id: it.id, name: it.name || '(untitled)', itemNum: it.itemNum || '', cat: cur, vendor: it.vendor || '', qty: it.qty || 0,
        leadTime: it.leadTime || '', leadWeeks: lw, status: status, ordered: ordered, eta: eta, install: install,
        note: note, late: late, dueSoon: dueSoon, ext: (it.qty || 0) * (it.estPrice || 0) });
    });
    return rows;
  }

  function setField(projName, id, field, value) {
    // Notes share a single source with the Procurement Tracker (item.statusRemarks),
    // so a note edited on either page appears on both.
    if (field === 'note') {
      var btN = budgetTrackers[projName];
      var itN = btN && btN.items.find(function (x) { return x.id === id; });
      if (itN) { itN.statusRemarks = value; try { DB.save('fp11_bt', budgetTrackers); } catch (e) {} }
      return;
    }
    var st = store(); st[projName] = st[projName] || {}; st[projName][id] = st[projName][id] || {};
    st[projName][id][field] = value;
    if (field === 'ordered') {
      var bt = budgetTrackers[projName];
      var it = bt && bt.items.find(function (x) { return x.id === id; });
      var lw = it ? leadWk(it.leadTime) : 0;
      if (lw && (st[projName][id].eta == null || st[projName][id].eta === '')) st[projName][id].eta = addDays(value, Math.round(lw * 7));
    }
    saveStore(st);
  }

  function dlUpdate(id, field, value) { if (!dlProj) return; setField(dlProj, id, field, value); render(); }
  // Notes use the same slide-out drawer (and the same source) as the Procurement Tracker.
  function dlOpenNotes(id) { if (!dlProj) return; if (typeof btOpenNotes === 'function') btOpenNotes(dlProj, id, window.renderDelivery); }
  function dlSetStatus(id, value) { if (typeof logActivity === 'function') logActivity('Updated delivery status'); dlUpdate(id, 'status', value); }
  function dlSetView(v) { localStorage.setItem('dl_view', v); render(); }

  // ── Bulk selection ─────────────────────────────────────────────────────────
  function selCount() { return Object.keys(dlSel).filter(function (k) { return dlSel[k]; }).length; }
  function dlToggleSel(id, on) { if (on) dlSel[id] = true; else delete dlSel[id]; render(); }
  function dlSelAll(on) { dlSel = {}; if (on) getRows(dlProj).forEach(function (r) { dlSel[r.id] = true; }); render(); }
  function dlClearSel() { dlSel = {}; render(); }
  function dlBulkStatus(v) {
    if (!v) return;
    var ids = Object.keys(dlSel).filter(function (k) { return dlSel[k]; });
    ids.forEach(function (id) { setField(dlProj, isNaN(+id) ? id : +id, 'status', v); });
    if (typeof logActivity === 'function') logActivity('Bulk set ' + ids.length + ' items to ' + stMeta(v).label);
    dlSel = {}; render();
  }
  function dlBulkRecompute() {
    var rows = getRows(dlProj);
    var ids = Object.keys(dlSel).filter(function (k) { return dlSel[k]; });
    ids.forEach(function (id) {
      var r = rows.find(function (x) { return String(x.id) === String(id); });
      if (r && r.ordered && r.leadWeeks) setField(dlProj, r.id, 'eta', addDays(r.ordered, Math.round(r.leadWeeks * 7)));
    });
    if (typeof logActivity === 'function') logActivity('Recomputed ETA for ' + ids.length + ' items');
    dlSel = {}; render();
  }

  function statusSelect(row, small) {
    return '<select class="' + (small ? '' : 'dl-sel') + '" onchange="dlSetStatus(' + row.id + ', this.value)">' +
      STATUSES.map(function (s) { return '<option value="' + s.k + '"' + (s.k === row.status ? ' selected' : '') + '>' + s.label + '</option>'; }).join('') + '</select>';
  }

  function statStrip(rows) {
    var by = {}; STATUSES.forEach(function (s) { by[s.k] = 0; });
    var late = 0; rows.forEach(function (r) { by[r.status]++; if (r.late) late++; });
    var cards = [['Line items', rows.length, ''], ['Ordered', by.order, 'var(--blue)'], ['In production', by.prod, 'var(--amber)'],
      ['Shipped', by.ship, 'var(--accent-ink)'], ['Received', by.recv, 'var(--green)'], ['Late', late, late ? 'var(--red)' : 'var(--green)']];
    return '<div class="rp-kpi-row k5" style="grid-template-columns:repeat(6,1fr)">' + cards.map(function (c) {
      return '<div class="rp-kpi"><div class="rp-kpi-label">' + c[0] + '</div><div class="rp-kpi-value sm"' + (c[2] ? ' style="color:' + c[2] + '"' : '') + '>' + c[1] + '</div></div>';
    }).join('') + '</div>';
  }

  function viewSchedule(rows) {
    rows = rows.slice().sort(function (a, b) {
      if (a.late !== b.late) return a.late ? -1 : 1;
      var ea = parseD(a.eta), eb = parseD(b.eta);
      if (ea && eb) return ea - eb; if (ea) return -1; if (eb) return 1; return 0;
    });
    var n = selCount();
    var allOn = n > 0 && n === rows.length;
    var bulkBar = n > 0 ? '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--accent-bg);border-bottom:1px solid var(--border);flex-wrap:wrap">' +
      '<b style="font-size:12.5px;color:var(--accent-ink)">' + n + ' selected</b>' +
      '<span style="font-size:12px;color:var(--text2)">Set status</span>' +
      '<select class="dl-sel" onchange="dlBulkStatus(this.value);this.value=\'\'"><option value="">Choose…</option>' +
      STATUSES.map(function (s) { return '<option value="' + s.k + '">' + s.label + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-sm" onclick="dlBulkRecompute()">Recompute ETA from lead</button>' +
      '<button class="btn btn-sm" onclick="dlClearSel()">Clear</button></div>' : '';
    var body = rows.map(function (r) {
      var checked = dlSel[r.id] ? ' checked' : '';
      return '<tr class="' + (r.late ? 'late' : '') + '">' +
        '<td style="width:30px;text-align:center"><input type="checkbox"' + checked + ' onchange="dlToggleSel(' + r.id + ', this.checked)" /></td>' +
        '<td style="white-space:nowrap;font-weight:600;color:var(--accent-ink);font-size:12px">' + (r.itemNum ? esc(r.itemNum) : '<span style="color:var(--text3);font-weight:400">—</span>') + '</td>' +
        '<td style="max-width:260px"><div class="dl-item-name">' + esc(r.name) + (r.late ? ' <span class="dl-late-pill">LATE</span>' : (r.dueSoon ? ' <span class="dl-late-pill" style="background:var(--amber-bg);color:var(--amber)">DUE SOON</span>' : '')) + '</div><div class="dl-item-sub">' + esc(r.cat) + ' · qty ' + r.qty + '</div></td>' +
        '<td style="font-size:12px">' + esc(r.vendor || '—') + '</td>' +
        '<td style="white-space:nowrap;font-size:12px">' + (r.leadTime ? esc(r.leadTime) : '<span style="color:var(--text3)">—</span>') + '</td>' +
        '<td>' + statusSelect(r) + '</td>' +
        '<td><input type="date" class="dl-inp" value="' + (r.ordered || '') + '" onchange="dlUpdate(' + r.id + ",'ordered',this.value)\" /></td>" +
        '<td><input type="date" class="dl-inp" value="' + (r.eta || '') + '" onchange="dlUpdate(' + r.id + ",'eta',this.value)\" style=\"" + (r.late ? 'color:var(--red);font-weight:600' : '') + '" /></td>' +
        '<td><input type="date" class="dl-inp" value="' + (r.install || '') + '" onchange="dlUpdate(' + r.id + ",'install',this.value)\" /></td>" +
        '<td style="min-width:160px"><div onclick="dlOpenNotes(' + r.id + ')" title="Click to edit notes" style="cursor:pointer;font-size:12px;line-height:1.35;' + (r.note ? 'color:var(--text2)' : 'color:var(--text3);font-style:italic') + '">' + (r.note ? esc(r.note) : '+ add note') + '</div></td>' +
        '</tr>';
    }).join('');
    return '<div class="rp-panel"><div class="rp-panel-body" style="padding:0">' + bulkBar + '<div style="overflow-x:auto;padding:4px 6px"><table class="dl-table">' +
      '<thead><tr><th style="width:30px;text-align:center"><input type="checkbox"' + (allOn ? ' checked' : '') + ' onchange="dlSelAll(this.checked)" /></th><th style="width:52px">Item #</th><th>Item</th><th>Vendor</th><th>Lead time</th><th>Status</th><th>Order date</th><th>Est. arrival</th><th>Install</th><th>Note</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="10" style="padding:30px;text-align:center;color:var(--text3)">No line items.</td></tr>') + '</tbody></table></div></div></div>';
  }

  function viewTimeline(rows) {
    var withDates = rows.filter(function (r) { return r.eta || r.ordered; });
    if (!withDates.length) return '<div class="rp-panel"><div class="rp-panel-body"><div class="rp-empty">No scheduled dates yet. Set order dates in the Schedule view to build the timeline.</div></div></div>';
    var t = today(); var mins = [t], maxs = [t];
    withDates.forEach(function (r) { var o = parseD(r.ordered), e = parseD(r.eta), i = parseD(r.install); if (o) { mins.push(o); maxs.push(o); } if (e) { mins.push(e); maxs.push(e); } if (i) maxs.push(i); });
    var min = new Date(Math.min.apply(null, mins)); var max = new Date(Math.max.apply(null, maxs));
    min = new Date(min.getFullYear(), min.getMonth(), 1); max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    var span = Math.max(1, daysBetween(min, max));
    var pos = function (d) { return Math.max(0, Math.min(100, daysBetween(min, d) / span * 100)); };
    var months = []; var mc = new Date(min); while (mc <= max) { months.push(new Date(mc)); mc.setMonth(mc.getMonth() + 1); }
    var monthsHtml = months.map(function (m) { return '<div class="dl-tl-month">' + m.toLocaleDateString('en-US', { month: 'short' }) + ' \u2019' + pad(m.getFullYear() % 100) + '</div>'; }).join('');
    var gridHtml = months.map(function () { return '<div></div>'; }).join('');
    var sorted = withDates.slice().sort(function (a, b) { var ea = parseD(a.eta) || parseD(a.ordered), eb = parseD(b.eta) || parseD(b.ordered); return ea - eb; });
    var rowsHtml = sorted.map(function (r) {
      var o = parseD(r.ordered) || parseD(r.eta); var e = parseD(r.eta) || parseD(r.ordered);
      var left = pos(o), right = pos(e); var w = Math.max(1.5, right - left); var m = stMeta(r.status);
      var barColor = r.late ? 'var(--red)' : m.bar; var labelInside = w > 14;
      return '<div class="dl-tl-row"><div class="dl-tl-label"><div class="dl-item-name" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.name) + '</div><div class="dl-item-sub">' + esc(r.vendor || r.cat) + '</div></div>' +
        '<div class="dl-tl-track"><div class="dl-tl-grid">' + gridHtml + '</div>' +
        '<div class="dl-tl-bar" title="' + esc(r.name) + ' — ' + fmtDate(r.ordered) + ' \u2192 ' + fmtDate(r.eta) + '" style="left:' + left + '%;width:' + w + '%;background:' + barColor + (m.k === 'none' ? ';color:var(--text2)' : '') + '">' + (labelInside ? fmtDate(r.eta) : '') + '</div></div></div>';
    }).join('');
    var todayLeft = pos(t);
    return '<div class="rp-panel"><div class="rp-panel-body">' +
      '<div class="dl-tl-head"><div></div><div class="dl-tl-months">' + monthsHtml + '</div></div>' +
      '<div style="position:relative"><div class="dl-tl-today" style="left:calc(240px + (100% - 240px) * ' + (todayLeft / 100) + ')"></div>' + rowsHtml + '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">' +
      STATUSES.map(function (s) { return '<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2)"><span style="width:12px;height:12px;border-radius:3px;background:' + s.bar + '"></span>' + s.label + '</div>'; }).join('') +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2)"><span style="width:12px;height:12px;border-radius:3px;background:var(--red)"></span>Late</div></div></div></div>';
  }

  function viewBoard(rows) {
    return '<div class="dl-board">' + STATUSES.map(function (s) {
      var arr = rows.filter(function (r) { return r.status === s.k; });
      var cards = arr.map(function (r) {
        return '<div class="dl-card' + (r.late ? ' late' : '') + '"><div class="dl-card-name">' + esc(r.name) + '</div>' +
          '<div class="dl-card-sub">' + esc(r.vendor || r.cat) + ' · qty ' + r.qty + '</div>' +
          '<div class="dl-card-foot"><span style="font-size:11px;color:' + (r.late ? 'var(--red)' : 'var(--text3)') + ';font-weight:' + (r.late ? '700' : '400') + '">' + (r.eta ? (r.late ? 'Late · ' : 'ETA ') + fmtDate(r.eta) : 'No ETA') + '</span>' + statusSelect(r, true) + '</div></div>';
      }).join('') || '<div style="font-size:11.5px;color:var(--text3);padding:8px 2px">None</div>';
      return '<div class="dl-col"><div class="dl-col-head"><span class="dl-col-title">' + s.label + '</span><span class="dl-col-n">' + arr.length + '</span></div>' + cards + '</div>';
    }).join('') + '</div>';
  }

  function render() {
    var host = document.getElementById('page-delivery'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="dl-wrap"><div class="rp-empty">Open a project to track its deliveries.</div></div>'; return; }
    if (dlProj !== proj.name) { dlSel = {}; }
    dlProj = proj.name;
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var rows = getRows(proj.name); var view = getView();
    var lateRows = rows.filter(function (r) { return r.late; });
    var VIEWS = { schedule: 'Schedule', timeline: 'Timeline', board: 'Board' };
    var toolbar = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">' + rows.length + ' line items · expediting schedule from lead times</div></div>' +
      '<div class="rp-toolbar-right" style="display:flex;align-items:center;gap:10px"><div class="rp-seg">' +
      Object.keys(VIEWS).map(function (k) { return '<button class="' + (k === view ? 'active' : '') + '" onclick="dlSetView(\'' + k + '\')">' + VIEWS[k] + '</button>'; }).join('') + '</div>' +
      '<button class="btn btn-sm" onclick="dlPrint()" title="Export the monthly material-status report for the Owner / PM">\u2399 Monthly status PDF</button></div></div>';
    var alert = lateRows.length ? '<div class="dl-alert"><svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--red);fill:none;stroke-width:2;flex-shrink:0"><path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
      '<div><b>' + lateRows.length + ' item' + (lateRows.length !== 1 ? 's are' : ' is') + ' past estimated arrival.</b> ' + esc(lateRows.slice(0, 3).map(function (r) { return r.name; }).join(', ')) + (lateRows.length > 3 ? ' and ' + (lateRows.length - 3) + ' more' : '') + '.</div></div>' : '';
    var bodyHtml = view === 'timeline' ? viewTimeline(rows) : view === 'board' ? viewBoard(rows) : viewSchedule(rows);
    host.innerHTML = '<div class="dl-wrap">' + toolbar + alert + statStrip(rows) + bodyHtml + '</div>';
  }

  // ── Monthly status report (the Owner / PM PDF) ──────────────────────────────
  // Derived entirely from the rows the expediter maintains here — single source
  // of truth. (Replaces the former standalone Material Tracking page.)
  var DL_BADGE = { none: 'gray', order: 'amber', prod: 'blue', ship: 'blue', recv: 'green' };

  function reportRows(projName) {
    return getRows(projName).slice().sort(function (a, b) {
      if (a.late !== b.late) return a.late ? -1 : 1;
      var ea = parseD(a.eta), eb = parseD(b.eta);
      if (ea && eb) return ea - eb; if (ea) return -1; if (eb) return 1; return 0;
    });
  }

  function reportTable(rows) {
    var body = rows.length ? rows.map(function (r) {
      var label = r.late ? 'Behind' : stMeta(r.status).label;
      var badge = r.late ? 'red' : (DL_BADGE[r.status] || 'gray');
      return '<tr' + (r.late ? ' style="background:var(--amber-bg)"' : '') + '>' +
        '<td class="fw500">' + (r.itemNum ? esc(r.itemNum) + ' \u2014 ' : '') + esc(r.name) + '</td>' +
        '<td>' + esc(r.vendor || '\u2014') + '</td>' +
        '<td style="text-align:right">' + r.qty + '</td>' +
        '<td><span class="badge badge-' + badge + '">' + esc(label) + '</span></td>' +
        '<td>' + fmtDate(r.ordered) + '</td>' +
        '<td' + (r.late ? ' style="color:var(--red);font-weight:600"' : '') + '>' + fmtDate(r.eta) + '</td>' +
        '<td>' + fmtDate(r.install) + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" style="padding:16px;color:var(--text3)">No line items yet.</td></tr>';
    return '<div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table>' +
      '<thead><tr><th>Item</th><th>Vendor</th><th style="text-align:right">Qty</th><th>Status</th><th>Ordered</th><th>Est. arrival</th><th>Install</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px;line-height:1.5">Status, order and arrival dates are maintained on the <b>Delivery &amp; Expediting</b> schedule; estimated arrival is projected from the order date and vendor lead time. Rows highlighted are <b style="color:var(--red)">behind schedule</b> \u2014 past the estimated arrival and not yet received.</div>';
  }

  function dlPrint() {
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { alert('Open a project first.'); return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var rows = reportRows(proj.name);
    var dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var header = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;margin-bottom:14px"><div style="display:flex;justify-content:space-between;border-bottom:2px solid #1A1A1A;padding-bottom:12px">' +
      '<div><div style="font-weight:800;font-size:18px">ai3, Inc.</div><div style="font-size:10px;letter-spacing:.14em;color:#93A1A8;font-weight:600">FF&amp;E PURCHASING AGENT</div></div>' +
      '<div style="text-align:right"><div style="font-size:16px;font-weight:700">Material Tracking Report</div><div style="font-size:12px;color:#5C6B72">' + esc(proj.name) + ' &middot; ' + dateStr + '</div></div></div></div>';
    var wrap = document.createElement('div'); wrap.id = 'dl-print'; wrap.style.cssText = 'position:absolute;left:-9999px';
    wrap.innerHTML = header + reportTable(rows);
    document.body.appendChild(wrap);
    if (typeof logActivity === 'function') logActivity('Exported material tracking report');
    if (typeof printPreview === 'function') printPreview('dl-print', 'Material Tracking \u2014 ' + proj.name, '@page{size:landscape;margin:0.5in}', 'Material Tracking \u2014 ' + proj.name);
    setTimeout(function () { wrap.remove(); }, 1000);
  }

  // Summary for the Home dashboard
  function dlSummary(projName) {
    var rows = getRows(projName);
    var late = rows.filter(function (r) { return r.late; });
    var dueSoon = rows.filter(function (r) { return r.dueSoon; });
    return { total: rows.length, late: late, dueSoon: dueSoon, lateCount: late.length };
  }

  window.renderDelivery = render;
  window.dlOpenNotes = dlOpenNotes;
  window.dlSetView = dlSetView;
  window.dlUpdate = dlUpdate;
  window.dlSetStatus = dlSetStatus;
  window.dlToggleSel = dlToggleSel;
  window.dlSelAll = dlSelAll;
  window.dlClearSel = dlClearSel;
  window.dlBulkStatus = dlBulkStatus;
  window.dlBulkRecompute = dlBulkRecompute;
  window.dlGetRows = getRows;
  window.dlSummary = dlSummary;
  window.dlPrint = dlPrint;
})();
