/* ============================================================================
   STEVE — PO autosave  (po-autosave.js)
   A purchase order saves itself while you work: every committed field edit
   schedules a quiet save a moment later, and the edit bar says where it stands.
   Nothing is written until the PO has a manufacturer (the same rule the Save
   button enforces), so an empty editor never leaves a stray record behind.

   Also wires the project → purchasing-agent / client-address fill on top of the
   app's own vpoAfterEdit.
   ========================================================================= */
(function () {
  'use strict';

  var DELAY = 900;
  var timer = null, lastJSON = '', saving = false, hooked = false;

  function el() { return document.getElementById('vpo-autosave-state'); }
  function editorOpen() {
    // Template mode borrows the PO editor but must never write a PO record.
    if (window.tplTemplateMode) return false;
    var ed = document.getElementById('vpo-editor');
    return !!(ed && ed.style.display !== 'none');
  }
  function status(text, tone) {
    var n = el(); if (!n) return;
    n.textContent = text;
    n.style.color = tone === 'warn' ? 'var(--amber,#b7791f)' : tone === 'ok' ? 'var(--green,#2e7d5b)' : 'var(--text3)';
  }

  function snapshot() {
    try { return JSON.stringify(getVPOFormData()); } catch (e) { return ''; }
  }

  // Quiet twin of saveVPO: no alert, no undo entry, no breadcrumb churn.
  function saveNow() {
    if (saving || !editorOpen()) return;
    var d;
    try { d = getVPOFormData(); } catch (e) { return; }
    if (!d || !String(d.mfrName || '').trim()) { status('Not saved \u2014 needs a manufacturer', 'warn'); return; }
    var json = JSON.stringify(d);
    if (json === lastJSON) return;
    saving = true;
    try {
      var proj = (projects || []).find(function (p) { return p.name === d.project; });
      if (currentVPOId) {
        var idx = vendorPOs.findIndex(function (v) { return v.id === currentVPOId; });
        if (idx >= 0) vendorPOs[idx] = Object.assign({}, vendorPOs[idx], d);
      } else {
        var poNum = (d.poNum && d.poNum.trim()) ? d.poNum.trim() : vpoPoNum(proj, d.itemNum);
        vendorPOs.push(Object.assign({ id: genId(), client: proj ? proj.client : '' }, d, { poNum: poNum }));
        currentVPOId = vendorPOs[vendorPOs.length - 1].id;
        var bc = document.getElementById('vpo-editor-breadcrumb');
        if (bc) bc.textContent = poNum;
      }
      DB.save('fp11_vpos', vendorPOs);
      lastJSON = json;
      var t = new Date();
      status('Saved ' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0'), 'ok');
    } catch (e) {
      console.warn('[ai3] autosave failed', e);
      status('Autosave failed \u2014 use Save', 'warn');
    } finally { saving = false; }
  }

  function schedule() {
    if (!editorOpen()) return;
    if (snapshot() === lastJSON) return;
    status('Unsaved changes\u2026');
    clearTimeout(timer);
    timer = setTimeout(saveNow, DELAY);
  }
  function flush() { clearTimeout(timer); saveNow(); }

  // Re-establish the per-PO baseline and report the true state of THIS record.
  function baseline() {
    if (window.tplTemplateMode) return;
    lastJSON = snapshot();
    mountBadge();
    status(currentVPOId ? 'Saved' : 'New \u2014 saves once a manufacturer is named',
      currentVPOId ? 'ok' : null);
  }

  // ── Hook the app's own edit-commit path ──────────────────────────────────
  function hook() {
    if (hooked) return;

    if (typeof window.vpoAfterEdit === 'function' && !window.vpoAfterEdit.__paHooked) {
      var origAfter = window.vpoAfterEdit;
      var wrapped = function (key) {
        var r = origAfter.apply(this, arguments);
        try {
          if (key === 'project' && typeof ctFillPOFromProject === 'function') {
            if (ctFillPOFromProject()) { try { recalcVPO(); } catch (e) {} }
          }
          if (key === 'ai3Contact' && typeof ctFillAgentContact === 'function') {
            ctFillAgentContact(); try { recalcVPO(); } catch (e) {}
          }
          // Naming a company pulls its primary contact into the matching block.
          if ((key === 'mfrName' || key === 'srcName') && typeof ctPrimaryFor === 'function') {
            var which = key === 'srcName' ? 'src' : 'mfr';
            var c = ctPrimaryFor(vpoForm[key]);
            var nameKey = which === 'src' ? 'srcContact' : 'mfrContact';
            if (c && !String(vpoForm[nameKey] || '').trim()) {
              vpoForm[nameKey] = c.name || '';
              vpoForm[which === 'src' ? 'srcContactTel' : 'mfrContactTel'] = c.phone || '';
              vpoForm[which === 'src' ? 'srcContactEmail' : 'mfrContactEmail'] = c.email || '';
              try { recalcVPO(); } catch (e) {}
            }
          }
        } catch (e) { console.warn('[ai3] PO fill failed', e); }
        schedule();
        return r;
      };
      wrapped.__paHooked = true;
      window.vpoAfterEdit = wrapped;
    }

    if (typeof window.vpoTypeChanged === 'function' && !window.vpoTypeChanged.__paHooked) {
      var origType = window.vpoTypeChanged;
      var wt = function () { var r = origType.apply(this, arguments); schedule(); return r; };
      wt.__paHooked = true;
      window.vpoTypeChanged = wt;
    }

    // Manual Save resets the baseline so autosave doesn't immediately re-fire.
    if (typeof window.saveVPO === 'function' && !window.saveVPO.__paBaseline) {
      var origSave = window.saveVPO;
      var ws = function () {
        var r = origSave.apply(this, arguments);
        clearTimeout(timer);
        lastJSON = snapshot();
        status('Saved', 'ok');
        return r;
      };
      ws.__paBaseline = true;
      ws.__vfHooked = origSave.__vfHooked;
      window.saveVPO = ws;
    }

    // Opening a PO establishes the baseline; closing flushes any pending edit.
    // `openVPOEditor` is what the list actually calls, and it invokes the hoisted
    // showVPOEditor directly — so hook both.
    if (typeof window.openVPOEditor === 'function' && !window.openVPOEditor.__paHooked) {
      var origOpen = window.openVPOEditor;
      var wo = function (id) {
        try { if (typeof ctMigratePO === 'function') ctMigratePO(id); } catch (e) {}
        var r = origOpen.apply(this, arguments);
        clearTimeout(timer);
        setTimeout(baseline, 60);
        return r;
      };
      wo.__paHooked = true;
      window.openVPOEditor = wo;
    }
    if (typeof window.showVPOEditor === 'function' && !window.showVPOEditor.__paHooked) {
      var origShow = window.showVPOEditor;
      var wsh = function () {
        var r = origShow.apply(this, arguments);
        clearTimeout(timer);
        setTimeout(baseline, 60);
        return r;
      };
      wsh.__paHooked = true;
      window.showVPOEditor = wsh;
    }
    if (typeof window.closeVPOEditor === 'function' && !window.closeVPOEditor.__paHooked) {
      var origClose = window.closeVPOEditor;
      var wc = function () { try { flush(); } catch (e) {} return origClose.apply(this, arguments); };
      wc.__paHooked = true;
      window.closeVPOEditor = wc;
    }

    hooked = true;
  }

  function mountBadge() {
    if (document.getElementById('vpo-autosave-state')) return;
    var bar = document.querySelector('#vpo-editor .vpo-editbar');
    if (!bar) return;
    var hint = bar.querySelector('div[style*="margin-left:auto"]');
    var span = document.createElement('span');
    span.id = 'vpo-autosave-state';
    span.style.cssText = 'font-size:11.5px;color:var(--text3);white-space:nowrap';
    if (hint) {
      hint.style.marginLeft = '0';
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:14px';
      bar.appendChild(wrap);
      wrap.appendChild(hint);
      wrap.appendChild(span);
    } else {
      span.style.marginLeft = 'auto';
      bar.appendChild(span);
    }
  }

  // A field committed inside the document also fires a native change/blur —
  // catch those too, so nothing depends on one code path.
  document.addEventListener('focusout', function (e) {
    if (!editorOpen()) return;
    if (e.target && e.target.closest && e.target.closest('#vpo-editor')) setTimeout(schedule, 30);
  }, true);
  window.addEventListener('beforeunload', function () { try { flush(); } catch (e) {} });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { try { flush(); } catch (e) {} } });

  function boot() {
    hook();
    mountBadge();
    // The editor is created lazily, so keep trying briefly after load.
    var n = 0;
    var iv = setInterval(function () { hook(); mountBadge(); if (++n > 30) clearInterval(iv); }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.paFlush = flush;
})();
