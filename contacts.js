/* ============================================================================
   STEVE — Contacts  (contacts.js)
   Two directories that keep themselves current:
     • ai3 Team      — purchasing agents (name, title, email, phone). Assign one
                       to a project and every PO for it carries that agent.
     • Clients       — client companies with shipping + billing addresses, which
                       fill a PO's Ship To and Bill To when the project is set.

   Company contacts (many per manufacturer / source) live in contacts-companies.js.
   Reuses host globals: ai3Team, clientContacts, projects, vendorPOs, DB,
   activeProject, vpoForm, ai3Toast, pushUndoSnapshot, genId, escHtml.
   ========================================================================= */
(function () {
  'use strict';

  var TAB_KEY = 'steve_contacts_tab';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function toast(m, ms) { try { if (typeof ai3Toast === 'function') ai3Toast(m, ms); } catch (e) {} }
  function newId() { try { return genId(); } catch (e) { return Date.now() + Math.floor(Math.random() * 1000); } }
  function tab() { try { return localStorage.getItem(TAB_KEY) || 'team'; } catch (e) { return 'team'; } }
  function setTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch (e) {} render(); }

  function saveTeam(label) {
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(label, []); } catch (e) {}
    try { DB.save('fp11_ai3team', ai3Team); } catch (e) {}
  }
  function saveClients(label) {
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(label, []); } catch (e) {}
    try { DB.save('fp11_clients', clientContacts); } catch (e) {}
  }

  // ── ai3 team ──────────────────────────────────────────────────────────────
  function teamList() { return (typeof ai3Team !== 'undefined' && Array.isArray(ai3Team)) ? ai3Team : []; }
  function agentByName(name) {
    var k = norm(name); if (!k) return null;
    return teamList().find(function (m) { return norm(m.name) === k; }) || null;
  }
  function agentOpts(cur) {
    var list = teamList().filter(function (m) { return String(m.name || '').trim(); });
    if (!list.length) return null;               // no team yet → keep a plain text field
    var names = list.map(function (m) { return String(m.name).trim(); });
    if (cur && names.indexOf(String(cur).trim()) < 0) names.unshift(String(cur).trim());
    return [''].concat(names);
  }
  function fillAgentSelect(val) {
    var sel = document.getElementById('proj-agent'); if (!sel) return;
    sel.innerHTML = '<option value="">\u2014 none \u2014</option>' +
      teamList().filter(function (m) { return String(m.name || '').trim(); })
        .map(function (m) {
          var n = String(m.name).trim();
          return '<option value="' + esc(n) + '">' + esc(n) + (m.email ? ' \u00b7 ' + esc(m.email) : '') + '</option>';
        }).join('');
    if (val && !sel.querySelector('option[value="' + String(val).replace(/"/g, '\\"') + '"]')) {
      var o = document.createElement('option'); o.value = val; o.textContent = val + ' (not on team)';
      sel.appendChild(o);
    }
    sel.value = val || '';
  }

  function addMember() {
    ai3Team.push({ id: newId(), name: '', title: '', email: '', phone: '' });
    saveTeam('Add team member'); render();
    setTimeout(function () {
      var rows = document.querySelectorAll('#ct-team-body input[data-k="name"]');
      if (rows.length) rows[rows.length - 1].focus();
    }, 40);
  }
  function setMember(id, key, val) {
    var m = teamList().find(function (x) { return String(x.id) === String(id); }); if (!m) return;
    var old = m.name;
    m[key] = String(val || '').trim();
    saveTeam('Edit team member');
    // Renaming an agent follows them onto their projects and POs.
    if (key === 'name' && old && m.name && old !== m.name) {
      var n = 0;
      try { (projects || []).forEach(function (p) { if (p.agent === old) { p.agent = m.name; n++; } }); DB.save('fp11_projects', projects); } catch (e) {}
      try { (vendorPOs || []).forEach(function (v) { if (v.ai3Contact === old) { v.ai3Contact = m.name; n++; } }); DB.save('fp11_vpos', vendorPOs); } catch (e) {}
      if (n) toast('Renamed on ' + n + ' project' + (n === 1 ? '' : 's') + ' / PO' + (n === 1 ? '' : 's'), 3000);
    }
    render();
  }
  function removeMember(id) {
    var m = teamList().find(function (x) { return String(x.id) === String(id); }); if (!m) return;
    var used = (projects || []).filter(function (p) { return p.agent && norm(p.agent) === norm(m.name); }).length;
    if (!confirm('Remove ' + (m.name || 'this member') + ' from the team?' + (used ? '\n\nStill assigned to ' + used + ' project(s) — those keep the name on existing POs.' : ''))) return;
    ai3Team = ai3Team.filter(function (x) { return String(x.id) !== String(id); });
    saveTeam('Remove team member'); render();
  }

  // ── Clients ───────────────────────────────────────────────────────────────
  function clientList() { return (typeof clientContacts !== 'undefined' && Array.isArray(clientContacts)) ? clientContacts : []; }
  function clientByName(name) {
    var k = norm(name); if (!k) return null;
    return clientList().find(function (c) { return norm(c.name) === k; }) || null;
  }
  function addClient(prefill) {
    var rec = { id: newId(), name: prefill || '', contact: '', email: '', phone: '', shipName: '', shipAttn: '', shipAddr: '', shipCity: '', shipPhone: '', billTo: '', notes: '' };
    clientContacts.push(rec);
    saveClients('Add client'); render();
    setTimeout(function () { var el = document.getElementById('ct-client-' + rec.id); if (el) el.scrollIntoView ? null : null; }, 30);
    return rec;
  }
  function setClient(id, key, val) {
    var c = clientList().find(function (x) { return String(x.id) === String(id); }); if (!c) return;
    c[key] = String(val || '');
    saveClients('Edit client');
    var badge = document.getElementById('ct-client-saved-' + id);
    if (badge) { badge.textContent = 'Saved'; badge.style.opacity = '1'; setTimeout(function () { badge.style.opacity = '0'; }, 1200); }
  }
  function removeClient(id) {
    var c = clientList().find(function (x) { return String(x.id) === String(id); }); if (!c) return;
    if (!confirm('Delete the record for ' + (c.name || 'this client') + '?')) return;
    clientContacts = clientContacts.filter(function (x) { return String(x.id) !== String(id); });
    saveClients('Delete client'); render();
  }
  // Pull every client name already used on a project into the directory.
  function importClients() {
    var have = {}; clientList().forEach(function (c) { have[norm(c.name)] = 1; });
    var added = 0;
    (projects || []).forEach(function (p) {
      var n = String(p.client || '').trim();
      if (!n || have[norm(n)]) return;
      have[norm(n)] = 1;
      clientContacts.push({
        id: newId(), name: n, contact: p.contact || '', email: p.email || '', phone: '',
        shipName: '', shipAttn: '', shipAddr: '', shipCity: '', shipPhone: '',
        billTo: p.billTo || '', notes: ''
      });
      added++;
    });
    if (added) { saveClients('Import clients from projects'); toast('\u2713 Added ' + added + ' client' + (added === 1 ? '' : 's'), 3000); render(); }
    else toast('Every project client is already in the directory', 3000);
  }

  // ── Filling a PO from the project's client + assigned agent ───────────────
  function fillPOFromProject() {
    if (typeof vpoForm === 'undefined' || !vpoForm) return;
    var proj = (projects || []).find(function (p) { return p.name === vpoForm.project; });
    if (!proj) return;
    var filled = 0;
    if (proj.agent && !String(vpoForm.ai3Contact || '').trim()) { vpoForm.ai3Contact = proj.agent; filled++; }
    var ag = agentByName(vpoForm.ai3Contact);
    if (ag) {
      if (ag.email && !String(vpoForm.ai3Email || '').trim()) { vpoForm.ai3Email = ag.email; filled++; }
      if (ag.phone && !String(vpoForm.ai3Tel || '').trim()) { vpoForm.ai3Tel = ag.phone; filled++; }
    }
    var cl = clientByName(proj.client);
    if (cl) {
      [['shipName', 'shipName'], ['shipAddr', 'shipAddr'], ['shipCity', 'shipCity'], ['shipPhone', 'shipPhone']].forEach(function (p) {
        if (cl[p[0]] && !String(vpoForm[p[1]] || '').trim()) { vpoForm[p[1]] = cl[p[0]]; filled++; }
      });
      if (cl.billTo && !vpoForm._billToEdited) { vpoForm.billTo = cl.billTo; }
    }
    return filled;
  }
  // When the agent field itself changes, bring their email + phone along.
  function fillAgentContact() {
    if (typeof vpoForm === 'undefined' || !vpoForm) return;
    var ag = agentByName(vpoForm.ai3Contact);
    if (!ag) return;
    if (ag.email) vpoForm.ai3Email = ag.email;
    if (ag.phone) vpoForm.ai3Tel = ag.phone;
  }

  // Apply the project's assigned agent to every PO on that project.
  function applyAgentToProject(projName) {
    var proj = (projects || []).find(function (p) { return p.name === projName; });
    if (!proj || !proj.agent) { alert('This project has no purchasing agent assigned yet.\n\nEdit the project and pick one.'); return; }
    var ag = agentByName(proj.agent);
    var hits = (vendorPOs || []).filter(function (v) { return v.project === projName; });
    if (!hits.length) { alert('No POs on this project yet.'); return; }
    var diff = hits.filter(function (v) { return v.ai3Contact !== proj.agent; }).length;
    if (!confirm('Set the purchasing agent to ' + proj.agent + ' on all ' + hits.length + ' PO' + (hits.length === 1 ? '' : 's') + ' for ' + projName + '?' +
      (diff ? '\n\n' + diff + ' currently show someone else.' : '\n\nThey all already show that name.'))) return;
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot('Assign purchasing agent', ['vendorPOs']); } catch (e) {}
    hits.forEach(function (v) {
      v.ai3Contact = proj.agent;
      if (ag && ag.email) v.ai3Email = ag.email;
      if (ag && ag.phone) v.ai3Tel = ag.phone;
    });
    try { DB.save('fp11_vpos', vendorPOs); } catch (e) {}
    try { if (typeof renderVPOList === 'function') renderVPOList(); } catch (e) {}
    toast('\u2713 ' + proj.agent + ' set on ' + hits.length + ' PO' + (hits.length === 1 ? '' : 's'), 3600);
  }

  // ── Repair: a Source contact was stored under the mfr* keys ──────────────
  // Runs per record and is idempotent, because `vendorPOs` is replaced by the
  // cloud pull after load — a single pass at boot would miss every real PO.
  function migrateOne(v) {
    if (!v || v._ctMigrated) return false;
    v._ctMigrated = 1;
    if (String(v.srcName || '').trim() && !String(v.srcContact || '').trim() && String(v.mfrContact || '').trim()) {
      v.srcContact = v.mfrContact; v.mfrContact = '';
      v.srcContactTel = v.mfrContactTel || ''; v.mfrContactTel = '';
      v.srcContactEmail = v.mfrContactEmail || ''; v.mfrContactEmail = '';
      return true;
    }
    return false;
  }
  function migrateContacts() {
    var n = 0;
    (typeof vendorPOs !== 'undefined' ? vendorPOs : []).forEach(function (v) { if (migrateOne(v)) n++; });
    if (n) {
      try { DB.save('fp11_vpos', vendorPOs); } catch (e) {}
      console.log('[ai3] moved ' + n + ' PO contact block(s) to Source');
    }
    return n;
  }
  function migratePO(id) {
    var v = (typeof vendorPOs !== 'undefined' ? vendorPOs : []).find(function (x) { return String(x.id) === String(id); });
    if (migrateOne(v)) { try { DB.save('fp11_vpos', vendorPOs); } catch (e) {} return true; }
    return false;
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  var IN = 'width:100%;padding:4px 7px;border:1px solid var(--border2);border-radius:3px;font-size:12px;font-family:inherit;box-sizing:border-box';

  function teamSection() {
    var list = teamList();
    var counts = {};
    (projects || []).forEach(function (p) { if (p.agent) counts[norm(p.agent)] = (counts[norm(p.agent)] || 0) + 1; });
    return '<div class="card" style="margin-bottom:18px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
        '<div><div style="font-weight:600;font-size:14px">ai3 Team</div>' +
        '<div style="font-size:12px;color:var(--text2)">Purchasing agents available to assign to a project. Edits save as you type.</div></div>' +
        '<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="ctAddMember()">+ Add member</button>' +
      '</div>' +
      (list.length
        ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)">' +
          '<th style="padding:6px 8px;text-align:left">Name</th><th style="padding:6px 8px;text-align:left">Title</th>' +
          '<th style="padding:6px 8px;text-align:left">Email</th><th style="padding:6px 8px;text-align:left">Phone</th>' +
          '<th style="padding:6px 8px;text-align:left;width:90px">Projects</th><th style="width:34px"></th></tr></thead><tbody id="ct-team-body">' +
          list.map(function (m) {
            return '<tr style="border-top:1px solid var(--border)">' +
              ['name', 'title', 'email', 'phone'].map(function (k) {
                return '<td style="padding:4px 6px"><input data-k="' + k + '" value="' + esc(m[k] || '') + '" style="' + IN + '" ' +
                  'onchange="ctSetMember(\'' + m.id + '\',\'' + k + '\',this.value)" /></td>';
              }).join('') +
              '<td style="padding:4px 8px;color:var(--text3)">' + (counts[norm(m.name)] || 0) + '</td>' +
              '<td style="padding:4px 6px;text-align:center"><span onclick="ctRemoveMember(\'' + m.id + '\')" title="Remove" style="cursor:pointer;color:var(--text3)">&times;</span></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div style="font-size:12.5px;color:var(--text3);padding:6px 0">No team members yet. Add the people who issue POs.</div>') +
      '</div>';
  }

  function assignSection() {
    var withAgent = (projects || []).filter(function (p) { return p.agent; }).length;
    var rows = (projects || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    if (!rows.length) return '';
    return '<div class="card" style="margin-bottom:18px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        '<div><div style="font-weight:600;font-size:14px">Project assignments</div>' +
        '<div style="font-size:12px;color:var(--text2)">' + withAgent + ' of ' + rows.length + ' projects have an agent. New POs pick it up automatically; use Apply to update POs already written.</div></div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)">' +
      '<th style="padding:6px 8px;text-align:left">Project</th><th style="padding:6px 8px;text-align:left;width:230px">Purchasing agent</th>' +
      '<th style="padding:6px 8px;text-align:left;width:70px">POs</th><th style="width:90px"></th></tr></thead><tbody>' +
      rows.map(function (p) {
        var n = (vendorPOs || []).filter(function (v) { return v.project === p.name; }).length;
        var opts = '<option value="">\u2014 none \u2014</option>' + teamList().filter(function (m) { return String(m.name || '').trim(); })
          .map(function (m) {
            var nm = String(m.name).trim();
            return '<option value="' + esc(nm) + '"' + (norm(nm) === norm(p.agent) ? ' selected' : '') + '>' + esc(nm) + '</option>';
          }).join('');
        return '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:5px 8px">' + esc(p.name) + '</td>' +
          '<td style="padding:4px 6px"><select style="' + IN + '" onchange="ctSetProjectAgent(' + JSON.stringify(String(p.id)) + ',this.value)">' + opts + '</select></td>' +
          '<td style="padding:5px 8px;color:var(--text3)">' + n + '</td>' +
          '<td style="padding:4px 6px;text-align:right">' + (n && p.agent ? '<button class="btn btn-sm" onclick="ctApplyAgent(' + JSON.stringify(p.name) + ')">Apply</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function setProjectAgent(projId, val) {
    var p = (projects || []).find(function (x) { return String(x.id) === String(projId); }); if (!p) return;
    try { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot('Assign agent', ['projects']); } catch (e) {}
    p.agent = String(val || '');
    try { DB.save('fp11_projects', projects); } catch (e) {}
    render();
  }

  function clientsSection() {
    var list = clientList().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var projClients = {};
    (projects || []).forEach(function (p) { if (p.client) projClients[norm(p.client)] = 1; });
    var missing = Object.keys(projClients).filter(function (k) { return !clientList().some(function (c) { return norm(c.name) === k; }); }).length;
    return '<div class="card">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div><div style="font-weight:600;font-size:14px">Clients</div>' +
        '<div style="font-size:12px;color:var(--text2)">Shipping and billing addresses. A PO fills its Ship To and Bill To from here when you set the project.' +
        (missing ? ' <span style="color:var(--amber,#b7791f)">' + missing + ' project client' + (missing === 1 ? '' : 's') + ' not yet recorded.</span>' : '') + '</div></div>' +
        '<div style="margin-left:auto;display:flex;gap:8px">' +
        (missing ? '<button class="btn btn-sm" onclick="ctImportClients()">Import from projects</button>' : '') +
        '<button class="btn btn-sm btn-primary" onclick="ctAddClient()">+ Add client</button></div>' +
      '</div>' +
      (list.length ? list.map(clientCard).join('') :
        '<div style="font-size:12.5px;color:var(--text3)">No clients yet.</div>') +
      '</div>';
  }

  function clientCard(c) {
    function fld(label, key, ph, wide) {
      return '<div style="' + (wide ? 'grid-column:1/-1;' : '') + '"><label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:2px">' + label + '</label>' +
        '<input value="' + esc(c[key] || '') + '" placeholder="' + esc(ph || '') + '" style="' + IN + '" onchange="ctSetClient(\'' + c.id + '\',\'' + key + '\',this.value)" /></div>';
    }
    return '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<input value="' + esc(c.name || '') + '" placeholder="Client company name" style="' + IN + ';font-weight:600;font-size:13px;max-width:340px" onchange="ctSetClient(\'' + c.id + '\',\'name\',this.value)" />' +
        '<span id="ct-client-saved-' + c.id + '" style="font-size:11px;color:var(--green,#2e7d5b);opacity:0;transition:opacity .3s"></span>' +
        '<span onclick="ctRemoveClient(\'' + c.id + '\')" title="Delete" style="margin-left:auto;cursor:pointer;color:var(--text3)">&times;</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 12px;margin-bottom:10px">' +
        fld('Contact', 'contact', 'Name') + fld('Email', 'email', 'name@client.com') + fld('Phone', 'phone', '+1 555 0100') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 12px;margin-bottom:10px">' +
        '<div style="grid-column:1/-1;font-size:11px;font-weight:600;color:var(--text2);border-top:1px solid var(--border);padding-top:8px">Ship to</div>' +
        fld('Ship-to name', 'shipName', 'Receiving warehouse') + fld('Attention', 'shipAttn', 'Attn:') + fld('Phone', 'shipPhone', 'Phone') +
        fld('Address', 'shipAddr', 'Street', true) +
        fld('City, State ZIP', 'shipCity', 'Atlanta, GA 30318', true) +
      '</div>' +
      '<div style="border-top:1px solid var(--border);padding-top:8px">' +
        '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:3px">Bill to</label>' +
        '<textarea rows="4" placeholder="Client name&#10;c/o ai3, Inc.&#10;916 Joseph E. Lowery Blvd.&#10;Suite 1, Atlanta, GA 30318" style="' + IN + '" onchange="ctSetClient(\'' + c.id + '\',\'billTo\',this.value)">' + esc(c.billTo || '') + '</textarea>' +
      '</div></div>';
  }

  function render() {
    var page = document.getElementById('page-contacts'); if (!page) return;
    var t = tab();
    var btn = function (id, label, n) {
      return '<button class="btn btn-sm' + (t === id ? ' btn-primary' : '') + '" onclick="ctSetTab(\'' + id + '\')">' + label +
        (n != null ? ' <span style="opacity:.7">' + n + '</span>' : '') + '</button>';
    };
    var companies = (typeof ctCompaniesSection === 'function') ? ctCompaniesSection() : '';
    page.innerHTML =
      '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
        btn('team', 'ai3 Team', teamList().length) +
        btn('clients', 'Clients', clientList().length) +
        (companies ? btn('companies', 'Manufacturers &amp; Sources') : '') +
      '</div>' +
      (t === 'team' ? teamSection() + assignSection()
        : t === 'clients' ? clientsSection()
        : companies);
  }

  // Small picker button next to a PO contact field (companies module supplies the list)
  function pickBtn(which, company) {
    if (typeof ctContactsFor !== 'function') return '';
    var list = ctContactsFor(company);
    if (!list || list.length < 2) return '';
    return ' <span onclick="event.stopPropagation();ctPickContact(\'' + which + '\',' + JSON.stringify(String(company || '')).replace(/"/g, '&quot;') + ')" ' +
      'title="' + list.length + ' contacts on file" style="cursor:pointer;color:#888;font-size:9px;border:1px solid #ccc;border-radius:2px;padding:0 3px;margin-left:4px">' + list.length + ' \u25be</span>';
  }

  window.ctRender = render;
  window.ctSetTab = setTab;
  window.ctAddMember = addMember;
  window.ctSetMember = setMember;
  window.ctRemoveMember = removeMember;
  window.ctAddClient = addClient;
  window.ctSetClient = setClient;
  window.ctRemoveClient = removeClient;
  window.ctImportClients = importClients;
  window.ctSetProjectAgent = setProjectAgent;
  window.ctApplyAgent = applyAgentToProject;
  window.ctAgentOpts = agentOpts;
  window.ctFillAgentSelect = fillAgentSelect;
  window.ctFillPOFromProject = fillPOFromProject;
  window.ctFillAgentContact = fillAgentContact;
  window.ctClientByName = clientByName;
  window.ctAgentByName = agentByName;
  window.ctPickBtn = pickBtn;
  window.ctMigrateContacts = migrateContacts;
  window.ctMigratePO = migratePO;

  function boot() { render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
