/* ============================================================================
   STEVE — Weekly Status page
   A firm-wide weekly update across all procurement projects. Auto-seeds from the
   current weekly report; each cell is editable inline with Normal/Red/Blue text
   colour, persists to localStorage, and prints to a landscape PDF.
   ============================================================================ */
(function(){
  const LS_ROWS = 'fp11_status_rows';
  const LS_META = 'fp11_status_meta';

  const STATUS_COLS = [
    {k:'project',        label:'Project Name'},
    {k:'projectContact', label:'Project Contact'},
    {k:'procContact',    label:'Procurement Contact'},
    {k:'paDate',         label:'Issue Date of PA'},
    {k:'firstPOs',       label:'Issue Date of First Round of POs'},
    {k:'lastPOs',        label:'Issue Date of Last Round of POs'},
    {k:'install',        label:'Installation Date'},
    {k:'closeout',       label:'Close Out Date'},
  ];

  const RED  = '#AE1A1D';   // needs attention
  const BLUE = '#2563A8';   // note / update
  const r = s => '<span style="color:'+RED+'">'+s+'</span>';
  const b = s => '<span style="color:'+BLUE+'">'+s+'</span>';

  // First-run seed — mirrors the firm's current weekly status report.
  function seedRows(){
    return [
      {project:'Local Lime GT', projectContact:'Caroline', procContact:'Sabrina and Mary Beth',
       paDate:'October 2, 2025', firstPOs:'Completed', lastPOs:'Completed',
       install:'Direct To Site – March to May 2026<br>'+r('Complete'), closeout:b('Will Close Out With LL WLR')},
      {project:'Local Lime WLR', projectContact:'Caroline', procContact:'Sabrina and Mary Beth',
       paDate:'PA1: June 27, 2025<br>PA2: October 2, 2025', firstPOs:'Completed', lastPOs:'Completed',
       install:'Drapery: Complete<br>FF&E: '+r('July 8th')+', 2026', closeout:'July 31, 2026'},
      {project:'The Well Raleigh', projectContact:'Brittany', procContact:'Mary Beth',
       paDate:'November 26, 2025, Received Balance of Funds', firstPOs:'Completed',
       lastPOs:'June 30, 2026<br>'+b('Drapery Rm + Area Rug strike-offs'),
       install:'September 14, 2026', closeout:'November 30, 2026'},
      {project:'Local Lime Leawood', projectContact:'Ann-Marie', procContact:'Mary Beth',
       paDate:'PA1: January 30, 2026<br>PA2 Reissued: March 3, 2026', firstPOs:'Completed',
       lastPOs:'Short lead time items remaining', install:'September 10, 2026', closeout:'October 2026'},
      {project:'Local Lime St Louis', projectContact:'Caroline', procContact:'Sabrina and Mary Beth',
       paDate:'February 24, 2026, ai3 re-issued PA May 18, '+r('Do not have funds'), firstPOs:'TBD',
       lastPOs:'TBD<br>'+b('SS is ready; In good shape ☺'), install:'Winter 2026?', closeout:'Winter 2026?'},
      {project:'Saint Alban’s', projectContact:'Caroline and Carolina', procContact:'Mary Beth and Sabrina',
       paDate:'Barstool Samples: February 16, 2026<br>PA: April 13, 2026, '+r('Received Half of Funds')+'<br>PA2: May 5, Received Funds',
       firstPOs:b('June 24 for Second Round'), lastPOs:r('July 24, 2026 for Last Round'),
       install:'Barstool Samples: '+b('Arrived')+'<br>FF&E Install: November 2026', closeout:'December 2026'},
      {project:'Minnie Olivia — Fogon and Lions', projectContact:'Brittany', procContact:'TBD',
       paDate:'In Process/Pending', firstPOs:'TBD', lastPOs:'TBD', install:'October 2026', closeout:'November 2026'},
      {project:'One Alliance', projectContact:'Carolina', procContact:'Sabrina and Mary Beth',
       paDate:'February 9, 2026', firstPOs:'Completed', lastPOs:b('Short lead time items remaining'),
       install:'November 23-27, 2026', closeout:'December 2026'},
      {project:'The Perlant On Call', projectContact:'Lucy and Emily', procContact:'Lucy and Emily',
       paDate:'PA 6: PDR Scope<br>PA 7: Patio Scope<br>PA 8: Library', firstPOs:'In-Process', lastPOs:'TBD',
       install:'PA 6: Completed<br>PA 7: Late June<br>PA 8: Mid August', closeout:'October 2026'},
    ].map(function(row){ row.id = 's'+Math.random().toString(36).slice(2,9); return row; });
  }

  function loadRows(){
    try{ const raw = localStorage.getItem(LS_ROWS); if(raw){ const a=JSON.parse(raw); if(Array.isArray(a)) return a; } }catch(e){}
    const s = seedRows(); saveRows(s); return s;
  }
  function saveRows(rows){ try{ localStorage.setItem(LS_ROWS, JSON.stringify(rows)); }catch(e){} }
  function loadMeta(){ try{ return JSON.parse(localStorage.getItem(LS_META)||'{}')||{}; }catch(e){ return {}; } }
  function saveMeta(m){ try{ localStorage.setItem(LS_META, JSON.stringify(m)); }catch(e){} }

  let STATUS_ROWS = null;

  // Derive a row's auto-fields from live STEVE data for one project.
  function deriveProject(p){
    const fmt = iso => { if(!iso) return ''; const d=new Date(iso); return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); };
    const myPAs=(typeof pas!=='undefined'?pas:[]).filter(a=>a.project===p.name && a.issueDate).map(a=>a.issueDate).sort();
    const myPOs=(typeof vendorPOs!=='undefined'?vendorPOs:[]).filter(v=>v.project===p.name && v.issueDate).map(v=>v.issueDate).sort();
    return {
      projectContact: p.contact||'',
      paDate: myPAs.length?fmt(myPAs[0]):'In Process/Pending',
      firstPOs: myPOs.length?fmt(myPOs[0]):'TBD',
      lastPOs: myPOs.length>1?fmt(myPOs[myPOs.length-1]):(myPOs.length?'Completed':'TBD'),
      install: p.installDate?fmt(p.installDate):'TBD',
      closeout: p.closeoutDate?fmt(p.closeoutDate):'TBD',
    };
  }

  const AUTO_KEYS = ['projectContact','paDate','firstPOs','lastPOs','install','closeout'];

  // Keep the report live: add any live project not yet listed, and refresh the
  // auto-derived cells that the user hasn't manually edited. Manual edits + the
  // original seed content (non-empty, no _auto flag) are never overwritten.
  function statusAutoSync(){
    if(!STATUS_ROWS) STATUS_ROWS = loadRows();
    const projs = (typeof projects!=='undefined' && Array.isArray(projects)) ? projects : [];
    let added = 0;
    const byId={}, byName={};
    STATUS_ROWS.forEach(row=>{ if(row.projId) byId[row.projId]=row; const n=(row.project||'').trim().toLowerCase(); if(n && !byName[n]) byName[n]=row; });
    projs.forEach(p=>{
      const d = deriveProject(p);
      let row = byId[p.id] || byName[(p.name||'').trim().toLowerCase()];
      if(!row){
        row = { id:'s'+Math.random().toString(36).slice(2,9), project:p.name||'', projId:p.id, procContact:'', _auto:{} };
        AUTO_KEYS.forEach(k=>{ row[k]=d[k]; row._auto[k]=true; });
        STATUS_ROWS.push(row); added++;
      } else {
        if(!row.projId) row.projId = p.id;
        if(!row._auto) row._auto = {};
        AUTO_KEYS.forEach(k=>{
          const empty = row[k]==null || String(row[k]).trim()==='';
          if((empty || row._auto[k]) && d[k]!=null && d[k]!==''){ row[k]=d[k]; row._auto[k]=true; }
        });
      }
    });
    saveRows(STATUS_ROWS);
    return added;
  }

  function mondayOf(d){
    const x = new Date(d); const day = (x.getDay()+6)%7; x.setDate(x.getDate()-day); return x;
  }
  function fmtWeek(){
    const m = mondayOf(new Date());
    return m.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  }

  function ensureCss(){
    if(document.getElementById('status-css')) return;
    const st = document.createElement('style'); st.id='status-css';
    st.textContent = `
      #page-status .st-wrap{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden; }
      #page-status .st-bar{ display:flex; align-items:center; gap:14px; padding:14px 18px; border-bottom:1px solid var(--border); flex-wrap:wrap; }
      #page-status .st-bar h2{ font-size:17px; font-weight:700; margin:0; }
      #page-status .st-week{ font-size:13px; color:var(--text2); }
      #page-status .st-week b{ color:var(--text); }
      #page-status .st-legend{ margin-left:auto; display:flex; gap:16px; font-size:12px; color:var(--text2); }
      #page-status .st-legend .dot{ display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:middle; }
      #page-status table{ width:100%; border-collapse:collapse; font-size:12.5px; table-layout:fixed; }
      #page-status thead th{ background:var(--accent2); color:#fff; text-align:left; font-weight:600; font-size:12px; padding:11px 12px; vertical-align:top; border-right:1px solid rgba(255,255,255,.18); line-height:1.3; }
      #page-status thead th:last-child{ border-right:none; }
      #page-status tbody td{ border:1px solid var(--border); padding:0; vertical-align:top; }
      #page-status tbody tr:nth-child(even) td{ background:#F7F9FA; }
      #page-status .st-cell{ padding:9px 12px; min-height:38px; line-height:1.45; outline:none; }
      #page-status .st-cell:hover{ background:#FFF8E6; }
      #page-status .st-cell:focus{ background:#FFF8E6; box-shadow:inset 0 0 0 2px #E3B343; }
      #page-status td.st-proj .st-cell{ font-weight:600; }
      #page-status .st-rowctl{ width:26px; text-align:center; }
      #page-status .st-del{ opacity:0; border:none; background:none; color:var(--text3); cursor:pointer; font-size:14px; padding:6px 4px; transition:opacity .12s; }
      #page-status tbody tr:hover .st-del{ opacity:1; }
      #page-status .st-del:hover{ color:var(--red); }
      #page-status .st-foot{ padding:11px 16px; border-top:1px solid var(--border); font-size:12px; color:var(--text3); }
    `;
    document.head.appendChild(st);
  }

  // Build printable table markup (optionally with row-control column for screen).
  function tableHTML(screen){
    const head = '<tr>' + (screen?'<th class="st-rowctl"></th>':'') +
      STATUS_COLS.map(c=>'<th'+(c.k==='project'?' style="width:14%"':'')+'>'+c.label+'</th>').join('') + '</tr>';
    const body = STATUS_ROWS.map(function(row){
      const ctl = screen ? '<td class="st-rowctl"><button class="st-del" title="Remove row" onclick="statusDeleteRow(\''+row.id+'\')">✕</button></td>' : '';
      const cells = STATUS_COLS.map(function(c){
        const val = row[c.k]||'';
        if(screen){
          return '<td class="'+(c.k==='project'?'st-proj':'')+'"><div class="st-cell" contenteditable="true" data-row="'+row.id+'" data-k="'+c.k+'" onblur="statusSave(this)">'+val+'</div></td>';
        }
        return '<td style="border:1px solid #d5dbde;padding:8px 10px;vertical-align:top;line-height:1.4'+(c.k==='project'?';font-weight:600':'')+'">'+val+'</td>';
      }).join('');
      return '<tr>'+ctl+cells+'</tr>';
    }).join('');
    return '<thead>'+head+'</thead><tbody>'+body+'</tbody>';
  }

  window.renderStatus = function(){
    ensureCss();
    STATUS_ROWS = loadRows();
    statusAutoSync();          // pull in live projects + refresh un-edited cells
    const meta = loadMeta();
    const week = meta.weekOf || fmtWeek();
    const host = document.getElementById('status-body');
    if(!host) return;
    host.innerHTML =
      '<div class="st-wrap">'+
        '<div class="st-bar">'+
          '<h2>Weekly Procurement Status</h2>'+
          '<div class="st-week">Week of <b class="st-cell" contenteditable="true" style="display:inline;padding:1px 4px" onblur="statusSaveWeek(this)">'+week+'</b></div>'+
          '<div class="st-legend">'+
            '<span><span class="dot" style="background:'+RED+'"></span>Needs attention</span>'+
            '<span><span class="dot" style="background:'+BLUE+'"></span>Note / update</span>'+
          '</div>'+
        '</div>'+
        '<div style="overflow-x:auto"><table>'+tableHTML(true)+'</table></div>'+
        '<div class="st-foot">'+STATUS_ROWS.length+' project'+(STATUS_ROWS.length!==1?'s':'')+' · Live projects sync automatically; edited cells stay locked to your text. Select text, then use Red / Blue above to flag it.</div>'+
      '</div>'+
      // hidden print source
      '<div id="status-print" style="display:none">'+
        '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;color:#1a1a1a">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:14px">'+
            '<div style="font-size:18px;font-weight:700">Weekly Procurement Status</div>'+
            '<div style="font-size:12px;color:#555">Week of '+week+'</div>'+
          '</div>'+
          '<table style="width:100%;border-collapse:collapse;font-size:10.5px">'+
            '<thead><tr>'+STATUS_COLS.map(c=>'<th style="background:#3F606D;color:#fff;text-align:left;font-weight:600;padding:7px 10px;border:1px solid #33505c;vertical-align:top">'+c.label+'</th>').join('')+'</tr></thead>'+
            '<tbody>'+STATUS_ROWS.map(function(row){ return '<tr>'+STATUS_COLS.map(function(c){ return '<td style="border:1px solid #d5dbde;padding:6px 9px;vertical-align:top;line-height:1.4'+(c.k==='project'?';font-weight:600':'')+'">'+(row[c.k]||'')+'</td>'; }).join('')+'</tr>'; }).join('')+'</tbody>'+
          '</table>'+
        '</div>'+
      '</div>';
  };

  window.statusSave = function(el){
    if(!STATUS_ROWS) return;
    const row = STATUS_ROWS.find(x=>x.id===el.dataset.row);
    if(!row) return;
    row[el.dataset.k] = el.innerHTML;
    if(row._auto) row._auto[el.dataset.k] = false;   // manual edit wins from now on
    saveRows(STATUS_ROWS);
  };
  window.statusSaveWeek = function(el){ const m=loadMeta(); m.weekOf = el.textContent.trim(); saveMeta(m); };

  // Apply a text colour to the current selection inside a status cell.
  window.statusColor = function(color){
    try{ document.execCommand('styleWithCSS', false, true); }catch(e){}
    document.execCommand('foreColor', false, color);
    const cell = document.activeElement;
    if(cell && cell.classList && cell.classList.contains('st-cell') && cell.dataset.row) statusSave(cell);
  };

  window.statusAddRow = function(){
    if(!STATUS_ROWS) STATUS_ROWS = loadRows();
    STATUS_ROWS.push({ id:'s'+Math.random().toString(36).slice(2,9), project:'', projectContact:'', procContact:'', paDate:'', firstPOs:'', lastPOs:'', install:'', closeout:'' });
    saveRows(STATUS_ROWS); renderStatus();
  };
  window.statusDeleteRow = function(id){
    if(!confirm('Remove this project from the status report?')) return;
    STATUS_ROWS = STATUS_ROWS.filter(x=>x.id!==id);
    saveRows(STATUS_ROWS); renderStatus();
  };

  // Add any live STEVE projects not already listed, auto-filling PA / PO dates.
  window.statusSyncProjects = function(){
    const added = statusAutoSync();
    renderStatus();
    if(typeof ai3Toast==='function') ai3Toast(added?('Added '+added+' project'+(added!==1?'s':'')):'Synced with live projects');
    else alert(added?('Added '+added+' project'+(added!==1?'s':'')+' to the status report.'):'Synced — all live projects are on the report.');
  };

  window.statusPrint = function(){
    if(!document.getElementById('status-print')) renderStatus();
    if(typeof printPreview==='function')
      printPreview('status-print','Weekly Procurement Status','@page{size:landscape;margin:0.4in}table{width:100%}', 'Weekly Status');
    else window.print();
  };
})();
