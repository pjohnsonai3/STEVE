/* ============================================================================
   STEVE — Procurement Tracker extensions (tracker-ext.js)
   · One tracker per Purchase Authorization (PA1, PA2, PA3…) with a toggle.
     Every row carries paId; legacy rows belong to the PA the tracker was
     seeded from.
   · Payments: one line per payment — amount, type, check #, freight, tax,
     date. Item freight/tax paid are now sums of the per-payment values.
   · Placing rows: typing an item # moves the row into the category for its
     hundreds band and re-sorts it numerically (C-101, C-101A, D-401F…).
   · Save indicator + Save button; PO list filter by PA.
   ========================================================================= */
(function () {
  'use strict';

  var BANDS = [
    { n: 1, label: 'Seating',       re: /seat|chair|sofa|settee|stool|bench|banquet|uphol/i },
    { n: 2, label: 'Tables',        re: /table|casegood|case good|desk|credenza|millwork|cabinet/i },
    { n: 3, label: 'Lighting',      re: /light|lamp|sconce|chandelier|pendant/i },
    { n: 4, label: 'Drapery',       re: /draper|window|shade|blind|soft ?good|textile|trim/i },
    { n: 5, label: 'Rugs',          re: /rug|carpet|floor ?cover/i },
    { n: 6, label: 'Miscellaneous', re: /misc|other|wall ?cover|signage|planter|equip/i },
    { n: 7, label: 'Mirrors',       re: /mirror|glass/i },
    { n: 8, label: 'Art',           re: /\bart\b|artwork|framed|print/i },
    { n: 9, label: 'Accessories',   re: /accessor|decor|pillow|throw|vase|object|bedding|linen/i }
  ];
  function toast(m) { try { if (typeof ai3Toast === 'function') ai3Toast(m); } catch (e) {} }
  function save() { DB.save('fp11_bt', budgetTrackers); }

  // ── PAs for a project, in issue order ─────────────────────────────────────
  function projectPAs(projName) {
    return (typeof pas !== 'undefined' ? pas : []).filter(function (p) { return p.project === projName; })
      .slice().sort(function (a, b) {
        var d = String(a.date || '').localeCompare(String(b.date || ''));
        return d || String(a.paNum || '').localeCompare(String(b.paNum || ''), undefined, { numeric: true });
      });
  }
  function paLabel(projName, paId) {
    var list = projectPAs(projName);
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(paId)) return 'PA' + (i + 1);
    return '';
  }
  window.btProjectPAs = projectPAs;
  window.btPALabel = paLabel;

  // Legacy rows → the PA the tracker was seeded from (same rule as ensureBudgetTracker).
  function migrate(projName) {
    var bt = budgetTrackers[projName];
    if (!bt || !Array.isArray(bt.items)) return;
    var missing = bt.items.filter(function (i) { return i.paId === undefined; });
    if (!missing.length) return;
    var seed = (typeof pas !== 'undefined' ? pas : []).find(function (p) { return p.project === projName; });
    var id = seed ? seed.id : '';
    missing.forEach(function (i) { i.paId = id; });
    save();
  }

  // Held in memory first so the choice sticks even if storage is blocked or
  // a sync re-render lands mid-change; localStorage only remembers it across reloads.
  var VIEW_KEY = 'steve_bt_pa_view', _views = {};
  window.TRACKER_EXT_VERSION = '2026-10-28b';
  function getView(projName) {
    if (Object.prototype.hasOwnProperty.call(_views, projName)) return _views[projName];
    try { return String((JSON.parse(localStorage.getItem(VIEW_KEY)) || {})[projName] || ''); } catch (e) { return ''; }
  }
  function setView(projName, v) {
    _views[projName] = String(v || '');
    try { var m = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; m[projName] = _views[projName]; localStorage.setItem(VIEW_KEY, JSON.stringify(m)); } catch (e) {}
  }

  // Called at the top of renderBTTable: migrate, fill toolbar selects, return the active PA view.
  window.btPAPrepare = function (projName) {
    migrate(projName);
    var list = projectPAs(projName);
    var v = getView(projName);
    if (v && !list.some(function (p) { return String(p.id) === v; })) v = '';
    var sel = document.getElementById('bt-pa-filter');
    if (sel) {
      sel.innerHTML = '<option value="">All PAs</option>' + list.map(function (p, i) {
        return '<option value="' + escHtml(String(p.id)) + '"' + (String(p.id) === v ? ' selected' : '') + '>PA' + (i + 1) + ' \u00b7 ' + escHtml(p.paNum || '') + '</option>';
      }).join('');
      sel.value = v;
      sel.style.display = list.length ? '' : 'none';
    }
    var sf = document.getElementById('bt-status-filter');
    if (sf && !sf.dataset.v2) {
      var cur = sf.value;
      sf.innerHTML = '<option value="">All Statuses</option>' +
        BT_STATUSES.map(function (s) { return '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>'; }).join('') +
        '<option value="none">No status set</option>' +
        '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500</option>' +
        '<option value="ordered">Ordered (has order # or payment)</option>' +
        '<option value="pending">Not yet ordered</option>';
      sf.value = cur && cur !== 'urgent' ? cur : (cur === 'urgent' ? 'Urgent' : '');
      sf.dataset.v2 = '1';
    }
    return v;
  };
  window.btViewTracker = function (projName, v) {
    var bt = budgetTrackers[projName];
    if (!v) return bt;
    return Object.assign({}, bt, { items: bt.items.filter(function (i) { return String(i.paId == null ? '' : i.paId) === String(v); }) });
  };
  window.btSetPAView = function (v) {
    var p = btCurrentProject; if (!p) return;
    setView(p, String(v || ''));
    renderBTTable();
  };
  window.btEmptyPAView = function (projName, v) {
    var pa = (pas || []).find(function (p) { return String(p.id) === String(v); });
    return '<div class="empty-state" style="padding:40px 20px;text-align:center">' +
      '<p style="margin-bottom:12px">No tracker rows for <strong>' + escHtml(paLabel(projName, v)) + ' \u00b7 ' + escHtml(pa ? pa.paNum || '' : '') + '</strong> yet.</p>' +
      (pa && pa.items && pa.items.length
        ? '<button class="btn btn-primary btn-sm" onclick="btLoadPAItems(\'' + escHtml(projName).replace(/'/g, "\\'") + '\',\'' + escHtml(v) + '\')">Load ' + pa.items.filter(function (i) { return !i.isCategory; }).length + ' items from this PA</button>'
        : '<p style="color:var(--text3)">This PA has no line items.</p>') +
      '</div>';
  };
  window.btLoadPAItems = function (projName, paId) {
    var bt = budgetTrackers[projName], pa = (pas || []).find(function (p) { return String(p.id) === String(paId); });
    if (pa) paId = pa.id;
    if (!bt || !pa) return;
    if (typeof pushUndo === 'function') pushUndo('Load PA items');
    var next = Math.max.apply(null, [0].concat(bt.items.map(function (i) { return i.id || 0; }))) + 1;
    (pa.items || []).forEach(function (it) {
      bt.items.push({
        id: next++, paId: paId, category: it.isCategory ? it.name : '', isCategory: !!it.isCategory,
        itemNum: it.itemNum || '', name: it.name || '', vendor: it.vendor || '', description: it.description || '',
        qty: it.qty || 0, estPrice: it.price || 0, leadTime: it.leadTime || '', orderNo: '', amtPaid: 0,
        paymentType: '', taxPaid: 0, freightPaid: 0, datePaid: '', budgetQty: it.qty || 0, budgetPrice: it.price || 0,
        contingencyUsed: 0, statusRemarks: ''
      });
    });
    save(); loadBudgetTracker();
    toast('Loaded ' + paLabel(projName, paId) + ' into the tracker');
  };

  // ── Payments: per-payment freight & tax ───────────────────────────────────
  window.btEnsurePayments = function (item) {
    if (!Array.isArray(item.payments)) {
      item.payments = [
        { amt: parseFloat(item.amtPaid) || 0, type: item.paymentType || '', checkNum: item.checkNum || '', date: item.datePaid || '' },
        { amt: 0, type: '', checkNum: '', date: '' }
      ];
    }
    while (item.payments.length < 2) item.payments.push({ amt: 0, type: '', checkNum: '', date: '' });
    if (!item._payTF) {
      item.payments[0].freight = parseFloat(item.freightPaid) || 0;
      item.payments[0].tax = parseFloat(item.taxPaid) || 0;
      item._payTF = true;
    }
    return item.payments;
  };
  window.btSyncPaymentDerived = function (item) {
    var ps = item.payments || [];
    item.amtPaid = ps.reduce(function (a, p) { return a + (parseFloat(p.amt) || 0); }, 0);
    item.paymentType = ps.filter(function (p) { return p.type; })
      .map(function (p) { return p.type + (p.type === 'Check' && p.checkNum ? ' #' + p.checkNum : ''); }).join(' / ');
    var dates = ps.map(function (p) { return p.date; }).filter(Boolean).sort();
    if (dates.length) item.datePaid = dates[dates.length - 1];
    if (item._payTF) {
      item.freightPaid = ps.reduce(function (a, p) { return a + (parseFloat(p.freight) || 0); }, 0);
      item.taxPaid = ps.reduce(function (a, p) { return a + (parseFloat(p.tax) || 0); }, 0);
    }
  };
  window.btSetPayment = function (projName, itemId, idx, field, value) {
    var bt = budgetTrackers[projName]; if (!bt) return;
    var item = bt.items.find(function (i) { return i.id === itemId; }); if (!item) return;
    var ps = btEnsurePayments(item);
    if (field === 'amt' || field === 'freight' || field === 'tax') value = parseFloat(String(value).replace(/[$,]/g, '')) || 0;
    ps[idx][field] = value;
    if (field === 'type' && value !== 'Check') ps[idx].checkNum = '';
    if (field === 'type' && value !== 'Pay Multiple') delete ps[idx].members;
    btSyncPaymentDerived(item);
    save();
  };
  window.btAddPayment = function (projName, itemId) {
    var bt = budgetTrackers[projName]; if (!bt) return;
    var item = bt.items.find(function (i) { return i.id === itemId; }); if (!item) return;
    btEnsurePayments(item).push({ amt: 0, type: '', checkNum: '', date: '', freight: 0, tax: 0 });
    save(); renderBTTable();
  };
  window.btRemovePayment = function (projName, itemId, idx) {
    var bt = budgetTrackers[projName]; if (!bt) return;
    var item = bt.items.find(function (i) { return i.id === itemId; }); if (!item) return;
    var ps = btEnsurePayments(item);
    if (idx < 2 || idx >= ps.length) return;
    ps.splice(idx, 1);
    btSyncPaymentDerived(item); save(); renderBTTable();
  };

  // ── Placing & sorting rows ────────────────────────────────────────────────
  function parseNum(raw) {
    var m = String(raw == null ? '' : raw).trim().match(/^([A-Za-z]*)[\s._-]*(\d+)\s*([A-Za-z]*)$/);
    return m ? { num: parseInt(m[2], 10), suffix: (m[3] || '').toUpperCase() } : null;
  }
  function bandOfNum(raw) { var p = parseNum(raw); if (!p) return null; var b = Math.floor(p.num / 100); return (b >= 1 && b <= 9) ? b : null; }
  function bandOfName(name) {
    var s = String(name || '');
    if ((typeof isInstallCat === 'function' && isInstallCat(s)) || /install/i.test(s)) return 95;
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i].re.test(s)) return BANDS[i].n;
    return null;
  }
  function cmp(a, b) {
    var pa = parseNum(a.itemNum), pb = parseNum(b.itemNum);
    if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1;
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suffix === pb.suffix ? 0 : (pa.suffix < pb.suffix ? -1 : 1);
  }
  function stableSort(arr, fn) {
    return arr.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return fn(x[0], y[0]) || x[1] - y[1]; }).map(function (x) { return x[0]; });
  }
  function groupBand(g) {
    var counts = {};
    g.lines.forEach(function (l) { var b = bandOfNum(l.itemNum); if (b) counts[b] = (counts[b] || 0) + 1; });
    var best = null, n = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = +k; } });
    if (best) return best;
    var nb = g.head ? bandOfName(g.head.name) : null;
    return nb || 90;
  }

  // Move one row to the category for its number band, then re-sort the PA's tracker.
  window.btPlaceItem = function (projName, itemId) {
    var bt = budgetTrackers[projName]; if (!bt) return;
    var moved = bt.items.find(function (i) { return i.id === itemId; }); if (!moved) return;
    var groups = [], cur = null, origin = null;
    bt.items.forEach(function (it) {
      if (it.isCategory) { cur = { head: it, lines: [], paId: String(it.paId == null ? '' : it.paId) }; groups.push(cur); return; }
      if (!cur) { cur = { head: null, lines: [], paId: String(it.paId == null ? '' : it.paId) }; groups.push(cur); }
      if (it === moved) { origin = cur; return; }
      cur.lines.push(it);
    });
    var pid = String(moved.paId == null ? '' : moved.paId);
    var band = bandOfNum(moved.itemNum), target = null;
    if (band) {
      var mine = groups.filter(function (g) { return g.head && g.paId === pid; });
      target = mine.find(function (g) { return g.lines.some(function (l) { return bandOfNum(l.itemNum); }) && groupBand(g) === band; }) ||
               mine.find(function (g) { return bandOfName(g.head.name) === band; });
      if (!target) {
        var nid = Math.max.apply(null, [0].concat(bt.items.map(function (i) { return i.id || 0; }))) + 1;
        var label = BANDS[band - 1].label.toUpperCase();
        target = { head: { id: nid, isCategory: true, name: label, category: label, paId: moved.paId }, lines: [], paId: pid };
        groups.push(target);
      }
    }
    if (!target) target = origin || groups[groups.length - 1];
    target.lines.push(moved);

    var paOrder = [];
    groups.forEach(function (g) { if (paOrder.indexOf(g.paId) < 0) paOrder.push(g.paId); });
    groups.forEach(function (g) { g.lines = stableSort(g.lines, cmp); g._b = g.head ? groupBand(g) : 0; });
    var ordered = stableSort(groups, function (a, b) {
      var pa = paOrder.indexOf(a.paId) - paOrder.indexOf(b.paId);
      if (pa) return pa;
      if (!a.head) return -1; if (!b.head) return 1;
      return a._b - b._b;
    });
    var out = [];
    ordered.forEach(function (g) { if (g.head) out.push(g.head); g.lines.forEach(function (l) { out.push(l); }); });
    bt.items = out;
    save();
    if (target !== origin && target.head && band) toast('Moved #' + moved.itemNum + ' to ' + target.head.name);
    window._btFocusRow = itemId;
  };

  function wrapAdd(name, isCat) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ext) return;
    var w = function (projName) {
      var bt = budgetTrackers[projName]; if (!bt) return orig.apply(this, arguments);
      var before = bt.items.length;
      var r = orig.apply(this, arguments);
      var added = bt.items.slice(before);
      var vs = getView(projName);
      var paObj = projectPAs(projName).find(function (p) { return String(p.id) === vs; }) || projectPAs(projName)[0];
      var v = paObj ? paObj.id : '';
      added.forEach(function (i) { i.paId = v; });
      if (added.length && !isCat) {
        // Keep the new row inside its PA's block, at the end, until it gets a number.
        var it = added[0];
        bt.items.splice(bt.items.indexOf(it), 1);
        var last = -1;
        bt.items.forEach(function (x, k) { if (String(x.paId == null ? '' : x.paId) === String(v)) last = k; });
        bt.items.splice(last + 1, 0, it);
        save(); renderBTTable();
        window._btFocusRow = it.id; focusRow();
      } else if (added.length) { save(); renderBTTable(); }
      return r;
    };
    w.__ext = true; window[name] = w;
  }
  function focusRow() {
    var id = window._btFocusRow; if (id == null) return;
    setTimeout(function () {
      var tr = document.querySelector('#bt-table-wrap tr[data-bt-id="' + id + '"]');
      var wrap = document.getElementById('bt-table-wrap');
      if (tr && wrap) {
        wrap.scrollTop = Math.max(0, tr.offsetTop - 90);
        tr.style.outline = '2px solid var(--accent-ink)';
        setTimeout(function () { tr.style.outline = ''; }, 1600);
        var inp = tr.querySelector('input'); if (inp && !inp.value) inp.focus();
      }
      window._btFocusRow = null;
    }, 80);
  }
  window.btFocusPlacedRow = focusRow;

  // ── Save indicator ────────────────────────────────────────────────────────
  function stamp() {
    var el = document.getElementById('bt-save-state'); if (!el) return;
    var d = new Date();
    el.textContent = 'Saved ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  window.btSaveNow = function () {
    var a = document.activeElement;
    if (a && a.closest && a.closest('#bt-table-wrap')) a.blur();
    save();
    if (typeof sbSchedulePushState === 'function') sbSchedulePushState();
    stamp(); toast('Tracker saved');
  };
  function hookSave() {
    if (typeof DB === 'undefined' || !DB.save || DB.save.__bt) return;
    var o = DB.save;
    var w = function (k) { var r = o.apply(this, arguments); if (k === 'fp11_bt') stamp(); return r; };
    w.__bt = true; DB.save = w;
  }
  // Commit a half-typed tracker field if the tab is hidden or closed.
  function flush() { var a = document.activeElement; if (a && a.closest && a.closest('#bt-table-wrap')) a.blur(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  window.addEventListener('beforeunload', flush);

  // ── PO list: filter by PA ─────────────────────────────────────────────────
  window.vpoPAPopulate = function (projName) {
    var sel = document.getElementById('vpo-pa-filter'); if (!sel) return;
    var list = projName ? projectPAs(projName) : [];
    var cur = String(sel.value || '');
    if (!list.some(function (p) { return String(p.id) === cur; })) cur = '';
    sel.innerHTML = '<option value="">All PAs</option>' + list.map(function (p, i) {
      return '<option value="' + escHtml(String(p.id)) + '"' + (String(p.id) === cur ? ' selected' : '') + '>PA' + (i + 1) + ' \u00b7 ' + escHtml(p.paNum || '') + '</option>';
    }).join('');
    sel.value = cur;
    sel.style.display = list.length > 0 ? '' : 'none';
  };
  window.vpoPAMatch = function (v) {
    var sel = document.getElementById('vpo-pa-filter');
    var id = sel ? sel.value : ''; if (!id) return true;
    if (v.paId) return String(v.paId) === id;
    var pa = (pas || []).find(function (p) { return String(p.id) === id; }); if (!pa) return true;
    var n = String(v.itemNum || '').trim().toUpperCase(); if (!n) return false;
    return (pa.items || []).some(function (i) { return !i.isCategory && String(i.itemNum || '').trim().toUpperCase() === n; });
  };

  function boot() { wrapAdd('btAddItem', false); wrapAdd('btAddCategory', true); hookSave(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1500);
})();
