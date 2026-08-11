/* ============================================================================
   STEVE — Activity log / audit trail  (activity.js)
   Records labelled mutations by wrapping the host's pushUndo(label) plus direct
   logActivity() calls from feature modules. Stores to DB key 'fp11_activity'.
   ============================================================================ */
(function () {
  'use strict';
  function load() { try { return DB.load('fp11_activity', []); } catch (e) { return []; } }
  function save(a) { try { DB.save('fp11_activity', a); } catch (e) {} }

  function log(label, detail) {
    if (!label) return;
    var a = load();
    var now = Date.now();
    var proj = (typeof activeProject !== 'undefined' && activeProject) ? activeProject.name : '';
    // collapse identical consecutive labels within 4s (avoids per-keystroke noise)
    if (a.length && a[0].label === String(label) && a[0].project === proj && (now - a[0].ts) < 4000) {
      a[0].ts = now; save(a); return;
    }
    a.unshift({ ts: now, label: String(label), detail: detail || '', project: proj });
    if (a.length > 400) a.length = 400;
    save(a);
    try { if (typeof window.renderHome === 'function') { var h = document.getElementById('page-home'); if (h && h.classList.contains('active')) window.renderHome(); } } catch (e) {}
  }

  window.logActivity = log;
  window.getActivity = load;
  window.clearActivity = function () { save([]); };

  function wrap() {
    if (typeof window.pushUndo === 'function' && !window.pushUndo._actWrapped) {
      var orig = window.pushUndo;
      var w = function (label) { try { if (label) log(label); } catch (e) {} return orig.apply(this, arguments); };
      w._actWrapped = true;
      try { window.pushUndo = w; } catch (e) {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap); else wrap();
  setTimeout(wrap, 1200);
})();
