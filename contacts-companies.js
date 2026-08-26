/* ============================================================================
   STEVE — Manufacturers & Sources  (contacts-companies.js)
   Splits the source directory into what a company IS to you — manufacturer,
   source (dealer / rep), or both — and lets each carry as many contacts as it
   really has. A PO can then pick the right person instead of storing one.

   Contacts live on the supplier record as `contacts: [{name,title,phone,email,
   role,primary}]`; the legacy single contact/contactEmail/contactPhone fields
   are folded in on first read so nothing is lost.
   ========================================================================= */
(function () {
  'use strict';

  var KINDS = ['Manufacturer', 'Source', 'Both'];
  var IN = 'width:100%;padding:4px 7px;border:1px solid var(--border2);border-radius:3px;font-size:12px;font-family:inherit;box-sizing:border-box';
  var expanded = {};
  var filter = 'all';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function newId() { try { return genId(); } catch (e) { return Date.now() + Math.floor(Math.random() * 1000); } }
  function list() { return (typeof suppliers !== 'undefined' && Array.isArray(suppliers)) ? suppliers : []; }

  function save(label) {
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(label, []); } catch (e) {}
    try { DB.save('fp11_suppliers', suppliers); } catch (e) {}
    try { if (typeof renderSuppliers === 'function') renderSuppliers(); } catch (e) {}
  }
  function push(rec) { try { if (typeof sbPushSupplier === 'function') sbPushSupplier(rec); } catch (e) {} }

  // Fold the old single-contact fields into the contacts array, once.
  function contactsOf(s) {
    if (!s) return [];
    if (!Array.isArray(s.contacts)) s.contacts = [];
    if (!s._ctFolded) {
      s._ctFolded = 1;
      if ((s.contact || s.contactEmail || s.contactPhone) &&
          !s.contacts.some(function (c) { return norm(c.name) === norm(s.contact) && norm(c.email) === norm(s.contactEmail); })) {
        s.contacts.unshift({ id: newId(), name: s.contact || '', title: '', phone: s.contactPhone || '', email: s.contactEmail || '', role: 'Sales', primary: true });
      }
    }
    return s.contacts;
  }
  function kindOf(s) {
    if (s && KINDS.indexOf(s.kind) >= 0) return s.kind;
    // Unset records are inferred from how they've actually been used on POs.
    var asMfr = 0, asSrc = 0, n = norm(s && s.name);
    try {
      (vendorPOs || []).forEach(function (v) {
        if (norm(v.mfrName) === n) asMfr++;
        if (norm(v.srcName) === n) asSrc++;
      });
    } catch (e) {}
    if (asMfr && asSrc) return 'Both';
    if (asSrc && !asMfr) return 'Source';
    return 'Manufacturer';
  }
  function isKind(s, want) {
    var k = kindOf(s);
    return k === 'Both' || k === want;
  }

  // ── Used by the PO contact picker ────────────────────────────────────────
  function contactsFor(company) {
    var n = norm(company); if (!n) return [];
    var s = list().find(function (x) { return norm(x.name) === n; });
    if (!s) return [];
    return contactsOf(s).filter(function (c) { return String(c.name || '').trim() || String(c.email || '').trim(); });
  }
  function primaryFor(company) {
    var cs = contactsFor(company);
    return cs.find(function (c) { return c.primary; }) || cs[0] || null;
  }

  function pickContact(which, company) {
    var cs = contactsFor(company);
    if (!cs.length) return;
    var host = document.getElementById('ct-pick-pop');
    if (host) host.remove();
    var pop = document.createElement('div');
    pop.id = 'ct-pick-pop';
    pop.style.cssText = 'position:fixed;z-index:10000;background:#fff;border:1px solid #bbb;box-shadow:0 6px 20px rgba(0,0,0,.16);border-radius:4px;font-size:12px;min-width:220px;overflow:hidden';
    pop.innerHTML = '<div style="padding:5px 9px;background:#f4f4f4;border-bottom:1px solid #e2e2e2;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#777">' + esc(company) + '</div>' +
      cs.map(function (c, i) {
        return '<div data-i="' + i + '" style="padding:6px 9px;cursor:pointer;border-top:' + (i ? '1px solid #eee' : 'none') + '">' +
          '<div style="font-weight:600">' + esc(c.name || '(no name)') + (c.primary ? ' <span style="font-weight:400;color:#999;font-size:10px">primary</span>' : '') + '</div>' +
          '<div style="color:#777;font-size:10.5px">' + [c.role, c.title, c.email, c.phone].filter(Boolean).map(esc).join(' \u00b7 ') + '</div></div>';
      }).join('');
    document.body.appendChild(pop);
    var ev = window.event, x = 200, y = 200;
    if (ev && ev.clientX) { x = ev.clientX; y = ev.clientY + 8; }
    pop.style.left = Math.min(x, window.innerWidth - pop.offsetWidth - 12) + 'px';
    pop.style.top = Math.min(y, window.innerHeight - pop.offsetHeight - 12) + 'px';
    pop.addEventListener('click', function (e) {
      var row = e.target.closest('[data-i]'); if (!row) return;
      var c = cs[parseInt(row.getAttribute('data-i'), 10)];
      applyContact(which, c);
      pop.remove();
    });
    setTimeout(function () {
      document.addEventListener('mousedown', function off(e) {
        if (pop && !pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); }
      });
    }, 10);
  }
  function applyContact(which, c) {
    if (!c || typeof vpoForm === 'undefined' || !vpoForm) return;
    if (which === 'src') {
      vpoForm.srcContact = c.name || '';
      vpoForm.srcContactTel = c.phone || '';
      vpoForm.srcContactEmail = c.email || '';
    } else {
      vpoForm.mfrContact = c.name || '';
      vpoForm.mfrContactTel = c.phone || '';
      vpoForm.mfrContactEmail = c.email || '';
    }
    try { recalcVPO(); } catch (e) {}
    toast('\u2713 ' + (c.name || 'Contact') + ' applied', 2400);
  }

  // ── Editing ──────────────────────────────────────────────────────────────
  function setKind(id, val) {
    var s = list().find(function (x) { return String(x.id) === String(id); }); if (!s) return;
    s.kind = val; save('Set source type'); push(s); render();
  }
  function toggle(id) { expanded[id] = !expanded[id]; render(); }
  function setFilter(f) { filter = f; render(); }

  function addContact(id) {
    var s = list().find(function (x) { return String(x.id) === String(id); }); if (!s) return;
    var cs = contactsOf(s);
    cs.push({ id: newId(), name: '', title: '', phone: '', email: '', role: 'Sales', primary: !cs.length });
    expanded[id] = true;
    save('Add contact'); push(s); render();
  }
  function setContact(id, cid, key, val) {
    var s = list().find(function (x) { return String(x.id) === String(id); }); if (!s) return;
    var c = contactsOf(s).find(function (x) { return String(x.id) === String(cid); }); if (!c) return;
    c[key] = String(val || '').trim();
    // Keep the legacy single-contact fields pointed at the primary, so the rest
    // of STEVE (PO auto-fill, source sync) keeps working unchanged.
    syncPrimary(s);
    save('Edit contact'); push(s);
  }
  function makePrimary(id, cid) {
    var s = list().find(function (x) { return String(x.id) === String(id); }); if (!s) return;
    contactsOf(s).forEach(function (c) { c.primary = String(c.id) === String(cid); });
    syncPrimary(s); save('Set primary contact'); push(s); render();
  }
  function removeContact(id, cid) {
    var s = list().find(function (x) { return String(x.id) === String(id); }); if (!s) return;
    var cs = contactsOf(s);
    var c = cs.find(function (x) { return String(x.id) === String(cid); });
    if (c && (c.name || c.email) && !confirm('Remove ' + (c.name || 'this contact') + '?')) return;
    s.contacts = cs.filter(function (x) { return String(x.id) !== String(cid); });
    if (s.contacts.length && !s.contacts.some(function (x) { return x.primary; })) s.contacts[0].primary = true;
    syncPrimary(s); save('Remove contact'); push(s); render();
  }
  function syncPrimary(s) {
    var p = (s.contacts || []).find(function (c) { return c.primary; }) || (s.contacts || [])[0];
    if (!p) return;
    s.contact = p.name || '';
    s.contactEmail = p.email || '';
    s.contactPhone = p.phone || '';
  }

  // ── Section ──────────────────────────────────────────────────────────────
  function section() {
    var all = list().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var rows = all.filter(function (s) {
      if (filter === 'mfr') return isKind(s, 'Manufacturer');
      if (filter === 'src') return isKind(s, 'Source');
      if (filter === 'multi') return contactsFor(s.name).length > 1;
      return true;
    });
    var nMfr = all.filter(function (s) { return isKind(s, 'Manufacturer'); }).length;
    var nSrc = all.filter(function (s) { return isKind(s, 'Source'); }).length;
    var chip = function (f, label) {
      return '<button class="btn btn-sm' + (filter === f ? ' btn-primary' : '') + '" onclick="ctCoFilter(\'' + f + '\')">' + label + '</button>';
    };
    return '<div class="card">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div><div style="font-weight:600;font-size:14px">Manufacturers &amp; Sources</div>' +
        '<div style="font-size:12px;color:var(--text2)">' + nMfr + ' manufacturers, ' + nSrc + ' sources. A company can be both. Add as many contacts as it has \u2014 a PO can then pick the right one.</div></div>' +
        '<div style="margin-left:auto;display:flex;gap:6px">' + chip('all', 'All') + chip('mfr', 'Manufacturers') + chip('src', 'Sources') + chip('multi', 'Multiple contacts') + '</div>' +
      '</div>' +
      (rows.length
        ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)">' +
          '<th style="padding:6px 8px;text-align:left">Company</th><th style="padding:6px 8px;text-align:left;width:150px">Acts as</th>' +
          '<th style="padding:6px 8px;text-align:left;width:100px">Contacts</th><th style="padding:6px 8px;text-align:left">Primary</th></tr></thead><tbody>' +
          rows.map(rowHtml).join('') + '</tbody></table>'
        : '<div style="font-size:12.5px;color:var(--text3)">Nothing matches that filter.</div>') +
      '</div>';
  }

  function rowHtml(s) {
    var cs = contactsFor(s.name), p = primaryFor(s.name), open = !!expanded[s.id];
    var kind = kindOf(s);
    var main = '<tr style="border-top:1px solid var(--border);cursor:pointer" onclick="ctCoToggle(\'' + s.id + '\')">' +
      '<td style="padding:5px 8px;font-weight:500">' + '<span style="color:var(--text3);margin-right:5px">' + (open ? '\u25be' : '\u25b8') + '</span>' + esc(s.name) + '</td>' +
      '<td style="padding:4px 6px" onclick="event.stopPropagation()"><select style="' + IN + '" onchange="ctCoSetKind(\'' + s.id + '\',this.value)">' +
        KINDS.map(function (k) { return '<option' + (k === kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') +
        '</select></td>' +
      '<td style="padding:5px 8px;color:var(--text3)">' + (cs.length || '\u2014') + '</td>' +
      '<td style="padding:5px 8px;color:var(--text2)">' + (p ? esc([p.name, p.email].filter(Boolean).join(' \u00b7 ')) : '<span style="color:var(--text3)">none</span>') + '</td></tr>';
    if (!open) return main;
    return main + '<tr><td colspan="4" style="padding:0 8px 12px 26px;background:var(--surface2)">' +
      (cs.length
        ? '<table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>' +
          ['Name', 'Title', 'Role', 'Phone', 'Email'].map(function (h) { return '<th style="padding:4px 6px;text-align:left;color:var(--text3);font-weight:500">' + h + '</th>'; }).join('') +
          '<th style="width:80px"></th></tr></thead><tbody>' +
          contactsOf(list().find(function (x) { return String(x.id) === String(s.id); })).map(function (c) {
            return '<tr>' + ['name', 'title', 'role', 'phone', 'email'].map(function (k) {
              return '<td style="padding:3px 5px"><input value="' + esc(c[k] || '') + '" style="' + IN + '" onchange="ctCoSetContact(\'' + s.id + '\',\'' + c.id + '\',\'' + k + '\',this.value)" /></td>';
            }).join('') +
            '<td style="padding:3px 5px;white-space:nowrap;text-align:right">' +
              (c.primary ? '<span style="font-size:10px;color:var(--text3)">primary</span>'
                : '<span onclick="ctCoMakePrimary(\'' + s.id + '\',\'' + c.id + '\')" title="Make primary" style="cursor:pointer;font-size:10px;color:var(--accent-ink,#4a6fa5)">set primary</span>') +
              ' <span onclick="ctCoRemoveContact(\'' + s.id + '\',\'' + c.id + '\')" title="Remove" style="cursor:pointer;color:var(--text3);margin-left:6px">&times;</span>' +
            '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div style="font-size:11.5px;color:var(--text3);padding:8px 0 4px">No contacts on file.</div>') +
      '<button class="btn btn-sm" style="margin-top:8px" onclick="ctCoAddContact(\'' + s.id + '\')">+ Add contact</button>' +
      '</td></tr>';
  }

  function render() {
    try { if (typeof ctRender === 'function') ctRender(); } catch (e) {}
    try { if (typeof mfRender === 'function') mfRender(); } catch (e) {}
  }

  window.ctCompaniesSection = section;
  window.ctContactsFor = contactsFor;
  window.ctPrimaryFor = primaryFor;
  window.ctPickContact = pickContact;
  window.ctCoFilter = setFilter;
  window.ctCoToggle = toggle;
  window.ctCoSetKind = setKind;
  window.ctCoAddContact = addContact;
  window.ctCoSetContact = setContact;
  window.ctCoMakePrimary = makePrimary;
  window.ctCoRemoveContact = removeContact;
  window.ctVendorKind = kindOf;
  window.ctVendorIsKind = isKind;
})();
