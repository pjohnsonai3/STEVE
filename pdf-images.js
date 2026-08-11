/* ============================================================================
   STEVE — PDF → images  (pdf-images.js)
   Lazily loads pdf.js (only when first needed, from CDN) and renders the pages
   of a base64-encoded PDF to downscaled JPEG data URLs. Used by the Purchase
   Order AI Fill to capture the product images on a scanned cut sheet and place
   them on the PO. Exposes window.renderPdfPages(base64, opts) -> Promise<[{src,label,w,h}]>.
   ============================================================================ */
(function () {
  'use strict';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var _loading = null;

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_loading) return _loading;
    _loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = function () {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL; } catch (e) {}
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('Could not load the PDF engine — an internet connection is required the first time.')); };
      document.head.appendChild(s);
    });
    return _loading;
  }

  function b64ToUint8(b64) {
    var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // Render up to opts.maxPages pages to JPEG data URLs (white-matted, downscaled).
  async function renderPdfPages(base64, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 6, scale = opts.scale || 1.8, maxW = opts.maxW || 1400, quality = opts.quality || 0.82;
    var pdfjs = await loadPdfJs();
    var pdf = await pdfjs.getDocument({ data: b64ToUint8(base64) }).promise;
    var n = Math.min(pdf.numPages, maxPages);
    var out = [];
    for (var p = 1; p <= n; p++) {
      try {
        var page = await pdf.getPage(p);
        var vp = page.getViewport({ scale: scale });
        var ratio = vp.width > maxW ? maxW / vp.width : 1;
        var rvp = ratio === 1 ? vp : page.getViewport({ scale: scale * ratio });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(rvp.width);
        canvas.height = Math.round(rvp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: rvp }).promise;
        out.push({ src: canvas.toDataURL('image/jpeg', quality), label: 'Page ' + p + ' of ' + pdf.numPages, w: canvas.width, h: canvas.height });
      } catch (e) { /* skip a bad page */ }
    }
    try { pdf.destroy(); } catch (e) {}
    return out;
  }

  // Extract each embedded raster image from the PDF, tagged with its page.
  // Returns [{ src, w, h, page }]. Best-effort; skips small/decorative images.
  async function extractPdfImages(base64, opts) {
    opts = opts || {};
    var minDim = opts.minDim || 80, maxW = opts.maxW || 1100, quality = opts.quality || 0.85;
    var pdfjs = await loadPdfJs();
    var OPS = pdfjs.OPS || {};
    var pdf = await pdfjs.getDocument({ data: b64ToUint8(base64) }).promise;
    var out = [];
    function getObj(page, name) {
      return new Promise(function (res) {
        var done = false, t = setTimeout(function () { if (!done) { done = true; res(null); } }, 5000);
        function cb(o) { if (!done) { done = true; clearTimeout(t); res(o); } }
        try {
          if (page.objs.has && page.objs.has(name)) return cb(page.objs.get(name));
          page.objs.get(name, cb);
        } catch (e) {
          try { page.commonObjs.get(name, cb); } catch (e2) { if (!done) { done = true; clearTimeout(t); res(null); } }
        }
      });
    }
    function toCanvas(o) {
      var w = o.width, h = o.height; if (!w || !h) return null;
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (o.bitmap) { ctx.drawImage(o.bitmap, 0, 0, w, h); return c; }
      if (typeof HTMLImageElement !== 'undefined' && o instanceof HTMLImageElement) { ctx.drawImage(o, 0, 0, w, h); return c; }
      var data = o.data; if (!data) return null;
      var rgba, i, k;
      if (data.length === w * h * 4) { rgba = new Uint8ClampedArray(data); }
      else if (data.length === w * h * 3) { rgba = new Uint8ClampedArray(w * h * 4); for (i = 0, k = 0; i < data.length; i += 3, k += 4) { rgba[k] = data[i]; rgba[k + 1] = data[i + 1]; rgba[k + 2] = data[i + 2]; rgba[k + 3] = 255; } }
      else if (data.length === w * h) { rgba = new Uint8ClampedArray(w * h * 4); for (i = 0, k = 0; i < data.length; i++, k += 4) { rgba[k] = rgba[k + 1] = rgba[k + 2] = data[i]; rgba[k + 3] = 255; } }
      else return null;
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0); return c;
    }
    for (var p = 1; p <= pdf.numPages; p++) {
      try {
        var page = await pdf.getPage(p);
        var ops = await page.getOperatorList();
        var seen = {};
        for (var i = 0; i < ops.fnArray.length; i++) {
          var fn = ops.fnArray[i];
          if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
            var name = ops.argsArray[i][0]; if (!name || seen[name]) continue; seen[name] = 1;
            var o = await getObj(page, name); if (!o) continue;
            if ((o.width || 0) < minDim || (o.height || 0) < minDim) continue;
            var cv = toCanvas(o); if (!cv) continue;
            var fin = cv;
            if (cv.width > maxW) {
              var s = maxW / cv.width, c2 = document.createElement('canvas');
              c2.width = Math.round(cv.width * s); c2.height = Math.round(cv.height * s);
              var x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(cv, 0, 0, c2.width, c2.height); fin = c2;
            }
            var src; try { src = fin.toDataURL('image/jpeg', quality); } catch (e) { continue; }
            out.push({ src: src, w: fin.width, h: fin.height, page: p });
          }
        }
      } catch (e) { /* skip a bad page */ }
    }
    try { pdf.destroy(); } catch (e) {}
    return out;
  }

  // Plain text of each page (index 0 = page 1). Used to map images to line items.
  async function extractPdfPageText(base64) {
    var pdfjs = await loadPdfJs();
    var pdf = await pdfjs.getDocument({ data: b64ToUint8(base64) }).promise;
    var pages = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      try { var page = await pdf.getPage(p); var tc = await page.getTextContent(); pages.push(tc.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim()); }
      catch (e) { pages.push(''); }
    }
    try { pdf.destroy(); } catch (e) {}
    return pages;
  }

  window.renderPdfPages = renderPdfPages;
  window.extractPdfImages = extractPdfImages;
  window.extractPdfPageText = extractPdfPageText;
})();
