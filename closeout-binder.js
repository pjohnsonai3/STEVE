/* ============================================================================
   STEVE — Owner Close-Out Binder  (closeout-binder.js)
   Project-scoped Owner handover package: warranties, guarantees, maintenance
   instructions and flameproof certificates collected per vendor, tracked to
   completion and compiled into one binder at project close-out.
   Stores to DB key 'fp11_closeout' (flat array of checklist records, cloud-
   synced via SB_STATE). Vendors are derived from the project's POs / tracker.
   Reuses budgetTrackers, vendorPOs, activeProject, escHtml, ai3Toast,
   logActivity, genId, pushUndo, printPreview, ensureBudgetTracker, DB.
   ============================================================================ */
(function () {
  'use strict';

  var DOCS = ['Warranty certificate', 'Guarantee', 'Maintenance instructions', 'Flameproof certificate'];

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }

  // Record shape: { id, project, vendor, doc, collected:bool, requested:date, note }
  function load() { try { var x = (typeof closeoutDocs !== 'undefined') ? closeoutDocs : DB.load('fp11_closeout', []); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  function persist(arr) {
    var copy = arr.slice();
    try { if (typeof closeoutDocs !== 'undefined') { closeoutDocs.length = 0; copy.forEach(function (r) { closeoutDocs.push(r); }); } } catch (e) {}
    try { DB.save('fp11_closeout', (typeof closeoutDocs !== 'undefined') ? closeoutDocs : copy); } catch (e) {}
  }
  function projRecs(name) { return load().filter(function (r) { return r.project === name; }); }

  // Vendors that actually owe documents: those on POs, else tracker line vendors.
  function projVendors(name) {
    var set = {};
    (typeof vendorPOs !== 'undefined' ? vendorPOs : []).forEach(function (p) { if (p.project === name && p.supplier) set[p.supplier] = (set[p.supplier] || { vendor: p.supplier, po: p.poNum || p.id }); });
    if (!Object.keys(set).length) {
      var bt = budgetTrackers[name];
      if (bt) bt.items.filter(function (i) { return !i.isCategory && i.vendor; }).forEach(function (i) { set[i.vendor] = set[i.vendor] || { vendor: i.vendor, po: '' }; });
    }
    return Object.keys(set).map(function (k) { return set[k]; }).sort(function (a, b) { return a.vendor.localeCompare(b.vendor); });
  }

  function recFor(name, vendor, doc) { return load().find(function (r) { return r.project === name && r.vendor === vendor && r.doc === doc; }) || null; }

  function toggle(name, vendor, doc) {
    var arr = load(); var rec = arr.find(function (r) { return r.project === name && r.vendor === vendor && r.doc === doc; });
    if (typeof pushUndo === 'function') pushUndo('Close-out doc');
    if (rec) { rec.collected = !rec.collected; rec.requested = rec.collected ? '' : rec.requested; }
    else { rec = { id: (typeof genId === 'function' ? genId() : Date.now()), project: name, vendor: vendor, doc: doc, collected: true, requested: '', note: '' }; arr.push(rec); }
    persist(arr); render();
  }
  function request(name, vendor, doc) {
    var arr = load(); var rec = arr.find(function (r) { return r.project === name && r.vendor === vendor && r.doc === doc; });
    if (typeof pushUndo === 'function') pushUndo('Request doc');
    var today = new Date().toISOString().slice(0, 10);
    if (rec) { rec.requested = today; rec.collected = false; }
    else { rec = { id: (typeof genId === 'function' ? genId() : Date.now()), project: name, vendor: vendor, doc: doc, collected: false, requested: today, note: '' }; arr.push(rec); }
    persist(arr);
    if (typeof logActivity === 'function') logActivity('Requested ' + doc + ' from ' + vendor);
    toast('Marked requested from ' + vendor); render();
  }

  function naToggle(name, vendor, doc) {
    var arr = load(); var rec = arr.find(function (r) { return r.project === name && r.vendor === vendor && r.doc === doc; });
    if (typeof pushUndo === 'function') pushUndo('Toggle N/A');
    if (rec) { rec.na = !rec.na; if (rec.na) { rec.collected = false; rec.requested = ''; } }
    else { rec = { id: (typeof genId === 'function' ? genId() : Date.now()), project: name, vendor: vendor, doc: doc, collected: false, requested: '', na: true, note: '' }; arr.push(rec); }
    persist(arr); render();
  }

  function render() {
    var host = document.getElementById('page-closeout-binder'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty">Open a project to assemble its close-out binder.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}
    var name = proj.name;
    var vendors = projVendors(name);

    var required = 0, collected = 0;
    vendors.forEach(function (vd) { DOCS.forEach(function (doc) { var r = recFor(name, vd.vendor, doc); if (r && r.na) return; required++; if (r && r.collected) collected++; }); });
    var pct = required ? Math.round(collected / required * 100) : 0;

    var bar = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(name) + '</div>' +
      '<div class="rp-period">Owner handover package</div></div>' +
      '<div class="rp-toolbar-right"><button class="btn btn-primary" onclick="cbCompile()">\u2913 Compile binder</button></div></div>';

    var summary = '<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div class="section-title" style="font-size:15px">Close-out document collection</div>' +
      '<div style="font-size:12.5px;color:var(--text2)"><b style="color:var(--text)">' + collected + ' of ' + required + '</b> collected</div></div>' +
      '<div style="background:var(--surface2);border-radius:20px;height:8px;overflow:hidden"><div style="height:100%;border-radius:20px;background:var(--green);width:' + pct + '%"></div></div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.5">Required per vendor: warranty, guarantee, maintenance instructions, and flameproof certificate (mark N/A where it doesn\u2019t apply). Outstanding items can be requested with the final balance invoice.</div></div>';

    var body = vendors.length ? vendors.map(function (vd) { return vendorCard(name, vd); }).join('') :
      '<div class="card"><div class="rp-empty">No vendors found for this project yet \u2014 issue POs or add vendors to tracker lines, and they\u2019ll appear here for document collection.</div></div>';

    host.innerHTML = bar + summary + body;
  }

  function vendorCard(name, vd) {
    var rows = DOCS.map(function (doc) {
      var r = recFor(name, vd.vendor, doc);
      var na = r && r.na, done = r && r.collected;
      var box = na ? '<div style="width:18px;height:18px;border-radius:4px;border:1.5px dashed var(--border2);flex-shrink:0"></div>' :
        '<div onclick="cbToggle(\'' + js(name) + '\',\'' + js(vd.vendor) + '\',\'' + js(doc) + '\')" style="width:18px;height:18px;border-radius:4px;border:1.5px solid ' + (done ? 'var(--green)' : 'var(--border2)') + ';background:' + (done ? 'var(--green)' : 'transparent') + ';flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;cursor:pointer">' + (done ? '\u2713' : '') + '</div>';
      var sub = na ? '<small style="color:var(--text3)">Not applicable</small>' :
        (done ? '' : (r && r.requested ? '<small style="color:var(--red)">Requested ' + fmtMD(r.requested) + ' \u2014 awaiting vendor</small>' : ''));
      var actions = na ? '<button class="btn btn-sm" onclick="cbNA(\'' + js(name) + '\',\'' + js(vd.vendor) + '\',\'' + js(doc) + '\')">Mark applicable</button>' :
        (done ? '' : '<button class="btn btn-sm" onclick="cbRequest(\'' + js(name) + '\',\'' + js(vd.vendor) + '\',\'' + js(doc) + '\')">Request</button><button class="btn btn-sm" onclick="cbNA(\'' + js(name) + '\',\'' + js(vd.vendor) + '\',\'' + js(doc) + '\')">N/A</button>');
      return '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--border)">' + box +
        '<div style="flex:1;font-size:13.5px;' + (na ? 'color:var(--text3)' : '') + '">' + esc(doc) + (sub ? '<div>' + sub + '</div>' : '') + '</div>' +
        '<div style="display:flex;gap:6px">' + actions + '</div></div>';
    }).join('');

    var vendorDone = DOCS.every(function (doc) { var r = recFor(name, vd.vendor, doc); return (r && r.na) || (r && r.collected); });
    var outstanding = DOCS.filter(function (doc) { var r = recFor(name, vd.vendor, doc); return !((r && r.na) || (r && r.collected)); }).length;
    var badge = vendorDone ? '<span class="badge badge-green">Complete</span>' : '<span class="badge badge-amber">' + outstanding + ' outstanding</span>';

    return '<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
      '<div class="section-title" style="font-size:14.5px">' + esc(vd.vendor) + (vd.po ? ' \u00b7 PO ' + esc(vd.po) : '') + '</div>' + badge + '</div>' + rows + '</div>';
  }

  function js(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function fmtMD(s) { var p = String(s).split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : s; }

  function cbCompile() {
    var proj = activeProject; if (!proj) return;
    var name = proj.name; var vendors = projVendors(name);
    var dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var sec = function (vd) {
      var items = DOCS.map(function (doc) {
        var r = recFor(name, vd.vendor, doc);
        if (r && r.na) return '';
        var status = (r && r.collected) ? '<span style="color:#1F8A5B;font-weight:600">\u2713 Collected</span>' : '<span style="color:#AE1A1D">Outstanding</span>';
        return '<tr><td style="padding:6px 10px;border-bottom:1px solid #EEF1F3;font-size:12.5px">' + esc(doc) + '</td><td style="padding:6px 10px;border-bottom:1px solid #EEF1F3;text-align:right;font-size:12.5px">' + status + '</td></tr>';
      }).join('');
      return '<div style="margin-top:18px"><div style="font-weight:700;font-size:13.5px;color:#4A6E7E;border-bottom:1px solid #E4E8EB;padding-bottom:5px;margin-bottom:4px">' + esc(vd.vendor) + (vd.po ? ' \u00b7 PO ' + esc(vd.po) : '') + '</div>' +
        '<table style="width:100%;border-collapse:collapse">' + items + '</table></div>';
    };
    var html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:760px;margin:0 auto;color:#1A1A1A">' +
      '<div style="display:flex;justify-content:space-between;border-bottom:2px solid #1A1A1A;padding-bottom:14px">' +
        '<div><div style="font-weight:800;font-size:19px">ai3, Inc.</div><div style="font-size:10px;letter-spacing:.14em;color:#93A1A8;font-weight:600">FF&amp;E PURCHASING AGENT</div></div>' +
        '<div style="text-align:right"><div style="font-size:17px;font-weight:700">Owner Close-Out Binder</div><div style="font-size:12px;color:#5C6B72">' + esc(name) + ' &middot; ' + dateStr + '</div></div></div>' +
      '<div style="font-size:12.5px;color:#5C6B72;margin-top:14px">Warranties, guarantees, maintenance instructions and flameproof certificates collected per vendor for Owner handover.</div>' +
      vendors.map(sec).join('') + '</div>';
    var wrap = document.createElement('div'); wrap.id = 'cb-print'; wrap.style.cssText = 'position:absolute;left:-9999px'; wrap.innerHTML = html;
    document.body.appendChild(wrap);
    if (typeof printPreview === 'function') printPreview('cb-print', 'Close-Out Binder \u2014 ' + name, '@page{margin:0.6in 0.7in}', 'Close-Out Binder \u2014 ' + name);
    setTimeout(function () { wrap.remove(); }, 1000);
  }

  window.renderCloseoutBinder = render;
  window.cbToggle = toggle; window.cbRequest = request; window.cbNA = naToggle; window.cbCompile = cbCompile;
})();
