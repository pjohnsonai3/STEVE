/* ============================================================================
   STEVE — Bid Analysis  (bid-analysis.js)
   Project-scoped competitive bidding: capture 3+ bids per high-quantity line,
   compare them side by side, award a vendor, and see variance against the
   budget allowance (qty x est price). Records a rejection rationale for the
   audit trail when the low bid is not awarded.
   Stores to DB key 'fp11_bids' (flat array, cloud-synced via SB_STATE).
   Reuses budgetTrackers, activeProject, escHtml, ai3Toast, logActivity,
   genId, pushUndo, fmtD, ensureBudgetTracker, DB.
   ============================================================================ */
(function () {
  'use strict';

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function num(v) { return parseFloat(v) || 0; }
  function m0(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('en-US'); }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }
  function newId() { return (typeof genId === 'function') ? genId() : Date.now(); }
  function v(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  // A "package" = one tracker item out to bid, holding an array of bids.
  function load() { try { var x = (typeof bidPackages !== 'undefined') ? bidPackages : DB.load('fp11_bids', []); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  function persist(arr) {
    var copy = arr.slice();
    try { if (typeof bidPackages !== 'undefined') { bidPackages.length = 0; copy.forEach(function (r) { bidPackages.push(r); }); } } catch (e) {}
    try { DB.save('fp11_bids', (typeof bidPackages !== 'undefined') ? bidPackages : copy); } catch (e) {}
  }
  function projItems(name) { var bt = budgetTrackers[name]; return bt ? bt.items.filter(function (i) { return !i.isCategory; }) : []; }
  function findItem(name, id) { var bt = budgetTrackers[name]; return bt ? (bt.items.find(function (i) { return i.id === id; }) || null) : null; }
  function projPkgs(name) { return load().filter(function (p) { return p.project === name; }); }

  function allowance(name, itemId) { var it = findItem(name, itemId); return it ? num(it.qty) * num(it.estPrice) : 0; }
  function extended(pkg, bid) { return num(bid.unit) * num(pkg.qty) + num(bid.freight); }

  // ── Package modal (create a line out to bid) ──
  function ensurePkgModal() {
    if (document.getElementById('ba-pkg-modal')) return;
    var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'ba-pkg-modal';
    ov.innerHTML = '<div class="modal" style="width:480px"><div class="modal-header"><div class="modal-title">Put a line out to bid</div><button class="modal-close" onclick="baClosePkg()">\u2715</button></div>' +
      '<div class="modal-body"><div class="form-row"><label>Tracker line item</label><select id="ba-pkg-item" onchange="baPkgHint()"></select>' +
        '<div id="ba-pkg-hint" style="font-size:11.5px;color:var(--text3);margin-top:5px"></div></div>' +
        '<div class="form-row"><label>Spec summary (optional)</label><input id="ba-pkg-spec" placeholder="e.g. aluminum frame, contract sling, stackable"></div></div>' +
      '<div class="modal-footer"><button class="btn" onclick="baClosePkg()">Cancel</button><button class="btn btn-primary" onclick="baSavePkg()">Create bid package</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) baClosePkg(); });
  }
  function baOpenPkg() {
    var name = activeProject ? activeProject.name : ''; if (!name) { toast('Open a project first.'); return; }
    ensurePkgModal();
    var items = projItems(name);
    var taken = projPkgs(name).map(function (p) { return p.itemId; });
    var avail = items.filter(function (it) { return taken.indexOf(it.id) < 0; });
    var sel = document.getElementById('ba-pkg-item');
    sel.innerHTML = avail.length ? avail.map(function (it) {
      return '<option value="' + it.id + '">' + esc((it.itemNum ? it.itemNum + ' \u2014 ' : '') + (it.name || '') + ' \u00b7 qty ' + num(it.qty)) + '</option>';
    }).join('') : '<option value="">All line items are already out to bid</option>';
    document.getElementById('ba-pkg-spec').value = '';
    baPkgHint();
    if (typeof openModal === 'function') openModal('ba-pkg-modal'); else document.getElementById('ba-pkg-modal').classList.add('open');
  }
  function baPkgHint() {
    var name = activeProject ? activeProject.name : '';
    var it = findItem(name, parseInt(v('ba-pkg-item'), 10));
    document.getElementById('ba-pkg-hint').innerHTML = it ? ('Budget allowance ' + m0(num(it.qty) * num(it.estPrice)) + ' \u00b7 qty ' + num(it.qty)) : '';
  }
  function baClosePkg() { if (typeof closeModal === 'function') closeModal('ba-pkg-modal'); else { var m = document.getElementById('ba-pkg-modal'); if (m) m.classList.remove('open'); } }
  function baSavePkg() {
    var name = activeProject ? activeProject.name : '';
    var itemId = parseInt(v('ba-pkg-item'), 10);
    var it = findItem(name, itemId); if (!it) { toast('Select a line item.'); return; }
    var arr = load();
    if (typeof pushUndo === 'function') pushUndo('Create bid package');
    arr.push({ id: newId(), project: name, itemId: itemId, name: (it.itemNum ? it.itemNum + ' \u2014 ' : '') + (it.name || ''), qty: num(it.qty), spec: v('ba-pkg-spec').trim(), bids: [], awardedBidId: null, rationale: '' });
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Opened bid package \u2014 ' + it.name);
    baClosePkg(); render();
  }
  function baDeletePkg(id) { if (!confirm('Remove this bid package and its bids?')) return; if (typeof pushUndo === 'function') pushUndo('Delete bid package'); persist(load().filter(function (p) { return p.id !== id; })); render(); }

  // ── Bid modal ──
  var bidPkgId = null, bidEditId = null;
  function ensureBidModal() {
    if (document.getElementById('ba-bid-modal')) return;
    var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'ba-bid-modal';
    ov.innerHTML = '<div class="modal" style="width:520px"><div class="modal-header"><div class="modal-title" id="ba-bid-title">Add bid</div><button class="modal-close" onclick="baCloseBid()">\u2715</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-grid2"><div class="form-row"><label>Vendor</label><input id="ba-vendor" placeholder="Vendor name"></div>' +
          '<div class="form-row"><label>Unit price ($)</label><input type="number" id="ba-unit" min="0" step="0.01" oninput="baBidTotal()"></div></div>' +
        '<div class="form-grid2"><div class="form-row"><label>Freight ($)</label><input type="number" id="ba-freight" min="0" step="0.01" oninput="baBidTotal()"></div>' +
          '<div class="form-row"><label>Lead time (weeks)</label><input type="number" id="ba-lead" min="0" step="1"></div></div>' +
        '<div class="form-row"><label>Spec compliance</label><select id="ba-compliance"><option>Full</option><option>Substitution noted</option><option>Partial</option><option>Non-compliant</option></select></div>' +
        '<div class="form-row"><label>Notes</label><input id="ba-bid-notes" placeholder="Optional"></div>' +
        '<div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px 14px;display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text2)">Extended (qty \u00d7 unit + freight)</span><b id="ba-bid-total">$0</b></div>' +
      '</div><div class="modal-footer"><button class="btn" onclick="baCloseBid()">Cancel</button><button class="btn btn-primary" onclick="baSaveBid()">Save bid</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) baCloseBid(); });
  }
  function baBidTotal() {
    var pkg = load().find(function (p) { return p.id === bidPkgId; }); if (!pkg) return;
    document.getElementById('ba-bid-total').textContent = m0(num(v('ba-unit')) * num(pkg.qty) + num(v('ba-freight')));
  }
  function baAddBid(pkgId, bidId) {
    ensureBidModal(); bidPkgId = pkgId; bidEditId = bidId || null;
    var pkg = load().find(function (p) { return p.id === pkgId; });
    var bid = bidId && pkg ? pkg.bids.find(function (b) { return b.id === bidId; }) : null;
    document.getElementById('ba-bid-title').textContent = bid ? 'Edit bid' : 'Add bid \u2014 ' + (pkg ? esc(pkg.name) : '');
    document.getElementById('ba-vendor').value = bid ? bid.vendor : '';
    document.getElementById('ba-unit').value = bid ? bid.unit : '';
    document.getElementById('ba-freight').value = bid ? bid.freight : '';
    document.getElementById('ba-lead').value = bid ? bid.lead : '';
    document.getElementById('ba-compliance').value = bid ? bid.compliance : 'Full';
    document.getElementById('ba-bid-notes').value = bid ? bid.notes : '';
    baBidTotal();
    if (typeof openModal === 'function') openModal('ba-bid-modal'); else document.getElementById('ba-bid-modal').classList.add('open');
  }
  function baCloseBid() { if (typeof closeModal === 'function') closeModal('ba-bid-modal'); else { var m = document.getElementById('ba-bid-modal'); if (m) m.classList.remove('open'); } bidPkgId = bidEditId = null; }
  function baSaveBid() {
    var arr = load(); var pkg = arr.find(function (p) { return p.id === bidPkgId; }); if (!pkg) return;
    var data = { vendor: v('ba-vendor').trim() || 'Vendor', unit: num(v('ba-unit')), freight: num(v('ba-freight')), lead: num(v('ba-lead')), compliance: v('ba-compliance'), notes: v('ba-bid-notes').trim() };
    if (typeof pushUndo === 'function') pushUndo('Save bid');
    if (bidEditId) { var b = pkg.bids.find(function (x) { return x.id === bidEditId; }); if (b) Object.assign(b, data); }
    else pkg.bids.push(Object.assign({ id: newId() }, data));
    persist(arr); baCloseBid(); render();
  }
  function baDeleteBid(pkgId, bidId) {
    var arr = load(); var pkg = arr.find(function (p) { return p.id === pkgId; }); if (!pkg) return;
    if (typeof pushUndo === 'function') pushUndo('Delete bid');
    pkg.bids = pkg.bids.filter(function (b) { return b.id !== bidId; });
    if (pkg.awardedBidId === bidId) pkg.awardedBidId = null;
    persist(arr); render();
  }
  function baAward(pkgId, bidId) {
    var arr = load(); var pkg = arr.find(function (p) { return p.id === pkgId; }); if (!pkg) return;
    // If awarding a non-low bid, prompt for rationale (audit trail)
    var low = pkg.bids.slice().sort(function (a, b) { return extended(pkg, a) - extended(pkg, b); })[0];
    var rationale = pkg.rationale || '';
    if (low && low.id !== bidId) {
      rationale = prompt('This is not the lowest bid. Record the rationale for the audit trail (lead time, spec compliance, etc.):', rationale || '');
      if (rationale === null) return;
    }
    if (typeof pushUndo === 'function') pushUndo('Award bid');
    pkg.awardedBidId = bidId; pkg.rationale = rationale || '';
    persist(arr);
    if (typeof logActivity === 'function') { var w = pkg.bids.find(function (b) { return b.id === bidId; }); logActivity('Awarded ' + (w ? w.vendor : '') + ' \u2014 ' + pkg.name); }
    toast('\u2713 Vendor awarded'); render();
  }
  function baUnaward(pkgId) { var arr = load(); var pkg = arr.find(function (p) { return p.id === pkgId; }); if (!pkg) return; if (typeof pushUndo === 'function') pushUndo('Clear award'); pkg.awardedBidId = null; persist(arr); render(); }

  // ── Find vendors to bid against the spec (AI + saved Sourcing findings) ──
  var findPkgId = null, findCache = {};
  function leadWeeks(s) { var m = String(s || '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
  function ensureFindModal() {
    if (document.getElementById('ba-find-modal')) return;
    var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'ba-find-modal';
    ov.innerHTML = '<div class="modal" style="width:680px;max-height:86vh;display:flex;flex-direction:column">' +
      '<div class="modal-header"><div><div class="modal-title" id="ba-find-title">Find vendors to bid</div>' +
      '<div id="ba-find-sub" style="font-size:12px;color:var(--text3);margin-top:2px"></div></div>' +
      '<button class="modal-close" onclick="baCloseFind()">\u2715</button></div>' +
      '<div class="modal-body" id="ba-find-body" style="overflow:auto"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) baCloseFind(); });
  }
  function baFindVendors(pkgId) {
    var name = activeProject ? activeProject.name : ''; var pkg = load().find(function (p) { return p.id === pkgId; }); if (!pkg) return;
    var it = findItem(name, pkg.itemId);
    findPkgId = pkgId; ensureFindModal();
    document.getElementById('ba-find-title').textContent = 'Find vendors to bid \u2014 ' + (pkg.name || '');
    document.getElementById('ba-find-sub').textContent = (it ? 'Spec: ' + (it.name || '') + (pkg.spec ? ' \u00b7 ' + pkg.spec : '') + ' \u00b7 allowance ' + m0(allowance(name, pkg.itemId)) : '');
    if (typeof openModal === 'function') openModal('ba-find-modal'); else document.getElementById('ba-find-modal').classList.add('open');
    renderFind();
  }
  function baCloseFind() { if (typeof closeModal === 'function') closeModal('ba-find-modal'); else { var m = document.getElementById('ba-find-modal'); if (m) m.classList.remove('open'); } findPkgId = null; }

  function existingVendors(pkg) { return pkg.bids.map(function (b) { return String(b.vendor || '').toLowerCase().trim(); }); }
  function renderFind() {
    var name = activeProject ? activeProject.name : ''; var pkg = load().find(function (p) { return p.id === findPkgId; }); if (!pkg) return;
    var it = findItem(name, pkg.itemId);
    var body = document.getElementById('ba-find-body');
    var have = existingVendors(pkg);
    // 1) saved Sourcing findings on this tracker item — instant, no API
    var findings = (it && it.findings) ? it.findings : [];
    var fHtml = findings.length ? '<div class="ba-find-sec">From this item\u2019s Sourcing findings</div>' +
      findings.map(function (f) { return candRow({ vendor: f.vendor, name: f.name, price: num(f.price), lead: leadWeeks(f.leadTime), notes: f.notes || '' }, have); }).join('') : '';
    // 2) AI alternates
    var aiHtml;
    if (findCache[pkg.id]) {
      aiHtml = findCache[pkg.id].length
        ? '<div class="ba-find-sec">Spec-matched alternates <span style="font-weight:400;color:var(--text3)">(AI)</span></div>' + findCache[pkg.id].map(function (c) { return candRow(c, have); }).join('')
        : '<div style="font-size:13px;color:var(--text3);padding:10px 0">No alternates returned. Try refining the item name or spec.</div>';
    } else {
      aiHtml = '<div style="padding:6px 0 2px"><button class="btn btn-primary" onclick="baRunFind()">\u2726 Find spec-matched vendors (AI)</button>' +
        '<div style="font-size:11.5px;color:var(--text3);margin-top:6px">Searches a broad range of vendors for products matching this spec near your ' + m0(allowance(name, pkg.itemId)) + ' allowance, so you have real options to bid out.</div></div>';
    }
    body.innerHTML = (fHtml || aiHtml ? '' : '') +
      (findings.length ? fHtml : '') +
      '<div style="height:14px"></div>' + aiHtml +
      '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px"><button class="btn btn-sm" onclick="baCloseFind();baAddBid(' + pkg.id + ')">+ Enter a bid manually instead</button></div>';
  }
  function candRow(c, have) {
    var dup = have.indexOf(String(c.vendor || '').toLowerCase().trim()) >= 0;
    var enc = encodeURIComponent(JSON.stringify({ vendor: c.vendor || 'Vendor', unit: num(c.price), lead: num(c.lead) || leadWeeks(c.lead), name: c.name || '' }));
    return '<div style="display:flex;gap:12px;align-items:center;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 13px;margin-bottom:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:13px">' + esc(c.vendor || 'Vendor') + (dup ? ' <span style="font-size:10px;color:var(--text3);font-weight:400">\u00b7 already bid</span>' : '') + '</div>' +
        (c.name ? '<div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.name) + '</div>' : '') +
        (c.notes ? '<div style="font-size:11px;color:var(--text3);font-style:italic;margin-top:2px">' + esc(c.notes) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0">' + (num(c.price) > 0 ? '<div style="font-weight:700;font-variant-numeric:tabular-nums">' + m0(c.price) + '<small style="font-weight:400;color:var(--text3)"> /ea</small></div>' : '<div style="font-size:11px;color:var(--text3)">no price</div>') +
        ((num(c.lead) || leadWeeks(c.lead)) ? '<div style="font-size:11px;color:var(--text3)">' + (num(c.lead) || leadWeeks(c.lead)) + ' wks</div>' : '') + '</div>' +
      '<button class="btn btn-sm ' + (dup ? '' : 'btn-primary') + '" ' + (dup ? 'disabled style="opacity:.5"' : '') + ' onclick="baAddCandidate(\'' + enc + '\')">' + (dup ? 'Added' : 'Add as bid') + '</button>' +
      '</div>';
  }
  async function baRunFind() {
    var name = activeProject ? activeProject.name : ''; var pkg = load().find(function (p) { return p.id === findPkgId; }); if (!pkg) return;
    var it = findItem(name, pkg.itemId); if (!it) return;
    var body = document.getElementById('ba-find-body');
    var prev = body.innerHTML;
    body.innerHTML = '<div style="text-align:center;padding:30px 0"><div style="font-size:22px;animation:spin 1.5s linear infinite;display:inline-block">\u2699</div><div style="font-size:13px;font-weight:500;margin-top:8px">Finding spec-matched vendors\u2026</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Drawing on a broad range of contract sources</div></div>';
    try {
      if (typeof aiGetAlternatives !== 'function') throw new Error('Research engine unavailable.');
      var proj = (projects || []).find(function (p) { return p.name === name; });
      var alts = await aiGetAlternatives(it.name, it.vendor, (it.description || pkg.spec || ''), num(it.estPrice), num(it.qty), proj && proj.type);
      findCache[pkg.id] = (alts || []).map(function (a) { return { vendor: a.vendor || '', name: a.name || '', price: num(a.price), lead: leadWeeks(a.leadTime), notes: a.notes || a.description || '' }; });
      renderFind();
    } catch (e) {
      body.innerHTML = '<div style="padding:12px 14px;background:var(--red-bg);border-radius:var(--radius-sm);color:var(--red);font-size:12.5px;white-space:pre-line">' + esc(e.message) + '</div>' +
        '<div style="margin-top:12px"><button class="btn btn-sm" onclick="renderFindBack()">\u2190 Back</button></div>';
      window.renderFindBack = function () { body.innerHTML = prev; };
    }
  }
  function baAddCandidate(enc) {
    var c; try { c = JSON.parse(decodeURIComponent(enc)); } catch (e) { return; }
    var arr = load(); var pkg = arr.find(function (p) { return p.id === findPkgId; }); if (!pkg) return;
    if (typeof pushUndo === 'function') pushUndo('Add bid candidate');
    pkg.bids.push({ id: newId(), vendor: c.vendor || 'Vendor', unit: num(c.unit), freight: 0, lead: num(c.lead), compliance: 'Substitution noted', notes: c.name ? ('Spec-matched: ' + c.name) : 'Added from vendor search' });
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Added bid candidate ' + (c.vendor || '') + ' \u2014 ' + pkg.name);
    renderFind(); render();
  }

  function render() {
    var host = document.getElementById('page-bid-analysis'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to run bid analysis.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var pkgs = projPkgs(proj.name);
    var awarded = pkgs.filter(function (p) { return p.awardedBidId; }).length;
    var needBids = pkgs.filter(function (p) { return p.bids.length < 3; }).length;
    var savings = pkgs.reduce(function (a, p) { if (!p.awardedBidId) return a; var w = p.bids.find(function (b) { return b.id === p.awardedBidId; }); return a + (allowance(proj.name, p.itemId) - (w ? extended(p, w) : 0)); }, 0);

    var bar = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">Competitive bids &amp; award</div></div>' +
      '<div class="rp-toolbar-right"><button class="btn btn-primary" onclick="baOpenPkg()">+ Put a line out to bid</button></div></div>';
    var kpis = '<div class="rp-kpi-row k4">' +
      kpi('Lines out to bid', pkgs.length, 'this project') +
      kpi('Awarded', awarded, pkgs.length ? awarded + ' of ' + pkgs.length : '\u2014') +
      kpi('Need 3+ bids', needBids, needBids ? 'below threshold' : 'all compliant', needBids ? 'var(--warn)' : 'var(--green)') +
      kpi('Variance vs. budget', (savings >= 0 ? '\u2212' : '+') + m0(Math.abs(savings)), savings >= 0 ? 'under allowance' : 'over allowance', savings >= 0 ? 'var(--green)' : 'var(--red)') +
      '</div>';

    var cards = pkgs.length ? pkgs.map(function (pkg) { return pkgCard(proj.name, pkg); }).join('') :
      '<div class="card"><div class="rp-empty">No lines out to bid yet. Click <b>+ Put a line out to bid</b> to capture competitive bids and award a vendor.</div></div>';

    host.innerHTML = bar + kpis + cards;
  }

  function pkgCard(name, pkg) {
    var allow = allowance(name, pkg.itemId);
    var sorted = pkg.bids.slice().sort(function (a, b) { return extended(pkg, a) - extended(pkg, b); });
    var lowId = sorted[0] ? sorted[0].id : null;
    var awarded = pkg.bids.find(function (b) { return b.id === pkg.awardedBidId; });
    var variance = awarded ? allow - extended(pkg, awarded) : null;

    var head = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">' +
      '<div><div class="section-title" style="font-size:15px">' + esc(pkg.name) + ' \u00b7 qty ' + pkg.qty + '</div>' +
      (pkg.spec ? '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(pkg.spec) + '</div>' : '') + '</div>' +
      '<div style="text-align:right;font-size:12.5px;color:var(--text2)">Budget allowance <b style="color:var(--text)">' + m0(allow) + '</b>' +
      (variance != null ? ' \u00b7 <span style="color:' + (variance >= 0 ? 'var(--green)' : 'var(--red)') + '">' + m0(Math.abs(variance)) + (variance >= 0 ? ' under' : ' over') + '</span>' : '') + '</div></div>';

    var cols = pkg.bids.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:14px">' +
      sorted.map(function (b) {
        var isAward = b.id === pkg.awardedBidId, isLow = b.id === lowId;
        var ext = extended(pkg, b);
        var tag = isAward ? '<div style="position:absolute;top:-9px;left:14px;background:var(--green);color:#fff;font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 8px;border-radius:10px">AWARDED</div>' :
          (isLow ? '<div style="position:absolute;top:-9px;left:14px;background:var(--blue);color:#fff;font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 8px;border-radius:10px">LOW</div>' : '');
        var cmpColor = b.compliance === 'Full' ? 'var(--green)' : (b.compliance === 'Non-compliant' ? 'var(--red)' : 'var(--warn)');
        return '<div style="position:relative;border:1px solid ' + (isAward ? 'var(--green)' : 'var(--border)') + ';border-radius:var(--radius-sm);padding:15px 14px 12px;' + (isAward ? 'box-shadow:0 0 0 1px var(--green)' : '') + '">' + tag +
          '<div style="font-weight:700;font-size:13.5px">' + esc(b.vendor) + '</div>' +
          '<div style="font-size:22px;font-weight:700;margin:9px 0 1px;font-variant-numeric:tabular-nums">' + m0(b.unit) + '<small style="font-size:12px;font-weight:400;color:var(--text3)"> / ea</small></div>' +
          row('Extended', m0(ext)) + row('Freight', b.freight ? m0(b.freight) : '\u2014') + row('Lead time', (b.lead ? b.lead + ' wks' : '\u2014')) +
          '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-top:1px solid var(--border)"><span style="color:var(--text2)">Spec</span><span style="font-weight:600;color:' + cmpColor + '">' + esc(b.compliance) + '</span></div>' +
          '<div style="display:flex;gap:6px;margin-top:10px">' +
            (isAward ? '<button class="btn btn-sm" style="flex:1" onclick="baUnaward(' + pkg.id + ')">Clear award</button>' : '<button class="btn btn-sm btn-primary" style="flex:1" onclick="baAward(' + pkg.id + ',' + b.id + ')">Award</button>') +
            '<button class="btn btn-sm" onclick="baAddBid(' + pkg.id + ',' + b.id + ')">Edit</button>' +
            '<button class="btn btn-sm" onclick="baDeleteBid(' + pkg.id + ',' + b.id + ')">\u2715</button>' +
          '</div></div>';
      }).join('') + '</div>' : '<div style="display:flex;align-items:center;gap:12px;padding:14px 0"><div style="font-size:13px;color:var(--text3)">No bids yet.</div><button class="btn btn-sm btn-primary" onclick="baFindVendors(' + pkg.id + ')">\u2726 Find vendors to bid</button></div>';

    var foot = '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">' +
      '<div style="display:flex;gap:8px"><button class="btn btn-sm" onclick="baAddBid(' + pkg.id + ')">+ Add bid</button>' +
      '<button class="btn btn-sm" onclick="baFindVendors(' + pkg.id + ')">\u2726 Find vendors to bid</button></div>' +
      '<button class="btn btn-sm" onclick="baDeletePkg(' + pkg.id + ')">Remove package</button></div>';
    var rationale = (awarded && pkg.rationale) ? '<div style="margin-top:12px;background:var(--amber-bg);border-radius:var(--radius-sm);padding:10px 13px;font-size:12px;color:var(--text2)"><b style="color:var(--warn)">Rejection rationale:</b> ' + esc(pkg.rationale) + '</div>' : '';

    return '<div class="card" style="margin-bottom:16px">' + head + cols + rationale + foot + '</div>';
  }
  function row(k, val) { return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-top:1px solid var(--border)"><span style="color:var(--text2)">' + k + '</span><span style="font-weight:600">' + val + '</span></div>'; }
  // section label inside the find-vendors modal
  if (!document.getElementById('ba-find-css')) { var _s = document.createElement('style'); _s.id = 'ba-find-css'; _s.textContent = '.ba-find-sec{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);font-weight:700;margin:6px 0 9px}'; (document.head || document.documentElement).appendChild(_s); }
  function kpi(label, value, sub, color) { return '<div class="rp-kpi"><div class="rp-kpi-label">' + label + '</div><div class="rp-kpi-value sm"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div><div class="rp-kpi-sub">' + sub + '</div></div>'; }

  window.renderBidAnalysis = render;
  window.baOpenPkg = baOpenPkg; window.baClosePkg = baClosePkg; window.baSavePkg = baSavePkg; window.baPkgHint = baPkgHint; window.baDeletePkg = baDeletePkg;
  window.baAddBid = baAddBid; window.baCloseBid = baCloseBid; window.baSaveBid = baSaveBid; window.baBidTotal = baBidTotal; window.baDeleteBid = baDeleteBid;
  window.baAward = baAward; window.baUnaward = baUnaward;
  window.baFindVendors = baFindVendors; window.baCloseFind = baCloseFind; window.baRunFind = baRunFind; window.baAddCandidate = baAddCandidate;
})();
