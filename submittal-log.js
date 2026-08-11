/* ============================================================================
   STEVE — Submittal Log  (submittal-log.js)
   Project-scoped tracking of shop drawings, material data, samples and COM
   approvals per line item: requested -> received -> approved, with the RFP's
   four-day review clock and overdue flags.
   Stores to DB key 'fp11_submittals' (flat array, cloud-synced via SB_STATE).
   Reuses budgetTrackers, activeProject, escHtml, ai3Toast, logActivity,
   genId, pushUndo, ensureBudgetTracker, DB.
   ============================================================================ */
(function () {
  'use strict';

  var TYPES = ['Shop drawing', 'Material data', 'Sample', 'COM approval', 'Finish sample', 'Other'];
  var REVIEW_DAYS = 4;

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function num(v) { return parseFloat(v) || 0; }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }
  function newId() { return (typeof genId === 'function') ? genId() : Date.now(); }
  function v(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function load() { try { var x = (typeof submittalLog !== 'undefined') ? submittalLog : DB.load('fp11_submittals', []); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  function persist(arr) {
    var copy = arr.slice();
    try { if (typeof submittalLog !== 'undefined') { submittalLog.length = 0; copy.forEach(function (r) { submittalLog.push(r); }); } } catch (e) {}
    try { DB.save('fp11_submittals', (typeof submittalLog !== 'undefined') ? submittalLog : copy); } catch (e) {}
  }
  function projItems(name) { var bt = budgetTrackers[name]; return bt ? bt.items.filter(function (i) { return !i.isCategory; }) : []; }
  function findItem(name, id) { var bt = budgetTrackers[name]; return bt ? (bt.items.find(function (i) { return i.id === id; }) || null) : null; }
  function projSubs(name) { return load().filter(function (s) { return s.project === name; }); }

  function parseISO(s) { if (!s) return null; var p = String(s).split('-'); if (p.length < 3) return null; var d = new Date(+p[0], +p[1] - 1, +p[2]); return isNaN(d) ? null : d; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtMD(s) { var d = parseISO(s); return d ? (d.getMonth() + 1) + '/' + d.getDate() : '\u2014'; }

  // Status derivation: due date = requested + REVIEW_DAYS (vendor turnaround target).
  // Review clock starts when received; approval closes it.
  function statusOf(s) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (s.approved) return { key: 'approved', label: 'Approved ' + fmtMD(s.approvedDate), badge: 'green' };
    if (s.outcome === 'revise') return { key: 'revise', label: 'Revise & resubmit', badge: 'amber' };
    if (s.received) {
      var rec = parseISO(s.received);
      var reviewDue = rec ? addDays(rec, REVIEW_DAYS) : null;
      var daysLeft = reviewDue ? Math.ceil((reviewDue - today) / 86400000) : null;
      if (daysLeft != null && daysLeft < 0) return { key: 'review-late', label: 'Review overdue', badge: 'red' };
      return { key: 'review', label: 'In review' + (daysLeft != null ? ' (' + Math.max(0, daysLeft) + ' of ' + REVIEW_DAYS + 'd)' : ''), badge: 'blue' };
    }
    // not received yet — waiting on vendor
    var due = parseISO(s.due);
    if (due && due < today) return { key: 'overdue', label: 'Overdue from vendor', badge: 'red' };
    return { key: 'requested', label: 'Requested', badge: 'amber' };
  }

  // ── Modal ──
  var editingId = null;
  function ensureModal() {
    if (document.getElementById('sl-modal')) return;
    var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'sl-modal';
    ov.innerHTML = '<div class="modal" style="width:540px">' +
      '<div class="modal-header"><div class="modal-title" id="sl-title">Log submittal</div><button class="modal-close" onclick="slClose()">\u2715</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-row"><label>Tracker line item</label><select id="sl-item"></select></div>' +
        '<div class="form-grid2">' +
          '<div class="form-row"><label>Type</label><select id="sl-type">' + TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
          '<div class="form-row"><label>Requested date</label><input type="date" id="sl-requested" onchange="slAutoDue()"></div>' +
        '</div>' +
        '<div class="form-grid2">' +
          '<div class="form-row"><label>Due from vendor</label><input type="date" id="sl-due"></div>' +
          '<div class="form-row"><label>Received date</label><input type="date" id="sl-received"></div>' +
        '</div>' +
        '<div class="form-row"><label>Reference / notes</label><input id="sl-notes" placeholder="e.g. COM yardage, finish code"></div>' +
      '</div>' +
      '<div class="modal-footer"><button class="btn" onclick="slClose()">Cancel</button><button class="btn btn-primary" onclick="slSave()">Save</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) slClose(); });
  }
  function fillItems(name, sel) {
    var el = document.getElementById('sl-item'); var items = projItems(name);
    el.innerHTML = items.length ? items.map(function (it) {
      var lbl = (it.itemNum ? it.itemNum + ' \u2014 ' : '') + (it.name || '(untitled)') + (it.vendor ? ' \u00b7 ' + it.vendor : '');
      return '<option value="' + it.id + '"' + (it.id === sel ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }).join('') : '<option value="">No tracker items yet</option>';
  }
  function slAutoDue() {
    var r = parseISO(v('sl-requested')); if (r && !v('sl-due')) document.getElementById('sl-due').value = isoOf(addDays(r, 10));
  }
  function slOpen(id) {
    var name = activeProject ? activeProject.name : ''; if (!name) { toast('Open a project first.'); return; }
    ensureModal(); editingId = id || null;
    var s = id ? load().find(function (x) { return x.id === id; }) : null;
    document.getElementById('sl-title').textContent = s ? 'Edit submittal' : 'Log submittal';
    fillItems(name, s ? s.itemId : null);
    document.getElementById('sl-type').value = s ? s.type : 'Shop drawing';
    document.getElementById('sl-requested').value = s ? (s.requested || '') : new Date().toISOString().slice(0, 10);
    document.getElementById('sl-due').value = s ? (s.due || '') : '';
    document.getElementById('sl-received').value = s ? (s.received || '') : '';
    document.getElementById('sl-notes').value = s ? (s.notes || '') : '';
    if (!s) slAutoDue();
    if (typeof openModal === 'function') openModal('sl-modal'); else document.getElementById('sl-modal').classList.add('open');
  }
  function slClose() { if (typeof closeModal === 'function') closeModal('sl-modal'); else { var m = document.getElementById('sl-modal'); if (m) m.classList.remove('open'); } editingId = null; }
  function slSave() {
    var name = activeProject ? activeProject.name : '';
    var itemId = parseInt(v('sl-item'), 10);
    if (!itemId && itemId !== 0) { toast('Select a line item.'); return; }
    var item = findItem(name, itemId);
    var arr = load(); var rec = editingId ? arr.find(function (x) { return x.id === editingId; }) : null;
    var data = { project: name, itemId: itemId, vendor: item ? (item.vendor || '') : '', type: v('sl-type'),
      requested: v('sl-requested'), due: v('sl-due'), received: v('sl-received'), notes: v('sl-notes').trim() };
    if (typeof pushUndo === 'function') pushUndo(rec ? 'Edit submittal' : 'Log submittal');
    if (rec) Object.assign(rec, data); else { rec = Object.assign({ id: newId(), approved: false, outcome: '' }, data); arr.push(rec); }
    persist(arr);
    if (typeof logActivity === 'function') logActivity((editingId ? 'Edited' : 'Logged') + ' submittal \u2014 ' + data.type);
    slClose(); render();
  }
  function slMarkReceived(id) { var arr = load(); var s = arr.find(function (x) { return x.id === id; }); if (!s) return; if (typeof pushUndo === 'function') pushUndo('Submittal received'); s.received = new Date().toISOString().slice(0, 10); s.outcome = ''; persist(arr); render(); }
  function slApprove(id) { var arr = load(); var s = arr.find(function (x) { return x.id === id; }); if (!s) return; if (typeof pushUndo === 'function') pushUndo('Approve submittal'); s.approved = true; s.approvedDate = new Date().toISOString().slice(0, 10); s.outcome = 'approved'; if (!s.received) s.received = s.approvedDate; persist(arr); if (typeof logActivity === 'function') logActivity('Approved submittal \u2014 ' + s.type); toast('\u2713 Submittal approved'); render(); }
  function slRevise(id) { var arr = load(); var s = arr.find(function (x) { return x.id === id; }); if (!s) return; if (typeof pushUndo === 'function') pushUndo('Revise & resubmit'); s.outcome = 'revise'; s.approved = false; persist(arr); render(); }
  function slDelete(id) { if (!confirm('Delete this submittal?')) return; if (typeof pushUndo === 'function') pushUndo('Delete submittal'); persist(load().filter(function (x) { return x.id !== id; })); render(); }

  function render() {
    var host = document.getElementById('page-submittal-log'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to track its submittals.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var subs = projSubs(proj.name).map(function (s) { return { s: s, st: statusOf(s) }; });
    subs.sort(function (a, b) { return (a.s.due || '').localeCompare(b.s.due || ''); });
    var open = subs.filter(function (x) { return x.st.key !== 'approved'; }).length;
    var inReview = subs.filter(function (x) { return x.st.key === 'review' || x.st.key === 'review-late'; }).length;
    var approved = subs.filter(function (x) { return x.st.key === 'approved'; }).length;
    var overdue = subs.filter(function (x) { return x.st.key === 'overdue' || x.st.key === 'review-late'; }).length;

    var bar = '<div class="rp-toolbar"><div class="rp-toolbar-left">' +
      '<div class="rp-scope-name">' + esc(proj.name) + '</div><div class="rp-period">Shop drawings, samples &amp; COM approvals</div></div>' +
      '<div class="rp-toolbar-right"><button class="btn btn-primary" onclick="slOpen()">+ Log submittal</button></div></div>';
    var kpis = '<div class="rp-kpi-row k4">' +
      kpi('Open submittals', open, subs.length + ' total') +
      kpi('In review', inReview, REVIEW_DAYS + '-day clock') +
      kpi('Approved', approved, 'this project') +
      kpi('Overdue', overdue, overdue ? 'need follow-up' : 'on track', overdue ? 'var(--red)' : 'var(--green)') +
      '</div>';

    var rows = subs.length ? subs.map(function (x) {
      var s = x.s, st = x.st, item = findItem(proj.name, s.itemId);
      var itemLabel = item ? ((item.itemNum ? item.itemNum + ' \u2014 ' : '') + (item.name || '')) : '<span style="color:var(--red)">missing</span>';
      var acts = [];
      if (!s.received && !s.approved) acts.push('<button class="btn btn-sm" onclick="slMarkReceived(' + s.id + ')">Mark received</button>');
      if (s.received && !s.approved) { acts.push('<button class="btn btn-sm btn-primary" onclick="slApprove(' + s.id + ')">Approve</button>'); acts.push('<button class="btn btn-sm" onclick="slRevise(' + s.id + ')">Revise</button>'); }
      acts.push('<button class="btn btn-sm" onclick="slOpen(' + s.id + ')">Edit</button>');
      acts.push('<button class="btn btn-sm" onclick="slDelete(' + s.id + ')">\u2715</button>');
      return '<tr><td>' + esc(s.type) + '</td><td>' + itemLabel + '</td><td>' + esc(s.vendor || '\u2014') + '</td>' +
        '<td>' + fmtMD(s.requested) + '</td><td' + (st.key === 'overdue' ? ' style="color:var(--red);font-weight:600"' : '') + '>' + fmtMD(s.due) + '</td>' +
        '<td>' + (s.received ? fmtMD(s.received) : '<span style="color:var(--text3)">\u2014</span>') + '</td>' +
        '<td><span class="badge badge-' + st.badge + '">' + esc(st.label) + '</span></td>' +
        '<td style="text-align:right"><div style="display:flex;gap:6px;justify-content:flex-end">' + acts.join('') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="8" style="padding:16px;color:var(--text3)">No submittals yet. Click <b>+ Log submittal</b> to start tracking shop drawings, samples and COM approvals.</td></tr>';

    host.innerHTML = bar + kpis +
      '<div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table>' +
      '<thead><tr><th>Type</th><th>Item</th><th>Vendor</th><th>Requested</th><th>Due</th><th>Received</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px;line-height:1.5">Once a submittal is received, the ' + REVIEW_DAYS + '-day review clock starts; approvals close it. Items <b style="color:var(--red)">overdue from vendor</b> (past due date, not received) and <b style="color:var(--red)">review overdue</b> surface for follow-up.</div>';
  }
  function kpi(label, value, sub, color) { return '<div class="rp-kpi"><div class="rp-kpi-label">' + label + '</div><div class="rp-kpi-value sm"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div><div class="rp-kpi-sub">' + sub + '</div></div>'; }

  window.renderSubmittalLog = render;
  window.slOpen = slOpen; window.slClose = slClose; window.slSave = slSave; window.slAutoDue = slAutoDue;
  window.slMarkReceived = slMarkReceived; window.slApprove = slApprove; window.slRevise = slRevise; window.slDelete = slDelete;
})();
