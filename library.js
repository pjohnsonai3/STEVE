/* ============================================================================
   STEVE — Library (robust)
   A catalog of every product across POs + spec books, with:
     • De-duplication (identical products merged; occurrences tracked)
     • Combined filters: search · group-by · source · vendor · project ·
       price range · has-image · favorites · tag · sort
     • Favorites, tags & a custom image per product (persisted in libMeta,
       keyed by a stable fingerprint)
     • Multi-select + bulk actions: favorite, tag, export CSV, send to Sourcing
     • Item detail / quick-look modal: gallery, specs, every occurrence,
       drag-drop image, research links, send to a project's Sourcing shortlist
   Reuses host globals: _libCollect, escHtml, sbHydrateImages, sbUploadImage,
   viewPO, ai3Toast, DB, projects, libMeta, librarySaved, vpoDownscaleImage.
   ============================================================================ */
(function () {
  'use strict';

  /* ---- granular type classifier (unchanged) ---- */
  var DEFS = [
    { n: 'Textiles & COM', i: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 13c4 0 4-4 8-4s4 4 8 4"/>',
      kw: ['fabric', 'upholstery', 'welt', 'yds', 'yardage', ' yard', 'sqft', 'sq ft', 'boucle', 'mohair', 'webbing', 'tassel', 'leather for', 'vinyl for', 'c.o.m', 'com fabric'], cat: [] },
    { n: 'Sofas & Sectionals', i: '<path d="M4 13a2 2 0 0 1 4 0v1h8v-1a2 2 0 0 1 4 0v5H4z"/><path d="M6 13V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5"/><path d="M7 18v2M17 18v2"/>',
      kw: ['sofa', 'sectional', 'settee', 'loveseat', 'couch'], cat: [] },
    { n: 'Barstools & Counter Stools', i: '<path d="M8 4h8l-1 6H9z"/><path d="M12 10v6"/><path d="M9 20l1-4M15 20l-1-4"/>',
      kw: ['barstool', 'bar stool', 'counter stool', 'counterstool', 'stool'], cat: [] },
    { n: 'Benches & Banquettes', i: '<rect x="3" y="10" width="18" height="4.5" rx="1"/><path d="M5 14.5v5M19 14.5v5"/>',
      kw: ['bench', 'banquette', 'booth', 'ottoman', 'pouf'], cat: [] },
    { n: 'Lounge & Accent Chairs', i: '<path d="M7 11V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4"/><path d="M6 11h12v5H6z"/><path d="M7 16v4M17 16v4"/>',
      kw: ['lounge chair', 'accent chair', 'swivel', 'armchair', 'arm chair', 'club chair', 'wing chair', 'lounge', 'recliner', 'easy chair'], cat: [] },
    { n: 'Side & Dining Chairs', i: '<path d="M8 3v9M16 3l-1 9M8 12h7"/><path d="M8 12l-1 8M15 12l1 8"/>',
      kw: ['side chair', 'dining chair', 'guest chair', 'task chair', 'desk chair', 'stacking', 'chair'], cat: ['Seating'] },
    { n: 'Tables & Desks', i: '<rect x="3" y="7" width="18" height="2.6" rx="1"/><path d="M5 9.6V19M19 9.6V19"/>',
      kw: ['table', 'desk'], cat: [] },
    { n: 'Casegoods & Storage', i: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M8 8h1M15 8h1"/>',
      kw: ['credenza', 'casegood', 'case good', 'cabinet', 'bookcase', 'shelving', 'shelf', 'dresser', 'nightstand', 'sideboard', 'storage', 'hutch', 'console', 'millwork'], cat: ['Tables, Casegoods'] },
    { n: 'Lighting', i: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10c.7.6 1 1.2 1 2h6c0-.8.3-1.4 1-2a6 6 0 0 0-4-10z"/>',
      kw: ['lamp', 'sconce', 'pendant', 'chandelier', 'luminaire', 'lighting', ' light', 'fixture'], cat: ['Decorative Lighting'] },
    { n: 'Rugs & Flooring', i: '<rect x="5" y="6" width="14" height="12" rx="1"/><path d="M5 6 3 4M19 6l2-2M5 18l-2 2M19 18l2 2"/>',
      kw: ['rug', 'carpet', 'runner', 'flooring', 'floor covering'], cat: ['Floor Covering'] },
    { n: 'Drapery & Window', i: '<path d="M4 3h16M6 3c0 7-1 12 1 18M18 3c0 7 1 11-1 18M12 3v18"/>',
      kw: ['drapery', 'drape', 'curtain', 'roman shade', 'shade', 'blind', 'window treatment', 'sheer'], cat: ['Drapery'] },
    { n: 'Art & Decor', i: '<rect x="4" y="4" width="16" height="16" rx="1"/><circle cx="9" cy="9" r="1.5"/><path d="M5 17l4-3 3 2 3-3 4 4"/>',
      kw: ['artwork', 'wall art', 'giclee', 'painting', 'sculpture', 'photograph', 'framed print', ' print'], cat: ['Art'] },
    { n: 'Mirrors & Glass', i: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M10 6.5a2.5 2.5 0 0 0-1.6 2.3"/>',
      kw: ['mirror'], cat: ['Mirrors & Glass', 'Mirrors'] },
    { n: 'Accessories', i: '<path d="M9 4h6M10 4c0 2-2 2-2 5 0 2 1 3 1 5s-1 3-1 4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2c0-1-1-2-1-4s1-3 1-5c0-3-2-3-2-5"/>',
      kw: ['accessory', 'accessories', 'vase', 'tray', 'pillow', 'throw', 'planter', 'bookend', 'decorative object', 'bowl', 'candle', 'objet'], cat: ['Accessories'] },
    { n: 'Wallcovering', i: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M4 14h16M9 4v16M15 4v16"/>',
      kw: ['wallcovering', 'wall covering', 'wallpaper'], cat: ['Wallcovering'] },
    { n: 'Installation & Freight', i: '<path d="M14 7l3-3 3 3-3 3-2-2-7 7 1 1-3 3-3-3 3-3 1 1 7-7z"/>',
      kw: ['installation', 'install', 'freight', 'labor', 'delivery', 'receiving', 'warehousing', 'assembly'], cat: ['Installation'] }
  ];
  var OTHER = { n: 'Other', i: '<circle cx="12" cy="12" r="8"/><path d="M9.5 10a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16h.01"/>' };
  var ORDER = DEFS.map(function (d) { return d.n; }).concat([OTHER.n]);
  function defOf(name) { for (var i = 0; i < DEFS.length; i++) if (DEFS[i].n === name) return DEFS[i]; return OTHER; }
  function typeOf(it) {
    var hay = ((it.name || '') + ' ' + (it.code || '')).toLowerCase();
    for (var i = 0; i < DEFS.length; i++) { var d = DEFS[i]; for (var k = 0; k < d.kw.length; k++) if (hay.indexOf(d.kw[k]) !== -1) return d.n; }
    var cat = it.category || '';
    for (var j = 0; j < DEFS.length; j++) if (DEFS[j].cat.indexOf(cat) !== -1) return DEFS[j].n;
    return OTHER.n;
  }

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(v) { return '$' + (parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function fp(name, mfr) { return (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + String(mfr || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()); }
  function meta(f) { if (typeof libMeta === 'undefined') return {}; return libMeta[f] || {}; }
  function saveMeta() { if (typeof DB !== 'undefined') DB.save('fp11_libmeta', libMeta); }
  function saveShortlist() { if (typeof DB !== 'undefined') DB.save('fp11_libsaved', librarySaved); }

  /* ---- collect + dedupe into products ---- */
  function products() {
    var raw = (typeof _libCollect === 'function') ? _libCollect() : [];
    var byFp = {}, order = [];
    raw.forEach(function (it) {
      var f = fp(it.name, it.mfr);
      var p = byFp[f];
      if (!p) { p = byFp[f] = { fp: f, name: it.name, mfr: it.mfr, category: it.category, occ: [], images: [] }; order.push(f); }
      p.occ.push(it);
      if (it.image && p.images.indexOf(it.image) === -1) p.images.push(it.image);
      if (!p.mfr && it.mfr) p.mfr = it.mfr;
    });
    return order.map(function (f) {
      var p = byFp[f], m = meta(f);
      var prices = p.occ.map(function (o) { return parseFloat(o.price) || 0; }).filter(function (x) { return x > 0; });
      p.type = typeOf(p.occ[0]);
      p.price = prices.length ? Math.min.apply(null, prices) : 0;
      p.projects = Array.from(new Set(p.occ.map(function (o) { return o.project; }).filter(Boolean)));
      p.sources = Array.from(new Set(p.occ.map(function (o) { return o.src; })));
      p.fav = !!m.fav; p.tags = m.tags || [];
      if (m.image) { p.image = m.image; p.customImage = true; }
      else p.image = p.images[0] || '';
      p.allImages = (m.image ? [m.image] : []).concat(p.images);
      return p;
    });
  }

  /* ---- filter state ---- */
  var F = { group: 'type', source: '', vendor: '', project: '', tag: '', pmin: '', pmax: '', img: false, fav: false, sort: 'name' };
  var SEL = {};            // selected fingerprints
  var LIB_ACTIVE = null;   // drilled-in type
  var GRID = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:13px';

  function matchFilters(p, q) {
    if (q && [p.name, p.mfr, p.category, p.tags.join(' '), p.occ.map(function (o) { return o.code; }).join(' '), p.projects.join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return false;
    if (F.source && p.sources.indexOf(F.source) === -1) return false;
    if (F.vendor && (p.mfr || '') !== F.vendor) return false;
    if (F.project && p.projects.indexOf(F.project) === -1) return false;
    if (F.tag && p.tags.indexOf(F.tag) === -1) return false;
    if (F.img && !p.image) return false;
    if (F.fav && !p.fav) return false;
    if (F.pmin !== '' && !(p.price >= parseFloat(F.pmin))) return false;
    if (F.pmax !== '' && !(p.price <= parseFloat(F.pmax))) return false;
    return true;
  }
  function sortProducts(arr) {
    var s = F.sort;
    arr.sort(function (a, b) {
      if (s === 'price-asc') return (a.price || 0) - (b.price || 0) || a.name.localeCompare(b.name);
      if (s === 'price-desc') return (b.price || 0) - (a.price || 0) || a.name.localeCompare(b.name);
      if (s === 'uses') return b.occ.length - a.occ.length || a.name.localeCompare(b.name);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return arr;
  }
  function keysFor(p) {
    switch (F.group) {
      case 'category': return [p.category || 'Other'];
      case 'manufacturer': return [p.mfr || '(no manufacturer)'];
      case 'project': return p.projects.length ? p.projects : ['(no project)'];
      case 'source': return p.sources.map(function (s) { return s === 'PO' ? 'Purchase Orders' : 'Specifications'; });
      default: return [p.type];
    }
  }

  /* ---- controls ---- */
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function controls(all) {
    var vendors = Array.from(new Set(all.map(function (p) { return p.mfr; }).filter(Boolean))).sort();
    var projs = Array.from(new Set(all.reduce(function (a, p) { return a.concat(p.projects); }, []))).sort();
    var tags = Array.from(new Set(all.reduce(function (a, p) { return a.concat(p.tags); }, []))).sort();
    var sel = 'height:30px;font-size:12px;font-family:inherit;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);padding:0 8px';
    var anyFilter = F.source || F.vendor || F.project || F.tag || F.img || F.fav || F.pmin !== '' || F.pmax !== '';
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:2px 0 14px">' +
      '<select style="' + sel + '" onchange="libSet(\'group\',this.value)">' +
        opt('type', 'Browse by Type', F.group) + opt('category', 'By Category', F.group) + opt('manufacturer', 'By Manufacturer', F.group) + opt('project', 'By Project', F.group) + opt('source', 'By Source', F.group) +
      '</select>' +
      '<select style="' + sel + '" onchange="libSet(\'source\',this.value)">' + opt('', 'All sources', F.source) + opt('PO', 'Purchase Orders', F.source) + opt('Spec', 'Specifications', F.source) + '</select>' +
      '<select style="' + sel + ';max-width:170px" onchange="libSet(\'vendor\',this.value)">' + opt('', 'All vendors', F.vendor) + vendors.map(function (v) { return opt(v, v, F.vendor); }).join('') + '</select>' +
      '<select style="' + sel + ';max-width:180px" onchange="libSet(\'project\',this.value)">' + opt('', 'All projects', F.project) + projs.map(function (v) { return opt(v, v, F.project); }).join('') + '</select>' +
      (tags.length ? '<select style="' + sel + '" onchange="libSet(\'tag\',this.value)">' + opt('', 'All tags', F.tag) + tags.map(function (v) { return opt(v, '#' + v, F.tag); }).join('') + '</select>' : '') +
      '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text2)">$<input type="number" value="' + esc(F.pmin) + '" placeholder="min" style="width:62px;' + sel + '" onchange="libSet(\'pmin\',this.value)"> – <input type="number" value="' + esc(F.pmax) + '" placeholder="max" style="width:62px;' + sel + '" onchange="libSet(\'pmax\',this.value)"></span>' +
      '<button onclick="libSet(\'img\',' + (!F.img) + ')" style="' + sel + ';cursor:pointer;' + (F.img ? 'background:var(--accent-bg);color:var(--accent-ink);border-color:var(--accent)' : 'color:var(--text2)') + '">Has image</button>' +
      '<button onclick="libSet(\'fav\',' + (!F.fav) + ')" style="' + sel + ';cursor:pointer;' + (F.fav ? 'background:var(--accent-bg);color:var(--accent-ink);border-color:var(--accent)' : 'color:var(--text2)') + '">★ Favorites</button>' +
      '<select style="' + sel + '" onchange="libSet(\'sort\',this.value)">' + opt('name', 'Sort: Name', F.sort) + opt('price-asc', 'Price ↑', F.sort) + opt('price-desc', 'Price ↓', F.sort) + opt('uses', 'Most used', F.sort) + '</select>' +
      (anyFilter ? '<button onclick="libClearFilters()" style="' + sel + ';cursor:pointer;color:var(--accent-ink)">✕ Clear</button>' : '') +
      '</div>';
  }

  /* ---- product card (with select checkbox) ---- */
  function card(p) {
    var checked = !!SEL[p.fp];
    var uses = p.occ.length;
    var poN = p.occ.filter(function (o) { return o.src === 'PO'; }).length;
    var img = '<div style="position:relative;height:122px;background:var(--surface2);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px;overflow:hidden">' +
      (p.image ? '<img data-sbsrc="' + String(p.image).replace(/"/g, '&quot;') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'" />' : 'No image') +
      '<span onclick="event.stopPropagation();libToggleFav(\'' + p.fp + '\')" title="Favorite" style="position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:' + (p.fav ? 'var(--amber)' : 'var(--text3)') + '">' + (p.fav ? '★' : '☆') + '</span>' +
      '<span onclick="event.stopPropagation();libToggleSel(\'' + p.fp + '\')" title="Select" style="position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:4px;border:1.5px solid ' + (checked ? 'var(--accent-ink)' : 'var(--border2)') + ';background:' + (checked ? 'var(--accent-ink)' : 'rgba(255,255,255,.92)') + ';color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px">' + (checked ? '✓' : '') + '</span>' +
      (uses > 1 ? '<span style="position:absolute;bottom:6px;left:6px;font-size:9.5px;font-weight:700;background:rgba(0,0,0,.7);color:#fff;border-radius:8px;padding:1px 7px">×' + uses + ' uses</span>' : '') +
      '</div>';
    var tagchips = p.tags.length ? '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">' + p.tags.slice(0, 3).map(function (t) { return '<span style="font-size:9px;background:var(--surface2);color:var(--text2);border-radius:7px;padding:1px 6px">#' + esc(t) + '</span>'; }).join('') + '</div>' : '';
    var right = p.price ? '<span style="font-size:11.5px;color:var(--text2)">' + money(p.price) + '</span>' : '<span style="font-size:10.5px;color:var(--text3)">' + esc(p.occ[0].code || '') + '</span>';
    return '<div onclick="libOpenDetail(\'' + p.fp + '\')" style="cursor:pointer;background:var(--surface);border:1px solid ' + (checked ? 'var(--accent-ink)' : 'var(--border2)') + ';border-radius:var(--radius-sm);overflow:hidden;transition:border-color .12s">' + img +
      '<div style="padding:9px 10px">' +
      '<div style="font-size:12.5px;font-weight:600;line-height:1.25;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(p.name) + '</div>' +
      '<div style="font-size:11.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.mfr || '—') + '</div>' +
      '<div style="font-size:10.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">' + esc(p.projects[0] || '') + (p.projects.length > 1 ? ' +' + (p.projects.length - 1) : '') + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">' +
      '<span style="font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:' + (poN ? 'var(--accent-ink)' : 'var(--text3)') + ';background:' + (poN ? 'var(--accent-bg)' : 'var(--surface2)') + ';border-radius:8px;padding:1px 7px">' + (poN ? 'Ordered' : 'Spec') + '</span>' + right + '</div>' +
      tagchips + '</div></div>';
  }

  function sectionHead(label, count, def) {
    var ic = def ? '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:var(--accent-ink);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">' + def.i + '</svg>' : '';
    return '<div style="margin:20px 0 10px;display:flex;align-items:center;gap:9px">' + ic +
      '<div style="font-size:13.5px;font-weight:700;color:var(--text)">' + esc(label) + '</div>' +
      '<div style="font-size:11px;color:var(--text3);background:var(--accent-bg);border-radius:10px;padding:1px 8px">' + count + '</div></div>';
  }
  function typeCard(name, arr, idx) {
    var def = defOf(name);
    var imgs = arr.filter(function (x) { return x.image; }).slice(0, 3).map(function (x) { return x.image; });
    var cover;
    if (imgs.length) {
      var cols = Math.min(3, imgs.length);
      cover = '<div style="height:122px;display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:2px;background:var(--surface2)">' +
        imgs.map(function (src) { return '<div style="overflow:hidden;background:var(--surface2)"><img data-sbsrc="' + String(src).replace(/"/g, '&quot;') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.parentElement.style.opacity=0" /></div>'; }).join('') + '</div>';
    } else {
      cover = '<div style="height:122px;background:var(--accent-bg);display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" style="width:42px;height:42px;stroke:var(--accent-ink);fill:none;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;opacity:.65">' + def.i + '</svg></div>';
    }
    var poN = arr.reduce(function (a, x) { return a + x.occ.filter(function (o) { return o.src === 'PO'; }).length; }, 0);
    var metaLine = arr.length + ' product' + (arr.length !== 1 ? 's' : '') + (poN ? ' · ' + poN + ' ordered' : '');
    return '<div onclick="libOpenType(' + idx + ')" style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.boxShadow=\'var(--shadow)\';this.style.transform=\'translateY(-2px)\'" onmouseout="this.style.borderColor=\'var(--border2)\';this.style.boxShadow=\'none\';this.style.transform=\'none\'">' +
      cover + '<div style="padding:12px 14px;display:flex;align-items:center;gap:11px"><div style="width:34px;height:34px;border-radius:8px;background:var(--accent-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--accent-ink);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round">' + def.i + '</svg></div>' +
      '<div style="min-width:0;flex:1"><div style="font-size:13.5px;font-weight:700;color:var(--text);line-height:1.2">' + esc(name) + '</div><div style="font-size:11.5px;color:var(--text3);margin-top:1px">' + metaLine + '</div></div><span style="color:var(--text3);font-size:15px">›</span></div></div>';
  }

  /* ---- bulk selection bar ---- */
  function bulkBar() {
    var n = Object.keys(SEL).length; if (!n) return '';
    return '<div style="position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:10px;background:var(--accent-ink);color:#fff;border-radius:var(--radius-sm);padding:9px 14px;margin-bottom:12px">' +
      '<b style="font-size:13px">' + n + ' selected</b>' +
      '<div style="flex:1"></div>' +
      '<button onclick="libBulk(\'fav\')" style="background:rgba(255,255,255,.16);border:none;color:#fff;font-family:inherit;font-size:12px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer">★ Favorite</button>' +
      '<button onclick="libBulk(\'tag\')" style="background:rgba(255,255,255,.16);border:none;color:#fff;font-family:inherit;font-size:12px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer"># Tag</button>' +
      '<button onclick="libBulk(\'sourcing\')" style="background:rgba(255,255,255,.16);border:none;color:#fff;font-family:inherit;font-size:12px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer">→ Send to Sourcing</button>' +
      '<button onclick="libBulk(\'csv\')" style="background:rgba(255,255,255,.16);border:none;color:#fff;font-family:inherit;font-size:12px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer">⤓ Export CSV</button>' +
      '<button onclick="libClearSel()" style="background:none;border:none;color:#fff;font-family:inherit;font-size:16px;cursor:pointer;padding:0 4px">✕</button>' +
      '</div>';
  }

  /* ---- main render ---- */
  function render() {
    var body = document.getElementById('library-body'); if (!body) return;
    var q = (((document.getElementById('library-search') || {}).value) || '').trim().toLowerCase();
    var sync = document.getElementById('library-group'); if (sync) sync.style.display = 'none'; // superseded by our group control
    var all = products();
    var items = all.filter(function (p) { return matchFilters(p, q); });
    sortProducts(items);

    var total = all.length, poU = all.reduce(function (a, p) { return a + p.occ.filter(function (o) { return o.src === 'PO'; }).length; }, 0);
    var withImg = all.filter(function (p) { return p.image; }).length;
    var html = '<div style="color:var(--text2);font-size:13px;margin:0 0 12px"><b style="color:var(--text)">' + total + '</b> unique product' + (total !== 1 ? 's' : '') + ' across ' + poU + ' order line' + (poU !== 1 ? 's' : '') + ' and your spec books. <b style="color:var(--text)">' + withImg + '</b> have an image.' + ((items.length !== all.length) ? ' Showing <b style="color:var(--text)">' + items.length + '</b>.' : '') + '</div>';
    html += controls(all);
    html += bulkBar();

    if (!items.length) { body.innerHTML = html + '<div style="color:var(--text3);padding:40px;text-align:center">No products match these filters.</div>'; sync && (sync.style.display = 'none'); if (typeof sbHydrateImages === 'function') sbHydrateImages(body); return; }

    var grouped = F.group === 'type' && !q && !LIB_ACTIVE;
    // Type overview cards (only in default type-grouping w/o filters narrowing to one)
    if (F.group === 'type' && !LIB_ACTIVE) {
      var byType = {}; items.forEach(function (p) { (byType[p.type] = byType[p.type] || []).push(p); });
      if (q) {
        ORDER.forEach(function (name) { var arr = byType[name]; if (!arr || !arr.length) return; html += sectionHead(name, arr.length, defOf(name)); html += '<div style="' + GRID + '">' + arr.map(card).join('') + '</div>'; });
      } else {
        html += '<div style="font-size:12.5px;color:var(--text3);margin:-4px 0 14px">Browse by furniture type, or use the filters above. Select cards (top-left box) for bulk actions; click any card for full detail.</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:14px">';
        ORDER.forEach(function (name, idx) { var arr = byType[name]; if (arr && arr.length) html += typeCard(name, arr, idx); });
        html += '</div>';
      }
      body.innerHTML = html; if (typeof sbHydrateImages === 'function') sbHydrateImages(body); return;
    }
    if (F.group === 'type' && LIB_ACTIVE) {
      var arrT = items.filter(function (p) { return p.type === LIB_ACTIVE; });
      html += '<button onclick="libBackToTypes()" style="background:none;border:none;color:var(--accent-ink);font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 0">← All types</button>';
      html += sectionHead(LIB_ACTIVE, arrT.length, defOf(LIB_ACTIVE));
      html += arrT.length ? '<div style="' + GRID + '">' + arrT.map(card).join('') + '</div>' : '<div style="color:var(--text3);padding:32px;text-align:center">No items.</div>';
      body.innerHTML = html; if (typeof sbHydrateImages === 'function') sbHydrateImages(body); return;
    }

    // Grouped list (category/manufacturer/project/source)
    var groups = {}; items.forEach(function (p) { keysFor(p).forEach(function (k) { (groups[k] = groups[k] || []).push(p); }); });
    var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || a.localeCompare(b); });
    keys.forEach(function (k) { html += sectionHead(k, groups[k].length); html += '<div style="' + GRID + '">' + groups[k].map(card).join('') + '</div>'; });
    body.innerHTML = html; if (typeof sbHydrateImages === 'function') sbHydrateImages(body);
  }

  /* ---- detail modal ---- */
  function ensureModal() {
    var m = document.getElementById('lib-modal');
    if (m) return m;
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'lib-modal';
    m.innerHTML = '<div class="modal" style="width:760px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column">' +
      '<div class="modal-header"><div class="modal-title" id="lib-modal-title">Product</div><button class="modal-close" onclick="closeModal(\'lib-modal\')">&times;</button></div>' +
      '<div class="modal-body" id="lib-modal-body" style="overflow:auto"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('mousedown', function (e) { if (e.target === m) closeModal('lib-modal'); });
    return m;
  }
  var _detailFp = null;
  window.libOpenDetail = function (f) {
    _detailFp = f;
    ensureModal();
    if (typeof openModal === 'function') openModal('lib-modal');
    renderDetail();
  };
  function findProduct(f) { var all = products(); for (var i = 0; i < all.length; i++) if (all[i].fp === f) return all[i]; return null; }
  function renderDetail() {
    var p = findProduct(_detailFp); if (!p) { closeModal('lib-modal'); return; }
    document.getElementById('lib-modal-title').textContent = p.name || 'Product';
    var imgs = p.allImages.filter(Boolean);
    var gallery = imgs.length
      ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + imgs.slice(0, 6).map(function (src, i) { return '<div style="width:' + (i === 0 ? '100%' : '88px') + ';height:' + (i === 0 ? '220px' : '88px') + ';background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><img data-sbsrc="' + String(src).replace(/"/g, '&quot;') + '" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'"/></div>'; }).join('') + '</div>'
      : '';
    var drop = '<div id="lib-drop" ondragover="event.preventDefault();this.style.borderColor=\'var(--accent)\'" ondragleave="this.style.borderColor=\'var(--border2)\'" ondrop="libDropImage(event)" style="border:2px dashed var(--border2);border-radius:var(--radius-sm);padding:' + (imgs.length ? '10px' : '26px') + ' 14px;text-align:center;color:var(--text3);font-size:12px;margin-bottom:14px;cursor:default">' +
      'Drag an image here to ' + (p.customImage ? 'replace' : 'set') + ' this product’s photo' + (p.customImage ? ' · <span onclick="libClearImage()" style="color:var(--accent-ink);cursor:pointer;text-decoration:underline">remove custom</span>' : '') +
      '<input type="file" accept="image/*" id="lib-file" style="display:none" onchange="libPickImage(this)"> · <span onclick="document.getElementById(\'lib-file\').click()" style="color:var(--accent-ink);cursor:pointer;text-decoration:underline">browse</span></div>';

    var facts = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">' +
      fact('Manufacturer', p.mfr || '—') + fact('Type', p.type) + fact('Category', p.category || '—') +
      fact('Best price', p.price ? money(p.price) : '—') + fact('Appears in', p.occ.length + ' place' + (p.occ.length !== 1 ? 's' : '')) + fact('Projects', String(p.projects.length || 0)) +
      '</div>';

    var descOcc = p.occ.find(function (o) { return o.description; });
    var desc = descOcc ? '<div style="font-size:12.5px;color:var(--text2);line-height:1.5;margin-bottom:14px;white-space:pre-line">' + esc(descOcc.description) + '</div>' : '';

    var occ = '<div class="lib-seclbl">Where this product appears</div><div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px">' +
      p.occ.map(function (o, i) {
        var click = o.src === 'PO' ? ' onclick="closeModal(\'lib-modal\');viewPO(' + ((typeof o.id === 'number') ? o.id : ("'" + String(o.id || '').replace(/'/g, '') + "'")) + ')" style="cursor:pointer"' : '';
        return '<div' + click + ' style="display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;' + (i ? 'border-top:1px solid var(--border);' : '') + '">' +
          '<span style="font-size:9.5px;font-weight:700;text-transform:uppercase;color:' + (o.src === 'PO' ? 'var(--accent-ink)' : 'var(--text3)') + ';background:' + (o.src === 'PO' ? 'var(--accent-bg)' : 'var(--surface2)') + ';border-radius:7px;padding:1px 7px">' + (o.src === 'PO' ? 'PO' : 'Spec') + '</span>' +
          '<span style="flex:1;min-width:0;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(o.project || '—') + (o.code ? ' · ' + esc(o.code) : '') + '</span>' +
          (o.price ? '<span style="color:var(--text)">' + money(o.price) + '</span>' : '') +
          (o.src === 'PO' ? '<span style="color:var(--accent-ink);font-size:11px">Open →</span>' : '') +
        '</div>';
      }).join('') + '</div>';

    var tags = '<div class="lib-seclbl">Tags</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:16px">' +
      p.tags.map(function (t) { return '<span style="font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:2px 9px">#' + esc(t) + ' <span onclick="libRemoveTag(\'' + esc(t).replace(/'/g, '') + '\')" style="cursor:pointer;color:var(--text3);margin-left:2px">×</span></span>'; }).join('') +
      '<button onclick="libAddTag()" style="font-size:11px;border:1px dashed var(--border2);background:none;color:var(--accent-ink);border-radius:12px;padding:2px 10px;cursor:pointer;font-family:inherit">+ Add tag</button></div>';

    var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:14px">' +
      '<button onclick="libToggleFav(\'' + p.fp + '\',true)" style="' + btn(p.fav) + '">' + (p.fav ? '★ Favorited' : '☆ Favorite') + '</button>' +
      '<button onclick="libSendOne(\'' + p.fp + '\')" style="' + btn(false, true) + '">→ Send to Sourcing</button>' +
      '<button onclick="window.open(\'https://www.google.com/search?q=' + encodeURIComponent((p.name || '') + ' ' + (p.mfr || '')) + '\',\'_blank\')" style="' + btn(false) + '">Web search</button>' +
      '<button onclick="window.open(\'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent((p.name || '') + ' ' + (p.mfr || '')) + '\',\'_blank\')" style="' + btn(false) + '">Image search</button>' +
      '</div>';

    document.getElementById('lib-modal-body').innerHTML = gallery + drop + facts + desc + occ + tags + actions;
    if (typeof sbHydrateImages === 'function') sbHydrateImages(document.getElementById('lib-modal-body'));
  }
  function fact(l, v) { return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px"><div style="font-size:10px;color:var(--text3);margin-bottom:2px">' + esc(l) + '</div><div style="font-size:13px;font-weight:600">' + esc(v) + '</div></div>'; }
  function btn(active, primary) { return 'padding:7px 14px;border-radius:var(--radius-sm);font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid ' + (primary ? 'var(--accent-ink)' : 'var(--border2)') + ';background:' + (primary ? 'var(--accent-ink)' : active ? 'var(--accent-bg)' : 'var(--surface)') + ';color:' + (primary ? '#fff' : active ? 'var(--accent-ink)' : 'var(--text)'); }
  function refreshAll() { render(); if (document.getElementById('lib-modal') && document.getElementById('lib-modal').classList.contains('open')) renderDetail(); }

  /* ---- image set/replace ---- */
  function applyImage(dataUrl) {
    if (!_detailFp) return;
    libMeta[_detailFp] = libMeta[_detailFp] || {};
    libMeta[_detailFp].image = dataUrl; saveMeta(); refreshAll();
    if (typeof sbUploadImage === 'function') {
      var pre = (typeof vpoDownscaleImage === 'function') ? vpoDownscaleImage(dataUrl, 1000, 0.82).catch(function () { return dataUrl; }) : Promise.resolve(dataUrl);
      pre.then(function (out) { return sbUploadImage(out, 'library'); }).then(function (url) { if (url) { libMeta[_detailFp].image = url; saveMeta(); refreshAll(); } });
    }
  }
  function readFileImg(file) { if (!file || !/^image\//.test(file.type)) { if (typeof ai3Toast === 'function') ai3Toast('Please drop an image file'); return; } var r = new FileReader(); r.onload = function (e) { applyImage(e.target.result); }; r.readAsDataURL(file); }
  window.libDropImage = function (ev) { ev.preventDefault(); var z = document.getElementById('lib-drop'); if (z) z.style.borderColor = 'var(--border2)'; var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; readFileImg(f); };
  window.libPickImage = function (inp) { readFileImg(inp.files && inp.files[0]); };
  window.libClearImage = function () { if (_detailFp && libMeta[_detailFp]) { delete libMeta[_detailFp].image; saveMeta(); refreshAll(); } };

  /* ---- favorites / tags ---- */
  window.libToggleFav = function (f, fromDetail) { libMeta[f] = libMeta[f] || {}; libMeta[f].fav = !libMeta[f].fav; saveMeta(); refreshAll(); };
  window.libAddTag = function () { var t = prompt('Tag (e.g. lobby, client-approved, reusable):'); if (!t || !t.trim()) return; t = t.trim().replace(/^#/, ''); libMeta[_detailFp] = libMeta[_detailFp] || {}; var arr = libMeta[_detailFp].tags = libMeta[_detailFp].tags || []; if (arr.indexOf(t) === -1) arr.push(t); saveMeta(); refreshAll(); };
  window.libRemoveTag = function (t) { var m = libMeta[_detailFp]; if (m && m.tags) { m.tags = m.tags.filter(function (x) { return x !== t; }); saveMeta(); refreshAll(); } };

  /* ---- selection + bulk ---- */
  window.libToggleSel = function (f) { if (SEL[f]) delete SEL[f]; else SEL[f] = true; render(); };
  window.libClearSel = function () { SEL = {}; render(); };
  window.libBulk = function (action) {
    var fps = Object.keys(SEL); if (!fps.length) return;
    if (action === 'fav') { fps.forEach(function (f) { libMeta[f] = libMeta[f] || {}; libMeta[f].fav = true; }); saveMeta(); if (typeof ai3Toast === 'function') ai3Toast(fps.length + ' favorited'); render(); return; }
    if (action === 'tag') { var t = prompt('Tag to apply to ' + fps.length + ' product(s):'); if (!t || !t.trim()) return; t = t.trim().replace(/^#/, ''); fps.forEach(function (f) { libMeta[f] = libMeta[f] || {}; var a = libMeta[f].tags = libMeta[f].tags || []; if (a.indexOf(t) === -1) a.push(t); }); saveMeta(); if (typeof ai3Toast === 'function') ai3Toast('Tagged ' + fps.length); render(); return; }
    if (action === 'csv') { exportCSV(fps); return; }
    if (action === 'sourcing') { sendToSourcing(fps); return; }
  };
  function exportCSV(fps) {
    var all = products(); var map = {}; all.forEach(function (p) { map[p.fp] = p; });
    var rows = [['Product', 'Manufacturer', 'Type', 'Category', 'Best Price', 'Uses', 'Projects', 'Source', 'Code', 'Tags']];
    fps.forEach(function (f) { var p = map[f]; if (!p) return; rows.push([p.name, p.mfr, p.type, p.category, p.price || '', p.occ.length, p.projects.join('; '), p.sources.join('/'), (p.occ[0] && p.occ[0].code) || '', p.tags.join(' ')]); });
    var csv = rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' }); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'library-export.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (typeof ai3Toast === 'function') ai3Toast('Exported ' + fps.length + ' product(s)');
  }

  /* ---- send to a project's Sourcing shortlist ---- */
  function projectPicker(cb) {
    var list = (typeof projects !== 'undefined' ? projects : []).slice().sort(function (a, b) { return String(a.name).localeCompare(b.name); });
    if (!list.length) { if (typeof ai3Toast === 'function') ai3Toast('No projects yet'); return; }
    ensureModal();
    var m = document.getElementById('lib-modal'); if (typeof openModal === 'function') openModal('lib-modal');
    document.getElementById('lib-modal-title').textContent = 'Send to Sourcing';
    document.getElementById('lib-modal-body').innerHTML = '<div style="font-size:12.5px;color:var(--text2);margin-bottom:12px">Choose the project whose Sourcing shortlist these products should land in. You can then assign them to specific line items inside Sourcing.</div>' +
      '<div style="display:flex;flex-direction:column;gap:7px">' + list.map(function (pr) { return '<button onclick="libDoSend(\'' + String(pr.name).replace(/'/g, "\\'") + '\')" style="text-align:left;padding:11px 14px;border:1px solid var(--border2);background:var(--surface);border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">' + esc(pr.name) + '<span style="display:block;font-weight:400;font-size:11.5px;color:var(--text3);margin-top:1px">' + esc(pr.client || '') + '</span></button>'; }).join('') + '</div>';
    _pendingSend = cb;
  }
  var _pendingSend = null, _pendingFps = null;
  function snap(p) { return { id: (typeof genId === 'function') ? genId() : Date.now() + Math.floor(Math.random() * 1e4), fp: p.fp, name: p.name, vendor: p.mfr, price: p.price, leadTime: '', image: p.image || '', description: (p.occ.find(function (o) { return o.description; }) || {}).description || '', mode: 'library', addedAt: new Date().toISOString().slice(0, 10) }; }
  function sendToSourcing(fps) { _pendingFps = fps.slice(); projectPicker(function (proj) { doSend(proj, _pendingFps); }); }
  window.libSendOne = function (f) { _pendingFps = [f]; projectPicker(function (proj) { doSend(proj, _pendingFps); }); };
  window.libDoSend = function (proj) { if (_pendingSend) { var cb = _pendingSend; _pendingSend = null; cb(proj); } };
  function doSend(proj, fps) {
    var all = products(); var map = {}; all.forEach(function (p) { map[p.fp] = p; });
    librarySaved[proj] = librarySaved[proj] || [];
    var added = 0;
    fps.forEach(function (f) { var p = map[f]; if (!p) return; if (librarySaved[proj].some(function (x) { return x.fp === f; })) return; librarySaved[proj].push(snap(p)); added++; });
    saveShortlist();
    closeModal('lib-modal');
    SEL = {}; render();
    if (typeof ai3Toast === 'function') ai3Toast(added + ' product' + (added !== 1 ? 's' : '') + ' sent to ' + proj + ' › Sourcing');
  }

  window.libSet = function (k, v) { F[k] = (v === 'true') ? true : (v === 'false') ? false : v; if (k === 'group') LIB_ACTIVE = null; render(); };
  window.libClearFilters = function () { F.source = F.vendor = F.project = F.tag = ''; F.pmin = F.pmax = ''; F.img = F.fav = false; render(); };
  window.libOpenType = function (idx) { LIB_ACTIVE = ORDER[idx] || null; render(); var c = document.getElementById('content'); if (c) c.scrollTop = 0; };
  window.libBackToTypes = function () { LIB_ACTIVE = null; render(); };
  window.libResetTypes = function () { LIB_ACTIVE = null; };

  function install() {
    window.libRender = render;
    // tiny stylesheet for section labels in the modal
    if (!document.getElementById('lib-css')) { var s = document.createElement('style'); s.id = 'lib-css'; s.textContent = '.lib-seclbl{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);font-weight:700;margin:4px 0 8px}'; document.head.appendChild(s); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
