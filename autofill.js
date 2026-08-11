/* ============================================================================
   STEVE — Vendor autocomplete + fill-from-Library  (autofill.js)
   1) Any vendor/manufacturer field suggests names from the Vendor directory
      plus every vendor already used on a project.
   2) Any item-name field suggests products STEVE has seen before; accepting one
      fills the manufacturer (and lead time) on the same row when they're empty.

   Purely additive: attaches by placeholder text via event delegation, so it
   survives the app's constant re-renders and needs no markup changes.
   Reuses host globals: suppliers, budgetTrackers, pas, vendorPOs, specBooks.
   ========================================================================= */
(function () {
  'use strict';

  var VENDOR_PH = ['vendor', 'vendor / manufacturer', 'vendor / description', 'manufacturer'];
  var NAME_PH = ['item name'];
  // Purchase Orders use click-to-edit spans (.vpo-field[data-f]) whose inputs
  // carry no placeholder, so map those field keys directly.
  var VPO_KEYS = { mfrName: 'vendor', srcName: 'vendor', vendorName: 'vendor', itemHeadline: 'name', itemName: 'name' };
  var MIN_VENDOR = 1, MIN_NAME = 2, MAX_ROWS = 8;

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function phOf(el) { return String(el.getAttribute('placeholder') || '').trim().toLowerCase(); }
  function vpoFieldOf(el) {
    var span = el && el.closest ? el.closest('.vpo-field') : null;
    return span ? (span.getAttribute('data-f') || '') : '';
  }
  function kind(el) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return null;
    var p = phOf(el);
    if (VENDOR_PH.indexOf(p) >= 0) return 'vendor';
    if (NAME_PH.indexOf(p) >= 0) return 'name';
    var k = vpoFieldOf(el);
    if (k && VPO_KEYS[k]) return VPO_KEYS[k];
    return null;
  }

  // ── Indexes, rebuilt lazily and invalidated on data change ────────────────
  var _vendors = null, _products = null, _builtAt = 0;

  function eachLineItem(fn) {
    try {
      Object.keys(budgetTrackers || {}).forEach(function (pn) {
        (budgetTrackers[pn].items || []).forEach(function (i) {
          if (!i.isCategory) fn({ name: i.name, vendor: i.vendor, price: i.estPrice, leadTime: i.leadTime });
        });
      });
    } catch (e) {}
    try {
      (pas || []).forEach(function (pa) {
        (pa.items || []).forEach(function (i) {
          if (!i.isCategory) fn({ name: i.name, vendor: i.vendor, price: i.price, leadTime: i.leadTime });
        });
      });
    } catch (e) {}
    try {
      (vendorPOs || []).forEach(function (po) {
        var v = po.mfrName || po.srcName || po.vendor || '';
        if (po.itemHeadline || po.itemName) {
          fn({ name: po.itemHeadline || po.itemName, vendor: v, price: po.unitPrice || po.price, leadTime: po.leadTime });
        }
        if (po.srcName && po.srcName !== po.mfrName) fn({ name: '', vendor: po.srcName });
        (po.items || []).forEach(function (i) {
          fn({ name: i.name || i.description, vendor: v || i.vendor, price: i.price, leadTime: i.leadTime });
        });
      });
    } catch (e) {}
    try {
      (specBooks || []).forEach(function (sb) {
        (sb.items || []).forEach(function (i) {
          fn({ name: i.name, vendor: i.vendor || i.manufacturer, price: i.price, leadTime: i.leadTime });
        });
      });
    } catch (e) {}
  }

  function build() {
    var v = {}, p = {};
    try {
      (typeof suppliers !== 'undefined' ? suppliers : []).forEach(function (s) {
        if (!s || !s.name) return;
        var k = norm(s.name);
        if (!k) return;
        v[k] = v[k] || { label: String(s.name).trim(), count: 0, directory: true };
        v[k].directory = true;
        v[k].lead = v[k].lead || s.lead || '';
      });
    } catch (e) {}

    eachLineItem(function (it) {
      var vn = String(it.vendor || '').trim();
      if (vn) {
        var vk = norm(vn);
        if (vk) {
          v[vk] = v[vk] || { label: vn, count: 0, directory: false };
          v[vk].count++;
        }
      }
      var nm = String(it.name || '').trim();
      if (nm && nm.length > 2) {
        var pk = norm(nm);
        if (!pk) return;
        var rec = p[pk] || (p[pk] = { label: nm, count: 0, vendors: {}, price: 0, leadTime: '' });
        rec.count++;
        if (vn) rec.vendors[vn] = (rec.vendors[vn] || 0) + 1;
        if (!rec.price && it.price) rec.price = it.price;
        if (!rec.leadTime && it.leadTime) rec.leadTime = it.leadTime;
      }
    });

    _vendors = Object.keys(v).map(function (k) { return { key: k, label: v[k].label, count: v[k].count, directory: v[k].directory }; });
    _products = Object.keys(p).map(function (k) {
      var r = p[k];
      var best = '', bn = 0;
      Object.keys(r.vendors).forEach(function (n) { if (r.vendors[n] > bn) { bn = r.vendors[n]; best = n; } });
      return { key: k, label: r.label, count: r.count, vendor: best, price: r.price, leadTime: r.leadTime };
    });
    _builtAt = Date.now();
  }
  function indexes() { if (!_vendors || Date.now() - _builtAt > 30000) build(); return { vendors: _vendors, products: _products }; }

  // ── Scoring ───────────────────────────────────────────────────────────────
  function initials(label) {
    return String(label).split(/[^A-Za-z0-9]+/).filter(Boolean).map(function (w) { return w[0]; }).join('').toLowerCase();
  }
  function score(entry, q) {
    var k = entry.key;
    if (k === q) return 100;
    if (k.indexOf(q) === 0) return 80 - Math.min(20, k.length - q.length);
    if ((' ' + k).indexOf(' ' + q) >= 0) return 60;
    if (k.indexOf(q) >= 0) return 40;
    if (q.length >= 2 && initials(entry.label).indexOf(q.replace(/ /g, '')) === 0) return 55;
    return -1;
  }
  function search(list, raw) {
    var q = norm(raw);
    if (!q) return [];
    return list.map(function (e) { return { e: e, s: score(e, q) }; })
      .filter(function (x) { return x.s >= 0; })
      .sort(function (a, b) { return b.s - a.s || (b.e.count || 0) - (a.e.count || 0) || a.e.label.localeCompare(b.e.label); })
      .slice(0, MAX_ROWS).map(function (x) { return x.e; });
  }

  // ── Row helpers ───────────────────────────────────────────────────────────
  function siblingInput(from, phList) {
    var node = from;
    for (var d = 0; d < 6 && node; d++) {
      node = node.parentElement;
      if (!node) break;
      var found = null;
      node.querySelectorAll('input').forEach(function (i) {
        if (!found && i !== from && phList.indexOf(phOf(i)) >= 0) found = i;
      });
      if (found) return found;
    }
    return null;
  }
  function setValue(input, val) {
    if (!input) return;
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Dropdown ──────────────────────────────────────────────────────────────
  var box = null, target = null, rows = [], sel = -1, mode = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'af-suggest';
    box.style.cssText = 'position:fixed;z-index:9999;min-width:200px;max-width:340px;background:var(--surface,#fff);border:1px solid var(--border2,#ccc);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.14);font-size:12px;overflow:hidden;display:none';
    box.addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.body.appendChild(box);
    return box;
  }
  function hide() { if (box) box.style.display = 'none'; target = null; rows = []; sel = -1; }
  function place() {
    if (!target || !box) return;
    var r = target.getBoundingClientRect();
    box.style.left = Math.round(r.left) + 'px';
    box.style.width = Math.max(200, Math.round(r.width)) + 'px';
    var below = window.innerHeight - r.bottom;
    if (below < 160 && r.top > below) {
      box.style.top = 'auto'; box.style.bottom = Math.round(window.innerHeight - r.top + 2) + 'px';
    } else {
      box.style.bottom = 'auto'; box.style.top = Math.round(r.bottom + 2) + 'px';
    }
  }
  function paint() {
    ensureBox();
    if (!rows.length) { hide(); return; }
    box.innerHTML = rows.map(function (e, i) {
      var meta = mode === 'vendor'
        ? (e.directory ? 'directory' : e.count + ' use' + (e.count === 1 ? '' : 's'))
        : [e.vendor || '', e.count + '\u00d7'].filter(Boolean).join(' \u00b7 ');
      return '<div data-i="' + i + '" style="padding:5px 9px;cursor:pointer;display:flex;gap:8px;align-items:baseline;' +
        (i === sel ? 'background:var(--accent-bg,#eef);' : '') + '">' +
        '<span style="flex:1;color:var(--text,#222);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        e.label.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</span>' +
        '<span style="color:var(--text3,#999);font-size:10.5px;white-space:nowrap">' + meta + '</span></div>';
    }).join('');
    box.style.display = 'block';
    place();
  }
  // ── Purchase Order: pull the rest of a vendor's details ───────────────────
  // Sources, in order: the Vendor directory record, anything parseable out of
  // its notes (contact / website / extra email), then the most recent PO issued
  // to the same manufacturer. Only ever fills fields that are currently blank.
  var PO_CARRY = ['mfrTel', 'mfrEmail', 'mfrWeb', 'srcName', 'srcWeb', 'mfrContact', 'mfrContactTel', 'mfrContactEmail', 'delivery', 'terms', 'shipVia'];

  function poVendorDetails(name) {
    var out = {};
    var s = null;
    try { if (typeof vpoFindVendorMatch === 'function') s = vpoFindVendorMatch(name); } catch (e) {}
    if (s) {
      if (s.phone) out.mfrTel = String(s.phone).trim();
      if (s.email) out.mfrEmail = String(s.email).trim();
      if (s.website) out.mfrWeb = String(s.website).trim();
      if (s.contact) out.mfrContact = String(s.contact).trim();
      if (s.contactEmail) out.mfrContactEmail = String(s.contactEmail).trim();
      if (s.contactPhone) out.mfrContactTel = String(s.contactPhone).trim();
      if (s.lead) out.delivery = s.lead + (String(s.lead) === '1' ? ' week' : ' weeks') + ' lead time';
      var notes = String(s.notes || '');
      var c = notes.match(/contact:\s*([^\u00b7\n]+)/i);
      if (c) out.mfrContact = c[1].trim();
      var w = notes.match(/(?:web|website|url)\s*:\s*(\S+)/i) || notes.match(/https?:\/\/\S+/i);
      if (w) out.mfrWeb = (w[1] || w[0]).replace(/[.,;\u00b7]+$/, '');
      var em = notes.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (em && !out.mfrEmail) out.mfrEmail = em[0];
      var tel = notes.match(/(?:tel|phone)\s*:\s*([+\d][\d\s().-]{6,})/i);
      if (tel && !out.mfrTel) out.mfrTel = tel[1].trim();
    }
    var prev = null;
    try {
      (vendorPOs || []).forEach(function (po) {
        if (norm(po.mfrName || '') === norm(name)) prev = po;
      });
    } catch (e) {}
    if (prev) PO_CARRY.forEach(function (k) { if (!out[k] && prev[k]) out[k] = prev[k]; });
    return out;
  }

  function applyPoVendor(name) {
    if (typeof vpoForm === 'undefined' || !vpoForm) return;
    var d = poVendorDetails(name), filled = [];
    Object.keys(d).forEach(function (k) {
      if (d[k] && !String(vpoForm[k] || '').trim()) { vpoForm[k] = d[k]; filled.push(k); }
    });
    if (filled.length) {
      try { if (typeof pushUndo === 'function') pushUndo('Fill vendor details'); } catch (e) {}
      try {
        if (typeof ai3Toast === 'function') ai3Toast('Filled ' + filled.length + ' field' + (filled.length === 1 ? '' : 's') + ' from your vendor records', 3000);
      } catch (e) {}
    }
  }

  function accept(i) {
    var e = rows[i]; if (!e || !target) return;
    var input = target;
    var vpoKey = vpoFieldOf(input);
    if (vpoKey) {
      // Purchase Order: commit through the document's own blur handler, and put
      // the manufacturer straight on the form when that field is still empty.
      if (mode === 'name' && e.vendor && typeof vpoForm !== 'undefined' && vpoForm && !String(vpoForm.mfrName || '').trim()) {
        vpoForm.mfrName = e.vendor;
        applyPoVendor(e.vendor);
      }
      if (mode === 'vendor' && vpoKey === 'mfrName') applyPoVendor(e.label);
      input.value = e.label;
      hide();
      input.blur();
      return;
    }
    if (mode === 'vendor') {
      setValue(input, e.label);
    } else {
      setValue(input, e.label);
      var vf = siblingInput(input, VENDOR_PH);
      if (vf && !String(vf.value || '').trim() && e.vendor) setValue(vf, e.vendor);
      var lf = siblingInput(input, ['lead time']);
      if (lf && !String(lf.value || '').trim() && e.leadTime) setValue(lf, e.leadTime);
    }
    hide();
  }
  function refresh(input) {
    var k = kind(input); if (!k) { hide(); return; }
    var q = input.value || '';
    if (k === 'vendor' && q.trim().length < MIN_VENDOR) { hide(); return; }
    if (k === 'name' && q.trim().length < MIN_NAME) { hide(); return; }
    var ix = indexes();
    mode = k; target = input;
    rows = search(k === 'vendor' ? ix.vendors : ix.products, q);
    if (rows.length === 1 && norm(rows[0].label) === norm(q)) rows = [];
    sel = -1;
    paint();
  }

  document.addEventListener('input', function (e) { if (kind(e.target)) refresh(e.target); }, true);
  document.addEventListener('focusin', function (e) { if (!kind(e.target)) hide(); }, true);
  document.addEventListener('focusout', function (e) { if (e.target === target) setTimeout(function () { if (document.activeElement !== target) hide(); }, 120); }, true);
  document.addEventListener('keydown', function (e) {
    if (!target || e.target !== target || !rows.length) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % rows.length; paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel <= 0 ? rows.length : sel) - 1; paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (sel >= 0) { accept(sel); e.preventDefault(); } }
    else if (e.key === 'Escape') { hide(); }
  }, true);
  document.addEventListener('click', function (e) {
    if (!box || box.style.display === 'none') return;
    var row = e.target.closest && e.target.closest('#af-suggest [data-i]');
    if (row) { accept(parseInt(row.getAttribute('data-i'), 10)); e.preventDefault(); }
    else if (!box.contains(e.target)) hide();
  }, true);
  window.addEventListener('scroll', function () { if (target) place(); }, true);
  window.addEventListener('resize', function () { if (target) place(); });

  window.afRebuildIndex = build;
  window.afPoVendorDetails = poVendorDetails;
})();
