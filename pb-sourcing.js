/* ============================================================================
   STEVE — Sourcing inside the Preliminary Budget  (pb-sourcing.js)

   The budget is where numbers get decided, so the sourcing tools belong there
   too. This adds, to the open PB editor:

     • a sourcing strip  — how many lines are sourced, what has been found, and
                           what the chosen sources would do to the total;
     • Apply chosen      — writes every chosen finding's price / source / lead
                           time onto its budget line in one step;
     • Library shortlist — products parked for the project, droppable onto an
                           existing line or added as a new one;
     • Source in hub     — opens the Sourcing page scoped to THIS budget rather
                           than the Procurement Tracker.

   Per-line research (the magnifier menu) already worked here; this makes the
   project-level half of Sourcing reachable from the budget.
   ========================================================================= */
(function () {
  'use strict';

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function num(v) { return parseFloat(v) || 0; }
  function money(v) { return '$' + Math.round(num(v)).toLocaleString('en-US'); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function newId() { return Date.now() + Math.random(); }
  function editorOpen() {
    var e = document.getElementById('pb-editor');
    return !!(e && e.style.display !== 'none');
  }
  function lines() { return (typeof pbLineItems !== 'undefined' && Array.isArray(pbLineItems)) ? pbLineItems : []; }
  function realLines() { return lines().filter(function (i) { return !i.isCategory; }); }
  function projName() {
    var el = document.getElementById('pb-project');
    return (el && el.value) || '';
  }
  function chosenOf(it) { return (it.findings || []).find(function (f) { return f.chosen; }) || null; }

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

  // ── Roll-up ───────────────────────────────────────────────────────────────
  function stats() {
    var items = realLines();
    var withF = 0, sourced = 0, delta = 0, pending = 0;
    items.forEach(function (it) {
      var f = (it.findings || []).length;
      if (f) withF++;
      var ch = chosenOf(it);
      if (!ch) return;
      sourced++;
      var qty = num(it.qty) || 1;
      if (num(ch.price) > 0) {
        delta += (num(ch.price) - num(it.price)) * qty;
        if (Math.abs(num(ch.price) - num(it.price)) > 0.005) pending++;
      }
    });
    return { total: items.length, withF: withF, sourced: sourced, delta: delta, pending: pending };
  }

  // ── Apply every chosen finding to its line ───────────────────────────────
  function applyChosen() {
    var items = realLines(), n = 0;
    items.forEach(function (it) {
      var ch = chosenOf(it);
      if (!ch) return;
      var touched = false;
      if (num(ch.price) > 0 && Math.abs(num(ch.price) - num(it.price)) > 0.005) { it.price = num(ch.price); touched = true; }
      if (ch.vendor && ch.vendor !== it.vendor) { it.vendor = ch.vendor; touched = true; }
      if (ch.leadTime && ch.leadTime !== it.leadTime) { it.leadTime = ch.leadTime; touched = true; }
      if (touched) n++;
    });
    if (!n) { toast('Every chosen source already matches its budget line'); return; }
    persist('Apply chosen sources');
    if (typeof pbRenderCategoriesForm === 'function') { try { pbRenderCategoriesForm(); } catch (e) {} }
    if (typeof recalcPB === 'function') recalcPB();
    toast('\u2713 Applied ' + n + ' chosen source' + (n === 1 ? '' : 's') + ' to the budget', 3600);
  }

  // ── Library shortlist ────────────────────────────────────────────────────
  function shortlist() {
    var p = projName();
    return (typeof librarySaved !== 'undefined' && p && librarySaved[p]) ? librarySaved[p] : [];
  }
  function dropShortlist(idx, target) {
    var sl = shortlist(), s = sl[idx];
    if (!s) return;
    if (target === '__new') {
      // Land it in the last category so it is never orphaned above the first one.
      var at = lines().length;
      var newItem = {
        id: newId(), isCategory: false,
        itemNum: String(100 + realLines().length),
        name: s.name || '', description: s.description || '', vendor: s.vendor || '',
        qty: 1, price: num(s.price), leadTime: s.leadTime || '', location: '', notes: '', bold: false
      };
      pbLineItems.splice(at, 0, newItem);
      persist('Add line from Library');
      if (typeof pbRenderCategoriesForm === 'function') { try { pbRenderCategoriesForm(); } catch (e) {} }
      if (typeof recalcPB === 'function') recalcPB();
      toast('\u2713 Added \u201c' + (s.name || 'product') + '\u201d as a new budget line', 3600);
      return;
    }
    var it = lines().find(function (x) { return String(x.id) === String(target); });
    if (!it) return;
    // Attach as a finding, so the line keeps its own estimate until you choose.
    it.findings = it.findings || [];
    it.findings.push({
      id: newId(), mode: 'library', name: s.name || '', vendor: s.vendor || '',
      price: num(s.price), leadTime: s.leadTime || '', url: s.url || '',
      description: s.description || '', notes: 'From Library shortlist',
      chosen: false, savedAt: new Date().toISOString().slice(0, 10)
    });
    persist('Shortlist to budget line');
    if (typeof recalcPB === 'function') recalcPB();
    toast('Added to ' + (it.name || 'the line') + ' as a finding \u2014 open Research to compare', 4200);
  }
  function removeShortlist(idx) {
    var p = projName();
    if (!p || typeof librarySaved === 'undefined' || !librarySaved[p]) return;
    librarySaved[p].splice(idx, 1);
    try { DB.save('fp11_libsaved', librarySaved); } catch (e) {}
    render();
  }

  // ── Open the hub against this budget ─────────────────────────────────────
  function sourceInHub() {
    if (typeof currentPBId === 'undefined' || !currentPBId) {
      toast('\u26a0 Save the budget first, then it can be sourced in the hub');
      return;
    }
    var p = projName();
    if (!p) { toast('\u26a0 Pick a project first'); return; }
    // research.js reads this when resolving what the hub sources.
    window.srcSourceOverride = { store: 'pbrec', pbId: currentPBId, project: p };
    var link = document.querySelector('nav a[data-page="sourcing"]');
    if (link && typeof nav === 'function') nav(link);
    else if (typeof renderSourcing === 'function') renderSourcing();
  }

  // ── Strip ─────────────────────────────────────────────────────────────────
  function host() {
    var pv = document.getElementById('pb-preview');
    if (!pv) return null;
    var h = document.getElementById('pb-src-strip');
    if (!h) {
      h = document.createElement('div');
      h.id = 'pb-src-strip';
      h.style.cssText = 'margin-bottom:12px';
      pv.parentNode.insertBefore(h, pv);
    }
    return h;
  }

  function render() {
    if (!editorOpen()) return;
    var h = host();
    if (!h) return;
    if (typeof pbViewMode !== 'undefined' && pbViewMode === 'client') { h.innerHTML = ''; return; }

    var st = stats(), sl = shortlist();
    if (!st.total) { h.innerHTML = ''; return; }

    var itemOpts = realLines().filter(function (i) { return i.name || i.itemNum; })
      .map(function (it) {
        return '<option value="' + esc(it.id) + '">' + esc((it.itemNum ? it.itemNum + ' \u00b7 ' : '') + (it.name || 'line')) + '</option>';
      }).join('');

    var pill = function (label, value, sub, tone) {
      return '<div style="min-width:104px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">' + label + '</div>' +
        '<div style="font-size:15px;font-weight:600;margin-top:1px' + (tone ? ';color:' + tone : '') + '">' + value + '</div>' +
        '<div style="font-size:10.5px;color:var(--text3)">' + sub + '</div></div>';
    };

    var deltaTone = st.delta < 0 ? 'var(--green,#2e7d5b)' : st.delta > 0 ? 'var(--red,#c0392b)' : '';
    var deltaText = st.sourced
      ? (st.delta === 0 ? 'on estimate' : (st.delta < 0 ? '\u2193 ' + money(-st.delta) : '\u2191 ' + money(st.delta)))
      : '\u2014';

    h.innerHTML =
      '<div class="card" style="padding:12px 16px;border-left:3px solid var(--accent)">' +
        '<div style="display:flex;align-items:flex-start;gap:22px;flex-wrap:wrap">' +
          '<div style="min-width:150px">' +
            '<div style="font-weight:600;font-size:13px">Sourcing</div>' +
            '<div style="font-size:11.5px;color:var(--text2);line-height:1.4">Research any line with the magnifier, then bring the numbers back here.</div>' +
          '</div>' +
          pill('Sourced', st.sourced + ' / ' + st.total, 'lines with a chosen source') +
          pill('In research', st.withF, 'lines with findings') +
          pill('Chosen vs estimate', deltaText, st.sourced ? 'across sourced lines' : 'nothing chosen yet', deltaTone) +
          '<div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">' +
            (st.pending
              ? '<button class="btn btn-sm btn-primary" onclick="pbsApplyChosen()">Apply ' + st.pending + ' chosen price' + (st.pending === 1 ? '' : 's') + '</button>'
              : '') +
            '<button class="btn btn-sm" onclick="pbsSourceInHub()">Source in hub \u2192</button>' +
          '</div>' +
        '</div>' +
        (sl.length ? shortlistHTML(sl, itemOpts) : '') +
      '</div>';
  }

  function shortlistHTML(sl, itemOpts) {
    return '<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:11px">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">From the Library</div>' +
        '<div style="font-size:11px;color:var(--text3)">' + sl.length + ' shortlisted for this project</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px">' +
      sl.map(function (s, idx) {
        var img = s.image
          ? '<div style="height:70px;background:var(--surface2);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:6px">' +
            '<img data-sbsrc="' + String(s.image).replace(/"/g, '&quot;') + '" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'" /></div>'
          : '';
        return '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 10px;background:var(--surface)">' + img +
          '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name || '(unnamed)') + '</div>' +
          '<div style="font-size:10.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.vendor || '') + '</div>' +
          '<div style="font-size:12px;font-weight:600;margin:4px 0 7px">' + (num(s.price) > 0 ? money(s.price) : '\u2014') + '</div>' +
          '<select onchange="if(this.value){pbsDropShortlist(' + idx + ',this.value);this.value=\'\';}" ' +
            'style="width:100%;height:26px;font-size:11px;font-family:inherit;border:1px solid var(--border2);border-radius:3px;background:var(--surface);cursor:pointer">' +
            '<option value="">Use in budget \u25be</option>' +
            '<option value="__new">Add as a new line</option>' +
            (itemOpts ? '<optgroup label="Compare against">' + itemOpts + '</optgroup>' : '') +
          '</select>' +
          '<div style="text-align:right;margin-top:5px"><span onclick="pbsRemoveShortlist(' + idx + ')" style="font-size:10.5px;color:var(--text3);cursor:pointer">Remove</span></div>' +
        '</div>';
      }).join('') + '</div></div>';
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  var hooked = false;
  function hook() {
    if (hooked) return;
    if (typeof window.recalcPB === 'function' && !window.recalcPB.__pbsHooked) {
      var orig = window.recalcPB;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { render(); } catch (e) { console.warn('[ai3] PB sourcing strip failed', e); }
        return r;
      };
      w.__pbsHooked = true;
      window.recalcPB = w;
      hooked = true;
    }
  }

  window.pbsApplyChosen = applyChosen;
  window.pbsSourceInHub = sourceInHub;
  window.pbsDropShortlist = dropShortlist;
  window.pbsRemoveShortlist = removeShortlist;
  window.pbsRender = render;

  function boot() {
    hook();
    var n = 0;
    var iv = setInterval(function () { hook(); if (hooked || ++n > 30) clearInterval(iv); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
