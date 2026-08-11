/* ============================================================================
   STEVE — Invoice Register  (invoice-register.js)
   Project-scoped ledger of vendor invoices, each linked to a Procurement
   Tracker line item. Approving an invoice POSTS its amounts into that item's
   payments (Amt Paid), Tax Paid and Freight Paid — and recomputes Balance Due —
   exactly as a manual tracker payment would. Voiding/deleting reverses the post.

   Stores to DB key 'fp11_invledger' (a flat array, cloud-synced via SB_STATE).
   Reuses budgetTrackers, activeProject, escHtml, ai3Toast, logActivity,
   genId, btSyncPaymentDerived, ensureBudgetTracker, DB, fmtD.
   ============================================================================ */
(function () {
  'use strict';

  var TYPES = ['Deposit', 'Balance', 'Other'];

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(v) { var n = Number(v) || 0; return (typeof fmtD === 'function') ? fmtD(n) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }
  function num(v) { return parseFloat(v) || 0; }

  // ── Data ────────────────────────────────────────────────────────────────
  function load() { try { var v = (typeof invoiceLedger !== 'undefined') ? invoiceLedger : DB.load('fp11_invledger', []); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function persist(arr) {
    var copy = arr.slice();
    try { if (typeof invoiceLedger !== 'undefined') { invoiceLedger.length = 0; copy.forEach(function (r) { invoiceLedger.push(r); }); } } catch (e) {}
    try { DB.save('fp11_invledger', (typeof invoiceLedger !== 'undefined') ? invoiceLedger : copy); } catch (e) {}
  }
  function newId() { return (typeof genId === 'function') ? genId() : Date.now(); }

  function projInvoices(name) { return load().filter(function (i) { return i.project === name; }); }
  function trackerItems(name) {
    var bt = (typeof budgetTrackers !== 'undefined') ? budgetTrackers[name] : null;
    if (!bt) return [];
    return bt.items.filter(function (i) { return !i.isCategory; });
  }
  function findItem(name, id) {
    var bt = (typeof budgetTrackers !== 'undefined') ? budgetTrackers[name] : null;
    if (!bt) return null;
    return bt.items.find(function (i) { return i.id === id; }) || null;
  }

  // ── Posting to the Procurement Tracker ───────────────────────────────────
  // Net goods (goods − discount) is added as a payment line on the item, so it
  // flows through the same amtPaid/paymentType/datePaid derivation the tracker
  // uses. Tax and freight add to the item's scalar Tax Paid / Freight Paid.
  function postToTracker(inv) {
    var item = findItem(inv.project, inv.itemId);
    if (!item) { toast('\u26a0 Linked tracker item not found — nothing posted.'); return false; }
    var ps = (typeof btEnsurePayments === 'function') ? btEnsurePayments(item) : (Array.isArray(item.payments) ? item.payments : (item.payments = []));
    var net = num(inv.goods) - num(inv.discount);
    ps.push({ amt: net, type: 'Invoice' + (inv.invNum ? ' ' + inv.invNum : ''), checkNum: '', date: inv.date || '', srcInv: inv.id });
    item.taxPaid = num(item.taxPaid) + num(inv.tax);
    item.freightPaid = num(item.freightPaid) + num(inv.freight);
    if (typeof btSyncPaymentDerived === 'function') btSyncPaymentDerived(item);
    else item.amtPaid = ps.reduce(function (a, p) { return a + num(p.amt); }, 0);
    var ext = num(item.qty) * num(item.estPrice);
    item.balanceDue = Math.max(0, ext - num(item.amtPaid));
    try { DB.save('fp11_bt', budgetTrackers); } catch (e) {}
    inv.posted = true;
    return true;
  }
  function reverseFromTracker(inv) {
    var item = findItem(inv.project, inv.itemId);
    if (item) {
      if (Array.isArray(item.payments)) item.payments = item.payments.filter(function (p) { return p.srcInv !== inv.id; });
      item.taxPaid = Math.max(0, num(item.taxPaid) - num(inv.tax));
      item.freightPaid = Math.max(0, num(item.freightPaid) - num(inv.freight));
      if (typeof btSyncPaymentDerived === 'function') btSyncPaymentDerived(item);
      else if (Array.isArray(item.payments)) item.amtPaid = item.payments.reduce(function (a, p) { return a + num(p.amt); }, 0);
      var ext = num(item.qty) * num(item.estPrice);
      item.balanceDue = Math.max(0, ext - num(item.amtPaid));
      try { DB.save('fp11_bt', budgetTrackers); } catch (e) {}
    }
    inv.posted = false;
  }

  function refreshTrackerIfVisible() {
    var pg = document.getElementById('page-budget-tracker');
    if (pg && pg.classList.contains('active') && typeof renderBTTable === 'function') { try { renderBTTable(); } catch (e) {} }
  }

  // ── Reconciliation check (data-driven) ───────────────────────────────────
  // Flags an invoice whose net goods would push the item's paid total beyond
  // its extended budget line (qty × est price) — i.e. an apparent overpay.
  function reconFlag(inv) {
    var item = findItem(inv.project, inv.itemId);
    if (!item) return { cls: 'badge-red', txt: '\u26a0 No linked item' };
    var ext = num(item.qty) * num(item.estPrice);
    if (ext <= 0) return null;
    var net = num(inv.goods) - num(inv.discount);
    var alreadyPaid = inv.posted ? num(item.amtPaid) : num(item.amtPaid) + net;
    if (alreadyPaid > ext + 0.5) return { cls: 'badge-red', txt: '\u26a0 Exceeds PO line' };
    return null;
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  var editingId = null;

  function ensureModal() {
    if (document.getElementById('ir-modal')) return;
    var ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'ir-modal';
    ov.innerHTML =
      '<div class="modal" style="width:560px">' +
        '<div class="modal-header"><div class="modal-title" id="ir-modal-title">Log invoice</div>' +
          '<button class="modal-close" onclick="irCloseModal()">\u2715</button></div>' +
        '<div class="modal-body">' +
          '<div id="ir-scan" style="border:1px dashed var(--border2);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;background:var(--surface2)">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<button class="btn btn-sm btn-primary" type="button" onclick="document.getElementById(\'ir-scan-file\').click()">✨ Scan invoice PDF</button>' +
              '<span style="font-size:11.5px;color:var(--text3)">Reads a PDF or photo of the invoice and fills the fields below.</span>' +
              '<input type="file" id="ir-scan-file" accept="application/pdf,.pdf,image/*" style="display:none" onchange="if(this.files[0]){irScanFile(this.files[0]);this.value=\'\';}" />' +
            '</div>' +
            '<div id="ir-scan-status" style="font-size:11.5px;color:var(--text2);margin-top:8px;display:none"></div>' +
            '<div id="ir-scan-key" style="margin-top:8px;display:none"><div style="display:flex;gap:8px;align-items:center">' +
              '<input type="password" id="ir-scan-key-input" placeholder="Paste AI API key" style="flex:1;padding:6px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:12px;font-family:inherit" />' +
              '<button class="btn btn-sm" type="button" onclick="irScanSaveKey()">Save key</button>' +
            '</div></div>' +
          '</div>' +
          '<div class="form-row"><label>Tracker line item</label>' +
            '<select id="ir-item" onchange="irItemHint()"></select>' +
            '<div id="ir-item-hint" style="font-size:11.5px;color:var(--text3);margin-top:5px"></div></div>' +
          '<div class="form-grid2">' +
            '<div class="form-row"><label>Invoice #</label><input id="ir-invnum" placeholder="e.g. INV-2207" /></div>' +
            '<div class="form-row"><label>Invoice date</label><input type="date" id="ir-date" /></div>' +
          '</div>' +
          '<div class="form-row"><label>Type</label><select id="ir-type">' +
            TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
          '<div class="form-grid2">' +
            '<div class="form-row"><label>Goods ($)</label><input type="number" id="ir-goods" min="0" step="0.01" placeholder="0.00" oninput="irRecalcTotal()" /></div>' +
            '<div class="form-row"><label>Discount ($)</label><input type="number" id="ir-discount" min="0" step="0.01" placeholder="0.00" oninput="irRecalcTotal()" /></div>' +
            '<div class="form-row"><label>Sales tax ($)</label><input type="number" id="ir-tax" min="0" step="0.01" placeholder="0.00" oninput="irRecalcTotal()" /></div>' +
            '<div class="form-row"><label>Freight ($)</label><input type="number" id="ir-freight" min="0" step="0.01" placeholder="0.00" oninput="irRecalcTotal()" /></div>' +
          '</div>' +
          '<div class="form-row"><label>Notes</label><input id="ir-notes" placeholder="Optional" /></div>' +
          '<div style="background:var(--surface2);border-radius:var(--radius-sm);padding:11px 14px;font-size:13px;display:flex;justify-content:space-between;align-items:center">' +
            '<span style="color:var(--text2)">Invoice total</span><b id="ir-total" style="font-size:16px">$0.00</b></div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn" onclick="irCloseModal()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="irSaveInvoice()">Save invoice</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) irCloseModal(); });
  }

  function fillItemSelect(name, selId) {
    var sel = document.getElementById('ir-item');
    var items = trackerItems(name);
    if (!items.length) { sel.innerHTML = '<option value="">No tracker items — build the Procurement Tracker first</option>'; return; }
    sel.innerHTML = items.map(function (it) {
      var label = (it.itemNum ? it.itemNum + ' — ' : '') + (it.name || '(untitled)') + (it.vendor ? ' · ' + it.vendor : '');
      return '<option value="' + it.id + '"' + (it.id === selId ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function irItemHint() {
    var name = activeProject ? activeProject.name : '';
    var id = parseInt(document.getElementById('ir-item').value, 10);
    var item = findItem(name, id);
    var el = document.getElementById('ir-item-hint');
    if (!item) { el.textContent = ''; return; }
    var ext = num(item.qty) * num(item.estPrice);
    el.innerHTML = 'PO line ' + (ext ? '$' + money(ext) : '—') + ' · already paid $' + money(item.amtPaid) +
      ' · balance $' + money(item.balanceDue);
  }

  function irRecalcTotal() {
    var t = num(v('ir-goods')) - num(v('ir-discount')) + num(v('ir-tax')) + num(v('ir-freight'));
    document.getElementById('ir-total').textContent = '$' + money(t);
  }
  function v(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function irOpenLog(id) {
    var name = activeProject ? activeProject.name : '';
    if (!name) { toast('Open a project first.'); return; }
    ensureModal();
    editingId = id || null;
    var inv = id ? load().find(function (x) { return x.id === id; }) : null;
    document.getElementById('ir-modal-title').textContent = inv ? 'Edit invoice' : 'Log invoice';
    fillItemSelect(name, inv ? inv.itemId : null);
    document.getElementById('ir-invnum').value = inv ? (inv.invNum || '') : '';
    document.getElementById('ir-date').value = inv ? (inv.date || '') : new Date().toISOString().slice(0, 10);
    document.getElementById('ir-type').value = inv ? (inv.type || 'Deposit') : 'Deposit';
    document.getElementById('ir-goods').value = inv ? (inv.goods || '') : '';
    document.getElementById('ir-discount').value = inv ? (inv.discount || '') : '';
    document.getElementById('ir-tax').value = inv ? (inv.tax || '') : '';
    document.getElementById('ir-freight').value = inv ? (inv.freight || '') : '';
    document.getElementById('ir-notes').value = inv ? (inv.notes || '') : '';
    irItemHint(); irRecalcTotal();
    _irScanPending = null;
    var _ss = document.getElementById('ir-scan-status'); if (_ss) { _ss.style.display = 'none'; _ss.innerHTML = ''; }
    var _sk = document.getElementById('ir-scan-key'); if (_sk) _sk.style.display = 'none';
    if (typeof openModal === 'function') openModal('ir-modal'); else document.getElementById('ir-modal').classList.add('open');
  }
  function irCloseModal() { if (typeof closeModal === 'function') closeModal('ir-modal'); else { var m = document.getElementById('ir-modal'); if (m) m.classList.remove('open'); } editingId = null; }

  function irSaveInvoice() {
    var name = activeProject ? activeProject.name : '';
    var itemId = parseInt(document.getElementById('ir-item').value, 10);
    if (!itemId && itemId !== 0) { toast('Select a tracker line item.'); return; }
    var item = findItem(name, itemId);
    var arr = load();
    var rec = editingId ? arr.find(function (x) { return x.id === editingId; }) : null;
    var data = {
      project: name,
      itemId: itemId,
      vendor: item ? (item.vendor || '') : '',
      invNum: v('ir-invnum').trim(),
      date: v('ir-date'),
      type: v('ir-type'),
      goods: num(v('ir-goods')),
      discount: num(v('ir-discount')),
      tax: num(v('ir-tax')),
      freight: num(v('ir-freight')),
      notes: v('ir-notes').trim()
    };
    if (typeof pushUndo === 'function') pushUndo(rec ? 'Edit invoice' : 'Log invoice');
    if (rec) {
      // editing only allowed while not posted; merge fields
      Object.assign(rec, data);
      if (rec.status === 'Void') rec.status = 'Pending';
    } else {
      rec = Object.assign({ id: newId(), status: 'Pending', posted: false }, data);
      arr.push(rec);
    }
    persist(arr);
    if (typeof logActivity === 'function') logActivity((editingId ? 'Edited' : 'Logged') + ' invoice ' + (data.invNum || ''));
    irCloseModal();
    render();
  }

  function irApprove(id) {
    var arr = load(); var inv = arr.find(function (x) { return x.id === id; });
    if (!inv || inv.posted) return;
    if (typeof pushUndo === 'function') pushUndo('Approve invoice');
    if (postToTracker(inv)) {
      inv.status = 'Approved';
      persist(arr);
      if (typeof logActivity === 'function') logActivity('Approved invoice ' + (inv.invNum || '') + ' — posted to tracker');
      toast('\u2713 Posted to Procurement Tracker');
      render(); refreshTrackerIfVisible();
    }
  }
  function irReopen(id) {
    var arr = load(); var inv = arr.find(function (x) { return x.id === id; });
    if (!inv) return;
    if (typeof pushUndo === 'function') pushUndo('Reopen invoice');
    if (inv.posted) reverseFromTracker(inv);
    inv.status = 'Pending';
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Reopened invoice ' + (inv.invNum || '') + ' — reversed from tracker');
    render(); refreshTrackerIfVisible();
  }
  function irVoid(id) {
    var arr = load(); var inv = arr.find(function (x) { return x.id === id; });
    if (!inv) return;
    if (!confirm('Void this invoice? Any amounts it posted to the tracker will be reversed.')) return;
    if (typeof pushUndo === 'function') pushUndo('Void invoice');
    if (inv.posted) reverseFromTracker(inv);
    inv.status = 'Void';
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Voided invoice ' + (inv.invNum || ''));
    toast('Invoice voided');
    render(); refreshTrackerIfVisible();
  }
  function irDelete(id) {
    var arr = load(); var inv = arr.find(function (x) { return x.id === id; });
    if (!inv) return;
    if (!confirm('Delete this invoice permanently?' + (inv.posted ? ' Its tracker amounts will be reversed.' : ''))) return;
    if (typeof pushUndo === 'function') pushUndo('Delete invoice');
    if (inv.posted) reverseFromTracker(inv);
    arr = arr.filter(function (x) { return x.id !== id; });
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Deleted invoice ' + (inv.invNum || ''));
    render(); refreshTrackerIfVisible();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function statusBadge(inv) {
    if (inv.status === 'Approved') return '<span class="badge badge-green">\u2713 Posted</span>';
    if (inv.status === 'Void') return '<span class="badge badge-gray">Void</span>';
    return '<span class="badge badge-amber">\u25f7 Pending</span>';
  }

  function render() {
    var host = document.getElementById('page-invoice-register');
    if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to log and review its invoices.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}

    var invs = projInvoices(proj.name).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var active = invs.filter(function (i) { return i.status !== 'Void'; });
    var posted = invs.filter(function (i) { return i.status === 'Approved'; });
    var pending = invs.filter(function (i) { return i.status === 'Pending'; });
    var totGoods = active.reduce(function (a, i) { return a + num(i.goods) - num(i.discount); }, 0);
    var totTax = active.reduce(function (a, i) { return a + num(i.tax); }, 0);
    var totFreight = active.reduce(function (a, i) { return a + num(i.freight); }, 0);
    var totAll = totGoods + totTax + totFreight;

    var header = '<div class="rp-toolbar"><div class="rp-toolbar-left">' +
      '<div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">Invoices logged against this project\u2019s Procurement Tracker</div></div>' +
      '<div class="rp-toolbar-right"><button class="btn btn-primary" onclick="irOpenLog()">+ Log invoice</button></div></div>';

    var kpis = '<div class="rp-kpi-row k4">' +
      kpi('Invoices', active.length, (pending.length ? pending.length + ' pending' : 'all posted')) +
      kpi('Invoiced (net + tax + frt)', '$' + money(totAll), 'across ' + active.length + ' invoices') +
      kpi('Posted to tracker', posted.length, posted.length === active.length ? 'fully reconciled' : (active.length - posted.length) + ' not posted') +
      kpi('Tax + freight', '$' + money(totTax + totFreight), '$' + money(totTax) + ' tax · $' + money(totFreight) + ' freight') +
      '</div>';

    var rows = invs.map(function (inv) {
      var item = findItem(inv.project, inv.itemId);
      var itemLabel = item ? ((item.itemNum ? item.itemNum + ' — ' : '') + (item.name || '(untitled)')) : '<span style="color:var(--red)">missing item</span>';
      var net = num(inv.goods) - num(inv.discount);
      var total = net + num(inv.tax) + num(inv.freight);
      var flag = reconFlag(inv);
      var canEdit = inv.status !== 'Approved';
      var acts = [];
      if (inv.status === 'Pending') acts.push('<button class="btn btn-sm btn-primary" onclick="irApprove(' + inv.id + ')">Approve &amp; post</button>');
      if (inv.status === 'Approved') acts.push('<button class="btn btn-sm" onclick="irReopen(' + inv.id + ')">Reopen</button>');
      if (canEdit) acts.push('<button class="btn btn-sm" onclick="irOpenLog(' + inv.id + ')">Edit</button>');
      if (inv.status !== 'Void') acts.push('<button class="btn btn-sm" onclick="irVoid(' + inv.id + ')">Void</button>');
      acts.push('<button class="btn btn-sm" onclick="irDelete(' + inv.id + ')" title="Delete">\u2715</button>');
      var dim = inv.status === 'Void' ? 'opacity:.55;' : '';
      return '<tr style="' + dim + '">' +
        '<td class="fw500">' + esc(inv.invNum || '—') + '</td>' +
        '<td>' + esc(inv.date || '—') + '</td>' +
        '<td>' + esc(inv.vendor || '—') + '</td>' +
        '<td>' + itemLabel + '</td>' +
        '<td>' + esc(inv.type || '') + '</td>' +
        '<td style="text-align:right">$' + money(net) + '</td>' +
        '<td style="text-align:right">' + (num(inv.tax) ? '$' + money(inv.tax) : '<span style="color:var(--text3)">—</span>') + '</td>' +
        '<td style="text-align:right">' + (num(inv.freight) ? '$' + money(inv.freight) : '<span style="color:var(--text3)">—</span>') + '</td>' +
        '<td style="text-align:right;font-weight:600">$' + money(total) + '</td>' +
        '<td>' + statusBadge(inv) + (flag ? ' <span class="badge ' + flag.cls + '">' + flag.txt + '</span>' : '') + '</td>' +
        '<td style="white-space:nowrap"><div style="display:flex;gap:6px;justify-content:flex-end">' + acts.join('') + '</div></td>' +
        '</tr>';
    }).join('');

    var table = invs.length
      ? '<div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table>' +
          '<thead><tr><th>Invoice</th><th>Date</th><th>Vendor</th><th>Tracker item</th><th>Type</th>' +
          '<th style="text-align:right">Goods</th><th style="text-align:right">Tax</th><th style="text-align:right">Freight</th>' +
          '<th style="text-align:right">Total</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>'
      : '<div class="card"><div class="rp-empty">No invoices yet. Click <b>+ Log invoice</b> to record one against a tracker line item — approving it posts the amounts into the Procurement Tracker.</div></div>';

    host.innerHTML = header + kpis + table;
  }

  function kpi(label, value, sub) {
    return '<div class="rp-kpi"><div class="rp-kpi-label">' + label + '</div>' +
      '<div class="rp-kpi-value sm">' + value + '</div>' +
      '<div class="rp-kpi-sub">' + sub + '</div></div>';
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  // Scan invoice PDF (AI) — reuses STEVE's shared AI plumbing
  // (window._specFillCallAI + the shared provider/key in localStorage).
  var _irScanPending = null;
  function _irProvider(){ return (typeof _specAiProvider==='function') ? _specAiProvider() : (localStorage.getItem('db_provider')||'anthropic'); }
  function _irKey(){ return (typeof _specAiKey==='function') ? _specAiKey() : (localStorage.getItem('db_apikey_'+_irProvider())||''); }

  function irScanSaveKey(){
    var el = document.getElementById('ir-scan-key-input'); var k = el ? el.value.trim() : '';
    if(!k){ toast('Paste your API key first.'); return; }
    localStorage.setItem('db_apikey_'+_irProvider(), k);
    var row = document.getElementById('ir-scan-key'); if(row) row.style.display='none';
    if(_irScanPending){ var f=_irScanPending; _irScanPending=null; irScanFile(f); }
  }

  function irScanFile(file){
    if(!file) return;
    if(!_irKey()){
      _irScanPending = file;
      var row = document.getElementById('ir-scan-key'); if(row) row.style.display='block';
      var st0 = document.getElementById('ir-scan-status');
      if(st0){ st0.style.display='block'; st0.textContent = 'Paste your '+(_irProvider()==='anthropic'?'Anthropic':'OpenAI')+' API key to scan (stored locally, shared with the other AI tools).'; }
      return;
    }
    var isPDF = file.type==='application/pdf' || /\.pdf$/i.test(file.name||'');
    var reader = new FileReader();
    reader.onload = function(){
      var b64 = String(reader.result).split(',')[1];
      _irRunScan({ kind:isPDF?'pdf':'image', base64:b64, mediaType:isPDF?'application/pdf':(file.type||'image/png'), name:file.name||'invoice' });
    };
    reader.onerror = function(){ toast('Could not read that file.'); };
    reader.readAsDataURL(file);
  }

  async function _irRunScan(fileObj){
    var st = document.getElementById('ir-scan-status');
    if(st){ st.style.display='block'; st.innerHTML = '<span style="color:var(--accent-ink)">⚙</span> Reading the invoice…'; }
    if(typeof window._specFillCallAI !== 'function'){ if(st) st.innerHTML='<span style="color:var(--red)">⚠</span> AI scanning is unavailable in this build.'; return; }
    var prompt = 'You are reading a vendor invoice for an interior-design procurement firm. Extract it into STRICT JSON. Return ONLY the JSON object — no markdown, no commentary.\n' +
      '{\n' +
      '  "invoiceNumber": "",\n' +
      '  "invoiceDate": "YYYY-MM-DD",\n' +
      '  "vendor": "",\n' +
      '  "type": "Deposit | Balance | Other",\n' +
      '  "goods": 0,\n' +
      '  "discount": 0,\n' +
      '  "tax": 0,\n' +
      '  "freight": 0,\n' +
      '  "lineItems": [ { "description": "", "qty": 0, "amount": 0 } ]\n' +
      '}\n' +
      'Rules: "goods" = merchandise subtotal BEFORE tax and freight (sum of line-item amounts, net of any separately listed discount). "tax" = sales tax only. Put shipping/delivery in "freight". Numbers only — no $ or commas. Use "" or 0 when not present. "type": Deposit for a deposit/down payment, Balance for a final/balance invoice, else Other.';
    try {
      var resp = await window._specFillCallAI(_irProvider(), _irKey(), prompt, fileObj, false);
      var m = resp.match(/\{[\s\S]*\}/); var clean = m ? m[0] : resp;
      var d = JSON.parse(clean);
      _irApplyScan(d);
      if(st) st.innerHTML = '<span style="color:var(--green)">✓</span> Filled from the invoice — review the fields below.';
    } catch(e){
      if(st){ st.style.display='block'; st.innerHTML = '<span style="color:var(--red)">⚠</span> ' + esc(e.message||'Could not read the invoice.'); }
    }
  }

  function _irNormDate(s){
    s = String(s||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s); if(!isNaN(d)) return d.toISOString().slice(0,10);
    return '';
  }
  function _irMatchItem(name, hint, vendor){
    var items = trackerItems(name); if(!items.length) return null;
    var v = String(vendor||'').toLowerCase(); var best=null, score=0;
    items.forEach(function(it){
      var s=0;
      if(it.vendor){ var iv=it.vendor.toLowerCase(); if(v && (v.indexOf(iv)>=0 || iv.indexOf(v)>=0)) s+=6; }
      var toks=((it.name||'')+' '+(it.itemNum||'')).toLowerCase().split(/\W+/).filter(function(t){return t.length>3;});
      toks.forEach(function(t){ if(hint.indexOf(t)>=0) s+=1; });
      if(s>score){ score=s; best=it; }
    });
    return score>0 ? best : null;
  }
  function _irApplyScan(d){
    d = d || {};
    var setV=function(id,val){ var el=document.getElementById(id); if(el && val!=null && val!=='') el.value=val; };
    if(d.invoiceNumber) setV('ir-invnum', String(d.invoiceNumber));
    if(d.invoiceDate){ var iso=_irNormDate(d.invoiceDate); if(iso) setV('ir-date', iso); }
    var t=String(d.type||'').toLowerCase(); var typeEl=document.getElementById('ir-type');
    if(typeEl){ if(/depos|down/.test(t)) typeEl.value='Deposit'; else if(/balance|final|progress/.test(t)) typeEl.value='Balance'; else if(d.type) typeEl.value='Other'; }
    var goods = num(d.goods);
    if(!goods && Array.isArray(d.lineItems)) goods = d.lineItems.reduce(function(a,li){ return a+num(li.amount); }, 0);
    if(goods) setV('ir-goods', goods);
    if(num(d.discount)) setV('ir-discount', num(d.discount));
    if(num(d.tax)) setV('ir-tax', num(d.tax));
    if(num(d.freight)) setV('ir-freight', num(d.freight));
    if(Array.isArray(d.lineItems) && d.lineItems.length){
      var lines = d.lineItems.map(function(li){ var q=num(li.qty); return (q?q+'× ':'')+(li.description||'')+(num(li.amount)?' — $'+money(li.amount):''); }).filter(Boolean);
      var notesEl=document.getElementById('ir-notes'); if(notesEl && lines.length){ notesEl.value=(notesEl.value?notesEl.value+' | ':'')+lines.join('; '); }
    }
    var name = activeProject ? activeProject.name : '';
    var hint = ((d.vendor||'')+' '+(Array.isArray(d.lineItems)?d.lineItems.map(function(li){return li.description||'';}).join(' '):'')).toLowerCase();
    var best = _irMatchItem(name, hint, d.vendor);
    if(best){ var sel=document.getElementById('ir-item'); if(sel){ sel.value=String(best.id); irItemHint(); } }
    irRecalcTotal();
  }

  window.renderInvoiceRegister = render;
  window.irScanFile = irScanFile;
  window.irScanSaveKey = irScanSaveKey;
  window.irOpenLog = irOpenLog;
  window.irCloseModal = irCloseModal;
  window.irSaveInvoice = irSaveInvoice;
  window.irItemHint = irItemHint;
  window.irRecalcTotal = irRecalcTotal;
  window.irApprove = irApprove;
  window.irReopen = irReopen;
  window.irVoid = irVoid;
  window.irDelete = irDelete;
})();
