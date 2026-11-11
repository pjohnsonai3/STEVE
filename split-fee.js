/* ============================================================================
   STEVE — Split procurement fee (split-fee.js)
   Some projects charge one fee on low-quantity items and a lower fee on
   high-quantity items (e.g. Hardin Woods: 25% / 10%). The setting lives on
   the project (proj.feeSplit = {on, low, high}); each line carries
   feeTier:'high' when it belongs to the high-quantity column. Installation
   stays outside the fee base as before. Normal projects are untouched.
   Also: Excel import of a split-fee budget into Document → Budget.
   ========================================================================= */
(function () {
  'use strict';
  var DEF = { low: 25, high: 10 };
  function proj(n) { return (typeof projects !== 'undefined' ? projects : []).find(function (p) { return p.name === n; }); }
  function saveProjects() { DB.save('fp11_projects', projects); if (typeof sbSchedulePushState === 'function') sbSchedulePushState(); }
  function money(n) { return '$' + fmtD(n || 0); }
  function toast(m) { try { if (typeof ai3Toast === 'function') ai3Toast(m); } catch (e) {} }

  window.sfSplit = function (projName) { var p = proj(projName); return p && p.feeSplit && p.feeSplit.on ? p.feeSplit : null; };

  // Fee for a set of items under a split (or null split → single rate).
  function feeWith(split, items, goodsSub, pct) {
    if (!split) return { fee: goodsSub * pct / 100, label: pct, split: null };
    var hiItems = (items || []).map(function (i) { return i.isCategory || i.feeTier === 'high' ? i : Object.assign({}, i, { price: 0, estPrice: 0 }); });
    var hi = splitGoodsInstall(hiItems, 'price').goods, lo = Math.max(0, goodsSub - hi);
    var low = parseFloat(split.low), high = parseFloat(split.high);
    return { fee: lo * low / 100 + hi * high / 100, label: 'Low qty ' + low + '% \u00b7 High qty ' + high, split: { lo: lo, hi: hi, low: low, high: high } };
  }
  window.sfFeeWith = feeWith;
  window.sfFee = function (projName, items, goodsSub, pct) { return feeWith(sfSplit(projName), items, goodsSub, pct); };

  // Replace the single "Procurement Fee (Low qty …)" row with one row per tier.
  function splitRows(containerId, projName, items, goodsSub) {
    var s = sfSplit(projName); if (!s) return;
    var box = document.getElementById(containerId); if (!box) return;
    var info = feeWith(s, items, goodsSub, 0).split;
    [].slice.call(box.querySelectorAll('tr')).forEach(function (tr) {
      var td = tr.children[0];
      if (!td || tr.dataset.sf || !/^Procurement Fee \(Low qty/.test(td.textContent.trim())) return;
      var mk = function (lbl, pct, base) {
        var r = tr.cloneNode(true); r.dataset.sf = '1';
        r.children[0].textContent = 'Procurement Fee \u2014 ' + lbl + ' (' + pct + '% on ' + money(base) + ')';
        r.children[r.children.length - 1].textContent = money(base * pct / 100);
        return r;
      };
      tr.parentNode.insertBefore(mk('Low qty', info.low, info.lo), tr);
      tr.parentNode.insertBefore(mk('High qty', info.high, info.hi), tr);
      tr.remove();
    });
  }

  // ── Per-line tier chip ────────────────────────────────────────────────────
  function storeProject(store) {
    var el = document.getElementById(store === 'pa' ? 'pa-project' : 'pb-project');
    return el ? el.value : '';
  }
  window.sfTierChip = function (store, idx, item, editable) {
    if (!sfSplit(storeProject(store))) return '';
    var hi = item.feeTier === 'high';
    if (!editable) return hi ? '<div style="font-size:9px;font-weight:700;letter-spacing:.04em;color:#555;margin-top:3px">HIGH QTY</div>' : '';
    return '<div style="margin-top:4px"><span onclick="event.stopPropagation();sfToggleTier(\'' + store + '\',' + idx + ')" title="Click to switch between the low- and high-quantity fee" ' +
      'style="display:inline-block;cursor:pointer;font-size:9px;font-weight:700;letter-spacing:.04em;padding:1px 5px;border-radius:2px;white-space:nowrap;' +
      (hi ? 'background:#1a1a1a;color:#fff;border:1px solid #1a1a1a' : 'background:#fff;color:#555;border:1px solid #bbb') + '">' + (hi ? 'HIGH QTY' : 'LOW QTY') + '</span></div>';
  };
  window.sfToggleTier = function (store, idx) {
    var arr = _docArr(store), it = arr[idx]; if (!it) return;
    if (typeof pushUndo === 'function') pushUndo('Change fee tier');
    it.feeTier = it.feeTier === 'high' ? 'low' : 'high';
    _docAfter(store);
  };

  // ── Settings control (PB fee card, PA fee strip) ──────────────────────────
  function controlHTML(store) {
    return '<div id="sf-ctl-' + store + '" style="margin:6px 0 10px;font-size:12px">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="sf-on-' + store + '" onchange="sfSetOn(\'' + store + '\',this.checked)" /> Split fee for high-quantity items</label>' +
      '<div id="sf-rates-' + store + '" style="display:none;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap">' +
        '<span>Low qty <input type="number" step="0.1" id="sf-low-' + store + '" oninput="sfSetRate(\'' + store + '\')" style="width:52px;padding:3px 4px;border:1px solid var(--border2);border-radius:3px;font-family:inherit" />%</span>' +
        '<span>High qty <input type="number" step="0.1" id="sf-high-' + store + '" oninput="sfSetRate(\'' + store + '\')" style="width:52px;padding:3px 4px;border:1px solid var(--border2);border-radius:3px;font-family:inherit" />%</span>' +
        '<span style="color:var(--text3);font-size:11px">Applies to this whole project. Tag lines LOW / HIGH QTY in the budget.</span>' +
      '</div></div>';
  }
  function mount(store) {
    if (document.getElementById('sf-ctl-' + store)) return;
    var inp = document.getElementById(store === 'pa' ? 'pa-fee-pct' : 'pb-fee-pct'); if (!inp) return;
    var host = inp.closest('.form-row') || inp.parentNode;
    host.insertAdjacentHTML('afterend', controlHTML(store));
  }
  function syncUI(store) {
    mount(store);
    var p = proj(storeProject(store)), s = p && p.feeSplit;
    var on = !!(s && s.on);
    var cb = document.getElementById('sf-on-' + store); if (!cb) return;
    cb.checked = on; cb.disabled = !p;
    document.getElementById('sf-rates-' + store).style.display = on ? 'flex' : 'none';
    var lo = document.getElementById('sf-low-' + store), hi = document.getElementById('sf-high-' + store);
    if (document.activeElement !== lo) lo.value = s ? s.low : DEF.low;
    if (document.activeElement !== hi) hi.value = s ? s.high : DEF.high;
    var single = document.getElementById(store === 'pa' ? 'pa-fee-pct' : 'pb-fee-pct');
    if (single) { single.disabled = on; single.style.opacity = on ? '.4' : ''; single.title = on ? 'Split fee is on for this project — see Low / High qty rates' : ''; }
  }
  function rerun(store) { if (store === 'pa') { recalcPA(); if (typeof paPersist === 'function') paPersist(); } else recalcPB(); }
  window.sfSetOn = function (store, on) {
    var p = proj(storeProject(store)); if (!p) { toast('Pick a project first'); return; }
    p.feeSplit = Object.assign({}, DEF, p.feeSplit || {}, { on: !!on });
    saveProjects(); rerun(store);
  };
  window.sfSetRate = function (store) {
    var p = proj(storeProject(store)); if (!p || !p.feeSplit) return;
    p.feeSplit.low = parseFloat(document.getElementById('sf-low-' + store).value) || 0;
    p.feeSplit.high = parseFloat(document.getElementById('sf-high-' + store).value) || 0;
    saveProjects(); rerun(store);
  };
  window.sfApplyToProject = function (projName, on) {
    var p = proj(projName); if (!p) return;
    p.feeSplit = Object.assign({}, DEF, p.feeSplit || {}, { on: on !== false });
    saveProjects();
  };

  function wrap(name, after) {
    var o = window[name]; if (typeof o !== 'function' || o.__sf) return;
    var w = function () { var r = o.apply(this, arguments); try { after(); } catch (e) { console.warn('split-fee', e); } return r; };
    w.__sf = true; window[name] = w;
  }

  // ── Excel import → Document-to-Budget results ─────────────────────────────
  var BANDS = ['', 'Seating', 'Tables', 'Lighting', 'Drapery', 'Rugs', 'Miscellaneous', 'Mirrors', 'Art', 'Accessories'];
  function cellStr(v) { return v == null ? '' : String(v).trim(); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; }

  function parseBudgetSheet(wb) {
    var name = wb.SheetNames.find(function (n) { return /budget|overall/i.test(n); }) || wb.SheetNames[0];
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    var hr = -1, col = {};
    for (var r = 0; r < Math.min(rows.length, 40) && hr < 0; r++) {
      var cells = rows[r].map(function (c) { return cellStr(c).toLowerCase(); });
      var q = cells.findIndex(function (c) { return /^(qty|quantity)/.test(c); });
      var pr = cells.findIndex(function (c) { return /price|unit cost/.test(c); });
      if (q >= 0 && pr >= 0) {
        hr = r;
        col.qty = q; col.price = pr;
        col.num = cells.findIndex(function (c) { return /item\s*(#|num|no)/.test(c); });
        col.desc = cells.findIndex(function (c) { return /descr|item name/.test(c); });
        col.loc = cells.findIndex(function (c) { return /location|area|room/.test(c); });
        col.high = cells.findIndex(function (c) { return /high/.test(c) && /qty|quant|total|item/.test(c); });
        col.low = cells.findIndex(function (c) { return /low/.test(c) && /qty|quant|total|item/.test(c); });
        if (col.num < 0) col.num = 0;
        if (col.desc < 0) col.desc = col.num + 1;
      }
    }
    if (hr < 0) throw new Error('Could not find a header row with Quantity and Price columns.');

    var title = rows.slice(0, hr).map(function (r) { return r.map(cellStr).filter(Boolean).join(' '); }).filter(Boolean)[0] || '';
    var items = [], area = '', last = null, end = rows.length;
    for (var i = hr + 1; i < rows.length; i++) {
      var row = rows[i], a = cellStr(row[col.num]), b = cellStr(row[col.desc]);
      var joined = row.map(cellStr).join(' ');
      if (/^(all areas|subtotal)\b/i.test(b) || /^subtotal$/i.test(cellStr(row[col.qty]))) { end = i; break; }
      var qCell = cellStr(row[col.qty]), pCell = cellStr(row[col.price]);
      var qty = num(qCell), price = num(pCell);
      if (/^not in scope/i.test(a)) { last = null; continue; }
      // A row is a line item when it has a quantity or price cell filled in — a "0" counts.
      if ((qCell !== '' && !isNaN(parseFloat(String(qCell).replace(/[$,\s]/g, '')))) || (pCell !== '' && price)) {
        // Text without digits in the item # column (e.g. "Installation") names the area, not a number.
        var isLabel = a && !/\d/.test(a);
        var lineArea = isLabel ? a : area;
        var tier = '';
        if (col.high >= 0 && num(row[col.high])) tier = 'high';
        else if (col.low >= 0 && num(row[col.low])) tier = 'low';
        last = { itemNum: isLabel ? '' : a, name: b || a, description: '', location: col.loc >= 0 ? cellStr(row[col.loc]) || lineArea : lineArea, qty: qCell === '' ? 1 : qty, price: price, feeTier: tier, _area: lineArea };
        items.push(last);
      } else if (a && !b) { area = a; last = null; }
      else if (a && b) { area = a; last = null; }  // "Admin. Offices — No scope included"
      else if (!a && b && last) { last.description += (last.description ? '\n' : '') + b; }
      else if (!a && !b && !joined.trim()) { /* blank */ }
    }

    // Fees below the subtotal
    var fees = {}, tail = rows.slice(end, end + 25);
    tail.forEach(function (row) {
      row.forEach(function (c, k) {
        var s = cellStr(c), m = s.match(/\(?\s*(\d+(?:\.\d+)?)\s*%\s*fee\s*\)?/i);
        if (m) { if (k === col.high) fees.high = parseFloat(m[1]); else if (k === col.low) fees.low = parseFloat(m[1]); }
      });
      var t = row.map(cellStr).join(' ');
      var g;
      if (/procurement fee/i.test(t) && (g = t.match(/(\d+(?:\.\d+)?)\s*%/))) fees.single = fees.single || parseFloat(g[1]);
      if (/contingency/i.test(t) && (g = t.match(/(\d+(?:\.\d+)?)\s*%/))) fees.cont = parseFloat(g[1]);
      if (/freight/i.test(t) && (g = t.match(/(\d+(?:\.\d+)?)\s*%/))) fees.freight = parseFloat(g[1]);
      if (/\btax\b/i.test(t) && (g = t.match(/(\d+(?:\.\d+)?)\s*%/))) fees.tax = parseFloat(g[1]);
    });
    var hasHigh = items.some(function (i) { return i.feeTier === 'high'; });
    var split = (col.high >= 0 && hasHigh) ? { on: true, low: fees.low || fees.single || DEF.low, high: fees.high || DEF.high } : null;

    // Group by the item number's hundreds band; installation and unnumbered lines by their area.
    var groups = {}, order = [];
    items.forEach(function (it) {
      var m = String(it.itemNum).match(/(\d+)/), band = m ? Math.floor(parseInt(m[1], 10) / 100) : 0;
      var key = /install/i.test(it._area + ' ' + it.name) ? 'Installation' : /mirror/i.test(it.name) ? 'Mirrors' : (band >= 1 && band <= 9 ? BANDS[band] : (it._area || 'Miscellaneous'));
      if (!groups[key]) { groups[key] = []; order.push(key); }
      if (!it.itemNum && key === 'Installation') it.itemNum = '';
      delete it._area; groups[key].push(it);
    });
    order.sort(function (x, y) {
      var rx = BANDS.indexOf(x), ry = BANDS.indexOf(y);
      rx = x === 'Installation' ? 99 : rx < 0 ? 50 : rx; ry = y === 'Installation' ? 99 : ry < 0 ? 50 : ry;
      return rx - ry;
    });
    return {
      summary: (title ? title + ' \u2014 ' : '') + items.length + ' items imported from Excel' +
        (split ? ' \u00b7 split fee ' + split.low + '% low qty / ' + split.high + '% high qty (' + items.filter(function (i) { return i.feeTier === 'high'; }).length + ' high-qty lines)' : ''),
      categories: order.map(function (k) { return { name: k, items: groups[k] }; }),
      feeSplit: split, fees: fees
    };
  }
  window.sfParseBudgetWorkbook = parseBudgetSheet;

  window.sfImportBudgetFile = function (file) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var parsed = parseBudgetSheet(wb);
        if (!parsed.categories.length) throw new Error('No priced line items were found.');
        dbFileName = file.name;
        var set = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; };
        set('db-fee-pct', parsed.feeSplit ? parsed.feeSplit.low : parsed.fees.single);
        set('db-cont-pct', parsed.fees.cont); set('db-freight-pct', parsed.fees.freight); set('db-tax-pct', parsed.fees.tax);
        var up = document.getElementById('db-upload-card'); if (up) up.style.display = 'none';
        var er = document.getElementById('db-error'); if (er) er.style.display = 'none';
        dbBuildResults(parsed);
      } catch (err) {
        alert('Could not read this spreadsheet: ' + err.message);
      }
    };
    rd.readAsArrayBuffer(file);
  };

  // ── Templates page entry ──────────────────────────────────────────────────
  window.sfTemplateDetail = function (projectSelectHTML) {
    var using = (projects || []).filter(function (p) { return p.feeSplit && p.feeSplit.on; });
    return '<div style="border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:16px 18px">' +
      '<div style="font-weight:600;font-size:15px">Split-Fee Budget</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5;max-width:560px">For projects that charge a lower procurement fee on high-quantity items. Every line is tagged LOW QTY or HIGH QTY, and the budget and PA show a fee line for each. Installation stays outside the fee.</div>' +
      '<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:7px">Deploy to a project</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + projectSelectHTML +
      '<span>Low qty <input type="number" id="sf-tpl-low" value="' + DEF.low + '" step="0.1" style="width:52px;padding:4px;border:1px solid var(--border2);border-radius:3px;font-family:inherit" />%</span>' +
      '<span>High qty <input type="number" id="sf-tpl-high" value="' + DEF.high + '" step="0.1" style="width:52px;padding:4px;border:1px solid var(--border2);border-radius:3px;font-family:inherit" />%</span>' +
      '<button class="btn btn-sm btn-primary" onclick="sfTplDeploy()">Apply</button></div></div>' +
      '<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:7px">Projects using it</div>' +
      (using.length ? using.map(function (p) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-top:1px solid var(--border)"><div style="flex:1">' + escHtml(p.name) + '</div>' +
          '<div style="color:var(--text3);width:130px">' + p.feeSplit.low + '% / ' + p.feeSplit.high + '%</div>' +
          '<button class="btn btn-sm" onclick="sfTplRemove(' + JSON.stringify(p.name).replace(/"/g, '&quot;') + ')">Turn off</button></div>';
      }).join('') : '<div style="font-size:12px;color:var(--text3)">None yet.</div>') +
      '</div></div>';
  };
  window.sfTplDeploy = function () {
    var ps = document.getElementById('tpl-dep-p'); var p = ps && proj(ps.value);
    if (!p) { toast('Pick a project'); return; }
    p.feeSplit = { on: true, low: parseFloat(document.getElementById('sf-tpl-low').value) || DEF.low, high: parseFloat(document.getElementById('sf-tpl-high').value) || DEF.high };
    saveProjects(); toast('Split fee on for ' + p.name); if (typeof tplRender === 'function') tplRender();
  };
  window.sfTplRemove = function (name) {
    var p = proj(name); if (!p || !p.feeSplit) return;
    if (!confirm('Turn off the split fee for ' + name + '? Lines keep their LOW / HIGH tags in case you turn it back on.')) return;
    p.feeSplit.on = false; saveProjects(); if (typeof tplRender === 'function') tplRender();
  };

  function boot() {
    wrap('recalcPB', function () {
      syncUI('pb');
      var n = storeProject('pb');
      if (sfSplit(n)) splitRows('pb-preview', n, pbLineItems, splitGoodsInstall(pbLineItems, 'price').goods);
    });
    wrap('recalcPA', function () {
      syncUI('pa');
      var n = storeProject('pa'), cur = (typeof currentPAId !== 'undefined' && currentPAId) ? pas.find(function (p) { return p.id === currentPAId; }) : null;
      if (sfSplit(n) && !(cur && cur.feeOverride)) splitRows('pa-preview', n, paLineItems, splitGoodsInstall(paLineItems, 'price').goods);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1500);
})();
