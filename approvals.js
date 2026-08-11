/* ============================================================================
   STEVE — Client sign-off / approval flow  (approvals.js)
   Project-scoped. Lists the project's Purchase Authorizations with an approval
   state machine (Draft → Sent → Approved / Changes requested) and a read-only,
   client-facing review document with a typed signature sign-off.
   Reuses host globals: pas, projects, activeProject, calcPATotal, escHtml, fmt,
   ai3Toast, DB.
   ============================================================================ */
(function () {
  'use strict';

  var INSTALL_CATS = ['Installation', 'Drapery (Measure & Install)', 'Installation (Drapery)'];
  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function money(n) { return (typeof fmt === 'function') ? fmt(n) : '$' + Math.round(n || 0).toLocaleString(); }
  function toast(m) { if (typeof ai3Toast === 'function') ai3Toast(m); }

  function store() { try { return DB.load('fp11_approvals', {}); } catch (e) { return {}; } }
  function saveStore(s) { try { DB.save('fp11_approvals', s); } catch (e) {} }
  function recOf(paId) { var s = store(); return s[paId] || { status: 'draft' }; }
  function setRec(paId, patch) { var s = store(); s[paId] = Object.assign(recOf(paId), patch); saveStore(s); }

  // Compute PA composition (mirrors the budget-tracker formula)
  function composition(pa) {
    var feeP = (pa.feePct != null ? pa.feePct : 25) / 100, contP = (pa.contPct != null ? pa.contPct : 5) / 100,
        frP = (pa.freightPct != null ? pa.freightPct : 10) / 100, taP = (pa.tariffPct != null ? pa.tariffPct : 5) / 100,
        txP = (pa.taxPct != null ? pa.taxPct : 8.9) / 100;
    var cur = '', goods = 0, install = 0, cats = {};
    (pa.items || []).forEach(function (it) {
      if (it.isCategory) { cur = it.name; return; }
      var ext = (it.qty || 0) * (it.price || 0);
      if (INSTALL_CATS.indexOf(cur) !== -1) install += ext; else goods += ext;
      var ck = cur || 'Uncategorized'; cats[ck] = (cats[ck] || 0) + ext;
    });
    var fee = goods * feeP, cont = goods * contP, freight = goods * frP, tariff = goods * taP, tax = (goods + freight) * txP;
    var total = (typeof calcPATotal === 'function') ? calcPATotal(pa) : (goods + install + fee + cont + freight + tariff + tax);
    return { goods: goods, install: install, fee: fee, cont: cont, freight: freight, tariff: tariff, tax: tax, total: total, cats: cats,
      pcts: { fee: pa.feePct != null ? pa.feePct : 25, cont: pa.contPct != null ? pa.contPct : 5, freight: pa.freightPct != null ? pa.freightPct : 10, tariff: pa.tariffPct != null ? pa.tariffPct : 5, tax: pa.taxPct != null ? pa.taxPct : 8.9 } };
  }

  var STATUS_META = {
    draft: { cls: 'ap-draft', label: 'Draft' },
    sent: { cls: 'ap-sent', label: 'Sent for approval' },
    approved: { cls: 'ap-appr', label: 'Approved' },
    changes: { cls: 'ap-chg', label: 'Changes requested' }
  };

  function steps(status) {
    var order = ['draft', 'sent', 'approved'];
    var curIdx = status === 'approved' ? 2 : status === 'sent' || status === 'changes' ? 1 : 0;
    var labels = ['Drafted', 'Sent to client', status === 'changes' ? 'Changes requested' : 'Approved'];
    return '<div class="ap-steps">' + order.map(function (s, n) {
      var done = n < curIdx || (n === 2 && status === 'approved');
      var current = n === curIdx && status !== 'approved';
      var cls = done ? 'done' : current ? 'current' : '';
      var dot = (n === 2 && status === 'changes') ? '!' : (done ? '\u2713' : (n + 1));
      return '<div class="ap-step ' + cls + (n === 2 && status === 'changes' ? ' changes' : '') + '">' +
        '<span class="ap-step-dot"' + (n === 2 && status === 'changes' ? ' style="background:var(--red);border-color:var(--red);color:#fff"' : '') + '>' + dot + '</span>' +
        '<span class="ap-step-label">' + labels[n] + '</span>' +
        (n < 2 ? '<span class="ap-step-line"></span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function paCard(pa) {
    var rec = recOf(pa.id);
    var comp = composition(pa);
    var sm = STATUS_META[rec.status] || STATUS_META.draft;
    var proj = projects.find(function (p) { return p.name === pa.project; });

    var cert = '';
    if (rec.status === 'approved') {
      cert = '<div class="ap-cert"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--green);font-weight:700">Authorized by client</div>' +
        '<div class="ap-cert-sig">' + esc(rec.signature || rec.approver || '') + '</div>' +
        '<div style="font-size:12.5px;color:var(--text)"><b>' + esc(rec.approver || '') + '</b>' + (rec.role ? ', ' + esc(rec.role) : '') + '</div>' +
        '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">Signed ' + esc(rec.date || '') + ' · authorized ' + money(comp.total) + '</div></div>';
    } else if (rec.status === 'changes' && rec.comment) {
      cert = '<div class="ap-cert" style="background:var(--red-bg);border-color:color-mix(in srgb,var(--red) 30%,transparent)"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--red);font-weight:700">Client requested changes</div>' +
        '<div style="font-size:13px;color:var(--text);margin-top:4px">\u201C' + esc(rec.comment) + '\u201D</div>' +
        (rec.approver ? '<div style="font-size:11.5px;color:var(--text3);margin-top:3px">\u2014 ' + esc(rec.approver) + (rec.date ? ', ' + esc(rec.date) : '') + '</div>' : '') + '</div>';
    }

    var actions = '<div class="ap-actions">' +
      '<button class="btn btn-primary btn-sm" onclick="apEmailClient(' + jsId(pa.id) + ')">✉ Email to client</button>' +
      '<button class="btn btn-sm" onclick="apOpenClientView(' + jsId(pa.id) + ')">Open client view</button>' +
      (rec.status === 'draft' ? '<button class="btn btn-sm" onclick="apMarkSent(' + jsId(pa.id) + ')">Mark as sent</button>' : '') +
      '<button class="btn btn-sm" onclick="apCopyLink(' + jsId(pa.id) + ')">\uD83D\uDD17 Copy share link</button>' +
      (rec.status !== 'draft' ? '<button class="btn btn-sm" onclick="apReset(' + jsId(pa.id) + ')">Reset</button>' : '') +
      '</div>';

    return '<div class="ap-card"><div class="ap-card-head"><div>' +
      '<div class="ap-pa-num">' + esc(pa.paNum || 'Authorization') + '</div>' +
      '<div class="ap-pa-meta">' + esc(pa.project || '') + (proj && proj.client ? ' · ' + esc(proj.client) : '') + ' · ' + money(comp.total) + ' authorized' + (pa.date ? ' · ' + esc(pa.date) : '') + '</div></div>' +
      '<span class="ap-status ' + sm.cls + '"><span class="d"></span>' + sm.label + '</span></div>' +
      '<div class="ap-card-body">' + steps(rec.status) + cert + actions + '</div></div>';
  }

  function jsId(id) { return (typeof id === 'number') ? id : ("'" + String(id).replace(/'/g, '') + "'"); }

  function render() {
    var host = document.getElementById('page-approvals'); if (!host) return;
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="ap-wrap"><div class="rp-empty">Open a project to manage client approvals.</div></div>'; return; }
    var list = (typeof pas !== 'undefined' ? pas : []).filter(function (p) { return p.project === proj.name; });

    var intro = '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:16px">Send each Purchase Authorization to the client for review and sign-off. The client view is read-only — they approve or request changes, and the decision is recorded here.</div>';
    var body = list.length ? list.map(paCard).join('')
      : '<div class="rp-empty">No Purchase Authorizations for this project yet. Create one in <b>Purchase Authorizations</b> to send for approval.</div>';
    host.innerHTML = '<div class="ap-wrap">' + intro + body + '</div>';
  }

  // ── Client view modal ──────────────────────────────────────────────────────
  var cv, cvPaId = null;
  function buildCV() {
    cv = document.createElement('div'); cv.className = 'cv-overlay';
    cv.innerHTML = '<div class="cv-doc" id="cv-doc"></div>';
    document.body.appendChild(cv);
    cv.addEventListener('click', function (e) { if (e.target === cv) closeCV(); });
  }

  function openCV(paId) {
    if (!cv) buildCV();
    cvPaId = paId;
    var pa = pas.find(function (p) { return String(p.id) === String(paId); }); if (!pa) return;
    var rec = recOf(paId);
    var comp = composition(pa);
    var proj = projects.find(function (p) { return p.name === pa.project; });

    var catRows = Object.keys(comp.cats).filter(function (k) { return comp.cats[k] > 0; })
      .sort(function (a, b) { return comp.cats[b] - comp.cats[a]; })
      .map(function (k) { return '<div class="cv-row"><span class="lbl">' + esc(k) + '</span><span class="val">' + money(comp.cats[k]) + '</span></div>'; }).join('');

    var feeRows = [
      ['Procurement fee (' + comp.pcts.fee + '%)', comp.fee],
      ['Contingency (' + comp.pcts.cont + '%)', comp.cont],
      ['Freight (' + comp.pcts.freight + '%)', comp.freight],
      ['Tariff / duty (' + comp.pcts.tariff + '%)', comp.tariff],
      ['Sales tax (' + comp.pcts.tax + '%)', comp.tax]
    ].filter(function (r) { return r[1] > 0; })
      .map(function (r) { return '<div class="cv-row"><span class="lbl">' + r[0] + '</span><span class="val">' + money(r[1]) + '</span></div>'; }).join('');

    var notes = (pa.notes && pa.notes.length)
      ? '<div class="cv-sec-title" style="margin-top:22px">Terms</div>' + pa.notes.slice(0, 6).map(function (n) { return '<div style="font-size:12px;color:var(--text2);line-height:1.5;padding:3px 0">\u2022 ' + esc(n) + '</div>'; }).join('')
      : '';

    var signBlock;
    if (rec.status === 'approved') {
      signBlock = '<div class="cv-sign"><div class="cv-approved-stamp">' +
        '<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--green);font-weight:700">Approved</div>' +
        '<div class="ap-cert-sig" style="margin:6px 0 2px">' + esc(rec.signature || rec.approver) + '</div>' +
        '<div style="font-size:13px;color:var(--text)"><b>' + esc(rec.approver || '') + '</b>' + (rec.role ? ', ' + esc(rec.role) : '') + '</div>' +
        '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">Signed ' + esc(rec.date || '') + '</div></div>' +
        '<div class="cv-sign-actions" style="margin-top:14px"><button class="cv-btn cv-btn-changes" style="flex:1" onclick="window.print()">\u2399 Print / save PDF</button></div></div>';
    } else {
      signBlock = '<div class="cv-sign"><div class="cv-sec-title">Authorization &amp; sign-off</div>' +
        '<div style="font-size:12.5px;color:var(--text2);line-height:1.5;margin-bottom:6px">By signing below, you authorize ai3 to procure the items in this authorization at the total shown above.</div>' +
        '<div class="cv-sign-grid">' +
        '<div class="cv-field"><label>Approver name</label><input id="cv-name" placeholder="Full name" value="' + esc(rec.approver || (proj && proj.contact) || '') + '" /></div>' +
        '<div class="cv-field"><label>Title / company</label><input id="cv-role" placeholder="e.g. Owner, Highwoods" value="' + esc(rec.role || (proj && proj.client) || '') + '" /></div>' +
        '</div>' +
        '<div class="cv-field" style="margin-bottom:16px"><label>Type your name to sign</label><input id="cv-sig" placeholder="Signature" style="font-family:\'Brush Script MT\',\'Segoe Script\',cursive;font-size:20px" /></div>' +
        '<div class="cv-sign-actions">' +
        '<button class="cv-btn cv-btn-approve" onclick="apApprove(' + jsId(paId) + ')">\u2713 Approve &amp; authorize</button>' +
        '<button class="cv-btn cv-btn-changes" onclick="apRequestChanges(' + jsId(paId) + ')">Request changes</button>' +
        '</div></div>';
    }

    document.getElementById('cv-doc').innerHTML =
      '<div class="cv-band"><span>Client review \u00b7 read only</span><button onclick="apCloseClientView()" aria-label="Close">\u00d7</button></div>' +
      '<div class="cv-head"><div class="cv-title">' + esc(pa.project || '') + '</div>' +
      '<div class="cv-sub">Purchase Authorization ' + esc(pa.paNum || '') + (proj && proj.client ? ' \u00b7 prepared for ' + esc(proj.client) : '') + (pa.date ? ' \u00b7 ' + esc(pa.date) : '') + '</div></div>' +
      '<div class="cv-body">' +
      '<div class="cv-sec-title">Scope by category</div>' + (catRows || '<div class="cv-row"><span class="lbl">No line items</span><span class="val">—</span></div>') +
      (comp.install > 0 ? '<div class="cv-row"><span class="lbl">Installation</span><span class="val">' + money(comp.install) + '</span></div>' : '') +
      '<div class="cv-sec-title" style="margin-top:22px">Fees &amp; taxes</div>' + feeRows +
      '<div class="cv-row total"><span class="lbl">Total authorized</span><span class="val">' + money(comp.total) + '</span></div>' +
      notes +
      '</div>' + signBlock;

    cv.classList.add('open');
  }
  function closeCV() { if (cv) cv.classList.remove('open'); }

  function apApprove(paId) {
    var name = (document.getElementById('cv-name') || {}).value || '';
    var role = (document.getElementById('cv-role') || {}).value || '';
    var sig = (document.getElementById('cv-sig') || {}).value || '';
    if (!name.trim() || !sig.trim()) { toast('Enter a name and signature to approve.'); return; }
    setRec(paId, { status: 'approved', approver: name.trim(), role: role.trim(), signature: sig.trim(), date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), comment: '' });
    closeCV(); render(); toast('Authorization approved \u2713');
  }
  function apRequestChanges(paId) {
    var name = (document.getElementById('cv-name') || {}).value || '';
    var c = prompt('What changes are needed? (optional)') || '';
    setRec(paId, { status: 'changes', approver: name.trim(), comment: c.trim(), date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) });
    closeCV(); render(); toast('Changes requested');
  }
  function apMarkSent(paId) { setRec(paId, { status: 'sent', sentDate: new Date().toISOString().slice(0, 10) }); render(); toast('Marked as sent for approval'); }
  function apReset(paId) { if (!confirm('Reset this authorization back to draft?')) return; setRec(paId, { status: 'draft', approver: '', role: '', signature: '', comment: '', date: '' }); render(); }
  function apCopyLink(paId) {
    var url = shareUrl(paId);
    try { navigator.clipboard.writeText(url); toast('Share link copied to clipboard'); }
    catch (e) { toast('Share link: ' + url); }
    var rec = recOf(paId); if (rec.status === 'draft') { setRec(paId, { status: 'sent', sentDate: new Date().toISOString().slice(0, 10) }); render(); }
  }

  function shareUrl(paId) { return location.origin + location.pathname + '#/approve/' + paId; }

  function apEmailClient(paId) {
    var pa = pas.find(function (p) { return String(p.id) === String(paId); }); if (!pa) return;
    var proj = projects.find(function (p) { return p.name === pa.project; }) || {};
    var comp = composition(pa);
    var url = shareUrl(paId);
    var who = (proj.contact && proj.contact.trim()) || proj.client || 'there';
    var subject = 'Purchase Authorization ' + (pa.paNum || '') + ' — ' + (pa.project || '') + ' for your approval';
    var body = 'Hi ' + who + ',\n\n' +
      'Purchase Authorization ' + (pa.paNum || '') + ' for ' + (pa.project || '') + ' is ready for your review and approval' +
      (comp.total ? ' — total ' + money(comp.total) : '') + '.\n\n' +
      'Please review and sign off here:\n' + url + '\n\n' +
      'Thank you,\nai3';
    var mailto = 'mailto:' + (proj.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    window.location.href = mailto;
    if (!proj.email) toast('No client email on file — add the recipient in your mail app.');
    else toast('Opening email to ' + proj.email + '…');
    var rec = recOf(paId);
    if (rec.status === 'draft') { setRec(paId, { status: 'sent', sentDate: new Date().toISOString().slice(0, 10) }); render(); }
  }

  // Deep-link handler: opening a shared #/approve/<id> link surfaces that PA's
  // client review view once the data is available (after sign-in / sync).
  function apCheckHashRoute() {
    var m = (location.hash || '').match(/^#\/approve\/(.+)$/);
    if (!m) return;
    var id = m[1], tries = 0;
    (function attempt() {
      if (typeof pas !== 'undefined' && pas.find(function (p) { return String(p.id) === String(id); })) { openCV(id); return; }
      if (tries++ < 60) setTimeout(attempt, 200);
    })();
  }

  window.renderApprovals = render;
  window.apEmailClient = apEmailClient;
  window.apOpenClientView = openCV;
  window.apCloseClientView = closeCV;
  window.apApprove = apApprove;
  window.apRequestChanges = apRequestChanges;
  window.apMarkSent = apMarkSent;
  window.apReset = apReset;
  window.apCopyLink = apCopyLink;
  window.addEventListener('hashchange', apCheckHashRoute);
  if (document.readyState !== 'loading') setTimeout(apCheckHashRoute, 400);
  else window.addEventListener('DOMContentLoaded', function () { setTimeout(apCheckHashRoute, 400); });
})();
