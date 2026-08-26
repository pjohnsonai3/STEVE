/* ============================================================================
   STEVE — PO pop-out  (po-window.js)
   1) A purchase order can pop out into a floating, draggable, resizable panel
      that sits over the list — so the list stays visible behind it and you can
      work on the PO beside it. Nothing reloads, so it works everywhere the app
      does and edits are live (the same in-memory record, same autosave).
   2) Closing or docking the editor puts the list back exactly where it was —
      same scroll position, no hunting for the row you just left.
   Deep link: <page>#po=<id> still opens straight into a PO, for the published
   site where a real second browser window is possible.
   ========================================================================= */
(function () {
  'use strict';

  var PREF = 'steve_po_popout';
  var GEO = 'steve_po_popout_geo';
  var scrollMemo = null;
  var suppressPop = false;
  var deepLinking = false;
  var popped = false;
  var homeParent = null, homeNext = null;

  function pref() { try { return localStorage.getItem(PREF) === '1'; } catch (e) { return false; } }
  function setPref(v) { try { localStorage.setItem(PREF, v ? '1' : '0'); } catch (e) {} paintToggle(); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function editor() { return document.getElementById('vpo-editor'); }
  function editorOpen() { var e = editor(); return !!(e && e.style.display !== 'none'); }

  function geo() {
    try { return JSON.parse(localStorage.getItem(GEO)) || null; } catch (e) { return null; }
  }
  function saveGeo(g) { try { localStorage.setItem(GEO, JSON.stringify(g)); } catch (e) {} }

  // ── Scroll memory ─────────────────────────────────────────────────────────
  // #content is the scroll container in STEVE (body is overflow:hidden).
  function scroller() {
    var cands = [document.getElementById('content'), document.querySelector('.main'),
      document.querySelector('main'), document.scrollingElement, document.documentElement];
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return document.getElementById('content') || document.scrollingElement || document.documentElement;
  }
  function isWindowScroller(el) {
    return el === document.documentElement || el === document.scrollingElement || el === document.body;
  }
  function remember() {
    var el = scroller();
    scrollMemo = { el: el, top: isWindowScroller(el) ? (window.pageYOffset || el.scrollTop || 0) : el.scrollTop };
  }
  function restore() {
    if (!scrollMemo) return;
    var m = scrollMemo, tries = 0;
    (function put() {
      if (isWindowScroller(m.el)) window.scrollTo(0, m.top);
      else m.el.scrollTop = m.top;
      if (++tries < 6) requestAnimationFrame(put);
    })();
    scrollMemo = null;
  }

  // ── The floating panel ────────────────────────────────────────────────────
  function shell() {
    var s = document.getElementById('vpo-float');
    if (s) return s;
    s = document.createElement('div');
    s.id = 'vpo-float';
    s.style.cssText = 'position:fixed;z-index:900;display:none;flex-direction:column;' +
      'background:var(--surface,#fff);border:1px solid var(--border2,#c9c9c9);border-radius:var(--radius,4px);' +
      'box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:visible;min-width:360px;min-height:200px';
    s.innerHTML =
      '<div id="vpo-float-bar" style="display:flex;align-items:center;gap:8px;padding:7px 10px;' +
        'background:var(--surface2,#f3f3f3);border-bottom:1px solid var(--border,#e2e2e2);cursor:move;user-select:none;flex:none">' +
        '<span id="vpo-float-title" style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:60px"></span>' +
        // Window controls never move and never shrink, so there is always a way out.
        '<span style="display:flex;align-items:center;gap:4px;flex:none;cursor:default">' +
          '<button class="btn btn-sm" onclick="pwRefPicker()" title="Open another PO beside this one, read-only">\u29c9 Reference</button>' +
          '<button class="btn btn-sm" id="vpo-float-max" title="Maximise / restore">\u2b1c</button>' +
          '<button class="btn btn-sm" onclick="pwDock()" title="Put it back in the page">\u21f2 Dock</button>' +
          '<button class="btn btn-sm" onclick="pwCloseFloat()" title="Close (Esc)">\u2715</button>' +
        '</span>' +
      '</div>' +
      '<div id="vpo-float-tools" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px 10px;' +
        'background:var(--surface2,#f3f3f3);border-bottom:1px solid var(--border,#e2e2e2);flex:none"></div>' +
      '<div id="vpo-float-body" style="flex:1;overflow:auto;padding:0 0 8px;background:var(--surface,#fff)"></div>';
    document.body.appendChild(s);
    dragBar(s);
    resizeGrip(s);
    document.getElementById('vpo-float-max').onclick = function () { toggleMax(s); };
    return s;
  }

  function clampTo(s, g) {
    var w = Math.min(Math.max(g.w || 900, MIN_W), window.innerWidth - 16);
    var h = Math.min(Math.max(g.h || Math.round(window.innerHeight * 0.82), MIN_H), window.innerHeight - 16);
    var l = Math.min(Math.max(g.l == null ? Math.round((window.innerWidth - w) / 2) : g.l, 4), Math.max(4, window.innerWidth - w - 4));
    var t = Math.min(Math.max(g.t == null ? 60 : g.t, 4), Math.max(4, window.innerHeight - h - 4));
    s.style.width = w + 'px'; s.style.height = h + 'px';
    s.style.left = l + 'px'; s.style.top = t + 'px';
  }
  function currentGeo(s) {
    return { l: parseInt(s.style.left, 10) || 0, t: parseInt(s.style.top, 10) || 0,
      w: parseInt(s.style.width, 10) || 900, h: parseInt(s.style.height, 10) || 600 };
  }
  var preMax = null;
  function toggleMax(s) {
    if (preMax) { clampTo(s, preMax); preMax = null; }
    else {
      preMax = currentGeo(s);
      s.style.left = '8px'; s.style.top = '8px';
      s.style.width = (window.innerWidth - 16) + 'px';
      s.style.height = (window.innerHeight - 16) + 'px';
    }
  }

  function dragBar(s, bar) {
    bar = bar || document.getElementById('vpo-float-bar');
    bar.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('#vpo-float-tools')) return;
      var g = currentGeo(s), sx = e.clientX, sy = e.clientY;
      preMax = null;
      // Pointer capture keeps the drag alive over the PO document and outside
      // the panel, which plain mousemove listeners lose.
      bar.setPointerCapture(e.pointerId);
      function mv(ev) {
        // Free movement; only guarantee a grabbable strip stays on screen.
        var l = g.l + ev.clientX - sx, t = g.t + ev.clientY - sy;
        s.style.left = Math.min(Math.max(l, 60 - g.w), window.innerWidth - 60) + 'px';
        s.style.top = Math.min(Math.max(t, 0), window.innerHeight - 34) + 'px';
      }
      function up(ev) {
        bar.removeEventListener('pointermove', mv);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        try { bar.releasePointerCapture(ev.pointerId); } catch (x) {}
        saveGeo(currentGeo(s));
      }
      bar.addEventListener('pointermove', mv);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }

  // Eight grab zones: four edges and four corners, so the panel stretches from
  // any side rather than only the bottom-right.
  var EDGES = [
    { k: 'n',  css: 'top:-4px;left:10px;right:10px;height:8px;cursor:ns-resize' },
    { k: 's',  css: 'bottom:-4px;left:10px;right:10px;height:8px;cursor:ns-resize' },
    { k: 'w',  css: 'left:-4px;top:10px;bottom:10px;width:8px;cursor:ew-resize' },
    { k: 'e',  css: 'right:-4px;top:10px;bottom:10px;width:8px;cursor:ew-resize' },
    { k: 'nw', css: 'top:-4px;left:-4px;width:14px;height:14px;cursor:nwse-resize' },
    { k: 'ne', css: 'top:-4px;right:-4px;width:14px;height:14px;cursor:nesw-resize' },
    { k: 'sw', css: 'bottom:-4px;left:-4px;width:14px;height:14px;cursor:nesw-resize' },
    { k: 'se', css: 'bottom:-4px;right:-4px;width:14px;height:14px;cursor:nwse-resize' }
  ];
  var MIN_W = 360, MIN_H = 200;

  function resizeGrip(s) {
    EDGES.forEach(function (spec) {
      var h = document.createElement('div');
      h.style.cssText = 'position:absolute;z-index:2;' + spec.css;
      h.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var g = currentGeo(s), sx = e.clientX, sy = e.clientY, k = spec.k;
        preMax = null;
        h.setPointerCapture(e.pointerId);
        function mv(ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          var l = g.l, t = g.t, w = g.w, ht = g.h;
          if (k.indexOf('e') >= 0) w = Math.max(MIN_W, g.w + dx);
          if (k.indexOf('s') >= 0) ht = Math.max(MIN_H, g.h + dy);
          if (k.indexOf('w') >= 0) { w = Math.max(MIN_W, g.w - dx); l = g.l + (g.w - w); }
          if (k.indexOf('n') >= 0) { ht = Math.max(MIN_H, g.h - dy); t = g.t + (g.h - ht); }
          s.style.left = l + 'px'; s.style.top = t + 'px';
          s.style.width = w + 'px'; s.style.height = ht + 'px';
        }
        function up(ev) {
          h.removeEventListener('pointermove', mv);
          h.removeEventListener('pointerup', up);
          h.removeEventListener('pointercancel', up);
          try { h.releasePointerCapture(ev.pointerId); } catch (x) {}
          saveGeo(currentGeo(s));
        }
        h.addEventListener('pointermove', mv);
        h.addEventListener('pointerup', up);
        h.addEventListener('pointercancel', up);
        e.preventDefault(); e.stopPropagation();
      });
      s.appendChild(h);
    });
  }


  // ── Reference panels ──────────────────────────────────────────────────────
  // STEVE keeps ONE working copy of a purchase order (vpoForm / vpoImages), so
  // two POs cannot both be editable at once without losing edits. A reference
  // panel is therefore a read-only rendering of another PO — open as many as you
  // like beside the one you are editing, to copy details across or compare.
  var refSeq = 0;

  function renderRef(v) {
    var savedForm = null, savedImages = null, savedCur = null, html = '';
    try {
      savedForm = vpoForm; savedImages = vpoImages; savedCur = currentVPOId;
      vpoForm = Object.assign({}, v);
      vpoImages = {
        products: Array.isArray(v.imgProducts) ? v.imgProducts.slice() : (v.imgProduct ? [v.imgProduct] : []),
        swatch: v.imgSwatch || '',
        layout: v.imgLayout ? Object.assign({}, v.imgLayout) : {}
      };
      currentVPOId = v.id;
      html = buildVPODoc(v, false);          // false = print/clean view, nothing editable
    } catch (e) {
      html = '<div style="padding:20px;font-size:13px;color:var(--text3)">Could not render this PO.</div>';
      console.warn('[ai3] reference render failed', e);
    } finally {
      if (savedForm !== null) { vpoForm = savedForm; vpoImages = savedImages; currentVPOId = savedCur; }
    }
    return html;
  }

  function openRef(id) {
    var v = (vendorPOs || []).find(function (x) { return String(x.id) === String(id); });
    if (!v) return;
    var n = ++refSeq;
    var p = document.createElement('div');
    p.className = 'vpo-ref';
    p.id = 'vpo-ref-' + n;
    p.style.cssText = 'position:fixed;z-index:880;display:flex;flex-direction:column;' +
      'background:var(--surface,#fff);border:1px solid var(--border2,#c9c9c9);border-radius:var(--radius,4px);' +
      'box-shadow:0 14px 40px rgba(0,0,0,.20);overflow:visible';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2,#f3f3f3);' +
      'border-bottom:1px solid var(--border,#e2e2e2);cursor:move;user-select:none;flex:none';
    bar.innerHTML =
      '<span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);flex:none">Reference</span>' +
      '<span style="font-size:12.5px;font-weight:600;flex:1;min-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        ((v.poNum || 'PO') + (v.mfrName ? ' \u00b7 ' + v.mfrName : '')).replace(/[&<>]/g, '') + '</span>';
    var tools = document.createElement('span');
    tools.style.cssText = 'display:flex;gap:4px;flex:none;cursor:default';
    var edit = document.createElement('button');
    edit.className = 'btn btn-sm'; edit.textContent = '\u270e Edit'; edit.title = 'Open this PO for editing';
    edit.onclick = function () { p.remove(); if (typeof openVPOEditor === 'function') openVPOEditor(v.id); };
    var close = document.createElement('button');
    close.className = 'btn btn-sm'; close.textContent = '\u2715'; close.title = 'Close';
    close.onclick = function () { p.remove(); };
    tools.appendChild(edit); tools.appendChild(close);
    bar.appendChild(tools);
    var body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow:auto;background:#fff';
    body.innerHTML = '<div style="transform-origin:top left;padding:6px">' + renderRef(v) + '</div>';
    p.appendChild(bar); p.appendChild(body);
    document.body.appendChild(p);

    // Cascade so several panels stay reachable.
    var off = ((n - 1) % 5) * 26;
    var w = Math.min(620, window.innerWidth - 40), h = Math.min(680, window.innerHeight - 80);
    p.style.width = w + 'px'; p.style.height = h + 'px';
    p.style.left = Math.max(8, window.innerWidth - w - 24 - off) + 'px';
    p.style.top = (52 + off) + 'px';

    dragBar(p, bar);
    resizeGrip(p);
    p.addEventListener('pointerdown', function () { p.style.zIndex = 880 + (++refSeq); }, true);
  }

  // Picker over every PO, so a reference can be opened without leaving the page.
  function openRefPicker() {
    var host = document.getElementById('vpo-ref-picker');
    if (host) { host.remove(); return; }
    host = document.createElement('div');
    host.id = 'vpo-ref-picker';
    host.style.cssText = 'position:fixed;z-index:1000;right:24px;top:96px;width:340px;max-height:60vh;overflow:auto;' +
      'background:var(--surface,#fff);border:1px solid var(--border2,#bbb);border-radius:var(--radius,4px);box-shadow:0 14px 40px rgba(0,0,0,.2)';
    var rows = (vendorPOs || []).slice().sort(function (a, b) {
      return String(a.project || '').localeCompare(String(b.project || '')) || String(a.poNum || '').localeCompare(String(b.poNum || ''));
    });
    host.innerHTML =
      '<div style="padding:8px 10px;background:var(--surface2,#f3f3f3);border-bottom:1px solid var(--border,#e2e2e2);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Open a PO as reference</div>' +
      '<input id="vpo-ref-q" placeholder="Search\u2026" style="width:100%;box-sizing:border-box;padding:7px 10px;border:0;border-bottom:1px solid var(--border,#e2e2e2);font-size:12.5px;font-family:inherit" />' +
      '<div id="vpo-ref-rows">' + rows.map(function (v) {
        var label = ((v.poNum || 'PO') + ' \u00b7 ' + (v.mfrName || '\u2014'));
        return '<div class="vpo-ref-row" data-id="' + v.id + '" data-s="' +
          String((v.poNum || '') + ' ' + (v.mfrName || '') + ' ' + (v.project || '') + ' ' + (v.itemName || '')).toLowerCase().replace(/"/g, '') +
          '" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border,#eee);font-size:12px">' +
          '<div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + label.replace(/[&<>]/g, '') + '</div>' +
          '<div style="font-size:10.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + String(v.project || '').replace(/[&<>]/g, '') + '</div></div>';
      }).join('') + '</div>';
    document.body.appendChild(host);
    host.addEventListener('click', function (e) {
      var row = e.target.closest('.vpo-ref-row');
      if (!row) return;
      openRef(row.getAttribute('data-id'));
      host.remove();
    });
    var q = document.getElementById('vpo-ref-q');
    q.oninput = function () {
      var t = q.value.toLowerCase();
      [].slice.call(host.querySelectorAll('.vpo-ref-row')).forEach(function (r) {
        r.style.display = (!t || r.getAttribute('data-s').indexOf(t) >= 0) ? '' : 'none';
      });
    };
    q.focus();
    setTimeout(function () {
      document.addEventListener('mousedown', function off(ev) {
        if (!host.contains(ev.target)) { host.remove(); document.removeEventListener('mousedown', off); }
      });
    }, 10);
  }

  // ── Pop out / dock ────────────────────────────────────────────────────────
  function popOut() {
    var ed = editor();
    if (!ed || popped) return;
    var s = shell();
    homeParent = ed.parentNode;
    homeNext = ed.nextSibling;
    document.getElementById('vpo-float-body').appendChild(ed);
    ed.style.display = 'block';
    // The editor's own toolbar lives in the topbar; bring it along, minus the
    // controls that only make sense while docked.
    var tools = document.getElementById('vpo-float-tools');
    var bar = document.getElementById('topbar-actions');
    if (bar && tools) {
      [].slice.call(bar.children).forEach(function (c) {
        if (c.id === 'vpo-popout-btn') { c.remove(); return; }
        var label = (c.textContent || '').trim();
        if (/^\u2190\s*Back$/.test(label)) { c.remove(); return; }   // Dock/✕ replace it
        tools.appendChild(c);
      });
    }
    if (bar && typeof pageConfig !== 'undefined' && pageConfig['vendor-pos']) bar.innerHTML = pageConfig['vendor-pos'].actions;
    var lv = document.getElementById('vpo-list-view');
    if (lv) lv.style.display = '';          // list stays usable behind the panel
    clampTo(s, geo() || {});
    s.style.display = 'flex';
    setTitle();
    popped = true;
    restore();                              // list keeps the position you left
  }

  function dock() {
    var ed = editor();
    var s = document.getElementById('vpo-float');
    if (!ed || !popped) return;
    var tools = document.getElementById('vpo-float-tools');
    var bar = document.getElementById('topbar-actions');
    if (bar && tools) { bar.innerHTML = ''; while (tools.firstChild) bar.appendChild(tools.firstChild); }
    if (homeParent) homeParent.insertBefore(ed, homeNext || null);
    if (s) s.style.display = 'none';
    popped = false;
    var lv = document.getElementById('vpo-list-view');
    if (lv) lv.style.display = 'none';
    ed.style.display = 'block';
  }

  function closeFloat() {
    // Dock first so the toolbar and the node go home, then close for real.
    dock();
    try { if (typeof closeVPOEditor === 'function') closeVPOEditor(); } catch (e) {}
  }

  function setTitle() {
    var t = document.getElementById('vpo-float-title');
    if (!t) return;
    var v = null;
    try { v = (vendorPOs || []).find(function (x) { return x.id === currentVPOId; }); } catch (e) {}
    t.textContent = v ? ((v.poNum || 'PO') + (v.mfrName ? ' \u00b7 ' + v.mfrName : '')) : 'New purchase order';
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  function addToolbarButton() {
    var bar = document.getElementById('topbar-actions');
    if (!bar || popped || document.getElementById('vpo-popout-btn')) return;
    if (!editorOpen() || !bar.querySelector('[onclick*="saveVPO"]')) return;
    var b = document.createElement('button');
    b.className = 'btn';
    b.id = 'vpo-popout-btn';
    b.textContent = '\u29c9 Pop Out';
    b.title = 'Float this purchase order over the list';
    b.onclick = popOut;
    bar.appendChild(b);
  }
  function paintToggle() {
    var el = document.getElementById('vpo-popout-toggle');
    if (!el) return;
    var on = pref();
    el.textContent = on ? '\u29c9 Popping out' : '\u29c9 Pop out POs';
    el.style.borderColor = on ? 'var(--accent)' : 'var(--border2)';
    el.style.color = on ? 'var(--accent-ink)' : 'var(--text3)';
    el.style.background = on ? 'var(--accent-bg)' : 'transparent';
  }
  function addListToggle() {
    var view = document.getElementById('vpo-list-view');
    if (!view || document.getElementById('vpo-popout-toggle')) return;
    var row = view.querySelector('.search-row');
    if (!row) return;
    var b = document.createElement('button');
    b.id = 'vpo-popout-toggle';
    b.className = 'btn btn-sm';
    b.style.cssText = 'margin-left:auto;white-space:nowrap';
    b.title = 'When on, opening a PO floats it over the list';
    b.onclick = function () { setPref(!pref()); };
    row.appendChild(b);
    if (!document.getElementById('vpo-ref-btn')) {
      var r = document.createElement('button');
      r.id = 'vpo-ref-btn';
      r.className = 'btn btn-sm';
      r.style.cssText = 'white-space:nowrap';
      r.textContent = '\u29c9 Reference';
      r.title = 'Open a PO in a floating read-only panel, to compare side by side';
      r.onclick = openRefPicker;
      row.appendChild(r);
    }
    paintToggle();
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  var hooked = false;
  function hook() {
    if (hooked) return;

    if (typeof window.openVPOEditor === 'function' && !window.openVPOEditor.__pwHooked) {
      var origOpen = window.openVPOEditor;
      var wo = function (id) {
        remember();
        var r = origOpen.apply(this, arguments);
        setTimeout(function () {
          if (pref() && !suppressPop) popOut(); else addToolbarButton();
          setTitle();
        }, 30);
        return r;
      };
      wo.__pwHooked = true; wo.__paHooked = origOpen.__paHooked;
      window.openVPOEditor = wo;
    }

    if (typeof window.openNewVPO === 'function' && !window.openNewVPO.__pwHooked) {
      var origNew = window.openNewVPO;
      var wn = function () {
        remember();
        var r = origNew.apply(this, arguments);
        setTimeout(function () { addToolbarButton(); setTitle(); }, 30);
        return r;
      };
      wn.__pwHooked = true; wn.__tplHooked = origNew.__tplHooked;
      window.openNewVPO = wn;
    }

    if (typeof window.closeVPOEditor === 'function' && !window.closeVPOEditor.__pwHooked) {
      var origClose = window.closeVPOEditor;
      var wc = function () {
        if (popped) dock();
        var r = origClose.apply(this, arguments);
        var btn = document.getElementById('vpo-popout-btn');
        if (btn) btn.remove();
        setTimeout(function () { addListToggle(); restore(); }, 0);
        return r;
      };
      wc.__pwHooked = true; wc.__paHooked = origClose.__paHooked;
      window.closeVPOEditor = wc;
    }

    if (typeof window.renderVPOList === 'function' && !window.renderVPOList.__pwHooked) {
      var origList = window.renderVPOList;
      var wl = function () { var r = origList.apply(this, arguments); addListToggle(); return r; };
      wl.__pwHooked = true;
      window.renderVPOList = wl;
    }

    hooked = true;
  }

  // ── Deep link (published site) ────────────────────────────────────────────
  function wantedId() {
    var m = String(location.hash || '').match(/^#po=(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function tryDeepLink() {
    var id = wantedId();
    if (!id) return true;
    if (typeof vendorPOs === 'undefined' || !Array.isArray(vendorPOs)) return false;
    var v = vendorPOs.find(function (x) { return String(x.id) === String(id); });
    if (!v) return false;
    deepLinking = true;
    try {
      var link = document.querySelector('a[data-page="vendor-pos"]');
      if (link && typeof nav === 'function') nav(link);
      suppressPop = true;                 // a dedicated window shouldn't also float
      try { if (typeof openVPOEditor === 'function') openVPOEditor(v.id); }
      finally { suppressPop = false; }
      document.title = (v.poNum ? v.poNum + ' \u00b7 ' : '') + 'STEVE';
    } catch (e) { console.warn('[ai3] deep link failed', e); }
    finally { deepLinking = false; }
    return true;
  }
  window.addEventListener('hashchange', function () { if (wantedId()) tryDeepLink(); });
  // Once the user has dragged or stretched the panel, leave it alone on resize
  // unless it would end up completely off screen.
  window.addEventListener('resize', function () {
    var s = document.getElementById('vpo-float');
    if (!s || !popped || preMax) return;
    var g = currentGeo(s);
    if (g.l > window.innerWidth - 60 || g.t > window.innerHeight - 34) clampTo(s, g);
  });
  // Safety net: Escape always docks the panel.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !popped) return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    dock();
  });

  function boot() {
    hook(); addListToggle();
    var n = 0;
    var iv = setInterval(function () {
      hook(); addListToggle();
      if (tryDeepLink() || ++n > 40) clearInterval(iv);
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.pwPopOut = popOut;
  window.pwDock = dock;
  window.pwCloseFloat = closeFloat;
  window.pwOpenRef = openRef;
  window.pwRefPicker = openRefPicker;
})();
