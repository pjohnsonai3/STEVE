/* ============================================================================
   STEVE — Document attachments  (attachments.js)
   Project-scoped "Files" page. Drag-and-drop or pick files (quotes, COM
   approvals, tear sheets, acknowledgements). Stored in IndexedDB so large files
   don't bloat localStorage. Reuses activeProject, escHtml, ai3Toast, logActivity.
   ============================================================================ */
(function () {
  'use strict';
  var DBNAME = 'steveFiles', STORE = 'files', _db = null;
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }

  function open() {
    return new Promise(function (res, rej) {
      if (_db) return res(_db);
      var r = indexedDB.open(DBNAME, 1);
      r.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains(STORE)) { var os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); os.createIndex('project', 'project', { unique: false }); } };
      r.onsuccess = function () { _db = r.result; res(_db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode) { return open().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); }); }
  function addFile(rec) { return tx('readwrite').then(function (os) { return new Promise(function (res, rej) { var q = os.add(rec); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }
  function listFiles(project) { return tx('readonly').then(function (os) { return new Promise(function (res) { var out = []; var idx = os.index('project'); var q = idx.openCursor(IDBKeyRange.only(project)); q.onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; q.onerror = function () { res(out); }; }); }); }
  function delFile(id) { return tx('readwrite').then(function (os) { return new Promise(function (res) { var q = os.delete(id); q.onsuccess = function () { res(); }; q.onerror = function () { res(); }; }); }); }

  var attProj = null;
  var TAGS = ['Quote', 'COM Approval', 'Tear Sheet', 'Acknowledgement', 'Invoice', 'Shop Drawing', 'Other'];

  function fileIcon(type, name) {
    var t = (type || '') + ' ' + (name || '');
    if (/image\//.test(type)) return null; // use thumbnail
    var ic = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
    if (/pdf/i.test(t)) return ic + '<text x="12" y="17" font-size="5" text-anchor="middle" fill="var(--red)" stroke="none" font-weight="700">PDF</text>';
    return ic;
  }

  function humanSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

  function render() {
    var host = document.getElementById('page-files'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="att-wrap"><div class="rp-empty">Open a project to manage its files.</div></div>'; return; }
    attProj = proj.name;
    var header = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(proj.name) + '</div>' +
      '<div class="rp-period">Quotes, COM approvals, tear sheets &amp; acknowledgements</div></div></div>';
    var drop = '<div class="att-drop" id="att-drop" onclick="document.getElementById(\'att-input\').click()">' +
      '<svg viewBox="0 0 24 24" style="width:30px;height:30px;stroke:var(--accent-ink);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg>' +
      '<div class="att-drop-title">Drop files here or click to upload</div>' +
      '<div class="att-drop-sub">PDF, images, spreadsheets — stored with this project</div>' +
      '<input type="file" id="att-input" multiple style="display:none" />' +
      '<select id="att-tag" onclick="event.stopPropagation()" style="margin-top:12px;padding:7px 10px;border:1px solid var(--border2);border-radius:6px;font-family:inherit;font-size:12.5px">' +
      TAGS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
      '</div>';
    host.innerHTML = '<div class="att-wrap">' + header + drop + '<div id="att-list"><div class="rp-empty">Loading…</div></div></div>';

    var input = document.getElementById('att-input');
    input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });
    var dz = document.getElementById('att-drop');
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });

    renderList();
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    var tag = (document.getElementById('att-tag') || {}).value || 'Other';
    var arr = Array.prototype.slice.call(files);
    var done = 0;
    arr.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        addFile({ project: attProj, tag: tag, name: f.name, type: f.type, size: f.size, dataUrl: reader.result, ts: Date.now() }).then(function () {
          done++; if (done === arr.length) { if (typeof logActivity === 'function') logActivity('Uploaded ' + arr.length + ' file' + (arr.length !== 1 ? 's' : '')); toast(arr.length + ' file' + (arr.length !== 1 ? 's' : '') + ' added'); renderList(); }
        });
      };
      reader.readAsDataURL(f);
    });
  }

  function renderList() {
    var el = document.getElementById('att-list'); if (!el) return;
    listFiles(attProj).then(function (files) {
      if (!files.length) { el.innerHTML = '<div class="rp-empty">No files yet. Upload quotes, COM approvals, or tear sheets above.</div>'; return; }
      files.sort(function (a, b) { return b.ts - a.ts; });
      // group by tag
      var groups = {}; var order = [];
      files.forEach(function (f) { var t = f.tag || 'Other'; if (!groups[t]) { groups[t] = []; order.push(t); } groups[t].push(f); });
      el.innerHTML = order.map(function (t) {
        var cards = groups[t].map(function (f) {
          var isImg = /image\//.test(f.type);
          var thumb = isImg ? '<div class="att-thumb" style="background-image:url(' + f.dataUrl + ')"></div>'
            : '<div class="att-thumb att-thumb-file"><svg viewBox="0 0 24 24">' + fileIcon(f.type, f.name) + '</svg></div>';
          return '<div class="att-card">' + thumb +
            '<div class="att-meta"><div class="att-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
            '<div class="att-sub">' + humanSize(f.size) + ' · ' + new Date(f.ts).toLocaleDateString() + '</div></div>' +
            '<div class="att-actions"><button class="att-btn" onclick="attOpen(' + f.id + ')">Open</button><button class="att-btn att-del" onclick="attDelete(' + f.id + ')">Delete</button></div>' +
            '</div>';
        }).join('');
        return '<div class="att-group"><div class="att-group-head">' + esc(t) + ' <span>' + groups[t].length + '</span></div><div class="att-grid">' + cards + '</div></div>';
      }).join('');
    });
  }

  window.renderFiles = render;
  window.attOpen = function (id) {
    tx('readonly').then(function (os) { var q = os.get(id); q.onsuccess = function () { var f = q.result; if (!f) return; var w = window.open(); if (w) { if (/image\//.test(f.type)) w.document.write('<img src="' + f.dataUrl + '" style="max-width:100%">'); else w.location = f.dataUrl; } }; });
  };
  window.attDelete = function (id) { if (!confirm('Delete this file?')) return; delFile(id).then(function () { if (typeof logActivity === 'function') logActivity('Deleted a file'); renderList(); }); };
})();
