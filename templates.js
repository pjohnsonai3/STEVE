/* ============================================================================
   STEVE — Templates  (templates.js)
   A workspace-level shelf of reusable document shells, one step under Projects:
     • PO templates   — a purchase order with its type, standard notes, spec
                        rows, terms and instructions already set. Prices, dates,
                        project and images are never carried over.
     • Spec templates — a specification book's areas, cover and issue settings,
                        without any items.

   Any PO or specification book, on any project, can become a template — either
   from its own toolbar or from the picker on this page. Templates themselves are
   project-agnostic by construction: everything tying a record to one job is
   stripped on capture, so using one is always safe.
   ========================================================================= */
(function () {
  'use strict';

  // Never carried into a template — job-specific, financial, or per-record.
  var PO_STRIP = ['id', 'project', 'client', 'poNum', '_poNumEdited', 'issueDate', 'revisionDate',
    'unitPrice', 'qty', 'amtPaid', 'taxPaid', 'freightPaid', 'datePaid', 'paymentType', 'orderNo',
    'status', 'images', 'vpoImages', 'extraPages', '_ctMigrated', 'billTo', '_billToEdited',
    'shipName', 'shipAttn', 'shipAddr', 'shipCity', 'shipPhone', 'shipContact'];
  var SPEC_STRIP = ['items', 'issueDate'];
  var VENDOR_KEYS = ['mfrName', 'mfrAddr', 'mfrCity', 'mfrTel', 'mfrEmail', 'mfrWeb', 'mfrContact',
    'mfrContactTel', 'mfrContactEmail', 'srcName', 'srcWeb', 'srcContact', 'srcContactTel', 'srcContactEmail'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function newId() { try { return genId(); } catch (e) { return Date.now() + Math.floor(Math.random() * 1000); } }
  function list() { return (typeof docTemplates !== 'undefined' && Array.isArray(docTemplates)) ? docTemplates : []; }
  function save(label) {
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(label, []); } catch (e) {}
    try { DB.save('fp11_templates', docTemplates); } catch (e) {}
  }
  function stamp(d) { if (!d) return ''; var t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  // ── In-app dialog ─────────────────────────────────────────────────────
  // window.prompt / confirm are blocked in some hosts (they return null / false
  // without showing anything), which would silently abandon every capture. All
  // template dialogs are therefore built in the page.
  var askCb = null;

  function ask(opts) {
    mountAsk();
    askCb = opts.onOk || null;
    document.getElementById('tpl-ask-title').textContent = opts.title || '';
    var body = '';
    if (opts.message) body += '<p style="font-size:12.5px;color:var(--text2);margin:0 0 12px;line-height:1.5">' + opts.message + '</p>';
    if (opts.field) {
      body += '<label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:4px">' + esc(opts.field) + '</label>' +
        '<input id="tpl-ask-text" value="' + esc(opts.value || '') + '" style="width:100%;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;box-sizing:border-box;margin-bottom:12px" />';
    }
    if (opts.select) {
      body += '<label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:4px">' + esc(opts.select.label || '') + '</label>' +
        '<select id="tpl-ask-select" style="width:100%;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;box-sizing:border-box;margin-bottom:12px">' +
        opts.select.options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') + '</select>';
    }
    if (opts.check) {
      body += '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text2);cursor:pointer;margin-bottom:4px">' +
        '<input type="checkbox" id="tpl-ask-check"' + (opts.checkDefault ? ' checked' : '') + ' style="margin-top:2px;cursor:pointer" />' +
        '<span>' + opts.check + '</span></label>';
    }
    document.getElementById('tpl-ask-body').innerHTML = body;
    document.getElementById('tpl-ask-ok').textContent = opts.ok || 'Save';
    var m = document.getElementById('tpl-ask-modal');
    try { openModal('tpl-ask-modal'); } catch (e) { m.classList.add('open'); }
    setTimeout(function () {
      var t = document.getElementById('tpl-ask-text');
      if (t) { t.focus(); t.select(); t.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); askOk(); } }; }
    }, 40);
  }
  function askClose() {
    askCb = null;
    try { closeModal('tpl-ask-modal'); } catch (e) {
      var m = document.getElementById('tpl-ask-modal'); if (m) m.classList.remove('open');
    }
  }
  function askOk() {
    var t = document.getElementById('tpl-ask-text');
    var s = document.getElementById('tpl-ask-select');
    var c = document.getElementById('tpl-ask-check');
    var res = { text: t ? String(t.value || '').trim() : '', select: s ? s.value : '', checked: !!(c && c.checked) };
    if (t && !res.text) { t.style.borderColor = 'var(--red,#c0392b)'; t.focus(); return; }
    var cb = askCb;
    askClose();
    if (cb) cb(res);
  }
  function mountAsk() {
    if (document.getElementById('tpl-ask-modal')) return;
    var m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'tpl-ask-modal';
    m.innerHTML = '<div class="modal" style="width:440px">' +
      '<div class="modal-header"><div class="modal-title" id="tpl-ask-title"></div>' +
      '<button class="modal-close" onclick="tplAskClose()">\u2715</button></div>' +
      '<div class="modal-body" id="tpl-ask-body"></div>' +
      '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn" onclick="tplAskClose()">Cancel</button>' +
      '<button class="btn btn-primary" id="tpl-ask-ok" onclick="tplAskOk()">Save</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) askClose(); });
  }

  // ── Capture ───────────────────────────────────────────────────────────────
  function makePOTemplate(src, presetName, keepVendor) {
    var body = {};
    Object.keys(src).forEach(function (k) { if (PO_STRIP.indexOf(k) < 0) body[k] = src[k]; });
    if (!keepVendor) VENDOR_KEYS.forEach(function (k) { body[k] = ''; });
    docTemplates.push({
      id: newId(), kind: 'po', name: presetName, poType: src.type || '',
      fromProject: src.project || '', body: body, created: new Date().toISOString(), used: 0
    });
    save('Save PO template');
    render();
  }

  function askAndSavePO(src, suggested) {
    ask({
      title: 'Save as PO template',
      field: 'Template name',
      value: suggested,
      check: 'Keep the manufacturer and source details (' + esc(src.mfrName || 'none on this PO') + '). Uncheck to leave them blank so the template works for any company.',
      checkDefault: true,
      ok: 'Save template',
      onOk: function (r) {
        makePOTemplate(src, r.text, r.checked);
        toast('\u2713 \u201c' + r.text + '\u201d saved to Templates', 3800);
        closePicker();
      }
    });
  }

  // From the PO editor toolbar
  function saveCurrentPO() {
    var d;
    try { d = getVPOFormData(); } catch (e) { d = null; }
    if (!d) { toast('\u26a0 Open a purchase order first'); return; }
    askAndSavePO(d, (d.type || 'PO') + (d.mfrName ? ' \u2014 ' + d.mfrName : ''));
  }
  // From the picker on this page — any PO, any project
  function savePOById(id) {
    var v = (vendorPOs || []).find(function (x) { return String(x.id) === String(id); });
    if (!v) return;
    askAndSavePO(v, (v.type || 'PO') + (v.mfrName ? ' \u2014 ' + v.mfrName : ''));
  }

  function makeSpecTemplate(projName, presetName) {
    var sb = (typeof specBooks !== 'undefined') ? specBooks[projName] : null;
    if (!sb) return false;
    var body = {};
    Object.keys(sb).forEach(function (k) { if (SPEC_STRIP.indexOf(k) < 0) body[k] = clone(sb[k]); });
    docTemplates.push({
      id: newId(), kind: 'spec', name: presetName,
      areas: Array.isArray(body.areas) ? body.areas.length : 0,
      fromProject: projName, body: body, created: new Date().toISOString(), used: 0
    });
    save('Save spec template');
    render();
    return true;
  }
  function saveCurrentSpec() {
    var pn = (typeof activeProject !== 'undefined' && activeProject) ? activeProject.name : '';
    if (!pn || !(typeof specBooks !== 'undefined' && specBooks[pn])) { toast('\u26a0 Open a project with a specification book first'); return; }
    ask({
      title: 'Save as specification template',
      field: 'Template name', value: pn + ' layout', ok: 'Save template',
      onOk: function (r) { if (makeSpecTemplate(pn, r.text)) toast('\u2713 \u201c' + r.text + '\u201d saved to Templates', 3800); }
    });
  }
  function saveSpecByProject(pn) {
    ask({
      title: 'Save as specification template',
      field: 'Template name', value: pn + ' layout', ok: 'Save template',
      onOk: function (r) {
        if (makeSpecTemplate(pn, r.text)) { toast('\u2713 \u201c' + r.text + '\u201d saved to Templates', 3800); closePicker(); }
      }
    });
  }

  // PO types come from the app itself, plus any type already in use on a template
  // or a saved PO, so nothing in the workspace is missing from the list.
  function poTypes() {
    var out = [], seen = {};
    function add(v) { v = String(v || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } }
    var sel = document.getElementById('vpo-type');
    if (sel && sel.options.length) [].slice.call(sel.options).forEach(function (o) { add(o.value || o.textContent); });
    else if (typeof VPO_BOILERPLATE !== 'undefined') Object.keys(VPO_BOILERPLATE).forEach(add);
    list().forEach(function (t) { if (t.kind === 'po') add(t.poType); });
    try { (vendorPOs || []).forEach(function (v) { add(v.type); }); } catch (e) {}
    return out.length ? out : ['Furniture'];
  }

  // ── Create from scratch ──────────────────────────────────────────────
  // A blank template still arrives useful: the chosen type brings its standard
  // notes and its spec rows with it.
  function newPOTemplate() {
    var types = poTypes();
    ask({
      title: 'New PO template',
      field: 'Template name',
      value: '',
      select: { label: 'PO type', options: types },
      ok: 'Create',
      onOk: function (r) {
        var type = r.select || types[0];
        var notes = '';
        try { notes = (VPO_BOILERPLATE[type] || VPO_BOILERPLATE['Furniture'] || []).join('\n'); } catch (e) {}
        var body = { type: type, notes: notes, salesTax: 'charge', delivery: '' };
        try { (PO_TYPE_FIELDS[type] || []).forEach(function (f) { body[f[1]] = ''; }); } catch (e) {}
        docTemplates.push({
          id: newId(), kind: 'po', name: r.text, poType: type,
          fromProject: '', body: body, created: new Date().toISOString(), used: 0
        });
        save('New PO template');
        render();
        toast('\u2713 \u201c' + r.text + '\u201d created with the standard ' + type + ' notes', 4200);
      }
    });
  }

  function newSpecTemplate() {
    ask({
      title: 'New specification template',
      field: 'Template name',
      message: 'Starts empty. Set the areas and cover up on a project\u2019s specification book, then use <strong>Save as Template</strong> to capture the finished layout.',
      ok: 'Create',
      onOk: function (r) {
        docTemplates.push({
          id: newId(), kind: 'spec', name: r.text, areas: 0,
          fromProject: '', body: { areas: [], cover: {} }, created: new Date().toISOString(), used: 0
        });
        save('New spec template');
        render();
        toast('\u2713 \u201c' + r.text + '\u201d created', 3400);
      }
    });
  }

  // ── Use ───────────────────────────────────────────────────────────────────
  function withProject(title, run) {
    if (forcedProject) { run(forcedProject); return; }
    if (typeof activeProject !== 'undefined' && activeProject) { run(activeProject); return; }
    var names = (projects || []).map(function (p) { return p.name; });
    if (!names.length) { toast('\u26a0 Create a project first'); return; }
    if (names.length === 1) { run((projects || [])[0]); return; }
    ask({
      title: title, select: { label: 'Project', options: names }, ok: 'Continue',
      onOk: function (r) {
        var p = (projects || []).find(function (x) { return x.name === r.select; });
        if (p) run(p);
      }
    });
  }

  function usePO(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); });
    if (!t || t.kind !== 'po') return;
    withProject('Start a PO from “' + t.name + '”', function (proj) {
      try {
        var link = document.querySelector('a[data-page="vendor-pos"]');
        if (link && typeof nav === 'function') nav(link);
        // The page's own New PO button is openNewVPO(); there is no newVPO().
        if (typeof openNewVPO !== 'function') throw new Error('New PO editor unavailable');
        applyingTemplate = true;      // don't seed from the default type on the way in
        try { openNewVPO(); } finally { applyingTemplate = false; }
        loadBody(t.body);
        vpoForm.project = proj.name;
        vpoForm._typeManual = true;
        var sel = document.getElementById('vpo-type');
        if (sel && t.poType) sel.value = t.poType;
        if (typeof vpoAfterEdit === 'function') vpoAfterEdit('project');
        else if (typeof recalcVPO === 'function') recalcVPO();
      } catch (e) {
        console.warn('[ai3] template apply failed', e);
        toast('\u26a0 Could not start a PO from that template');
        return;
      }
      t.used = (t.used || 0) + 1;
      noteDeployment(t, proj.name);
      save('Use PO template');
      toast('Started a ' + (t.poType || 'PO') + ' from “' + t.name + '” on ' + proj.name, 4600);
    });
  }

  function useSpec(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); });
    if (!t || t.kind !== 'spec') return;
    withProject('Apply “' + t.name + '” to a project', function (proj) {
      var existing = (typeof specBooks !== 'undefined') ? specBooks[proj.name] : null;
      var busy = existing && ((existing.items || []).length || (existing.areas || []).length);
      var go = function () {
        try {
          var sb = specBooks[proj.name] || { areas: [], items: [], cover: {}, issueDate: '' };
          Object.keys(t.body).forEach(function (k) { sb[k] = clone(t.body[k]); });
          if (!Array.isArray(sb.items)) sb.items = [];
          specBooks[proj.name] = sb;
          DB.save('fp11_specs', specBooks);
          if (typeof renderSpecifications === 'function' && document.getElementById('spec-items-wrap')) renderSpecifications();
          else if (typeof renderSpecProjectDashboard === 'function' && document.getElementById('spec-dashboard')) renderSpecProjectDashboard();
        } catch (e) {
          console.warn('[ai3] spec template apply failed', e);
          toast('\u26a0 Could not apply that template');
          return;
        }
        t.used = (t.used || 0) + 1;
        noteDeployment(t, proj.name);
        save('Use spec template');
        toast('\u2713 Applied “' + t.name + '” to ' + proj.name, 4000);
        render();
      };
      if (busy) {
        ask({
          title: 'Overwrite the layout?',
          message: '<strong>' + esc(proj.name) + '</strong> already has a specification book. Applying this template replaces its areas and cover settings. Items already in the book are kept.',
          ok: 'Apply template', onOk: go
        });
      } else go();
    });
  }

  function rename(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); }); if (!t) return;
    ask({
      title: 'Rename template', field: 'Name', value: t.name, ok: 'Rename',
      onOk: function (r) { t.name = r.text; save('Rename template'); render(); }
    });
  }
  function duplicate(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); }); if (!t) return;
    var c = clone(t); c.id = newId(); c.name = t.name + ' (copy)'; c.used = 0; c.created = new Date().toISOString();
    docTemplates.push(c); save('Duplicate template'); render();
    toast('Duplicated “' + t.name + '”', 2600);
  }
  function remove(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); }); if (!t) return;
    ask({
      title: 'Delete template',
      message: 'Delete <strong>' + esc(t.name) + '</strong>? Documents already made from it are not affected.',
      ok: 'Delete',
      onOk: function () {
        docTemplates = docTemplates.filter(function (x) { return String(x.id) !== String(id); });
        save('Delete template'); render();
        toast('Deleted “' + t.name + '”', 2600);
      }
    });
  }

  // ── Picker: turn an existing document into a template ────────────────────
  var pickerKind = 'po', pickerQuery = '';
  var forcedProject = null;
  var editingId = null;      // template being edited in the PO editor
  var deployedPick = '';     // template shown in the Deployed Templates panel
  var applyingTemplate = false;  // suppresses type-seeding while a template loads

  // Every field a template can carry. Cleared before a body is loaded, so a
  // sparse template can never inherit leftovers from another type.
  function templateFieldKeys() {
    var keys = VENDOR_KEYS.slice().concat(['notes', 'delivery', 'salesTax', 'poSubtitle', 'links',
      'shipInstructions', 'itemNum', 'itemHeadline', 'skuNum']);
    try {
      Object.keys(PO_TYPE_FIELDS).forEach(function (ty) {
        PO_TYPE_FIELDS[ty].forEach(function (f) { if (keys.indexOf(f[1]) < 0) keys.push(f[1]); });
      });
    } catch (e) {}
    return keys;
  }
  function loadBody(body) {
    templateFieldKeys().forEach(function (k) { vpoForm[k] = ''; });
    Object.keys(body || {}).forEach(function (k) { vpoForm[k] = body[k]; });
  }

  function noteDeployment(t, projName) {
    if (!Array.isArray(t.deployedTo)) t.deployedTo = [];
    t.deployedTo.push({ project: projName, date: new Date().toISOString() });
    if (t.deployedTo.length > 60) t.deployedTo = t.deployedTo.slice(-60);
  }

  function openPicker(kind) {
    pickerKind = kind || 'po'; pickerQuery = '';
    renderPicker();
    try { openModal('tpl-picker-modal'); } catch (e) {
      var m = document.getElementById('tpl-picker-modal'); if (m) m.classList.add('open');
    }
  }
  function closePicker() {
    try { closeModal('tpl-picker-modal'); } catch (e) {
      var m = document.getElementById('tpl-picker-modal'); if (m) m.classList.remove('open');
    }
  }
  function pickerSearch(v) { pickerQuery = String(v || ''); renderPicker(); }

  function renderPicker() {
    var body = document.getElementById('tpl-picker-body'); if (!body) return;
    var q = pickerQuery.toLowerCase();
    var tabs = '<div style="display:flex;gap:6px;margin-bottom:10px">' +
      '<button class="btn btn-sm' + (pickerKind === 'po' ? ' btn-primary' : '') + '" onclick="tplPickerKind(\'po\')">Purchase orders</button>' +
      '<button class="btn btn-sm' + (pickerKind === 'spec' ? ' btn-primary' : '') + '" onclick="tplPickerKind(\'spec\')">Specification books</button>' +
      '</div>' +
      '<input class="search-input" style="margin-bottom:10px" placeholder="Search\u2026" value="' + esc(pickerQuery) + '" oninput="tplPickerSearch(this.value)" />';

    if (pickerKind === 'spec') {
      var books = Object.keys((typeof specBooks !== 'undefined' && specBooks) || {})
        .filter(function (pn) { var sb = specBooks[pn]; return sb && ((sb.areas || []).length || (sb.items || []).length); })
        .filter(function (pn) { return !q || pn.toLowerCase().indexOf(q) >= 0; })
        .sort();
      body.innerHTML = tabs + (books.length
        ? '<div style="max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
          books.map(function (pn) {
            var sb = specBooks[pn];
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border)">' +
              '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12.5px">' + esc(pn) + '</div>' +
              '<div style="font-size:11px;color:var(--text3)">' + (sb.areas || []).length + ' areas \u00b7 ' + (sb.items || []).length + ' items</div></div>' +
              '<button class="btn btn-sm" onclick="tplSaveSpecByProject(' + JSON.stringify(pn).replace(/"/g, '&quot;') + ')">Make template</button></div>';
          }).join('') + '</div>'
        : '<div style="font-size:12.5px;color:var(--text3);padding:8px 0">No specification books' + (q ? ' match that search.' : ' yet.') + '</div>');
      return;
    }

    var pos = (typeof vendorPOs !== 'undefined' ? vendorPOs : []).filter(function (v) {
      if (!q) return true;
      return [v.poNum, v.project, v.mfrName, v.type, v.itemName, v.itemHeadline]
        .some(function (f) { return String(f || '').toLowerCase().indexOf(q) >= 0; });
    });
    var byProj = {};
    pos.forEach(function (v) { var k = v.project || '(no project)'; (byProj[k] = byProj[k] || []).push(v); });
    var keys = Object.keys(byProj).sort();
    body.innerHTML = tabs + (pos.length
      ? '<div style="max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
        keys.map(function (pn) {
          return '<div style="padding:6px 10px;background:var(--surface2);font-size:11px;font-weight:600;color:var(--text2);position:sticky;top:0">' + esc(pn) + ' <span style="font-weight:400;color:var(--text3)">' + byProj[pn].length + '</span></div>' +
            byProj[pn].slice(0, 200).map(function (v) {
              return '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid var(--border)">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v.poNum || '(no number)') + ' \u00b7 ' + esc(v.mfrName || '\u2014') + '</div>' +
                  '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v.type || '') + (v.itemName ? ' \u00b7 ' + esc(v.itemName) : '') + '</div>' +
                '</div>' +
                '<button class="btn btn-sm" onclick="tplSavePOById(\'' + v.id + '\')">Make template</button></div>';
            }).join('');
        }).join('') + '</div>'
      : '<div style="font-size:12.5px;color:var(--text3);padding:8px 0">No purchase orders' + (q ? ' match that search.' : ' yet.') + '</div>');
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  function editPO(id) {
    var t = list().find(function (x) { return String(x.id) === String(id); });
    if (!t || t.kind !== 'po') return;
    try {
      var link = document.querySelector('a[data-page="vendor-pos"]');
      if (link && typeof nav === 'function') nav(link);
      if (typeof openNewVPO !== 'function') throw new Error('PO editor unavailable');
      // Set before opening: the editor opens on the default type, and seeding
      // from that type's template would contaminate this one.
      editingId = t.id;
      window.tplTemplateMode = true;          // po-autosave.js checks this
      openNewVPO();
      loadBody(t.body);
      vpoForm.project = '';
      vpoForm._typeManual = true;
      var sel = document.getElementById('vpo-type');
      if (sel && t.poType) sel.value = t.poType;
      if (typeof recalcVPO === 'function') recalcVPO();
      dressEditor(t);
    } catch (e) {
      console.warn('[ai3] template edit failed', e);
      exitEdit();
      toast('\u26a0 Could not open that template for editing');
    }
  }

  function dressEditor(t) {
    var actions = document.getElementById('topbar-actions');
    if (actions) {
      actions.innerHTML =
        '<button class="btn btn-primary" onclick="tplSaveEdit()">Save template</button>' +
        '<button class="btn" onclick="tplCancelEdit()">Cancel</button>';
    }
    var bc = document.getElementById('vpo-editor-breadcrumb');
    if (bc) bc.textContent = 'Template: ' + t.name;
    var bar = document.querySelector('#vpo-editor .vpo-editbar');
    if (bar && !document.getElementById('tpl-edit-banner')) {
      var b = document.createElement('div');
      b.id = 'tpl-edit-banner';
      b.style.cssText = 'width:100%;order:-1;background:var(--accent-bg);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:7px 11px;font-size:12px;color:var(--accent-ink);margin-bottom:8px';
      b.innerHTML = 'Editing the template <strong>' + esc(t.name) + '</strong>. Nothing here becomes a purchase order — <strong>Save template</strong> stores these settings for reuse. Project, prices, dates and ship-to are not part of a template.';
      bar.parentNode.insertBefore(b, bar);
    }
    var badge = document.getElementById('vpo-autosave-state');
    if (badge) { badge.textContent = 'Template mode \u2014 autosave off'; badge.style.color = 'var(--accent-ink)'; }
  }

  function saveEdit() {
    var t = list().find(function (x) { return String(x.id) === String(editingId); });
    if (!t) { exitEdit(); return; }
    var d;
    try { d = getVPOFormData(); } catch (e) { toast('\u26a0 Could not read the editor'); return; }
    var body = {};
    Object.keys(d).forEach(function (k) { if (PO_STRIP.indexOf(k) < 0) body[k] = d[k]; });
    t.body = body;
    t.poType = d.type || t.poType;
    t.updated = new Date().toISOString();
    save('Edit PO template');
    var name = t.name;
    exitEdit();
    toast('\u2713 \u201c' + name + '\u201d updated', 3600);
  }

  function cancelEdit() { exitEdit(); toast('Edit discarded', 2200); }

  function exitEdit() {
    var b = document.getElementById('tpl-edit-banner');
    if (b) b.remove();
    // Close the editor while STILL in template mode: po-autosave wraps
    // closeVPOEditor with a flush, and its editorOpen() guard is what stops that
    // flush from writing a purchase order. Clear the flag only afterwards.
    try { if (typeof closeVPOEditor === 'function') closeVPOEditor(); }
    catch (e) {}
    finally {
      window.tplTemplateMode = false;
      editingId = null;
      try { currentVPOId = null; } catch (e) {}
    }
    var link = document.querySelector('a[data-page="templates"]');
    if (link && typeof nav === 'function') nav(link);
    render();
  }

  // ── Make the type's template the starting point for new POs ─────────────
  // STEVE seeds a new PO's notes from the hard-coded VPO_BOILERPLATE. Where a
  // type has a template, that template wins — but only while the notes are still
  // untouched boilerplate, so a PO someone has already written on is never
  // rewritten underneath them.
  function isUntouchedNotes(notes) {
    var n = String(notes || '');
    if (!n.trim()) return true;
    try {
      var std = Object.keys(VPO_BOILERPLATE).some(function (k) { return VPO_BOILERPLATE[k].join('\n') === n; });
      if (std) return true;
    } catch (e) {}
    return list().some(function (t) { return t.kind === 'po' && String(t.body && t.body.notes || '') === n; });
  }

  function applyTypeTemplate(type) {
    if (window.tplTemplateMode || applyingTemplate) return false;
    if (typeof vpoForm === 'undefined' || !vpoForm) return false;
    var t = templateForType(type);
    if (!t || !t.body) return false;
    var body = t.body, touched = false;
    if (body.notes && isUntouchedNotes(vpoForm.notes)) { vpoForm.notes = body.notes; touched = true; }
    // Everything else fills only where the PO is still blank.
    Object.keys(body).forEach(function (k) {
      if (k === 'notes' || k === 'type' || k === 'project') return;
      var v = body[k];
      if (v == null || v === '' || typeof v === 'object') return;
      if (!String(vpoForm[k] == null ? '' : vpoForm[k]).trim()) { vpoForm[k] = v; touched = true; }
    });
    return touched;
  }

  function hookEditor() {
    if (typeof window.vpoTypeChanged === 'function' && !window.vpoTypeChanged.__tplHooked) {
      var origType = window.vpoTypeChanged;
      var wt = function () {
        var r = origType.apply(this, arguments);
        try {
          var sel = document.getElementById('vpo-type');
          if (sel && applyTypeTemplate(sel.value) && typeof recalcVPO === 'function') recalcVPO();
        } catch (e) { console.warn('[ai3] template seed failed', e); }
        return r;
      };
      wt.__tplHooked = true;
      wt.__paHooked = origType.__paHooked;
      window.vpoTypeChanged = wt;
    }
    if (typeof window.openNewVPO === 'function' && !window.openNewVPO.__tplHooked) {
      var origNew = window.openNewVPO;
      var wn = function () {
        var r = origNew.apply(this, arguments);
        try {
          var sel = document.getElementById('vpo-type');
          if (sel && applyTypeTemplate(sel.value) && typeof recalcVPO === 'function') recalcVPO();
        } catch (e) { console.warn('[ai3] template seed failed', e); }
        return r;
      };
      wn.__tplHooked = true;
      window.openNewVPO = wn;
    }
  }

  // A type's footprint = purchase orders already saved with that type, plus the
  // deployments recorded when its template was used. The second half matters
  // because a PO started from Use isn't written until it has a manufacturer.
  function typeUsage(type) {
    var byProj = {}, total = 0, deployed = 0;
    function touch(k) { if (!byProj[k]) byProj[k] = { n: 0, last: '', deployed: 0 }; return byProj[k]; }
    try {
      (vendorPOs || []).forEach(function (v) {
        if ((v.type || '') !== type) return;
        total++;
        var e = touch(v.project || '(no project)');
        e.n++;
        var d = String(v.issueDate || '');
        if (/^\d{4}-\d{2}-\d{2}/.test(d) && d > e.last) e.last = d;
      });
    } catch (e) {}
    list().forEach(function (t) {
      if (t.kind !== 'po' || (t.poType || '') !== type) return;
      (t.deployedTo || []).forEach(function (d) {
        deployed++;
        var e = touch(d.project || '(no project)');
        e.deployed++;
        var iso = String(d.date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}/.test(iso) && iso > e.last) e.last = iso;
      });
    });
    return { total: total, deployed: deployed, byProject: byProj };
  }

  function templateForType(type) {
    return list().find(function (t) { return t.kind === 'po' && (t.poType || '') === type; }) || null;
  }
  function establishType(type, thenEdit) {
    var notes = '';
    try { notes = (VPO_BOILERPLATE[type] || VPO_BOILERPLATE['Furniture'] || []).join('\n'); } catch (e) {}
    var body = { type: type, notes: notes, salesTax: 'charge', delivery: '' };
    try { (PO_TYPE_FIELDS[type] || []).forEach(function (f) { body[f[1]] = ''; }); } catch (e) {}
    var rec = {
      id: newId(), kind: 'po', name: type + ' template', poType: type,
      fromProject: '', body: body, created: new Date().toISOString(), used: 0
    };
    docTemplates.push(rec);
    save('Establish ' + type + ' template');
    if (thenEdit) editPO(rec.id); else { render(); toast('\u2713 ' + type + ' template established from the standard notes', 4000); }
    return rec;
  }
  function editType(type) {
    var t = templateForType(type);
    if (t) editPO(t.id);
    else establishType(type, true);
  }

  // ── Page: one library, one detail pane ────────────────────────────────────
  // Everything about a template happens in one place: pick it on the left, see
  // what it is and where it has been used on the right, and act there. The PO
  // type is the organising unit, because a type is what a template belongs to.
  var sel = { kind: '', key: '' };

  function selectType(ty) { sel = { kind: 'type', key: ty }; render(); }
  function selectSpec(id) { sel = { kind: 'spec', key: String(id) }; render(); }

  function libraryRow(label, meta, active, onclick, flag) {
    return '<div onclick="' + onclick + '" style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-left:2px solid ' +
      (active ? 'var(--accent-ink)' : 'transparent') + ';background:' + (active ? 'var(--accent-bg)' : 'transparent') + '">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12.5px;font-weight:' + (active ? '600' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(label) + '</div>' +
        (meta ? '<div style="font-size:10.5px;color:var(--text3);margin-top:1px">' + meta + '</div>' : '') +
      '</div>' +
      (flag ? '<span style="font-size:9.5px;color:var(--accent-ink);border:1px solid var(--accent);border-radius:2px;padding:0 4px;white-space:nowrap">' + flag + '</span>' : '') +
      '</div>';
  }

  function library() {
    var types = poTypes();
    var withT = types.filter(function (t) { return templateForType(t); }).length;
    var specs = list().filter(function (t) { return t.kind === 'spec'; });
    return '<div style="border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);overflow:hidden">' +
      '<div style="padding:9px 11px;background:var(--surface2);border-bottom:1px solid var(--border)">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Purchase order types</div>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + withT + ' of ' + types.length + ' have a template</div>' +
      '</div>' +
      '<div style="max-height:520px;overflow:auto">' +
      types.map(function (ty) {
        var u = typeUsage(ty), has = !!templateForType(ty);
        var bits = [];
        if (u.total) bits.push(u.total + ' PO' + (u.total === 1 ? '' : 's'));
        if (u.deployed) bits.push(u.deployed + ' deployed');
        return libraryRow(ty, bits.join(' \u00b7 ') || 'not used yet',
          sel.kind === 'type' && sel.key === ty,
          'tplSelectType(' + JSON.stringify(ty).replace(/"/g, '&quot;') + ')',
          has ? 'template' : '');
      }).join('') +
      '</div>' +
      '<div style="padding:9px 11px;background:var(--surface2);border-top:1px solid var(--border);border-bottom:' + (specs.length ? '1px solid var(--border)' : 'none') + '">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">Specification books</div>' +
      '</div>' +
      (specs.length
        ? specs.map(function (t) {
            return libraryRow(t.name, (t.areas || 0) + ' areas' + (t.used ? ' \u00b7 used ' + t.used + '\u00d7' : ''),
              sel.kind === 'spec' && sel.key === String(t.id), 'tplSelectSpec(\'' + t.id + '\')', '');
          }).join('')
        : '<div style="padding:9px 11px;font-size:11.5px;color:var(--text3)">None yet</div>') +
      '</div>';
  }

  function projectSelect(id) {
    var ps = (projects || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var active = (typeof activeProject !== 'undefined' && activeProject) ? activeProject.name : '';
    if (!ps.length) return '<span style="font-size:12px;color:var(--text3)">No projects yet</span>';
    return '<select id="' + id + '" style="padding:6px 9px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:12.5px;font-family:inherit;background:var(--surface);max-width:260px">' +
      ps.map(function (p) { return '<option value="' + esc(p.name) + '"' + (p.name === active ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
      '</select>';
  }

  function usageTable(u) {
    var keys = Object.keys(u.byProject).sort();
    if (!keys.length) return '<div style="font-size:12px;color:var(--text3)">Not used on any project yet.</div>';
    return '<div style="max-height:200px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
      keys.map(function (k) {
        var e = u.byProject[k], bits = [];
        if (e.n) bits.push(e.n + ' PO' + (e.n === 1 ? '' : 's'));
        if (e.deployed) bits.push(e.deployed + ' deployed');
        return '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:4px 8px 4px 0">' + esc(k) + '</td>' +
          '<td style="padding:4px 8px;color:var(--text3);width:140px">' + bits.join(' \u00b7 ') + '</td>' +
          '<td style="padding:4px 0;color:var(--text3);width:100px">' + (e.last || '\u2014') + '</td></tr>';
      }).join('') + '</table></div>';
  }

  function stat(label, value) {
    return '<div><div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">' + label + '</div>' +
      '<div style="font-size:12.5px;margin-top:1px">' + value + '</div></div>';
  }
  function section(title, inner) {
    return '<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:14px">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:7px">' + title + '</div>' + inner + '</div>';
  }

  function detail() {
    var pad = 'border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:16px 18px';
    if (!sel.kind) {
      return '<div style="' + pad + ';color:var(--text3);font-size:13px;line-height:1.6">' +
        '<div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:6px">Pick a purchase order type</div>' +
        'A template holds the language a purchase order of that type always carries \u2014 standard notes, terms, delivery wording and its spec rows. ' +
        'Set one up once and every new PO of that type starts from it. Specification templates work the same way for a project\u2019s areas and cover.' +
        '</div>';
    }

    if (sel.kind === 'spec') {
      var t = list().find(function (x) { return String(x.id) === sel.key; });
      if (!t) { sel = { kind: '', key: '' }; return detail(); }
      var dep = {}; (t.deployedTo || []).forEach(function (d) {
        var k = d.project || '(no project)';
        if (!dep[k]) dep[k] = { n: 0, last: '', deployed: 0 };
        dep[k].deployed++; var iso = String(d.date || '').slice(0, 10);
        if (iso > dep[k].last) dep[k].last = iso;
      });
      return '<div style="' + pad + '">' +
        '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">' +
          '<div><div style="font-weight:600;font-size:15px">' + esc(t.name) + '</div>' +
          '<div style="font-size:12px;color:var(--text2)">Specification book layout</div></div>' +
          '<div style="margin-left:auto;display:flex;gap:6px">' +
            '<button class="btn btn-sm" onclick="tplRename(\'' + t.id + '\')">Rename</button>' +
            '<button class="btn btn-sm" onclick="tplRemove(\'' + t.id + '\')">Delete</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:22px;flex-wrap:wrap">' +
          stat('Areas', (t.areas || 0)) + stat('Used', (t.used || 0) + '\u00d7') +
          stat('Created', stamp(t.created) || '\u2014') +
          (t.fromProject ? stat('Captured from', esc(t.fromProject)) : '') +
        '</div>' +
        section('Deploy to a project',
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + projectSelect('tpl-dep-p') +
          '<button class="btn btn-sm btn-primary" onclick="tplDeploy(\'spec\',\'' + t.id + '\')">Apply layout</button>' +
          '<span style="font-size:11.5px;color:var(--text3)">Sets that project\u2019s areas and cover. Items already in the book are kept.</span></div>') +
        section('Where it has been used', usageTable({ byProject: dep })) +
        '</div>';
    }

    var ty = sel.key, u = typeUsage(ty), t2 = templateForType(ty);
    var extras = list().filter(function (x) { return x.kind === 'po' && (x.poType || '') === ty; });
    return '<div style="' + pad + '">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">' +
        '<div><div style="font-weight:600;font-size:15px">' + esc(ty) + '</div>' +
        '<div style="font-size:12px;color:var(--text2)">' +
          (t2 ? 'Template: ' + esc(t2.name) : 'No template yet \u2014 new POs of this type use the built-in standard notes.') + '</div></div>' +
        (t2 ? '<div style="margin-left:auto;display:flex;gap:6px">' +
          '<button class="btn btn-sm" onclick="tplRename(\'' + t2.id + '\')">Rename</button>' +
          '<button class="btn btn-sm" onclick="tplRemove(\'' + t2.id + '\')">Delete</button></div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap">' +
        stat('POs of this type', u.total) + stat('Deployments', u.deployed) +
        stat('Projects', Object.keys(u.byProject).length) +
        (t2 ? stat('Last edited', stamp(t2.updated) || '\u2014') : '') +
      '</div>' +
      section(t2 ? 'Update the template' : 'Set up the template',
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button class="btn btn-sm btn-primary" onclick="tplEditType(' + JSON.stringify(ty).replace(/"/g, '&quot;') + ')">' +
          (t2 ? 'Edit template' : 'Create template') + '</button>' +
        (t2 ? '' : '<button class="btn btn-sm" onclick="tplOpenPicker(\'po\')">Copy an existing PO</button>') +
        '<span style="font-size:11.5px;color:var(--text3);max-width:340px;line-height:1.4">Opens the purchase-order editor. Nothing you change becomes a PO \u2014 it is saved back to the template.</span></div>') +
      (t2 ? section('Deploy to a project',
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + projectSelect('tpl-dep-p') +
        '<button class="btn btn-sm btn-primary" onclick="tplDeploy(\'po\',\'' + t2.id + '\')">Start a PO</button>' +
        '<span style="font-size:11.5px;color:var(--text3)">Opens a new ' + esc(ty) + ' purchase order on that project, pre-filled.</span></div>') : '') +
      section('Where this type is in use', usageTable(u)) +
      (extras.length > 1 ? section('Other templates for this type',
        extras.slice(1).map(function (x) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">' +
            '<div style="flex:1">' + esc(x.name) + '</div>' +
            '<button class="btn btn-sm" onclick="tplEditPO(\'' + x.id + '\')">Edit</button>' +
            '<button class="btn btn-sm" onclick="tplRemove(\'' + x.id + '\')">Delete</button></div>';
        }).join('') +
        '<div style="font-size:11px;color:var(--text3);margin-top:6px">New POs of this type start from <strong>' + esc(t2 ? t2.name : '') + '</strong>.</div>') : '') +
      '</div>';
  }

  function deploy(kind, id) {
    var ps = document.getElementById('tpl-dep-p');
    var p = ps ? (projects || []).find(function (x) { return x.name === ps.value; }) : null;
    if (!p) { toast('\u26a0 Pick a project'); return; }
    forcedProject = p;
    try { (kind === 'spec' ? useSpec : usePO)(id); }
    finally { forcedProject = null; }
  }

  function render() {
    var page = document.getElementById('page-templates'); if (!page) return;
    page.innerHTML =
      '<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
        '<div style="font-size:12.5px;color:var(--text2);max-width:620px;line-height:1.5">' +
          'Templates carry the standing language of a document so nobody retypes it. Pick a purchase order type to set up or update its template, then deploy it to a project.' +
        '</div>' +
        '<div style="margin-left:auto;display:flex;gap:6px">' +
          '<button class="btn btn-sm" onclick="tplOpenPicker(\'po\')">Copy an existing PO</button>' +
          '<button class="btn btn-sm" onclick="tplOpenPicker(\'spec\')">Copy a spec book</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;align-items:start">' +
        library() + detail() +
      '</div>';
  }

  function mountModal() {
    if (document.getElementById('tpl-picker-modal')) return;
    var m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'tpl-picker-modal';
    m.innerHTML = '<div class="modal" style="width:640px">' +
      '<div class="modal-header"><div class="modal-title">Make a template from an existing document</div>' +
      '<button class="modal-close" onclick="tplClosePicker()">\u2715</button></div>' +
      '<div class="modal-body" id="tpl-picker-body"></div>' +
      '<div class="modal-footer"><button class="btn" onclick="tplClosePicker()">Close</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) closePicker(); });
  }

  window.tplRender = render;
  window.tplSaveCurrentPO = saveCurrentPO;
  window.tplSaveCurrentSpec = saveCurrentSpec;
  window.tplSavePOById = savePOById;
  window.tplSaveSpecByProject = saveSpecByProject;
  window.tplUsePO = usePO;
  window.tplUseSpec = useSpec;
  window.tplRename = rename;
  window.tplDuplicate = duplicate;
  window.tplRemove = remove;
  window.tplOpenPicker = openPicker;
  window.tplClosePicker = closePicker;
  window.tplPickerSearch = pickerSearch;
  window.tplPickerKind = function (k) { pickerKind = k; renderPicker(); };
  window.tplAskClose = askClose;
  window.tplAskOk = askOk;
  window.tplNewPO = newPOTemplate;
  window.tplNewSpec = newSpecTemplate;
  window.tplPOTypes = poTypes;
  window.tplEditPO = editPO;
  window.tplSaveEdit = saveEdit;
  window.tplCancelEdit = cancelEdit;
  window.tplSelectType = selectType;
  window.tplSelectSpec = selectSpec;
  window.tplDeploy = deploy;
  window.tplEditType = editType;
  window.tplEstablishType = establishType;
  window.tplApplyTypeTemplate = applyTypeTemplate;

  function boot() { mountModal(); mountAsk(); hookEditor(); render();
    // The PO editor's functions may not exist yet at load.
    var n = 0, iv = setInterval(function () { hookEditor(); if (++n > 20) clearInterval(iv); }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
