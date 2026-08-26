/* ============================================================================
   STEVE — Source record completion  (source-fill.js)
   Three ways to close the gaps in the Source directory:
     1) Backfill  — recover phone/email/website/contact already typed on POs
                    or buried in a source's notes, and propose them for review.
     2) Complete  — an inline grid of just the missing fields, sources that get
                    the most work first.
     3) Signature — paste an email signature; it parses into the right fields.

   Reuses host globals: suppliers, vendorPOs, budgetTrackers, pas, DB,
   sbPushSupplier, renderSuppliers, ai3Toast, openModal/closeModal, pushUndoSnapshot.
   ========================================================================= */
(function () {
  'use strict';

  var FIELDS = [
    { k: 'phone', label: 'Phone' },
    { k: 'email', label: 'Email' },
    { k: 'website', label: 'Website' },
    { k: 'contact', label: 'Contact' },
    { k: 'contactEmail', label: 'Contact email' },
    { k: 'contactPhone', label: 'Contact phone' }
  ];
  var PO_MAP = { mfrTel: 'phone', mfrEmail: 'email', mfrWeb: 'website', mfrContact: 'contact', mfrContactEmail: 'contactEmail', mfrContactTel: 'contactPhone' };

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function blank(v) { return !String(v == null ? '' : v).trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }

  function saveAll(label) {
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(label, ['suppliers']); } catch (e) {}
    try { DB.save('fp11_suppliers', suppliers); } catch (e) {}
    try { if (typeof renderSuppliers === 'function') renderSuppliers(); } catch (e) {}
  }
  function pushOne(rec) { try { if (typeof sbPushSupplier === 'function') sbPushSupplier(rec); } catch (e) {} }

  // ── How busy is each source? ──────────────────────────────────────────────
  function usageIndex() {
    var u = {};
    function bump(v, n) { var k = norm(v); if (k) u[k] = (u[k] || 0) + (n || 1); }
    try { Object.keys(budgetTrackers || {}).forEach(function (pn) { (budgetTrackers[pn].items || []).forEach(function (i) { if (!i.isCategory) bump(i.vendor); }); }); } catch (e) {}
    try { (pas || []).forEach(function (pa) { (pa.items || []).forEach(function (i) { if (!i.isCategory) bump(i.vendor); }); }); } catch (e) {}
    try { (vendorPOs || []).forEach(function (po) { bump(po.mfrName, 3); }); } catch (e) {}
    return u;
  }

  // ── 1. Backfill proposals ─────────────────────────────────────────────────
  function poDataFor(name) {
    var out = {};
    try {
      (vendorPOs || []).forEach(function (po) {
        if (norm(po.mfrName || '') !== norm(name)) return;
        Object.keys(PO_MAP).forEach(function (pk) {
          var v = String(po[pk] || '').trim();
          if (v) out[PO_MAP[pk]] = v;   // later POs win
        });
      });
    } catch (e) {}
    return out;
  }
  function notesDataFor(s) {
    var out = {}, n = String(s.notes || '');
    if (!n) return out;
    var c = n.match(/contact:\s*([^\u00b7\n]+)/i); if (c) out.contact = c[1].trim();
    var w = n.match(/(?:web|website|url)\s*:\s*(\S+)/i) || n.match(/https?:\/\/\S+/i);
    if (w) out.website = (w[1] || w[0]).replace(/[.,;\u00b7]+$/, '');
    var em = n.match(/[\w.+-]+@[\w-]+\.[\w.]+/); if (em) out.email = em[0];
    var tel = n.match(/(?:tel|phone)\s*:\s*([+\d][\d\s().-]{6,})/i); if (tel) out.phone = tel[1].trim();
    return out;
  }
  function proposals() {
    var out = [];
    (suppliers || []).forEach(function (s) {
      var po = poDataFor(s.name), notes = notesDataFor(s);
      FIELDS.forEach(function (f) {
        if (!blank(s[f.k])) return;
        var val = po[f.k], src = 'a previous PO';
        if (!val) { val = notes[f.k]; src = 'source notes'; }
        if (val) out.push({ id: s.id, vendor: s.name, field: f.k, label: f.label, value: String(val).trim(), vendor: src });
      });
    });
    return out;
  }

  var pending = [];
  function openBackfill() {
    pending = proposals();
    var body = document.getElementById('vf-backfill-body');
    if (!pending.length) {
      body.innerHTML = '<p style="font-size:13px;color:var(--text2);margin:0">Nothing left to recover — every blank field on your sources is genuinely missing from your POs and notes too. Use <strong>Fill missing details</strong> or <strong>Paste signature</strong> to add them.</p>';
    } else {
      body.innerHTML =
        '<p style="font-size:13px;color:var(--text2);margin:0 0 10px">Found ' + pending.length + ' detail' + (pending.length === 1 ? '' : 's') + ' already recorded elsewhere. Uncheck anything you don\u2019t want.</p>' +
        '<div style="max-height:340px;overflow:auto;border:1px solid var(--border2);border-radius:var(--radius-sm)">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="background:var(--surface2)">' +
        '<th style="padding:6px 8px;text-align:left;width:26px"><input type="checkbox" checked onchange="vfToggleAll(this)" /></th>' +
        '<th style="padding:6px 8px;text-align:left">Source</th><th style="padding:6px 8px;text-align:left">Field</th>' +
        '<th style="padding:6px 8px;text-align:left">Value</th><th style="padding:6px 8px;text-align:left">From</th></tr></thead><tbody>' +
        pending.map(function (p, i) {
          return '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:5px 8px"><input type="checkbox" class="vf-pick" data-i="' + i + '" checked /></td>' +
            '<td style="padding:5px 8px">' + esc(p.vendor) + '</td>' +
            '<td style="padding:5px 8px;color:var(--text2)">' + esc(p.label) + '</td>' +
            '<td style="padding:5px 8px">' + esc(p.value) + '</td>' +
            '<td style="padding:5px 8px;color:var(--text3)">' + esc(p.vendor) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    openModal('vf-backfill-modal');
  }
  function toggleAll(cb) { document.querySelectorAll('.vf-pick').forEach(function (c) { c.checked = cb.checked; }); }
  function applyBackfill() {
    var picks = [].slice.call(document.querySelectorAll('.vf-pick:checked')).map(function (c) { return pending[parseInt(c.getAttribute('data-i'), 10)]; }).filter(Boolean);
    if (!picks.length) { closeModal('vf-backfill-modal'); return; }
    var touched = {};
    picks.forEach(function (p) {
      var s = (suppliers || []).find(function (x) { return x.id === p.id; });
      if (s && blank(s[p.field])) { s[p.field] = p.value; touched[p.id] = s; }
    });
    saveAll('Backfill source details');
    Object.keys(touched).forEach(function (id) { pushOne(touched[id]); });
    closeModal('vf-backfill-modal');
    toast('\u2713 Filled ' + picks.length + ' field' + (picks.length === 1 ? '' : 's') + ' across ' + Object.keys(touched).length + ' source' + (Object.keys(touched).length === 1 ? '' : 's'), 3600);
    render();
  }

  // ── 2. Completion grid ────────────────────────────────────────────────────
  function openComplete() {
    var u = usageIndex();
    var list = (suppliers || []).filter(function (s) { return FIELDS.some(function (f) { return blank(s[f.k]); }); })
      .sort(function (a, b) { return (u[norm(b.name)] || 0) - (u[norm(a.name)] || 0) || String(a.name).localeCompare(String(b.name)); });
    var body = document.getElementById('vf-complete-body');
    if (!list.length) {
      body.innerHTML = '<p style="font-size:13px;color:var(--text2);margin:0">Every source record is complete.</p>';
    } else {
      var inp = 'width:100%;padding:3px 5px;border:1px solid var(--border2);border-radius:3px;font-size:11.5px;font-family:inherit;box-sizing:border-box';
      body.innerHTML =
        '<p style="font-size:13px;color:var(--text2);margin:0 0 10px">' + list.length + ' source' + (list.length === 1 ? '' : 's') + ' with gaps, most-used first. Edits save as you type.</p>' +
        '<div style="max-height:420px;overflow:auto;border:1px solid var(--border2);border-radius:var(--radius-sm)">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="background:var(--surface2)"><th style="padding:6px 8px;text-align:left;position:sticky;top:0;background:var(--surface2)">Source</th>' +
        FIELDS.map(function (f) { return '<th style="padding:6px 8px;text-align:left;position:sticky;top:0;background:var(--surface2)">' + f.label + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        list.map(function (s) {
          var uses = u[norm(s.name)] || 0;
          return '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:5px 8px;white-space:nowrap"><div style="font-weight:500">' + esc(s.name) + '</div>' +
            '<div style="font-size:10px;color:var(--text3)">' + (uses ? uses + ' use' + (uses === 1 ? '' : 's') : 'unused') + '</div></td>' +
            FIELDS.map(function (f) {
              return '<td style="padding:4px 6px"><input value="' + esc(s[f.k] || '') + '" style="' + inp + (blank(s[f.k]) ? ';background:var(--surface2)' : '') + '" ' +
                'onchange="vfSetField(\'' + s.id + '\',\'' + f.k + '\',this.value)" /></td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }
    openModal('vf-complete-modal');
  }
  function setField(id, key, val) {
    var s = (suppliers || []).find(function (x) { return String(x.id) === String(id); });
    if (!s) return;
    s[key] = String(val || '').trim();
    saveAll('Edit source details');
    pushOne(s);
    render();
  }

  // ── 3. Signature paste ────────────────────────────────────────────────────
  function parseSignature(text) {
    var t = String(text || '');
    var lines = t.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var out = {};
    var em = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
    if (em.length) out.contactEmail = em[0];
    var url = t.match(/https?:\/\/[^\s|,]+/i) || t.match(/\bwww\.[^\s|,]+/i);
    if (url) out.website = url[0].replace(/[.,;]+$/, '');
    else if (em.length) {
      var dom = em[0].split('@')[1];
      if (dom && !/gmail|yahoo|hotmail|outlook|icloud|aol/i.test(dom)) out.website = dom;
    }
    var tels = t.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
    var mobile = null, main = null;
    lines.forEach(function (l) {
      var m = l.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
      if (!m) return;
      if (/mobile|cell|direct/i.test(l) && !mobile) mobile = m[0].trim();
      else if (!main) main = m[0].trim();
    });
    if (mobile || tels[0]) out.contactPhone = (mobile || tels[0]).trim();
    if (main && main !== out.contactPhone) out.phone = main;
    else if (tels[1]) out.phone = tels[1].trim();
    var nameLine = lines.find(function (l) {
      return !/[@\d]/.test(l) && !/https?:|www\./i.test(l) && l.split(/\s+/).length <= 4 && /^[A-Z]/.test(l);
    });
    if (nameLine) out.contact = nameLine.replace(/[|,]+$/, '').trim();
    return out;
  }

  var sigParsed = null;
  function openSignature() {
    document.getElementById('vf-sig-text').value = '';
    document.getElementById('vf-sig-result').innerHTML = '';
    var sel = document.getElementById('vf-sig-source');
    sel.innerHTML = '<option value="">Select source\u2026</option>' +
      (suppliers || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
        .map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
    sigParsed = null;
    openModal('vf-sig-modal');
  }
  function parseSig() {
    var txt = document.getElementById('vf-sig-text').value;
    sigParsed = parseSignature(txt);
    var keys = Object.keys(sigParsed);
    var box = document.getElementById('vf-sig-result');
    if (!keys.length) { box.innerHTML = '<div style="font-size:12px;color:var(--text3)">Nothing recognisable found in that text.</div>'; return; }
    // Guess the source from the email domain or a company-looking line
    var sel = document.getElementById('vf-sig-source');
    if (!sel.value && sigParsed.website) {
      var dom = norm(sigParsed.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0]);
      var hit = (suppliers || []).find(function (s) { return dom && norm(s.name).replace(/ /g, '').indexOf(dom.replace(/ /g, '')) === 0; });
      if (hit) sel.value = hit.id;
    }
    box.innerHTML = '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Found:</div>' +
      '<table style="font-size:12px;border-collapse:collapse">' + keys.map(function (k) {
        var f = FIELDS.find(function (x) { return x.k === k; });
        return '<tr><td style="padding:2px 12px 2px 0;color:var(--text3)">' + esc(f ? f.label : k) + '</td><td style="padding:2px 0">' + esc(sigParsed[k]) + '</td></tr>';
      }).join('') + '</table>';
  }
  function applySig() {
    var id = document.getElementById('vf-sig-source').value;
    if (!id) { alert('Choose which source this signature belongs to.'); return; }
    if (!sigParsed) { parseSig(); if (!sigParsed || !Object.keys(sigParsed).length) return; }
    var s = (suppliers || []).find(function (x) { return String(x.id) === String(id); });
    if (!s) return;
    var n = 0;
    Object.keys(sigParsed).forEach(function (k) { if (blank(s[k])) { s[k] = sigParsed[k]; n++; } });
    saveAll('Fill source from signature');
    pushOne(s);
    closeModal('vf-sig-modal');
    toast(n ? ('\u2713 Filled ' + n + ' field' + (n === 1 ? '' : 's') + ' on ' + s.name) : (s.name + ' already had all of those filled'), 3400);
    render();
  }

  // ── 4. Keep the directory in step with POs ────────────────────────────────
  // After a PO is saved, its manufacturer block is the freshest contact info in
  // the system. Blank source fields fill silently; genuine disagreements are
  // shown for review; an unknown manufacturer offers to become a source record.
  var VF_MAP = { phone: 'mfrTel', email: 'mfrEmail', website: 'mfrWeb', contact: 'mfrContact', contactEmail: 'mfrContactEmail', contactPhone: 'mfrContactTel' };
  var sync = { diffs: [], vendorId: null, newRec: null };

  function syncFromPO() {
    var d;
    try { d = (typeof getVPOFormData === 'function') ? getVPOFormData() : vpoForm; } catch (e) { return; }
    if (!d || !String(d.mfrName || '').trim()) return;
    var name = String(d.mfrName).trim();
    var s = null;
    try { if (typeof vpoFindVendorMatch === 'function') s = vpoFindVendorMatch(name); } catch (e) {}

    if (!s) {
      var rec = { name: name };
      Object.keys(VF_MAP).forEach(function (k) { var v = String(d[VF_MAP[k]] || '').trim(); if (v) rec[k] = v; });
      if (d.delivery) { var wk = String(d.delivery).match(/(\d+)/); if (wk) rec.lead = parseInt(wk[1], 10) * 7; }
      sync.newRec = rec; sync.vendorId = null; sync.diffs = [];
      document.getElementById('vf-sync-body').innerHTML =
        '<p style="font-size:13px;color:var(--text2);margin:0 0 10px"><strong>' + esc(name) + '</strong> isn\u2019t in your source directory. Add it now with the details from this PO?</p>' +
        '<table style="font-size:12px;border-collapse:collapse">' +
        Object.keys(rec).filter(function (k) { return k !== 'name'; }).map(function (k) {
          var f = FIELDS.find(function (x) { return x.k === k; });
          return '<tr><td style="padding:2px 12px 2px 0;color:var(--text3)">' + esc(f ? f.label : k) + '</td><td style="padding:2px 0">' + esc(rec[k]) + '</td></tr>';
        }).join('') + '</table>';
      document.getElementById('vf-sync-go').textContent = 'Add source';
      openModal('vf-sync-modal');
      return;
    }

    var filled = [], diffs = [];
    Object.keys(VF_MAP).forEach(function (k) {
      var v = String(d[VF_MAP[k]] || '').trim();
      if (!v) return;
      if (blank(s[k])) { s[k] = v; filled.push(k); }
      else if (norm(s[k]) !== norm(v)) diffs.push({ field: k, was: s[k], now: v });
    });
    if (filled.length) {
      saveAll('Sync source from PO');
      pushOne(s);
      toast('\u2713 Added ' + filled.length + ' detail' + (filled.length === 1 ? '' : 's') + ' to ' + s.name + ' from this PO', 3400);
      render();
    }
    if (diffs.length) {
      sync.diffs = diffs; sync.vendorId = s.id; sync.newRec = null;
      document.getElementById('vf-sync-body').innerHTML =
        '<p style="font-size:13px;color:var(--text2);margin:0 0 10px">This PO has different details for <strong>' + esc(s.name) + '</strong>. Tick anything that should replace what\u2019s in the directory.</p>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr style="background:var(--surface2)"><th style="padding:5px 8px;width:26px"></th>' +
        '<th style="padding:5px 8px;text-align:left">Field</th><th style="padding:5px 8px;text-align:left">In directory</th>' +
        '<th style="padding:5px 8px;text-align:left">On this PO</th></tr></thead><tbody>' +
        diffs.map(function (df, i) {
          var f = FIELDS.find(function (x) { return x.k === df.field; });
          return '<tr style="border-top:1px solid var(--border)"><td style="padding:5px 8px"><input type="checkbox" class="vf-diff" data-i="' + i + '" /></td>' +
            '<td style="padding:5px 8px;color:var(--text2)">' + esc(f ? f.label : df.field) + '</td>' +
            '<td style="padding:5px 8px;color:var(--text3)">' + esc(df.was) + '</td>' +
            '<td style="padding:5px 8px">' + esc(df.now) + '</td></tr>';
        }).join('') + '</tbody></table>';
      document.getElementById('vf-sync-go').textContent = 'Update directory';
      openModal('vf-sync-modal');
    }
  }

  function applySync() {
    if (sync.newRec) {
      var rec = sync.newRec;
      rec.id = (typeof genId === 'function') ? genId() : ('v' + Date.now());
      rec.category = rec.category || 'Mixed';
      rec.status = rec.status || 'Active';
      rec.country = rec.country || '';
      rec.rating = rec.rating || 0;
      rec.discount = rec.discount || 0;
      rec.notes = rec.notes || '';
      rec.lead = rec.lead || 0;
      suppliers.push(rec);
      saveAll('Add source from PO');
      pushOne(rec);
      toast('\u2713 ' + rec.name + ' added to your source directory', 3400);
    } else if (sync.vendorId) {
      var s = (suppliers || []).find(function (x) { return x.id === sync.vendorId; });
      var picks = [].slice.call(document.querySelectorAll('.vf-diff:checked')).map(function (c) { return sync.diffs[parseInt(c.getAttribute('data-i'), 10)]; }).filter(Boolean);
      if (s && picks.length) {
        picks.forEach(function (df) { s[df.field] = df.now; });
        saveAll('Update source from PO');
        pushOne(s);
        toast('\u2713 Updated ' + picks.length + ' field' + (picks.length === 1 ? '' : 's') + ' on ' + s.name, 3400);
      }
    }
    sync = { diffs: [], vendorId: null, newRec: null };
    closeModal('vf-sync-modal');
    render();
  }

  function hookSave() {
    if (typeof window.saveVPO !== 'function' || window.saveVPO.__vfHooked) return;
    var orig = window.saveVPO;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { syncFromPO(); } catch (e) { console.warn('[ai3] source sync failed', e); }
      return r;
    };
    wrapped.__vfHooked = true;
    window.saveVPO = wrapped;
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  function stats() {
    var total = (suppliers || []).length, incomplete = 0, gaps = 0;
    (suppliers || []).forEach(function (s) {
      var m = FIELDS.filter(function (f) { return blank(s[f.k]); }).length;
      if (m) { incomplete++; gaps += m; }
    });
    return { total: total, incomplete: incomplete, gaps: gaps, recoverable: proposals().length };
  }
  function render() {
    var card = document.getElementById('vf-card'); if (!card) return;
    var st = stats();
    card.querySelector('#vf-summary').innerHTML = st.total
      ? (st.incomplete
        ? st.incomplete + ' of ' + st.total + ' sources are missing details (' + st.gaps + ' blank field' + (st.gaps === 1 ? '' : 's') + ')' +
          (st.recoverable ? ' \u00b7 <span style="color:var(--green)">' + st.recoverable + ' recoverable from your own records</span>' : '')
        : 'All ' + st.total + ' source records are complete.')
      : 'No sources in the directory yet.';
    card.querySelector('#vf-backfill-btn').disabled = !st.recoverable;
  }

  function mount() {
    var page = document.getElementById('page-suppliers');
    if (!page || document.getElementById('vf-card')) return;
    var card = document.createElement('div');
    card.className = 'card';
    card.id = 'vf-card';
    card.style.cssText = 'margin-bottom:14px';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<div><div style="font-weight:600;font-size:14px">Complete your source records</div>' +
        '<div id="vf-summary" style="font-size:12px;color:var(--text2);margin-top:2px"></div></div>' +
        '<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-sm btn-primary" id="vf-backfill-btn" onclick="vfOpenBackfill()">Recover from POs &amp; notes</button>' +
          '<button class="btn btn-sm" onclick="vfOpenComplete()">Fill missing details</button>' +
          '<button class="btn btn-sm" onclick="vfOpenSignature()">Paste signature</button>' +
        '</div>' +
      '</div>';
    page.insertBefore(card, page.firstChild);

    var modals = document.createElement('div');
    modals.innerHTML =
      '<div class="modal-overlay" id="vf-backfill-modal"><div class="modal" style="max-width:720px">' +
        '<div class="modal-header"><div class="modal-title">Recover source details</div>' +
        '<button class="modal-close" onclick="closeModal(\'vf-backfill-modal\')">\u2715</button></div>' +
        '<div class="modal-body" id="vf-backfill-body"></div>' +
        '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="closeModal(\'vf-backfill-modal\')">Cancel</button>' +
        '<button class="btn btn-sm btn-primary" onclick="vfApplyBackfill()">Fill selected</button></div></div></div>' +
      '<div class="modal-overlay" id="vf-complete-modal"><div class="modal" style="max-width:1000px">' +
        '<div class="modal-header"><div class="modal-title">Fill missing source details</div>' +
        '<button class="modal-close" onclick="closeModal(\'vf-complete-modal\')">\u2715</button></div>' +
        '<div class="modal-body" id="vf-complete-body"></div>' +
        '<div class="modal-footer" style="display:flex;justify-content:flex-end">' +
        '<button class="btn btn-sm btn-primary" onclick="closeModal(\'vf-complete-modal\')">Done</button></div></div></div>' +
      '<div class="modal-overlay" id="vf-sync-modal"><div class="modal" style="max-width:640px">' +
        '<div class="modal-header"><div class="modal-title">Source directory</div>' +
        '<button class="modal-close" onclick="closeModal(\'vf-sync-modal\')">\u2715</button></div>' +
        '<div class="modal-body" id="vf-sync-body"></div>' +
        '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="closeModal(\'vf-sync-modal\')">Not now</button>' +
        '<button class="btn btn-sm btn-primary" id="vf-sync-go" onclick="vfApplySync()">Update directory</button></div></div></div>' +
      '<div class="modal-overlay" id="vf-sig-modal"><div class="modal" style="max-width:560px">' +
        '<div class="modal-header"><div class="modal-title">Paste an email signature</div>' +
        '<button class="modal-close" onclick="closeModal(\'vf-sig-modal\')">\u2715</button></div>' +
        '<div class="modal-body">' +
          '<label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Source</label>' +
          '<select id="vf-sig-source" style="width:100%;padding:6px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;margin-bottom:10px"></select>' +
          '<label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Signature text</label>' +
          '<textarea id="vf-sig-text" rows="7" placeholder="Paste the whole signature block\u2026" oninput="vfParseSig()" style="width:100%;padding:8px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:12px;font-family:inherit;box-sizing:border-box"></textarea>' +
          '<div id="vf-sig-result" style="margin-top:10px"></div>' +
        '</div>' +
        '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="closeModal(\'vf-sig-modal\')">Cancel</button>' +
        '<button class="btn btn-sm btn-primary" onclick="vfApplySig()">Fill blanks</button></div></div></div>';
    while (modals.firstChild) {
      var m = modals.firstChild;
      document.body.appendChild(m);
      (function (el) { el.addEventListener('click', function (e) { if (e.target === el) el.classList.remove('open'); }); })(m);
    }
    render();
    hookSave();
  }

  window.vfOpenBackfill = openBackfill;
  window.vfApplyBackfill = applyBackfill;
  window.vfToggleAll = toggleAll;
  window.vfOpenComplete = openComplete;
  window.vfSetField = setField;
  window.vfOpenSignature = openSignature;
  window.vfParseSig = parseSig;
  window.vfApplySig = applySig;
  window.vfRender = render;
  window.vfApplySync = applySync;
  window.vfSyncFromPO = syncFromPO;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
