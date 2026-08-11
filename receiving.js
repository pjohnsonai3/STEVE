/* ============================================================================
   STEVE — Receiving / punch list  (receiving.js)
   Project-scoped, touch-friendly field checklist: mark each ordered item as
   received OK / damaged / short / installed, with quantity, date and note.
   Stores to DB key 'fp11_receiving'. Reuses budgetTrackers, activeProject,
   escHtml, ai3Toast, logActivity, DB.
   ============================================================================ */
(function () {
  'use strict';
  var CONDS = [
    { k: 'pending', label: 'Pending', cls: 'rcv-pending' },
    { k: 'ok', label: 'Received', cls: 'rcv-ok' },
    { k: 'damaged', label: 'Damaged', cls: 'rcv-dmg' },
    { k: 'short', label: 'Short', cls: 'rcv-short' },
    { k: 'installed', label: 'Installed', cls: 'rcv-inst' }
  ];
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function store() { try { return DB.load('fp11_receiving', {}); } catch (e) { return {}; } }
  function saveStore(s) { try { DB.save('fp11_receiving', s); } catch (e) {} }
  var rcvProj = null;

  function deliveryStatus(projName, id) {
    try { var st = DB.load('fp11_delivery', {}); return (st[projName] && st[projName][id] && st[projName][id].status) || null; } catch (e) { return null; }
  }

  function getItems(projName) {
    var bt = budgetTrackers[projName]; if (!bt) return [];
    var ps = store()[projName] || {}; var cur = ''; var out = [];
    bt.items.forEach(function (it) {
      if (it.isCategory) { cur = it.name; return; }
      var saved = ps[it.id] || {};
      // Reflect a status set on the Procurement Tracker: if Receiving has no
      // explicit entry yet, an "Item Received" tracker line shows as received here.
      var trackerReceived = /received/i.test(it.itemStatus || '');
      var cond = saved.cond || (trackerReceived ? 'ok' : (deliveryStatus(projName, it.id) === 'recv' ? 'ok' : 'pending'));
      out.push({ id: it.id, name: it.name || '(untitled)', cat: cur, vendor: it.vendor || '', qty: it.qty || 0,
        cond: cond, qtyRecv: saved.qtyRecv != null ? saved.qtyRecv : '', date: saved.date || it.receivedDate || '', note: saved.note || '' });
    });
    return out;
  }

  function setField(id, field, value) {
    var s = store(); s[rcvProj] = s[rcvProj] || {}; s[rcvProj][id] = s[rcvProj][id] || {};
    s[rcvProj][id][field] = value;
    if (field === 'cond' && value !== 'pending' && !s[rcvProj][id].date) s[rcvProj][id].date = new Date().toISOString().slice(0, 10);
    saveStore(s);
    syncTrackerReceived(id, s[rcvProj][id]);
  }

  // Link receiving back to the Procurement Tracker: a receipt date (or a
  // Received/Installed condition) flips the matching tracker line's status to
  // "Item Received" and records the date. Clearing both reverts the status only
  // if WE set it, so a manually-chosen status is never stomped.
  function syncTrackerReceived(id, rec) {
    try {
      if (typeof budgetTrackers === 'undefined') return;
      var bt = budgetTrackers[rcvProj]; if (!bt || !bt.items) return;
      var item = bt.items.find(function (i) { return i.id === id; }); if (!item) return;
      var received = rec.cond === 'ok' || rec.cond === 'installed' || !!(rec.date && String(rec.date).trim());
      var changed = false;
      if (received) {
        if (item.itemStatus !== 'Item Received') { item.itemStatus = 'Item Received'; changed = true; }
        var d = (rec.date && String(rec.date).trim()) ? rec.date : new Date().toISOString().slice(0, 10);
        if (item.receivedDate !== d) { item.receivedDate = d; changed = true; }
      } else {
        // No longer received — only undo what this link applied.
        if (item.itemStatus === 'Item Received') { item.itemStatus = ''; changed = true; }
        if (item.receivedDate) { item.receivedDate = ''; changed = true; }
      }
      if (changed) {
        DB.save('fp11_bt', budgetTrackers);
        if (typeof renderBTTable === 'function') { try { renderBTTable(); } catch (e) {} }
      }
    } catch (e) {}
  }
  function rcvSet(id, cond) { setField(id, 'cond', cond); if (typeof logActivity === 'function') logActivity('Marked item ' + (CONDS.find(function (c) { return c.k === cond; }) || {}).label); render(); }
  function rcvField(id, field, v) { setField(id, field, v); render(); }

  function condBtns(it) {
    return '<div class="rcv-conds">' + CONDS.map(function (c) {
      return '<button class="rcv-cond ' + c.cls + (it.cond === c.k ? ' on' : '') + '" onclick="rcvSet(' + it.id + ",'" + c.k + "')\">" + c.label + '</button>';
    }).join('') + '</div>';
  }

  function render() {
    var host = document.getElementById('page-receiving'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rcv-wrap"><div class="rp-empty">Open a project to receive its items.</div></div>'; return; }
    rcvProj = proj.name;
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var items = getItems(proj.name);
    var by = { pending: 0, ok: 0, damaged: 0, short: 0, installed: 0 };
    items.forEach(function (i) { by[i.cond] = (by[i.cond] || 0) + 1; });
    var done = by.ok + by.installed;

    var strip = '<div class="rp-kpi-row k5">' +
      [['To receive', by.pending, 'var(--text2)'], ['Received', by.ok, 'var(--green)'], ['Installed', by.installed, 'var(--accent-ink)'],
       ['Damaged', by.damaged, by.damaged ? 'var(--red)' : 'var(--text2)'], ['Short', by.short, by.short ? 'var(--amber)' : 'var(--text2)']]
        .map(function (c) { return '<div class="rp-kpi"><div class="rp-kpi-label">' + c[0] + '</div><div class="rp-kpi-value sm" style="color:' + c[2] + '">' + c[1] + '</div></div>'; }).join('') + '</div>';

    // group by category
    var groups = {}; var order = [];
    items.forEach(function (i) { if (!groups[i.cat]) { groups[i.cat] = []; order.push(i.cat); } groups[i.cat].push(i); });
    var listHtml = order.map(function (cat) {
      var rows = groups[cat].map(function (it) {
        var flag = (it.cond === 'damaged' || it.cond === 'short');
        return '<div class="rcv-item' + (flag ? ' flag' : '') + '"><div class="rcv-item-top"><div style="min-width:0"><div class="rcv-name">' + esc(it.name) + '</div>' +
          '<div class="rcv-sub">' + esc(it.vendor || '—') + ' · ordered qty ' + it.qty + '</div></div></div>' +
          condBtns(it) +
          '<div class="rcv-detail"><label>Qty received <input type="number" min="0" class="dl-inp" style="border-color:var(--border);max-width:90px" value="' + (it.qtyRecv === '' ? '' : it.qtyRecv) + '" placeholder="' + it.qty + '" onchange="rcvField(' + it.id + ",'qtyRecv',this.value)\" /></label>" +
          '<label>Date <input type="date" class="dl-inp" style="border-color:var(--border)" value="' + (it.date || '') + '" onchange="rcvField(' + it.id + ",'date',this.value)\" /></label>" +
          '<label style="flex:1">Note <input class="dl-inp" style="border-color:var(--border)" value="' + esc(it.note) + '" placeholder="Condition, location, who received…" onchange="rcvField(' + it.id + ",'note',this.value)\" /></label></div>" +
          '</div>';
      }).join('');
      return '<div class="rcv-group"><div class="rcv-group-head">' + esc(cat) + ' <span>' + groups[cat].length + '</span></div>' + rows + '</div>';
    }).join('');

    var header = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">' + done + ' of ' + items.length + ' items received or installed</div></div></div>';
    host.innerHTML = '<div class="rcv-wrap">' + header + strip + (listHtml || '<div class="rp-empty">No items to receive.</div>') + '</div>';
  }

  window.renderReceiving = render;
  window.rcvSet = rcvSet;
  window.rcvField = rcvField;
})();
