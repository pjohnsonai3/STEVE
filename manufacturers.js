/* ============================================================================
   STEVE — Manufacturers  (manufacturers.js)
   The makers, kept apart from the sources who sell them. A company can be both;
   this page shows everything acting as a manufacturer, with all of its contacts
   and the POs written to it.

   Shares its data and edit handlers with contacts-companies.js — same records,
   two views.
   ========================================================================= */
(function () {
  'use strict';

  var IN = 'width:100%;padding:4px 7px;border:1px solid var(--border2);border-radius:3px;font-size:12px;font-family:inherit;box-sizing:border-box';
  var open = {};
  var query = '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function all() { return (typeof suppliers !== 'undefined' && Array.isArray(suppliers)) ? suppliers : []; }
  function isMfr(s) { return (typeof ctVendorIsKind === 'function') ? ctVendorIsKind(s, 'Manufacturer') : true; }
  function contactsOf(name) { return (typeof ctContactsFor === 'function') ? ctContactsFor(name) : []; }

  function poStats(name) {
    var n = norm(name), count = 0, value = 0, last = '';
    try {
      (vendorPOs || []).forEach(function (v) {
        if (norm(v.mfrName) !== n) return;
        count++;
        value += (parseFloat(v.qty) || 0) * (parseFloat(v.unitPrice) || 0);
        // Imported rows carry free text in issueDate ("See Above"), which would
        // win a raw string comparison — only real dates count.
        var d = String(v.issueDate || '');
        if (/^\d{4}-\d{2}-\d{2}/.test(d) && d > last) last = d;
      });
    } catch (e) {}
    return { count: count, value: value, last: last };
  }
  function money(v) {
    try { return fmt(v); } catch (e) { return '$' + Math.round(v).toLocaleString(); }
  }

  function setQuery(v) { query = String(v || ''); render(); }
  function toggle(id) { open[id] = !open[id]; render(); }

  function render() {
    var page = document.getElementById('page-manufacturers'); if (!page) return;
    var q = norm(query);
    var rows = all().filter(isMfr)
      .filter(function (s) { return !q || norm(s.name).indexOf(q) >= 0 || norm(s.category).indexOf(q) >= 0; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var totalMfr = all().filter(isMfr).length;
    var noContact = all().filter(isMfr).filter(function (s) { return !contactsOf(s.name).length; }).length;

    page.innerHTML =
      '<div class="search-row">' +
        '<input class="search-input" placeholder="Search manufacturers\u2026" value="' + esc(query) + '" oninput="mfSearch(this.value)" />' +
      '</div>' +
      '<div class="card">' +
        '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
          '<div><div style="font-weight:600;font-size:14px">Manufacturers</div>' +
          '<div style="font-size:12px;color:var(--text2)">' + totalMfr + ' companies make what you specify' +
          (noContact ? ' \u00b7 ' + noContact + ' with no contact on file' : '') +
          '. A company marked <em>Both</em> also appears under Sources.</div></div>' +
          '<div style="margin-left:auto"><button class="btn btn-sm" onclick="nav(document.querySelector(\'a[data-page=&quot;contacts&quot;]\'))">Manage in Contacts</button></div>' +
        '</div>' +
        (rows.length
          ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)">' +
            '<th style="padding:6px 8px;text-align:left">Company</th>' +
            '<th style="padding:6px 8px;text-align:left;width:130px">Category</th>' +
            '<th style="padding:6px 8px;text-align:left;width:90px">Acts as</th>' +
            '<th style="padding:6px 8px;text-align:left;width:80px">Contacts</th>' +
            '<th style="padding:6px 8px;text-align:right;width:70px">POs</th>' +
            '<th style="padding:6px 8px;text-align:right;width:110px">PO value</th>' +
            '<th style="padding:6px 8px;text-align:left;width:100px">Last order</th></tr></thead><tbody>' +
            rows.map(rowHtml).join('') + '</tbody></table>'
          : '<div style="font-size:12.5px;color:var(--text3)">' + (query ? 'No manufacturer matches that search.' : 'No manufacturers yet \u2014 mark a company as Manufacturer under Contacts.') + '</div>') +
      '</div>';
  }

  function rowHtml(s) {
    var cs = contactsOf(s.name), st = poStats(s.name), isOpen = !!open[s.id];
    var kind = (typeof ctVendorKind === 'function') ? ctVendorKind(s) : 'Manufacturer';
    var main = '<tr style="border-top:1px solid var(--border);cursor:pointer" onclick="mfToggle(\'' + s.id + '\')">' +
      '<td style="padding:5px 8px;font-weight:500"><span style="color:var(--text3);margin-right:5px">' + (isOpen ? '\u25be' : '\u25b8') + '</span>' + esc(s.name) + '</td>' +
      '<td style="padding:5px 8px;color:var(--text2)">' + esc(s.category || '\u2014') + '</td>' +
      '<td style="padding:5px 8px;color:' + (kind === 'Both' ? 'var(--accent-ink)' : 'var(--text3)') + '">' + esc(kind) + '</td>' +
      '<td style="padding:5px 8px;color:' + (cs.length ? 'var(--text2)' : 'var(--amber,#b7791f)') + '">' + (cs.length || 'none') + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:var(--text2)">' + (st.count || '\u2014') + '</td>' +
      '<td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums">' + (st.value ? money(st.value) : '\u2014') + '</td>' +
      '<td style="padding:5px 8px;color:var(--text3)">' + esc(st.last || '\u2014') + '</td></tr>';
    if (!isOpen) return main;
    return main + '<tr><td colspan="7" style="padding:0 8px 12px 26px;background:var(--surface2)">' +
      (cs.length
        ? '<table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>' +
          ['Name', 'Title', 'Role', 'Phone', 'Email'].map(function (hd) { return '<th style="padding:4px 6px;text-align:left;color:var(--text3);font-weight:500">' + hd + '</th>'; }).join('') +
          '<th style="width:80px"></th></tr></thead><tbody>' +
          cs.map(function (c) {
            return '<tr>' + ['name', 'title', 'role', 'phone', 'email'].map(function (k) {
              return '<td style="padding:3px 5px"><input value="' + esc(c[k] || '') + '" style="' + IN + '" onchange="ctCoSetContact(\'' + s.id + '\',\'' + c.id + '\',\'' + k + '\',this.value)" /></td>';
            }).join('') +
            '<td style="padding:3px 5px;white-space:nowrap;text-align:right">' +
              (c.primary ? '<span style="font-size:10px;color:var(--text3)">primary</span>'
                : '<span onclick="ctCoMakePrimary(\'' + s.id + '\',\'' + c.id + '\')" style="cursor:pointer;font-size:10px;color:var(--accent-ink,#4a6fa5)">set primary</span>') +
              ' <span onclick="ctCoRemoveContact(\'' + s.id + '\',\'' + c.id + '\')" title="Remove" style="cursor:pointer;color:var(--text3);margin-left:6px">&times;</span>' +
            '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div style="font-size:11.5px;color:var(--text3);padding:8px 0 4px">No contacts on file.</div>') +
      '<button class="btn btn-sm" style="margin-top:8px" onclick="ctCoAddContact(\'' + s.id + '\')">+ Add contact</button>' +
      '</td></tr>';
  }

  window.mfRender = render;
  window.mfSearch = setQuery;
  window.mfToggle = toggle;
})();
