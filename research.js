/* ============================================================================
   STEVE — Research / Sourcing  (research.js)

   Per-item product research, usable from TWO surfaces:
     • the Procurement Tracker  (store 'bt' → budgetTrackers[project].items)
     • the Preliminary Budget   (store 'pb' → pbLineItems, the open PB editor)

   Each item gets a "Research ▾" menu — Find alternates · Price check · Find
   vendor · Spec search · Image search. AI tools render savable findings; spec/
   image open curated web searches. Findings persist on the item; "Use on item"
   writes name/vendor/price/lead back to whichever store owns it.

   The Tracker additionally has a project "Sourcing" hub (queue + compare). The
   Preliminary Budget shows its saved findings in a compact compare modal.
   ============================================================================ */
(function () {
  'use strict';

  function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s); }
  function fD(v) { return (typeof fmtD === 'function') ? fmtD(v) : (parseFloat(v) || 0).toFixed(2); }
  function money(v) { return '$' + Math.round(parseFloat(v) || 0).toLocaleString('en-US'); }
  function num(v) { return parseFloat(v) || 0; }
  function _q(s) { return String(s).replace(/'/g, "\\'"); }

  // ── Store adapters ─────────────────────────────────────────────────────────
  const STORES = {
    bt: {
      priceField: 'estPrice', hub: true,
      item: function (projName, id) { const bt = budgetTrackers[projName]; return bt ? bt.items.find(function (i) { return String(i.id) === String(id); }) : null; },
      projType: function (projName) { const p = (projects || []).find(function (x) { return x.name === projName; }); return p && p.type; },
      save: function () { DB.save('fp11_bt', budgetTrackers); },
      rerender: function () { if (typeof renderBTTable === 'function') { try { renderBTTable(); } catch (e) {} } }
    },
    pb: {
      priceField: 'price', hub: false,
      item: function (projName, id) { return (typeof pbLineItems !== 'undefined') ? pbLineItems.find(function (i) { return String(i.id) === String(id); }) : null; },
      projType: function () { const el = document.getElementById('pb-project'); const nm = el && el.value; const p = nm && (projects || []).find(function (x) { return x.name === nm; }); return p && p.type; },
      save: function () { if (typeof currentPBId !== 'undefined' && currentPBId) { const rec = (prelimBudgets || []).find(function (p) { return p.id === currentPBId; }); if (rec) rec.items = JSON.parse(JSON.stringify(pbLineItems)); } DB.save('fp11_pb', prelimBudgets); },
      rerender: function () { if (typeof recalcPB === 'function') { try { recalcPB(); } catch (e) {} } }
    },
    // Hub-only: operates directly on a project's Preliminary Budget record
    // (no dependency on the PB editor being open). _hubPBId names the record.
    pbrec: {
      priceField: 'price', hub: true,
      item: function (projName, id) { const rec = _hubRec(); return rec ? (rec.items || []).find(function (i) { return String(i.id) === String(id); }) : null; },
      projType: function (projName) { const p = (projects || []).find(function (x) { return x.name === projName; }); return p && p.type; },
      save: function () { DB.save('fp11_pb', prelimBudgets); if (typeof currentPBId !== 'undefined' && currentPBId === _hubPBId && typeof pbLineItems !== 'undefined') { const rec = _hubRec(); if (rec) { pbLineItems = JSON.parse(JSON.stringify(rec.items)); if (typeof recalcPB === 'function') { try { recalcPB(); } catch (e) {} } } } },
      rerender: function () {}
    }
  };
  function S(store) { return STORES[store] || STORES.bt; }

  // ── Tool catalog ─────────────────────────────────────────────────────────
  const TOOLS = {
    alternates:    { label: 'Find alternates',            desc: 'Comparable products you can swap in', kind: 'ai',  live: true,
      icon: '<path d="M4 4h7v7H4z"/><path d="M13 13h7v7h-7z"/><path d="M13 4l7 7"/>' },
    'price-check': { label: 'Price check / compare sources', desc: 'Same item across vendors, lowest price', kind: 'ai',
      icon: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    vendor:        { label: 'Find vendor / manufacturer',  desc: 'Who makes or carries this', kind: 'ai',
      icon: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>' },
    spec:          { label: 'Spec / tear-sheet search',    desc: 'Cut sheets & dimensioned specs', kind: 'web',
      icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>' },
    image:         { label: 'Image / inspiration search',  desc: 'Visual matches & similar looks', kind: 'web',
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>' },
  };
  const ORDER = ['alternates', 'price-check', 'vendor', 'spec', 'image'];
  function iconSvg(path, sz) { return '<svg viewBox="0 0 24 24" width="' + (sz || 14) + '" height="' + (sz || 14) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }

  // normalize an item from either store for the engine
  function _norm(store, item) {
    return { name: item.name || '', vendor: item.vendor || '', description: item.description || '',
      estPrice: num(item[S(store).priceField]), qty: item.qty };
  }

  /* ========================================================================
     PER-ITEM RESEARCH MENU
     ======================================================================== */
  let _menuEl = null;
  function closeMenu() { if (_menuEl) { _menuEl.remove(); _menuEl = null; document.removeEventListener('mousedown', _onDocDown, true); } }
  function _onDocDown(e) { if (_menuEl && !_menuEl.contains(e.target)) closeMenu(); }

  // Public: open the research menu. store = 'bt' | 'pb'.
  window.btResearchMenu = function (btn, store, projName, itemId) {
    if (_menuEl) { closeMenu(); return; }
    const item = S(store).item(projName, itemId); if (!item) return;
    const nFound = (item.findings || []).length;
    const menu = document.createElement('div');
    menu.className = 'research-menu';
    menu.innerHTML =
      '<div class="rm-head">Research this item</div>' +
      ORDER.map(function (k) {
        const t = TOOLS[k];
        return '<div class="rm-item" onclick="btRunResearch(\'' + store + '\',\'' + _q(projName) + '\',\'' + itemId + '\',\'' + k + '\')">' +
          '<span class="rm-ic">' + iconSvg(t.icon) + '</span>' +
          '<span class="rm-tx"><span class="rm-t">' + t.label + (t.live ? '<span class="rm-live">LIVE</span>' : '') + '</span>' +
          '<span class="rm-d">' + t.desc + '</span></span></div>';
      }).join('') +
      '<div class="rm-sep"></div>' +
      '<div class="rm-foot" onclick="' + (S(store).hub
        ? 'srcGoTo(\'' + _q(projName) + '\',\'' + itemId + '\')'
        : 'srcOpenFindings(\'' + store + '\',\'' + _q(projName) + '\',\'' + itemId + '\')') + '">' +
        (nFound ? '<span class="rm-pin">' + nFound + '</span> ' + nFound + ' saved finding' + (nFound > 1 ? 's' : '') + ' — compare →'
                : (S(store).hub ? 'Open in Sourcing hub →' : 'No findings yet')) +
      '</div>';
    document.body.appendChild(menu);
    _menuEl = menu;
    const r = btn.getBoundingClientRect();
    let left = r.right - 252; if (left < 8) left = 8;
    let top = r.bottom + 5;
    menu.style.left = left + 'px';
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 5);
    menu.style.top = top + 'px';
    setTimeout(function () { document.addEventListener('mousedown', _onDocDown, true); }, 0);
  };

  /* ========================================================================
     RUN A TOOL
     ======================================================================== */
  window.btRunResearch = function (store, projName, itemId, mode) {
    closeMenu();
    const item = S(store).item(projName, itemId); if (!item) return;
    const tool = TOOLS[mode];
    if (tool.kind === 'web') { _webSearch(mode, item); return; }

    const title = document.getElementById('alt-modal-title');
    const sub = document.getElementById('alt-modal-sub');
    const content = document.getElementById('alt-modal-content');
    if (title) title.textContent = tool.label + ' — ' + (item.itemNum ? item.itemNum + ' · ' : '') + (item.name || 'Item');
    if (sub) sub.textContent = item.vendor || '';
    if (content) content.innerHTML = _loadingHTML(mode);
    openModal('alt-modal');
    if (typeof altEnsureKey === 'function' && !altEnsureKey(content)) return;

    _research(mode, _norm(store, item), S(store).projType(projName)).then(function (results) {
      _renderResults(content, results, mode, store, projName, itemId);
    }).catch(function (err) {
      content.innerHTML = '<div style="padding:12px 14px;background:var(--red-bg);border-radius:var(--radius-sm);color:var(--red);font-size:12.5px;white-space:pre-line">' + esc(err.message) + '</div>';
    });
  };

  function _webSearch(mode, item) {
    const name = item.name || '', vendor = item.vendor || '';
    const q = mode === 'spec' ? (name + ' ' + vendor + ' cut sheet specification pdf').trim() : (name + ' ' + vendor).trim();
    const url = mode === 'spec' ? 'https://www.google.com/search?q=' + encodeURIComponent(q)
                                : 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q);
    window.open(url, '_blank');
    if (typeof ai3Toast === 'function') ai3Toast((mode === 'spec' ? 'Spec' : 'Image') + ' search opened in a new tab');
  }

  function _loadingHTML(mode) {
    const msg = mode === 'price-check' ? 'Comparing prices across vendors…' : mode === 'vendor' ? 'Finding vendors & manufacturers…' : 'Finding alternatives…';
    return '<div style="text-align:center;padding:24px 0"><div style="font-size:22px;margin-bottom:8px;animation:spin 1.5s linear infinite;display:inline-block">⏳</div>' +
      '<div style="font-size:13px;font-weight:500;color:var(--text)">' + msg + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:4px">Drawing on a broad range of vendors</div></div>';
  }

  /* ========================================================================
     AI ENGINE
     ======================================================================== */
  async function _research(mode, item, projType) {
    if (mode === 'alternates' && typeof aiGetAlternatives === 'function') {
      const a = await aiGetAlternatives(item.name, item.vendor, item.description, num(item.estPrice), item.qty, projType);
      return a.map(function (x) { x._mode = 'alternates'; return x; });
    }
    const provider = localStorage.getItem('db_provider') || 'anthropic';
    const aiKey = localStorage.getItem('db_apikey_' + provider) || '';
    const serpKey = localStorage.getItem('db_serpapi_key') || '';
    if (!aiKey) throw new Error('No AI API key saved. Add one in the AI Budget module first.');
    const name = item.name || '', vendor = item.vendor || '', desc = item.description || '', price = num(item.estPrice);

    let resultsList = '';
    if (serpKey && mode === 'price-check') {
      try {
        const res = await fetch('https://serpapi.com/search.json?engine=google_shopping&q=' + encodeURIComponent(name + ' ' + vendor) + '&num=20&api_key=' + serpKey);
        if (res.ok) {
          const data = await res.json();
          const rows = (data.shopping_results || []).slice(0, 16).map(function (r, i) {
            return (i + 1) + '. "' + (r.title || '') + '" from ' + (r.source || r.merchant || '') + ' — $' + ((r.price || '0').replace(/[^0-9.]/g, '')) + ' — URL: ' + (r.link || r.product_link || '');
          });
          if (rows.length) resultsList = rows.join('\n');
        }
      } catch (e) { console.warn('[research] serp', e.message); }
    }
    const text = await _aiCall(provider, aiKey, _prompt(mode, { name: name, vendor: vendor, desc: desc, price: price, projType: projType, resultsList: resultsList }));
    return _parseArr(text).map(function (x) { x._mode = mode; return x; });
  }

  function _prompt(mode, c) {
    const ref = 'Item: ' + c.name + ' | Vendor: ' + (c.vendor || '—') + ' | Spec: ' + (c.desc || '—') + ' | Reference price: $' + fD(c.price) + ' | Project type: ' + (c.projType || 'Commercial');
    const shape = 'Return ONLY a JSON array — no prose, no markdown:\n[{"name":"","vendor":"","price":0,"leadTime":"","url":"","description":"","notes":""}]';
    if (mode === 'price-check') {
      return 'You are an FF&E procurement specialist. Find where to buy THIS SAME item (or the closest equivalent) across different vendors/sources, sorted lowest price first.\n\n' + ref + '\n\n' +
        (c.resultsList ? 'Real search results to choose from:\n' + c.resultsList + '\n\n' : '') +
        'Give 5 sources. For "url" use the exact result URL when provided, else a Google search URL. "notes" = whether it is the exact item or an equivalent, and the price difference vs reference.\n\n' + shape;
    }
    if (mode === 'vendor') {
      return 'You are an FF&E procurement specialist for ' + (c.projType || 'commercial') + ' interiors. List 5 real manufacturers or vendors that make or carry this item (or a close equivalent). Span major contract lines, boutique/specialty & artisan makers, and trade-only or regional sources — vary the vendor.\n\n' + ref + '\n\n' +
        'Set "name" to the product/line, "vendor" to the manufacturer, "price" to a typical price if known (else 0), "url" to a Google search that finds them. "notes" = why they fit.\n\n' + shape;
    }
    return 'Suggest 5 varied alternatives.\n' + ref + '\n' + shape;
  }

  async function _aiCall(provider, aiKey, prompt) {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
      });
      if (!res.ok) { const e = await res.json().catch(function () { return {}; }); throw new Error((e.error && e.error.message) || ('API error ' + res.status)); }
      const data = await res.json();
      return data.content.filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join('').trim();
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiKey },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt + '\n\nWrap in {"results":[...]}' }] })
    });
    if (!res.ok) { const e = await res.json().catch(function () { return {}; }); throw new Error((e.error && e.error.message) || ('API error ' + res.status)); }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  function _parseArr(text) {
    let clean = String(text || '').replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const aS = clean.indexOf('['), aE = clean.lastIndexOf(']');
    if (aS >= 0 && aE > aS) clean = clean.slice(aS, aE + 1);
    else if (clean.startsWith('{')) { const w = JSON.parse(clean); clean = JSON.stringify(w.results || w.alternatives || w[Object.keys(w)[0]] || []); }
    clean = clean.replace(/,\s*([}\]])/g, '$1');
    const arr = JSON.parse(clean);
    return Array.isArray(arr) ? arr : [];
  }

  /* ========================================================================
     RESULT RENDER (modal)
     ======================================================================== */
  function _renderResults(container, results, mode, store, projName, itemId) {
    if (!results || !results.length) { container.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">No results found.</div>'; return; }
    const uid = '_rs_' + Date.now();
    window[uid] = results;
    container.innerHTML =
      '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">' + TOOLS[mode].label + ' · ' + results.length + ' results. <b>Save</b> the ones worth keeping; <b>Use on item</b> writes it back.</div>' +
      results.map(function (a, i) {
        const known = (typeof matchKnownVendor === 'function') ? matchKnownVendor(a.vendor) : null;
        const tag = known
          ? '<span style="font-size:10px;font-weight:700;color:var(--green);background:#fff;border:1px solid var(--green);border-radius:3px;padding:1px 6px;margin-left:6px;white-space:nowrap">✓ In your Vendors' + (known.rating ? ' · ' + known.rating.toFixed(1) + '★' : '') + '</span>'
          : '<span style="font-size:10px;font-weight:600;color:var(--text3);background:var(--surface2);border:1px solid var(--border2);border-radius:3px;padding:1px 6px;margin-left:6px;white-space:nowrap">New vendor</span>';
        const link = (a.url && String(a.url).startsWith('http')) ? a.url : 'https://www.google.com/search?q=' + encodeURIComponent((a.name || '') + ' ' + (a.vendor || ''));
        return '<div style="border:1px solid var(--border);border-left:3px solid ' + (known ? 'var(--green)' : 'var(--border2)') + ';border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;font-size:13px;margin-bottom:2px"><span onclick="window.open(\'' + esc(link).replace(/'/g, "\\'") + '\',\'_blank\')" style="color:var(--accent-ink);text-decoration:underline;cursor:pointer">' + esc(a.name || '(unnamed)') + '</span></div>' +
              '<div style="font-size:12px;margin-bottom:4px"><span style="color:var(--accent2)">' + esc(a.vendor || '') + '</span>' + tag + '</div>' +
              (a.description ? '<div style="font-size:11.5px;color:var(--text2);margin-bottom:6px">' + esc(a.description) + '</div>' : '') +
              '<div style="display:flex;gap:12px;font-size:11.5px;flex-wrap:wrap">' +
                (num(a.price) > 0 ? '<span style="color:var(--text2)">Price: <strong style="color:var(--text)">$' + fD(a.price) + '</strong></span>' : '') +
                (a.leadTime ? '<span style="color:var(--text2)">Lead: <strong>' + esc(a.leadTime) + '</strong></span>' : '') +
                (num(a.savings) > 0 ? '<span style="color:var(--green);font-weight:600">↓ $' + fD(a.savings) + ' less</span>' : '') +
              '</div>' +
              (a.notes ? '<div style="font-size:11px;color:var(--text3);margin-top:4px;font-style:italic">' + esc(a.notes) + '</div>' : '') +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
              '<button onclick="srcSaveFromResults(\'' + store + '\',\'' + _q(projName) + '\',\'' + itemId + '\',\'' + uid + '\',' + i + ',this)" style="padding:5px 12px;border-radius:var(--radius-sm);border:1px solid var(--accent-ink);background:var(--surface);color:var(--accent-ink);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap">＋ Save</button>' +
              '<button onclick="srcUseFromResults(\'' + store + '\',\'' + _q(projName) + '\',\'' + itemId + '\',\'' + uid + '\',' + i + ')" style="padding:5px 12px;border-radius:var(--radius-sm);border:1px solid var(--accent);background:var(--accent-bg);color:var(--accent-ink);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap">Use ↗</button>' +
            '</div>' +
          '</div></div>';
      }).join('');
  }

  function _toFinding(a, mode) {
    return { id: (typeof genId === 'function') ? genId() : Date.now() + Math.floor(Math.random() * 1e4),
      mode: a._mode || mode || 'alternates', name: a.name || '', vendor: a.vendor || '', price: num(a.price),
      leadTime: a.leadTime || '', url: a.url || '', description: a.description || '', notes: a.notes || '',
      chosen: false, savedAt: new Date().toISOString().slice(0, 10) };
  }

  window.srcSaveFromResults = function (store, projName, itemId, uid, idx, btn) {
    const arr = window[uid]; if (!arr || !arr[idx]) return;
    _addFinding(store, projName, itemId, _toFinding(arr[idx], arr[idx]._mode));
    if (btn) { btn.textContent = '✓ Saved'; btn.disabled = true; btn.style.opacity = '.6'; btn.style.cursor = 'default'; }
  };
  window.srcUseFromResults = function (store, projName, itemId, uid, idx) {
    const arr = window[uid]; if (!arr || !arr[idx]) return;
    const f = _toFinding(arr[idx], arr[idx]._mode);
    _addFinding(store, projName, itemId, f, true);
    _applyToItem(store, projName, itemId, f);
    closeModal('alt-modal');
  };

  /* ========================================================================
     FINDINGS MODEL
     ======================================================================== */
  function _addFinding(store, projName, itemId, finding, choose) {
    const item = S(store).item(projName, itemId); if (!item) return;
    item.findings = item.findings || [];
    const exists = item.findings.find(function (f) { return f.name === finding.name && f.vendor === finding.vendor; });
    let f = exists; if (!exists) { item.findings.push(finding); f = finding; }
    if (choose) { item.findings.forEach(function (x) { x.chosen = false; }); f.chosen = true; }
    S(store).save();
    if (typeof ai3Toast === 'function') ai3Toast(choose ? 'Saved & set as source' : 'Finding saved');
    S(store).rerender();
    if (S(store).hub && document.getElementById('page-sourcing') && document.getElementById('page-sourcing').offsetParent !== null) renderSourcing();
  }
  function _applyToItem(store, projName, itemId, f) {
    const item = S(store).item(projName, itemId); if (!item) return;
    if (f.name) item.name = f.name;
    if (f.vendor) item.vendor = f.vendor;
    if (num(f.price) > 0) item[S(store).priceField] = num(f.price);
    if (f.leadTime) item.leadTime = f.leadTime;
    S(store).save(); S(store).rerender();
  }
  window.srcUseFinding = function (store, projName, itemId, fid) {
    const item = S(store).item(projName, itemId); if (!item) return;
    const f = (item.findings || []).find(function (x) { return String(x.id) === String(fid); }); if (!f) return;
    item.findings.forEach(function (x) { x.chosen = false; }); f.chosen = true;
    _applyToItem(store, projName, itemId, f);
    if (typeof ai3Toast === 'function') ai3Toast('Set as item source');
    if (S(store).hub) renderSourcing(); else _renderFindingsModal(store, projName, itemId);
  };
  window.srcRemoveFinding = function (store, projName, itemId, fid) {
    const item = S(store).item(projName, itemId); if (!item || !item.findings) return;
    item.findings = item.findings.filter(function (x) { return String(x.id) !== String(fid); });
    S(store).save(); S(store).rerender();
    if (S(store).hub) renderSourcing(); else _renderFindingsModal(store, projName, itemId);
  };

  window.srcGoTo = function (projName, itemId) {
    closeMenu(); _srcSel = itemId;
    const a = document.querySelector('nav a[data-page="sourcing"]');
    if (a && typeof nav === 'function') nav(a);
  };

  /* ========================================================================
     FINDINGS COMPARE MODAL (for the Preliminary Budget — no hub there)
     ======================================================================== */
  window.srcOpenFindings = function (store, projName, itemId) {
    closeMenu();
    const item = S(store).item(projName, itemId); if (!item) return;
    if (!(item.findings || []).length) { if (typeof ai3Toast === 'function') ai3Toast('No saved findings yet — run a research tool first.'); return; }
    openModal('alt-modal');
    _renderFindingsModal(store, projName, itemId);
  };
  function _renderFindingsModal(store, projName, itemId) {
    const item = S(store).item(projName, itemId); if (!item) return;
    const title = document.getElementById('alt-modal-title'); const sub = document.getElementById('alt-modal-sub'); const content = document.getElementById('alt-modal-content');
    if (title) title.textContent = 'Saved findings — ' + (item.itemNum ? item.itemNum + ' · ' : '') + (item.name || 'Item');
    if (sub) sub.textContent = (item.findings || []).length + ' saved · estimate ' + money(num(item[S(store).priceField]) * (num(item.qty) || 1));
    if (content) content.innerHTML = '<div class="src-cards">' + _cards(store, projName, item) + '</div>';
  }

  /* ========================================================================
     SOURCING HUB — sources from the Procurement Tracker, or falls back to the
     project's Preliminary Budget when no tracker exists yet.
     ======================================================================== */
  function _items(name) { const bt = budgetTrackers[name]; return bt ? bt.items.filter(function (i) { return !i.isCategory && (i.name || i.itemNum); }) : []; }
  function _state(it) { const f = it.findings || []; if (f.some(function (x) { return x.chosen; })) return 'sourced'; if (f.length) return 'found'; return 'needs'; }
  let _srcSel = null, _hubStore = 'bt', _hubPBId = null;
  function _hubRec() { return (typeof prelimBudgets !== 'undefined') ? (prelimBudgets || []).find(function (p) { return p.id === _hubPBId; }) : null; }

  // pick the latest Preliminary Budget for a project that has line items
  function _latestPB(projName) {
    if (typeof prelimBudgets === 'undefined') return null;
    const cands = (prelimBudgets || []).filter(function (p) { return p.project === projName && (p.items || []).some(function (i) { return !i.isCategory && (i.name || i.itemNum); }); });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0); });
    return cands[0];
  }

  window.renderSourcing = function () {
    const host = document.getElementById('page-sourcing'); if (!host) return;
    const proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject : null;
    if (!proj) { host.innerHTML = '<div class="rp-empty" style="padding:40px;text-align:center;color:var(--text3)">Open a project to source its items.</div>'; return; }
    try { if (typeof ensureBudgetTracker === 'function') ensureBudgetTracker(proj.name); } catch (e) {}

    // Resolve the source: Procurement Tracker first, else Preliminary Budget.
    let items = _items(proj.name), source = 'Procurement Tracker';
    _hubStore = 'bt'; _hubPBId = null;
    if (!items.length) {
      const pb = _latestPB(proj.name);
      if (pb) {
        _hubStore = 'pbrec'; _hubPBId = pb.id;
        (pb.items || []).forEach(function (it) { if (it.id == null || it.id === '') it.id = Date.now() + Math.random(); });
        items = (pb.items || []).filter(function (i) { return !i.isCategory && (i.name || i.itemNum); });
        source = 'Preliminary Budget' + (pb.name ? ' · ' + pb.name : '');
      }
    }
    if (!items.length) { host.innerHTML = '<div class="rp-empty" style="padding:40px;text-align:center;color:var(--text3)">No line items yet. Build a Preliminary Budget or Procurement Tracker first, then source its items here.</div>'; return; }

    const store = _hubStore, pf = S(store).priceField;
    const sourced = items.filter(function (i) { return _state(i) === 'sourced'; }).length;
    const withFindings = items.filter(function (i) { return (i.findings || []).length; }).length;
    let savings = 0;
    items.forEach(function (it) { const ch = (it.findings || []).find(function (x) { return x.chosen; }); if (ch && num(ch.price) > 0 && num(it[pf]) > 0) savings += (num(it[pf]) - num(ch.price)) * (num(it.qty) || 1); });

    if (!_srcSel || !items.find(function (i) { return String(i.id) === String(_srcSel); })) { const fn = items.find(function (i) { return _state(i) !== 'sourced'; }); _srcSel = (fn || items[0]).id; }
    const sel = items.find(function (i) { return String(i.id) === String(_srcSel); });

    const kpi = function (l, v, s) { return '<div class="rp-kpi"><div class="rp-kpi-label">' + l + '</div><div class="rp-kpi-value sm">' + v + '</div><div class="rp-kpi-sub">' + s + '</div></div>'; };
    const bar = '<div class="rp-toolbar"><div class="rp-toolbar-left"><div class="rp-scope-name">' + esc(proj.name) + '</div><div class="rp-period">Sourcing from ' + esc(source) + '</div></div></div>' +
      '<div class="rp-kpi-row k4" style="margin-bottom:16px">' +
        kpi('Sourced', sourced + ' / ' + items.length, 'have a chosen source') +
        kpi('In research', withFindings, 'with saved findings') +
        kpi('Still to source', items.length - withFindings, 'no findings yet') +
        kpi('Est. savings', (savings >= 0 ? money(savings) : '−' + money(-savings)), 'chosen vs estimate') +
      '</div>';
    const queue = '<div class="src-col-left"><div class="src-h">Items <span style="margin-left:auto;font-weight:400;color:var(--text3)">' + items.length + '</span></div>' +
      items.map(function (it) {
        const st = _state(it); const sc = st === 'sourced' ? ['done', 'Sourced'] : st === 'found' ? ['found', it.findings.length + ' found'] : ['need', 'Needs'];
        return '<div class="src-q' + (String(it.id) === String(_srcSel) ? ' sel' : '') + '" onclick="srcSelect(\'' + _q(it.id) + '\')">' +
          '<div class="src-q-top"><span class="src-q-name">' + (it.itemNum ? esc(it.itemNum) + ' · ' : '') + esc(it.name || '(unnamed)') + '</span><span class="src-chip ' + sc[0] + '">' + sc[1] + '</span></div>' +
          '<div class="src-q-meta">' + esc(it.vendor || 'Vendor TBD') + ' · est ' + money(num(it[pf]) * (num(it.qty) || 1)) + ' · qty ' + (num(it.qty) || 0) + '</div></div>';
      }).join('') + '</div>';
    host.innerHTML = bar + _shortlistHTML(proj.name, items) + '<div class="card" style="padding:0;overflow:hidden"><div class="src-grid">' + queue + '<div class="src-col-right" id="src-detail">' + _detailHTML(_hubStore, proj.name, sel) + '</div></div></div>';
  };
  window.srcSelect = function (itemId) { _srcSel = itemId; renderSourcing(); };

  // Shortlist = products parked from the Library for this project, not yet
  // attached to a specific line item.
  function _shortlist(projName) { return (typeof librarySaved !== 'undefined' && librarySaved[projName]) ? librarySaved[projName] : []; }
  function _shortlistHTML(projName, items) {
    const sl = _shortlist(projName); if (!sl.length) return '';
    const itemOpts = items.map(function (it) { return '<option value="' + _q(it.id) + '">' + esc((it.itemNum ? it.itemNum + ' · ' : '') + (it.name || 'item')) + '</option>'; }).join('');
    return '<div class="card" style="padding:14px 16px;margin-bottom:16px;border-left:3px solid var(--accent)">' +
      '<div class="src-h" style="margin-bottom:10px">From the Library <span style="margin-left:auto;font-weight:400;color:var(--text3)">' + sl.length + ' shortlisted</span></div>' +
      '<div class="src-cards">' + sl.map(function (s, idx) {
        const img = s.image ? '<div style="height:80px;background:var(--surface2);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:7px"><img data-sbsrc="' + String(s.image).replace(/"/g, '&quot;') + '" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'"/></div>' : '';
        return '<div class="src-card">' + img +
          '<div class="src-pn">' + esc(s.name || '(unnamed)') + '</div><div class="src-pv">' + esc(s.vendor || '') + '</div>' +
          '<div class="src-prow"><span class="src-pp">' + (num(s.price) > 0 ? money(s.price) : '—') + '</span></div>' +
          '<div class="src-act" style="flex-direction:column;gap:6px">' +
            '<select onchange="if(this.value)srcAssignShortlist(\'' + _q(projName) + '\',' + idx + ',this.value)" style="width:100%;height:28px;font-size:11px;font-family:inherit;border:1px solid var(--accent-ink);color:var(--accent-ink);border-radius:5px;background:var(--accent-bg);cursor:pointer"><option value="">Assign to item ▾</option>' + itemOpts + '</select>' +
            '<button class="src-mini ghost" onclick="srcRemoveShortlist(\'' + _q(projName) + '\',' + idx + ')">Remove</button>' +
          '</div></div>';
      }).join('') + '</div></div>';
  }
  window.srcAssignShortlist = function (projName, idx, itemId) {
    const sl = _shortlist(projName); const s = sl[idx]; if (!s) return;
    _addFinding(_hubStore, projName, itemId, { id: (typeof genId === 'function') ? genId() : Date.now() + Math.floor(Math.random() * 1e4), mode: 'library', name: s.name || '', vendor: s.vendor || '', price: num(s.price), leadTime: s.leadTime || '', url: s.url || '', description: s.description || '', notes: 'From Library shortlist', chosen: false, savedAt: new Date().toISOString().slice(0, 10) });
    _srcSel = itemId;
    if (typeof ai3Toast === 'function') ai3Toast('Added to item as a finding');
    renderSourcing();
  };
  window.srcRemoveShortlist = function (projName, idx) {
    if (typeof librarySaved === 'undefined' || !librarySaved[projName]) return;
    librarySaved[projName].splice(idx, 1);
    if (typeof DB !== 'undefined') DB.save('fp11_libsaved', librarySaved);
    renderSourcing();
  };

  function _cards(store, projName, it) {
    const findings = it.findings || [];
    return findings.map(function (f) {
      const t = TOOLS[f.mode] || TOOLS.alternates;
      const delta = (num(f.price) > 0 && num(it[S(store).priceField]) > 0) ? (num(it[S(store).priceField]) - num(f.price)) : null;
      const link = (f.url && String(f.url).startsWith('http')) ? f.url : 'https://www.google.com/search?q=' + encodeURIComponent((f.name || '') + ' ' + (f.vendor || ''));
      return '<div class="src-card' + (f.chosen ? ' chosen' : '') + '">' +
        '<div class="src-card-top"><span class="src-src">' + esc(t.label.split(' / ')[0]) + '</span>' + (f.chosen ? '<span class="src-star">★ Chosen</span>' : '') + '</div>' +
        '<div class="src-pn"><span onclick="window.open(\'' + esc(link).replace(/'/g, "\\'") + '\',\'_blank\')" style="cursor:pointer;text-decoration:underline;color:var(--text)">' + esc(f.name || '(unnamed)') + '</span></div>' +
        '<div class="src-pv">' + esc(f.vendor || '') + '</div>' +
        '<div class="src-prow"><span class="src-pp">' + (num(f.price) > 0 ? money(f.price) : '—') + '</span><span class="src-pl">' + (f.leadTime ? esc(f.leadTime) : '') + '</span></div>' +
        (delta !== null ? '<div class="src-delta ' + (delta >= 0 ? 'pos' : 'neg') + '">' + (delta >= 0 ? '↓ ' + money(delta) + ' under est' : '↑ ' + money(-delta) + ' over est') + '</div>' : '') +
        (f.notes ? '<div class="src-notes">' + esc(f.notes) + '</div>' : '') +
        '<div class="src-act">' +
          '<button class="src-mini ' + (f.chosen ? 'ghost' : 'primary') + '" onclick="srcUseFinding(\'' + store + '\',\'' + _q(projName) + '\',\'' + _q(it.id) + '\',\'' + _q(f.id) + '\')">' + (f.chosen ? 'Re-apply' : 'Use on item') + '</button>' +
          '<button class="src-mini ghost" onclick="srcRemoveFinding(\'' + store + '\',\'' + _q(projName) + '\',\'' + _q(it.id) + '\',\'' + _q(f.id) + '\')">Remove</button>' +
        '</div></div>';
    }).join('');
  }

  function _detailHTML(store, projName, it) {
    if (!it) return '';
    const ext = num(it[S(store).priceField]) * (num(it.qty) || 1);
    const tools = '<div class="src-tools">' + ORDER.map(function (k) {
      const t = TOOLS[k];
      return '<button class="src-tool" title="' + t.desc + '" onclick="btRunResearch(\'' + store + '\',\'' + _q(projName) + '\',\'' + _q(it.id) + '\',\'' + k + '\')"><span class="src-tool-ic">' + iconSvg(t.icon, 13) + '</span>' + t.label.split(' / ')[0] + '</button>';
    }).join('') + '</div>';
    const findings = it.findings || [];
    const body = findings.length
      ? '<div class="src-cards">' + _cards(store, projName, it) + '</div>'
      : '<div style="text-align:center;padding:34px 20px;color:var(--text3)"><div style="font-size:13px;color:var(--text2);margin-bottom:4px;font-weight:600">No findings yet for this item</div><div style="font-size:12px">Run a research tool above to start sourcing it.</div></div>';
    return '<div class="src-detail-head"><div><div class="src-dt">' + (it.itemNum ? esc(it.itemNum) + ' · ' : '') + esc(it.name || 'Item') + '</div>' +
      '<div class="src-ds">Estimate ' + money(ext) + ' · qty ' + (num(it.qty) || 0) + ' · current vendor ' + esc(it.vendor || '—') + '</div></div></div>' + tools + body;
  }

})();
