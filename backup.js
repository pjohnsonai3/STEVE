/* ============================================================================
   STEVE — Backup & Restore  (backup.js)
   Exports every record collection plus every uploaded file (Supabase Storage)
   into a single .zip the user downloads. Restore reads that zip back, replaces
   the cloud contents, and re-uploads the files to their original paths.

   Reuses host globals: SB_STATE, suppliers, sbClient, sbUser, sbPushState,
   sbPushAllSuppliers, sbDeleteAllSuppliers, SB_BUCKET_IMG, SB_BUCKET_ATTACH,
   ai3Toast, openModal/closeModal.
   ========================================================================= */
(function () {
  'use strict';

  // Emails allowed to RESTORE. Everyone signed in can export.
  // Held in the `app_state` table under key 'backup_admins' so it is shared
  // across devices and editable from the Backup card — no code edit needed.
  // The first signed-in user to claim it becomes the administrator.
  var BACKUP_ADMINS = [];
  var adminsLoaded = false;

  async function loadAdmins() {
    if (typeof sbClient === 'undefined' || !sbClient) return;
    try {
      var r = await sbClient.from('app_state').select('data').eq('key', 'backup_admins').maybeSingle();
      if (r.error) { console.warn('[ai3] admin list read failed', r.error); return; }
      BACKUP_ADMINS = (r.data && Array.isArray(r.data.data)) ? r.data.data : [];
      adminsLoaded = true;
      renderCard();
    } catch (e) { console.warn('[ai3] admin list read error', e); }
  }

  async function saveAdmins(list) {
    var r = await sbClient.from('app_state').upsert(
      [{ key: 'backup_admins', data: list, updated_by: sbUser.id }], { onConflict: 'key' });
    if (r.error) { alert('Could not save the administrator list: ' + r.error.message); return false; }
    BACKUP_ADMINS = list; adminsLoaded = true; renderCard();
    return true;
  }

  async function claimAdmin() {
    var email = (typeof sbUser !== 'undefined' && sbUser && sbUser.email) || '';
    if (!email) { toast('\u26a0 Sign in first'); return; }
    if (BACKUP_ADMINS.length && !isAdmin()) { toast('\u26a0 An administrator is already set'); return; }
    if (await saveAdmins([email])) toast('\u2713 You are now the backup administrator');
  }

  async function addAdmin() {
    var el = document.getElementById('bk-admin-input');
    var email = (el && el.value || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 0) { alert('Enter an email address.'); return; }
    if (!isAdmin()) { toast('\u26a0 Only an administrator can do that'); return; }
    if (BACKUP_ADMINS.some(function (a) { return String(a).toLowerCase() === email; })) { el.value = ''; return; }
    if (await saveAdmins(BACKUP_ADMINS.concat([email]))) { el.value = ''; toast('\u2713 Administrator added'); }
  }

  async function removeAdmin(email) {
    if (!isAdmin()) return;
    if (BACKUP_ADMINS.length <= 1) { alert('At least one administrator must remain.'); return; }
    if (!confirm('Remove ' + email + ' as a backup administrator?')) return;
    await saveAdmins(BACKUP_ADMINS.filter(function (a) { return String(a).toLowerCase() !== String(email).toLowerCase(); }));
  }

  var LAST_KEY = 'steve_last_backup';
  var STALE_DAYS = 7;
  var FMT = 1; // backup format version

  function buckets() {
    var a = [];
    if (typeof SB_BUCKET_IMG === 'string') a.push(SB_BUCKET_IMG);
    if (typeof SB_BUCKET_ATTACH === 'string') a.push(SB_BUCKET_ATTACH);
    return a;
  }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }
  function isAdmin() {
    if (!BACKUP_ADMINS.length) return false;
    var e = (typeof sbUser !== 'undefined' && sbUser && sbUser.email || '').toLowerCase();
    return BACKUP_ADMINS.some(function (a) { return String(a).toLowerCase() === e; });
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function lastBackup() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } }
  function setLastBackup() { try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch (e) {} }
  function daysSince(iso) {
    if (!iso) return Infinity;
    var t = Date.parse(iso); if (isNaN(t)) return Infinity;
    return (Date.now() - t) / 86400000;
  }

  // ── ZIP writer (store, no compression — payloads are already jpg/pdf) ──────
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }
  async function makeZip(entries) {
    // entries: [{name, blob}]
    var parts = [], central = [], offset = 0, now = new Date();
    var tm = dosTime(now), dt = dosDate(now);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var nameU8 = new TextEncoder().encode(e.name);
      var dataU8 = new Uint8Array(await e.blob.arrayBuffer());
      var crc = crc32(dataU8);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, dataU8.length, true); lh.setUint32(22, dataU8.length, true);
      lh.setUint16(26, nameU8.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nameU8, dataU8);
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint16(8, 0, true); cd.setUint16(10, 0, true); cd.setUint16(12, tm, true); cd.setUint16(14, dt, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, dataU8.length, true); cd.setUint32(24, dataU8.length, true);
      cd.setUint16(28, nameU8.length, true); cd.setUint32(42, offset, true);
      central.push(cd.buffer, nameU8);
      offset += 30 + nameU8.length + dataU8.length;
    }
    var cdSize = central.reduce(function (n, p) { return n + (p.byteLength || p.length); }, 0);
    var eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
    eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eo.buffer]), { type: 'application/zip' });
  }

  // ── ZIP reader ────────────────────────────────────────────────────────────
  async function readZip(file) {
    var buf = await file.arrayBuffer(), dv = new DataView(buf), n = buf.byteLength, eocd = -1;
    for (var i = n - 22; i >= 0 && i > n - 66000; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a valid zip file.');
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true), p = cdOff, out = {};
    var dec = new TextDecoder();
    for (var j = 0; j < count; j++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(buf, p + 46, nlen));
      var lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lnlen + lelen;
      var raw = new Uint8Array(buf, start, csize);
      out[name] = { method: method, raw: raw };
      p += 46 + nlen + elen + clen;
    }
    return {
      names: Object.keys(out),
      async blob(name) {
        var e = out[name]; if (!e) return null;
        if (e.method === 0) return new Blob([e.raw]);
        if (typeof DecompressionStream === 'undefined') throw new Error('This zip is compressed and your browser cannot expand it.');
        var ds = new DecompressionStream('deflate-raw');
        return await new Response(new Blob([e.raw]).stream().pipeThrough(ds)).blob();
      },
      async text(name) { var b = await this.blob(name); return b ? await b.text() : null; }
    };
  }

  function download(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // ── Collect / apply records ───────────────────────────────────────────────
  function collectRecords() {
    var rec = {};
    if (typeof SB_STATE !== 'undefined') {
      SB_STATE.forEach(function (c) { try { rec[c.k] = c.get(); } catch (e) {} });
    }
    return { records: rec, suppliers: (typeof suppliers !== 'undefined' && Array.isArray(suppliers)) ? suppliers : [] };
  }
  function countOf(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return v == null ? 0 : 1;
  }

  async function listStorage(bucket, prefix, acc, log) {
    var res = await sbClient.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (res.error) { log('  ! ' + bucket + '/' + prefix + ' — ' + res.error.message); return; }
    for (var i = 0; i < (res.data || []).length; i++) {
      var it = res.data[i];
      var path = prefix ? prefix + '/' + it.name : it.name;
      if (it.id === null || (it.metadata == null && !/\.[a-z0-9]{2,5}$/i.test(it.name))) {
        await listStorage(bucket, path, acc, log);
      } else {
        acc.push({ bucket: bucket, path: path, size: (it.metadata && it.metadata.size) || 0 });
      }
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  var busy = false;
  async function runExport(includeFiles) {
    if (busy) return;
    if (typeof sbClient === 'undefined' || !sbClient) { toast('⚠ Not connected to the cloud.'); return; }
    busy = true;
    var log = progressLogger();
    try {
      log('Collecting records…');
      var data = collectRecords();
      var counts = {};
      Object.keys(data.records).forEach(function (k) { counts[k] = countOf(data.records[k]); });
      counts.suppliers = data.suppliers.length;

      var entries = [];
      var files = [];
      if (includeFiles) {
        log('Listing uploaded files…');
        for (var b of buckets()) { await listStorage(b, '', files, log); }
        var total = files.reduce(function (n, f) { return n + (f.size || 0); }, 0);
        log('Found ' + files.length + ' files (' + bytes(total) + '). Downloading…');
        var done = 0, failed = 0;
        for (var f of files) {
          var r = await sbClient.storage.from(f.bucket).download(f.path);
          if (r.error || !r.data) { failed++; log('  ! skipped ' + f.bucket + '/' + f.path); continue; }
          entries.push({ name: 'files/' + f.bucket + '/' + f.path, blob: r.data });
          done++;
          if (done % 10 === 0 || done === files.length) log('  ' + done + ' / ' + files.length + ' downloaded');
        }
        if (failed) log('  ' + failed + ' file(s) could not be read and are not in this backup.');
      }

      var manifest = {
        app: 'STEVE', format: FMT, createdAt: new Date().toISOString(),
        createdBy: (typeof sbUser !== 'undefined' && sbUser && sbUser.email) || 'unknown',
        includesFiles: !!includeFiles, counts: counts,
        files: entries.map(function (e) { return e.name; })
      };
      entries.unshift({ name: 'data.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) });
      entries.unshift({ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });

      log('Building archive…');
      var zip = await makeZip(entries);
      download(zip, 'STEVE-backup-' + stamp() + '.zip');
      setLastBackup(); renderCard();
      log('Done — ' + bytes(zip.size) + ' downloaded.');
      toast('✓ Backup downloaded');
    } catch (e) {
      console.error('[ai3] backup failed', e);
      log('FAILED: ' + (e.message || e));
      toast('⚠ Backup failed');
    } finally { busy = false; }
  }

  // ── Restore ───────────────────────────────────────────────────────────────
  var pending = null;

  async function pickRestore(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!isAdmin()) { toast('⚠ Restore is limited to admins'); return; }
    try {
      var payload, manifest = null, zip = null;
      if (/\.json$/i.test(file.name)) {
        payload = JSON.parse(await file.text());
      } else {
        zip = await readZip(file);
        var dj = await zip.text('data.json');
        if (!dj) throw new Error('This zip has no data.json — not a STEVE backup.');
        payload = JSON.parse(dj);
        var mj = await zip.text('manifest.json');
        if (mj) manifest = JSON.parse(mj);
      }
      if (!payload || !payload.records) throw new Error('Backup contents not recognised.');
      pending = { payload: payload, manifest: manifest, zip: zip, name: file.name };
      showConfirm();
    } catch (e) {
      console.error('[ai3] restore read failed', e);
      alert('Could not read that backup: ' + (e.message || e));
    }
  }

  function showConfirm() {
    var cur = collectRecords(), p = pending.payload, m = pending.manifest;
    var keys = Object.keys(p.records).concat(['suppliers']);
    var rows = keys.map(function (k) {
      var was = k === 'suppliers' ? countOf(cur.suppliers) : countOf(cur.records[k]);
      var will = k === 'suppliers' ? countOf(p.suppliers) : countOf(p.records[k]);
      var diff = will - was;
      var col = diff < 0 ? 'var(--red,#c0392b)' : (diff > 0 ? 'var(--green,#2e7d5b)' : 'var(--text3)');
      return '<tr><td style="padding:3px 10px 3px 0">' + k + '</td>' +
        '<td style="padding:3px 10px;text-align:right;color:var(--text2)">' + was + '</td>' +
        '<td style="padding:3px 10px;text-align:right">→ ' + will + '</td>' +
        '<td style="padding:3px 0;text-align:right;color:' + col + '">' + (diff > 0 ? '+' + diff : diff || '') + '</td></tr>';
    }).join('');
    var nFiles = pending.zip ? pending.zip.names.filter(function (n) { return n.indexOf('files/') === 0; }).length : 0;
    document.getElementById('bk-restore-body').innerHTML =
      '<p style="font-size:13px;color:var(--text2);margin:0 0 12px">Restoring <strong>replaces</strong> every record in the cloud with the contents of <strong>' + pending.name + '</strong>' +
      (m && m.createdAt ? ' (made ' + new Date(m.createdAt).toLocaleString() + ' by ' + (m.createdBy || 'unknown') + ')' : '') +
      '. Anything created since that backup is lost. A safety copy of today\u2019s data downloads first.</p>' +
      '<div style="max-height:260px;overflow:auto;border:1px solid var(--border2);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:12px">' +
      '<table style="font-size:12px;width:100%;border-collapse:collapse">' + rows + '</table></div>' +
      (nFiles ? '<p style="font-size:12px;color:var(--text2);margin:0 0 12px">' + nFiles + ' uploaded file(s) will be written back to cloud storage.</p>' : '') +
      '<label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Type <strong>RESTORE</strong> to confirm</label>' +
      '<input id="bk-restore-confirm" autocomplete="off" style="width:180px;padding:6px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:13px;font-family:inherit" />' +
      '<div id="bk-restore-progress" style="display:none;margin-top:12px;font-size:12px;color:var(--text2);background:var(--surface2);padding:8px 12px;border-radius:var(--radius-sm);font-family:monospace;white-space:pre-wrap;max-height:200px;overflow:auto"></div>';
    openModal('bk-restore-modal');
  }

  async function confirmRestore() {
    var el = document.getElementById('bk-restore-confirm');
    if (!el || el.value.trim().toUpperCase() !== 'RESTORE') { alert('Type RESTORE to confirm.'); return; }
    if (!pending) return;
    var box = document.getElementById('bk-restore-progress');
    box.style.display = ''; box.textContent = '';
    var log = function (m) { box.textContent += m + '\n'; box.scrollTop = box.scrollHeight; };
    var btn = document.getElementById('bk-restore-go');
    btn.disabled = true; btn.textContent = 'Restoring…';
    try {
      log('Saving a safety copy of current records…');
      var safety = collectRecords();
      download(new Blob([JSON.stringify(safety)], { type: 'application/json' }), 'STEVE-before-restore-' + stamp() + '.json');

      var p = pending.payload;
      log('Applying records…');
      SB_STATE.forEach(function (c) {
        if (Object.prototype.hasOwnProperty.call(p.records, c.k)) { try { c.set(p.records[c.k]); } catch (e) {} }
      });
      if (Array.isArray(p.suppliers) && typeof suppliers !== 'undefined') {
        suppliers.length = 0; p.suppliers.forEach(function (s) { suppliers.push(s); });
      }

      log('Pushing to the cloud…');
      var rows = SB_STATE.map(function (c) {
        var v; try { v = c.get(); } catch (e) { v = null; }
        return { key: c.k, data: v === undefined ? null : v, updated_by: sbUser.id };
      });
      var up = await sbClient.from('app_state').upsert(rows, { onConflict: 'key' });
      if (up.error) throw new Error('Cloud write failed: ' + up.error.message);

      if (Array.isArray(p.suppliers)) {
        log('Replacing source directory…');
        await sbDeleteAllSuppliers();
        await sbPushAllSuppliers();
      }

      if (pending.zip) {
        var names = pending.zip.names.filter(function (n) { return n.indexOf('files/') === 0; });
        if (names.length) {
          log('Restoring ' + names.length + ' uploaded file(s)…');
          var done = 0, failed = 0;
          for (var name of names) {
            var rest = name.slice(6);
            var slash = rest.indexOf('/');
            var bucket = rest.slice(0, slash), path = rest.slice(slash + 1);
            var blob = await pending.zip.blob(name);
            var r = await sbClient.storage.from(bucket).upload(path, blob, { upsert: true });
            if (r.error) { failed++; log('  ! ' + bucket + '/' + path + ' — ' + r.error.message); } else done++;
            if (done % 10 === 0) log('  ' + done + ' / ' + names.length);
          }
          log('  ' + done + ' restored' + (failed ? ', ' + failed + ' failed' : ''));
        }
      }

      log('Refreshing screens…');
      SB_STATE.forEach(function (c) { try { c.render(); } catch (e) {} });
      log('Done.');
      toast('✓ Restore complete');
      setTimeout(function () { closeModal('bk-restore-modal'); location.reload(); }, 1200);
    } catch (e) {
      console.error('[ai3] restore failed', e);
      log('FAILED: ' + (e.message || e));
      toast('⚠ Restore failed');
      btn.disabled = false; btn.textContent = 'Restore';
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function progressLogger() {
    var box = document.getElementById('bk-progress');
    if (box) { box.style.display = ''; box.textContent = ''; }
    return function (m) { if (box) { box.textContent += m + '\n'; box.scrollTop = box.scrollHeight; } };
  }

  function renderCard() {
    var card = document.getElementById('bk-card'); if (!card) return;
    var last = lastBackup(), stale = daysSince(last) > STALE_DAYS;
    var when = last ? new Date(last).toLocaleString() : 'never on this computer';
    card.querySelector('#bk-last').innerHTML =
      'Last backup: <strong>' + when + '</strong>' +
      (stale ? ' <span style="color:var(--amber,#b7791f)">— older than ' + STALE_DAYS + ' days</span>' : '');
    var me = (typeof sbUser !== 'undefined' && sbUser && sbUser.email) || '';
    var note = card.querySelector('#bk-admin-note');
    if (!me) {
      note.innerHTML = 'Sign in to manage backup administrators.';
    } else if (!BACKUP_ADMINS.length) {
      note.innerHTML = 'No backup administrator is set yet. ' +
        '<button class="btn btn-sm" style="margin-left:6px" onclick="bkClaimAdmin()">Make me the administrator</button>';
    } else if (isAdmin()) {
      note.innerHTML = 'Administrators: ' + BACKUP_ADMINS.map(function (a) {
        return '<span style="color:var(--text2)">' + a + '</span>' +
          (BACKUP_ADMINS.length > 1 ? ' <span onclick="bkRemoveAdmin(\'' + a + '\')" style="cursor:pointer;color:var(--text3)" title="Remove">&times;</span>' : '');
      }).join(', ') +
        ' <input id="bk-admin-input" placeholder="add email…" style="margin-left:8px;padding:4px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:12px;font-family:inherit;width:180px" />' +
        ' <button class="btn btn-sm" onclick="bkAddAdmin()">Add</button>';
    } else {
      note.innerHTML = 'Restore is limited to administrators. You are signed in as ' + me + '.';
    }
    card.querySelector('#bk-restore-btn').disabled = !isAdmin();
  }

  function mount() {
    var page = document.getElementById('page-import');
    if (!page || document.getElementById('bk-card')) return;
    var card = document.createElement('div');
    card.className = 'card';
    card.id = 'bk-card';
    card.style.cssText = 'margin-bottom:20px';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
        '<div><div style="font-weight:600;font-size:14px">Backup &amp; Restore</div>' +
        '<div style="font-size:12px;color:var(--text2)">Download every record and every uploaded file as one archive you can keep off-site. Restore reads that archive back and replaces what is in the cloud.</div></div>' +
        '<div id="bk-last" style="margin-left:auto;font-size:12px;color:var(--text3);white-space:nowrap"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
        '<button class="btn btn-sm btn-primary" onclick="bkExport(true)">↓ Back up everything</button>' +
        '<button class="btn btn-sm" onclick="bkExport(false)">↓ Records only (fast)</button>' +
        '<span style="width:1px;height:20px;background:var(--border2)"></span>' +
        '<button class="btn btn-sm" id="bk-restore-btn" onclick="document.getElementById(\'bk-file\').click()">↑ Restore from backup…</button>' +
        '<input type="file" id="bk-file" accept=".zip,.json" style="display:none" onchange="bkPickRestore(this)" />' +
      '</div>' +
      '<div id="bk-admin-note" style="font-size:12px;color:var(--text3);margin-bottom:10px"></div>' +
      '<div id="bk-progress" style="display:none;font-size:12px;color:var(--text2);background:var(--surface2);padding:8px 12px;border-radius:var(--radius-sm);font-family:monospace;white-space:pre-wrap;max-height:220px;overflow:auto"></div>';
    page.insertBefore(card, page.firstChild);

    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'bk-restore-modal';
    modal.innerHTML =
      '<div class="modal" style="max-width:560px">' +
        '<div class="modal-header"><div class="modal-title">Restore from backup</div>' +
        '<span class="modal-close" onclick="closeModal(\'bk-restore-modal\')">&times;</span></div>' +
        '<div class="modal-body" id="bk-restore-body"></div>' +
        '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button class="btn btn-sm" onclick="closeModal(\'bk-restore-modal\')">Cancel</button>' +
          '<button class="btn btn-sm btn-primary" id="bk-restore-go" onclick="bkConfirmRestore()">Restore</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal('bk-restore-modal'); });

    renderCard();
    // The admin list lives in the cloud, so wait for sign-in before reading it.
    var tries = 0;
    var poll = setInterval(function () {
      if (adminsLoaded || ++tries > 60) { clearInterval(poll); return; }
      if (typeof sbUser !== 'undefined' && sbUser && typeof sbClient !== 'undefined' && sbClient) { clearInterval(poll); loadAdmins(); }
      else renderCard();
    }, 1000);
    if (daysSince(lastBackup()) > STALE_DAYS) {
      setTimeout(function () { toast('Backup is ' + (lastBackup() ? 'over a week old' : 'not set up yet') + ' — Import/Export → Back up everything'); }, 4000);
    }
  }

  window.bkExport = runExport;
  window.bkPickRestore = pickRestore;
  window.bkConfirmRestore = confirmRestore;
  window.bkRenderCard = renderCard;
  window.bkClaimAdmin = claimAdmin;
  window.bkAddAdmin = addAdmin;
  window.bkRemoveAdmin = removeAdmin;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
