/* qr-scan.js - voucher QR scanning: live camera (HTTPS only) or photo capture (works on plain HTTP).
 * Decoder: native BarcodeDetector when present, otherwise js/qr-decode.js (loaded on demand).
 * Browsers only expose getUserMedia in secure contexts, so on a plain-HTTP hotspot page the live camera is
 * unavailable; the "Ambil foto" path opens the phone camera app via <input capture> and decodes the picture.
 */
(function (root) {
  'use strict';

  /* Turn scanned text into {username, password}. Accepts a login URL (…/login?username=..&password=..),
   * a "username=..&password=.." string, or a bare code. Returns null when it does not look like a voucher. */
  function parseVoucher(text) {
    text = String(text == null ? '' : text).trim();
    if (!text) return null;
    var u = null, p = null, params = null;
    try {
      var q = text.indexOf('?') >= 0 ? text.slice(text.indexOf('?') + 1) : (/(^|&)(username|user|code)=/i.test(text) ? text : '');
      if (q) params = new URLSearchParams(q.split('#')[0]);
    } catch (e) { params = null; }
    if (params) {
      u = params.get('username') || params.get('user') || params.get('code');
      p = params.get('password') || params.get('pass');
    }
    if (!u) {
      if (/^[A-Za-z0-9._@\-]{3,64}$/.test(text)) u = text;
      else return null;
    }
    return { username: u, password: p || u };
  }

  var decoderPromise = null;
  function loadDecoder() {
    if (root.QRDecode) return Promise.resolve(root.QRDecode);
    if (decoderPromise) return decoderPromise;
    decoderPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'js/qr-decode.js';
      s.onload = function () { res(root.QRDecode); };
      s.onerror = function () { rej(new Error('decoder')); };
      document.head.appendChild(s);
    });
    return decoderPromise;
  }

  var detector = null;
  function getDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ('BarcodeDetector' in root) detector = new root.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { detector = false; }
    return detector;
  }

  /* Decode a canvas. Resolves with text or null. */
  function decodeCanvas(canvas) {
    var det = getDetector();
    var viaNative = det ? det.detect(canvas).then(function (r) { return r && r.length ? r[0].rawValue : null; }, function () { return null; })
      : Promise.resolve(null);
    return viaNative.then(function (t) {
      if (t) return t;
      return loadDecoder().then(function (D) { return D.decodeCanvas(canvas); }, function () { return null; });
    });
  }

  function open(opts) {
    opts = opts || {};
    var dlg = document.getElementById('scan-dialog');
    var video = dlg.querySelector('video'), canvas = dlg.querySelector('canvas.work');
    var statusEl = dlg.querySelector('.scan-status'), empty = dlg.querySelector('.empty');
    var file = dlg.querySelector('input[type=file]'), stream = null, raf = 0, stopped = false, busy = false, last = 0;
    var T = opts.t || function (k) { return k; };

    function say(msg, isErr) { statusEl.textContent = msg || ''; statusEl.className = 'scan-status' + (isErr ? ' err' : ''); }
    function finish(text) {
      var v = parseVoucher(text);
      if (!v) { say(T('scan_notvoucher'), true); return false; }
      close(); if (opts.onResult) opts.onResult(v, text); return true;
    }
    function stopCam() {
      stopped = true; cancelAnimationFrame(raf);
      if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
      video.srcObject = null;
    }
    function close() {
      stopCam();
      file.onchange = null; dlg.querySelector('[data-close]').onclick = null; dlg.onclose = null;
      if (dlg.close) { if (dlg.open) dlg.close(); } else dlg.removeAttribute('open');
      if (opts.onClose) opts.onClose();
    }

    function tick(now) {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (busy || now - last < 130 || video.readyState < 2 || !video.videoWidth) return;
      last = now; busy = true;
      var sc = Math.min(1, 720 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * sc); canvas.height = Math.round(video.videoHeight * sc);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
      decodeCanvas(canvas).then(function (t) { busy = false; if (t && !stopped) finish(t); }, function () { busy = false; });
    }

    function startCam() {
      if (!root.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        empty.hidden = false; empty.textContent = T('scan_nocam');
        return;
      }
      empty.hidden = false; empty.textContent = T('scan_starting');
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
        if (stopped) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        stream = s; video.srcObject = s; video.setAttribute('playsinline', ''); video.muted = true;
        empty.hidden = true; say(T('scan_point'));
        return video.play().then(function () { raf = requestAnimationFrame(tick); });
      }).catch(function (e) {
        empty.hidden = false;
        empty.textContent = (e && e.name === 'NotAllowedError') ? T('scan_denied') : T('scan_nocam');
      });
    }

    function fromFile(f) {
      if (!f) return;
      say(T('scan_reading'));
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var sizes = [1280, 900, 640, 480], i = 0, ctxOpts = { willReadFrequently: true };
        (function attempt() {
          if (i >= sizes.length) { say(T('scan_fail'), true); return; }
          var sc = Math.min(1, sizes[i++] / Math.max(img.naturalWidth, img.naturalHeight));
          canvas.width = Math.max(1, Math.round(img.naturalWidth * sc)); canvas.height = Math.max(1, Math.round(img.naturalHeight * sc));
          canvas.getContext('2d', ctxOpts).drawImage(img, 0, 0, canvas.width, canvas.height);
          decodeCanvas(canvas).then(function (t) { if (t) { if (!finish(t)) return; } else attempt(); });
        })();
      };
      img.onerror = function () { URL.revokeObjectURL(url); say(T('scan_fail'), true); };
      img.src = url;
    }

    say(''); stopped = false;
    file.value = ''; file.onchange = function () { fromFile(file.files && file.files[0]); };
    dlg.querySelector('[data-close]').onclick = close;
    dlg.onclose = function () { stopCam(); };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    startCam();
    return { close: close };
  }

  var API = { open: open, parseVoucher: parseVoucher, decodeCanvas: decodeCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.HSScan = API;
})(typeof window !== 'undefined' ? window : this);
