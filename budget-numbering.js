/* ============================================================================
   STEVE — Budget item numbering & order  (budget-numbering.js)

   The firm numbers FF&E by category band:

     100s Seating · 200s Tables · 300s Lighting · 400s Drapery · 500s Rugs
     600s Miscellaneous · 700s Mirrors · 800s Art · 900s Accessories

   Item numbers carry a category prefix and, for related lines, a suffix:
   `C-101 Dining Chair` then `C-101A Upholstery for Above`; `D-401 Drapery
   Fabrication`, `D-401F Drapery Fabric`, `D-401H Drapery Hardware`. A plain
   string sort gets this wrong (it puts 1000 before 200, and can separate a
   suffix line from its parent), so numbers are parsed into
   prefix · number · suffix and compared piecewise. A suffixed line always
   follows its bare parent, and never leaves it.

   Applies to the Preliminary Budget: categories order by band, lines order by
   number inside their category, and the sheet re-sorts as soon as a number is
   entered or changed. Also fills the next free number in the band when a line
   is added, and offers the project's existing locations as a dropdown.
   ========================================================================= */
(function () {
  'use strict';

  // Band order is the contract; the patterns just recognise however a category
  // happens to be worded (STEVE ships "Window Treatments", the firm says
  // "Drapery", imports say "Soft Goods"). Art is tested before Accessories so
  // "Art & Accessories" lands in the 800s.
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
  var INSTALL_BAND = 95;   // installation sits after the numbered categories
  var UNKNOWN_BAND = 90;

  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function lines() { return (typeof pbLineItems !== 'undefined' && Array.isArray(pbLineItems)) ? pbLineItems : []; }

  // ── Parsing ───────────────────────────────────────────────────────────────
  // "C-101A" → {prefix:'C', num:101, suffix:'A'};  "101" → {prefix:'', num:101}
  function parseNum(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var m = s.match(/^([A-Za-z]*)[\s._-]*(\d+)\s*([A-Za-z]*)$/);
    if (!m) return null;
    return { prefix: m[1] || '', num: parseInt(m[2], 10), suffix: (m[3] || '').toUpperCase() };
  }
  function bandOfCategory(name) {
    var s = String(name || '');
    if (typeof isInstallCat === 'function' && isInstallCat(s)) return INSTALL_BAND;
    if (/install/i.test(s)) return INSTALL_BAND;
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i].re.test(s)) return BANDS[i].n;
    return UNKNOWN_BAND;
  }

  // Compare two item numbers: number first, then suffix — so 101 precedes 101A,
  // and 401F precedes 401H. Unnumbered lines sort last, keeping their order.
  function cmpItems(a, b) {
    var pa = parseNum(a.itemNum), pb = parseNum(b.itemNum);
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    if (pa.num !== pb.num) return pa.num - pb.num;
    if (pa.suffix !== pb.suffix) return pa.suffix < pb.suffix ? -1 : 1;
    return 0;
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  // Categories by band; lines by number within their own category. A line is
  // never moved between categories — the category is the user's call, the order
  // is ours.
  function groups() {
    var out = [], cur = null;
    lines().forEach(function (it) {
      if (it.isCategory) { cur = { head: it, items: [] }; out.push(cur); }
      else if (cur) cur.items.push(it);
      else { cur = { head: null, items: [it] }; out.push(cur); }   // orphans above the first header
    });
    return out;
  }

  function sortBudget(opts) {
    opts = opts || {};
    var gs = groups();
    if (!gs.length) return false;
    var before = lines().map(function (i) { return i.id; }).join('|');

    gs.forEach(function (g) {
      var stable = g.items.map(function (it, i) { return { it: it, i: i }; });
      stable.sort(function (x, y) { return cmpItems(x.it, y.it) || x.i - y.i; });
      g.items = stable.map(function (x) { return x.it; });
    });

    // Only reorder the categories themselves when every one of them is
    // recognisable; a single unmatched header would otherwise be flung to the
    // end of someone's carefully arranged budget.
    var headed = gs.filter(function (g) { return g.head; });
    var allKnown = headed.length && headed.every(function (g) { return bandOfCategory(g.head.name) !== UNKNOWN_BAND; });
    if (allKnown) {
      var keyed = gs.map(function (g, i) { return { g: g, i: i, b: g.head ? bandOfCategory(g.head.name) : -1 }; });
      keyed.sort(function (x, y) { return x.b - y.b || x.i - y.i; });
      gs = keyed.map(function (x) { return x.g; });
    }

    var flat = [];
    gs.forEach(function (g) { if (g.head) flat.push(g.head); g.items.forEach(function (it) { flat.push(it); }); });
    if (flat.map(function (i) { return i.id; }).join('|') === before) return false;

    pbLineItems.length = 0;
    flat.forEach(function (it) { pbLineItems.push(it); });
    if (!opts.quiet) persist('Sort by item number');
    return true;
  }

  function persist(label) {
    try { if (typeof pushUndo === 'function') pushUndo(label); } catch (e) {}
    try {
      if (typeof currentPBId !== 'undefined' && currentPBId) {
        var rec = (prelimBudgets || []).find(function (p) { return p.id === currentPBId; });
        if (rec) rec.items = JSON.parse(JSON.stringify(pbLineItems));
        DB.save('fp11_pb', prelimBudgets);
      }
    } catch (e) {}
  }
  function redraw() {
    if (typeof pbRenderCategoriesForm === 'function') { try { pbRenderCategoriesForm(); } catch (e) {} }
    if (typeof recalcPB === 'function') { try { recalcPB(); } catch (e) {} }
  }

  // ── Next free number in a band ────────────────────────────────────────────
  // The prefix is inherited from whatever the category already uses, so the
  // firm's own lettering is preserved rather than invented.
  function catInfo(catIdx) {
    var gs = groups();
    var g = gs[catIdx] || gs[gs.length - 1];
    if (!g) return null;
    var band = g.head ? bandOfCategory(g.head.name) : UNKNOWN_BAND;
    var prefix = '', best = 0;
    g.items.forEach(function (it) {
      var p = parseNum(it.itemNum);
      if (p && p.prefix && !prefix) prefix = p.prefix;
      if (p && !p.suffix && p.num > best) best = p.num;
    });
    return { group: g, band: band, prefix: prefix, highest: best };
  }
  function nextNumber(catIdx) {
    var ci = catInfo(catIdx);
    if (!ci || ci.band > 9) return '';
    var base = ci.band * 100;
    var used = {};
    lines().forEach(function (it) {
      var p = parseNum(it.itemNum);
      if (p && !p.suffix) used[p.num] = 1;
    });
    var n = ci.highest >= base && ci.highest < base + 100 ? ci.highest + 1 : base + 1;
    while (used[n] && n < base + 100) n++;
    return (ci.prefix ? ci.prefix + '-' : '') + n;
  }

  // ── Renumber a whole budget onto the bands ────────────────────────────────
  // Suffix lines follow their parent, so C-101 → C-105 takes C-101A → C-105A.
  function renumber() {
    var gs = groups(), changed = 0;
    gs.forEach(function (g) {
      if (!g.head) return;
      var band = bandOfCategory(g.head.name);
      if (band > 9) return;                       // installation / unrecognised: leave alone
      var prefix = '';
      g.items.forEach(function (it) { var p = parseNum(it.itemNum); if (p && p.prefix && !prefix) prefix = p.prefix; });
      var next = band * 100 + 1, map = {};
      g.items.forEach(function (it) {
        var p = parseNum(it.itemNum);
        if (p && p.suffix) return;                // handled with its parent below
        var want = (prefix ? prefix + '-' : '') + next;
        if (p) map[p.num] = next;
        if (it.itemNum !== want) { it.itemNum = want; changed++; }
        next++;
      });
      g.items.forEach(function (it) {
        var p = parseNum(it.itemNum);
        if (!p || !p.suffix) return;
        var to = map[p.num];
        if (!to) return;
        var want = (prefix ? prefix + '-' : '') + to + p.suffix;
        if (it.itemNum !== want) { it.itemNum = want; changed++; }
      });
    });
    if (!changed) { sortBudget(); redraw(); toast('Already numbered by category'); return; }
    persist('Renumber by category');
    sortBudget({ quiet: true });
    redraw();
    toast('\u2713 Renumbered ' + changed + ' line' + (changed === 1 ? '' : 's') + ' onto their category bands', 4200);
  }

  function sortNow() {
    if (sortBudget()) { redraw(); toast('\u2713 Sorted by item number', 2600); }
    else toast('Already in order');
  }

  // ── Locations already used on this project ───────────────────────────────
  function locations() {
    var seen = {}, out = [];
    function add(v) {
      var s = String(v == null ? '' : v).trim();
      if (!s) return;
      var k = s.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(s); }
    }
    lines().forEach(function (it) { add(it.location); });
    var el = document.getElementById('pb-project');
    var pn = el && el.value;
    if (pn) {
      try {
        (prelimBudgets || []).forEach(function (p) {
          if (p.project === pn) (p.items || []).forEach(function (it) { add(it.location); });
        });
      } catch (e) {}
      try {
        var bt = (typeof budgetTrackers !== 'undefined') ? budgetTrackers[pn] : null;
        if (bt) (bt.items || []).forEach(function (it) { add(it.location || it.area); });
      } catch (e) {}
      try {
        (pas || []).forEach(function (p) {
          if (p.project === pn) (p.items || []).forEach(function (it) { add(it.location); });
        });
      } catch (e) {}
      try {
        var sb = (typeof specBooks !== 'undefined') ? specBooks[pn] : null;
        if (sb) (sb.areas || []).forEach(function (a) { add(a && (a.name || a)); });
      } catch (e) {}
    }
    return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  var pendingSort = false, hooked = false;

  function hook() {
    if (hooked) return;
    if (typeof window.recalcPB !== 'function' || typeof window._docSet !== 'function') return;

    // An item number edited on the sheet (or in the side panel) schedules a sort;
    // recalcPB then performs it, so the row lands in place as you leave the field.
    var origSet = window._docSet;
    window._docSet = function (store, idx, field, val) {
      var r = origSet.apply(this, arguments);
      if (store === 'pb' && field === 'itemNum') pendingSort = true;
      return r;
    };

    if (typeof window.pbUpdateItem === 'function') {
      var origUpd = window.pbUpdateItem;
      window.pbUpdateItem = function (ci, ii, field, value) {
        var r = origUpd.apply(this, arguments);
        if (field === 'itemNum') { pendingSort = true; if (typeof recalcPB === 'function') recalcPB(); }
        return r;
      };
    }

    var origRecalc = window.recalcPB;
    window.recalcPB = function () {
      if (pendingSort) {
        pendingSort = false;
        if (sortBudget({ quiet: true })) {
          persist('Sort by item number');
          var r0 = origRecalc.apply(this, arguments);
          if (typeof pbRenderCategoriesForm === 'function') { try { pbRenderCategoriesForm(); } catch (e) {} }
          return r0;
        }
      }
      return origRecalc.apply(this, arguments);
    };

    // A new line arrives pre-numbered with the next free number in its band.
    if (typeof window.pbAddByIdx === 'function') {
      var origAdd = window.pbAddByIdx;
      window.pbAddByIdx = function (catIdx) {
        var r = origAdd.apply(this, arguments);
        try { stampNewest(catIdx); } catch (e) {}
        return r;
      };
    }
    if (typeof window.pbAddItemToCategory === 'function') {
      var origAdd2 = window.pbAddItemToCategory;
      window.pbAddItemToCategory = function (catIdx) {
        var r = origAdd2.apply(this, arguments);
        try { stampNewest(catIdx); } catch (e) {}
        return r;
      };
    }
    hooked = true;
  }

  // The freshly added row is the one blank line in that category.
  function stampNewest(catIdx) {
    var gs = groups();
    var idx = catIdx;
    if (idx == null || idx < 0 || !gs[idx]) {
      // pbAddByIdx takes an absolute index into pbLineItems for the header
      idx = gs.findIndex(function (g) { return g.items.some(function (it) { return !it.itemNum && !it.name; }); });
    }
    var g = gs[idx];
    if (!g) return;
    var blank = g.items.filter(function (it) { return !String(it.itemNum || '').trim() && !String(it.name || '').trim(); });
    if (blank.length !== 1) return;
    var n = nextNumber(idx);
    if (!n) return;
    blank[0].itemNum = n;
    redraw();
  }

  window.pbSortNow = sortNow;
  window.pbRenumber = renumber;
  window.pbLocations = locations;
  window.pbNextNumber = nextNumber;

  function boot() {
    hook();
    var n = 0;
    var iv = setInterval(function () { hook(); if (hooked || ++n > 40) clearInterval(iv); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
