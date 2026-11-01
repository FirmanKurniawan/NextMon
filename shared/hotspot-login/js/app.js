/* app.js - shared behaviour for all hotspot pages. Strict-mode safe: RouterOS values (which may contain octal
 * escapes such as chap-id) live ONLY in the small inline <script> of each page (window.HS), never in this file. */
(function (root) {
  'use strict';
  var doc = document, CFG = root.HS_CONFIG || {}, LANG = CFG.lang === 'en' ? 'en' : 'id';

  /* ---------- i18n (dynamic strings only; static page copy is Indonesian, edit the HTML to translate) ---------- */
  var STR = {
    id: {
      code_label: 'Kode voucher', user_label: 'Username', pass_label: 'Kata sandi',
      need_code: 'Masukkan kode voucher Anda.', need_user: 'Masukkan username.', need_pass: 'Masukkan kata sandi.',
      connecting: 'Menghubungkan...', show: 'Tampilkan kata sandi', hide: 'Sembunyikan kata sandi',
      offline: 'Perangkat tidak terhubung ke jaringan hotspot.',
      scan_nocam: 'Kamera langsung membutuhkan koneksi aman (HTTPS) atau izin kamera. Gunakan tombol "Ambil foto" di bawah.',
      scan_starting: 'Membuka kamera...', scan_point: 'Arahkan kamera ke QR pada voucher.', scan_denied: 'Izin kamera ditolak. Gunakan "Ambil foto" atau izinkan kamera di pengaturan browser.',
      scan_reading: 'Membaca gambar...', scan_fail: 'QR tidak terbaca. Coba lagi dengan foto yang lebih dekat dan terang.',
      scan_notvoucher: 'QR terbaca, tetapi bukan voucher yang dikenali.',
      dark: 'Beralih ke mode gelap', light: 'Beralih ke mode terang',
      wa_buy: 'Hubungi admin via WhatsApp',
      unit_d: 'hari', quota_left: 'Sisa kuota', time_left: 'Sisa waktu',
      err_generic: 'Gagal masuk. Periksa kode voucher lalu coba lagi.',
      err_invalid_single: 'Kode voucher tidak valid atau sudah tidak berlaku.',
      err_invalid: 'Username atau kata sandi salah.',
      err_inuse: 'Voucher ini sedang dipakai di perangkat lain.',
      err_time: 'Masa pakai voucher sudah habis.',
      err_quota: 'Kuota voucher sudah habis.',
      err_expired: 'Voucher sudah kedaluwarsa.',
      err_mac: 'Voucher ini terikat ke perangkat lain.',
      err_radius: 'Server autentikasi belum merespons. Coba lagi sebentar lagi.',
      err_notyet: 'Anda belum login. Silakan masuk dulu.',
      err_nohotspot: 'Layanan hotspot belum tersedia. Hubungi admin.'
    },
    en: {
      code_label: 'Voucher code', user_label: 'Username', pass_label: 'Password',
      need_code: 'Enter your voucher code.', need_user: 'Enter your username.', need_pass: 'Enter your password.',
      connecting: 'Connecting...', show: 'Show password', hide: 'Hide password',
      offline: 'This device is not connected to the hotspot network.',
      scan_nocam: 'Live camera needs a secure (HTTPS) page or camera permission. Use "Take photo" below.',
      scan_starting: 'Opening camera...', scan_point: 'Point the camera at the QR on your voucher.', scan_denied: 'Camera permission denied. Use "Take photo" or allow the camera in browser settings.',
      scan_reading: 'Reading image...', scan_fail: 'Could not read a QR. Try again with a closer, brighter photo.',
      scan_notvoucher: 'A QR was read, but it is not a recognised voucher.',
      dark: 'Switch to dark mode', light: 'Switch to light mode',
      wa_buy: 'Contact admin on WhatsApp',
      unit_d: 'day', quota_left: 'Quota left', time_left: 'Time left',
      err_generic: 'Login failed. Check your voucher code and try again.',
      err_invalid_single: 'This voucher code is invalid or no longer valid.',
      err_invalid: 'Wrong username or password.',
      err_inuse: 'This voucher is already in use on another device.',
      err_time: 'This voucher has run out of time.',
      err_quota: 'This voucher has run out of quota.',
      err_expired: 'This voucher has expired.',
      err_mac: 'This voucher is bound to another device.',
      err_radius: 'The authentication server is not responding. Please retry shortly.',
      err_notyet: 'You are not logged in. Please sign in first.',
      err_nohotspot: 'Hotspot service is unavailable. Contact the admin.'
    }
  };
  function t(k) { return (STR[LANG] && STR[LANG][k]) || STR.id[k] || k; }

  /* Map RouterOS English error text to friendly copy. Unknown text is returned as-is. */
  function friendlyError(raw, singleMode) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var rules = [
      [/invalid username or password/i, singleMode ? 'err_invalid_single' : 'err_invalid'],
      [/already logged in|simultaneous session|no more sessions are allowed/i, 'err_inuse'],
      [/session time limit|uptime limit|time limit reached/i, 'err_time'],
      [/data limit|traffic limit|quota|bytes limit/i, 'err_quota'],
      [/expired/i, 'err_expired'],
      [/not allowed to log in from this mac|mac address|bound to/i, 'err_mac'],
      [/radius server is not responding|radius/i, 'err_radius'],
      [/not logged in/i, 'err_notyet'],
      [/hotspot service is not enabled|service is not enabled/i, 'err_nohotspot']
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(s)) return t(rules[i][1]);
    return s;
  }

  var $ = function (sel, scope) { return (scope || doc).querySelector(sel); };
  function text(el, v) { if (el) el.textContent = v; }

  /* ---------- theme ---------- */
  function effectiveTheme() {
    var a = doc.documentElement.getAttribute('data-theme');
    if (a === 'dark' || a === 'light') return a;
    return root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setupTheme() {
    var btn = $('#theme-btn');
    if (!btn) return;
    function paint() {
      var dark = effectiveTheme() === 'dark';
      btn.innerHTML = root.HSIcons.svg(dark ? 'sun' : 'moon');
      var label = dark ? t('light') : t('dark');
      btn.setAttribute('aria-label', label); btn.title = label;
    }
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      doc.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hs_theme', next); } catch (e) { /* storage may be blocked in captive-portal browsers */ }
      paint();
    });
    paint();
  }

  /* ---------- brand ---------- */
  function applyBrand() {
    var b = CFG.brand || 'WiFi', nodes = doc.querySelectorAll('[data-brand]'), i;
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = b;
    nodes = doc.querySelectorAll('[data-tagline]');
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = CFG.tagline || '';
    nodes = doc.querySelectorAll('img[data-logo]');
    for (i = 0; i < nodes.length; i++) { if (CFG.logo) nodes[i].src = CFG.logo; nodes[i].alt = b; }
    doc.title = doc.title.replace('{brand}', b);
  }

  function init() {
    root.HSIcons.render();
    applyBrand();
    setupTheme();
  }

  /* ---------- utf-8 byte string (so non-ASCII passwords hash as the router expects) ---------- */
  function toByteString(s) { return unescape(encodeURIComponent(s)); }

  /* ---------- login page ---------- */
  function initLogin(HS) {
    init();
    var form = $('#login'), mode = CFG.voucherMode === 'userpass' ? 'userpass' : 'single';
    try { var saved = localStorage.getItem('hs_mode'); if (saved === 'single' || saved === 'userpass') mode = saved; } catch (e) { /* ignore */ }
    var codeI = $('#code'), userI = $('#user'), passI = $('#pass'), btn = $('#go'), errBox = $('#error');
    var segBtns = doc.querySelectorAll('.seg button');

    function setMode(m, focus) {
      mode = m;
      $('#grp-single').hidden = m !== 'single';
      $('#grp-userpass').hidden = m !== 'userpass';
      for (var i = 0; i < segBtns.length; i++) segBtns[i].setAttribute('aria-pressed', String(segBtns[i].getAttribute('data-mode') === m));
      try { localStorage.setItem('hs_mode', m); } catch (e) { /* ignore */ }
      clearInvalid();
      if (focus) (m === 'single' ? codeI : userI).focus();
    }
    function clearInvalid() {
      var els = doc.querySelectorAll('.input.invalid');
      for (var i = 0; i < els.length; i++) els[i].classList.remove('invalid');
    }
    function showError(msg, detail) {
      if (!msg) { errBox.hidden = true; return; }
      errBox.hidden = false;
      text($('#error-text'), msg);
      var d = $('#error-detail'); d.textContent = detail && detail !== msg ? detail : ''; d.hidden = !d.textContent;
    }
    function mark(input) { input.closest('.input').classList.add('invalid'); input.focus(); }

    if (CFG.allowModeSwitch === false) $('#seg').hidden = true;
    for (var i = 0; i < segBtns.length; i++) segBtns[i].addEventListener('click', function (e) { setMode(e.currentTarget.getAttribute('data-mode'), true); });

    var eye = $('#toggle-pass');
    if (eye) {
      eye.innerHTML = root.HSIcons.svg('eye'); eye.setAttribute('aria-label', t('show'));
      eye.addEventListener('click', function () {
        var show = passI.type === 'password';
        passI.type = show ? 'text' : 'password';
        eye.innerHTML = root.HSIcons.svg(show ? 'eyeoff' : 'eye'); eye.setAttribute('aria-label', show ? t('hide') : t('show'));
      });
    }
    form.addEventListener('input', function () { clearInvalid(); if (!errBox.hidden && !HS.error) showError(''); });

    function send(user, pass) {
      var f = doc.forms.login;
      f.elements.username.value = user;
      f.elements.password.value = HS.chapId ? root.hexMD5(HS.chapId + toByteString(pass) + HS.chapChallenge) : pass;
      btn.classList.add('loading'); btn.disabled = true; text($('#submit-label'), t('connecting'));
      f.submit();
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var user, pass;
      if (mode === 'single') {
        user = codeI.value.replace(/\s+/g, '');
        if (!user) { showError(t('need_code')); return mark(codeI); }
        pass = user;
      } else {
        user = userI.value.trim(); pass = passI.value;
        if (!user) { showError(t('need_user')); return mark(userI); }
        if (!pass) { showError(t('need_pass')); return mark(passI); }
      }
      showError('');
      send(user, pass);
    });

    /* server-side error from RouterOS */
    var raw = (HS.error || '').trim();
    if (raw) { showError(friendlyError(raw, mode === 'single'), raw); }

    /* prefill from RouterOS-remembered username (only meaningful for userpass) */
    if (HS.username && !codeI.value) { codeI.value = HS.username; userI.value = HS.username; }

    /* QR / link login: ?username=..&password=.. (voucher QR) */
    var q = new URLSearchParams(root.location.search), qu = q.get('username') || q.get('code'), qp = q.get('password');
    var auto = false;
    if (qu) {
      codeI.value = qu; userI.value = qu; if (qp) passI.value = qp;
      setMode(qp && qp !== qu ? 'userpass' : 'single');
      auto = !raw && !sessionStorageGet('hs_auto');
    } else setMode(mode);
    if (auto) { sessionStoragePut('hs_auto', '1'); send(qu, qp || qu); }

    /* scanner */
    var scanBtn = $('#scan-btn');
    if (CFG.scan === false) { scanBtn.hidden = true; }
    else scanBtn.addEventListener('click', function () {
      root.HSScan.open({
        t: t,
        onResult: function (v) {
          codeI.value = v.username; userI.value = v.username; passI.value = v.password;
          setMode(v.password && v.password !== v.username ? 'userpass' : 'single');
          showError('');
          send(v.username, v.password);
        }
      });
    });

    /* connection chip + support link */
    var chip = $('#net-chip');
    function net() {
      var on = root.navigator.onLine !== false;
      chip.className = 'chip ' + (on ? 'off' : '');
      text(chip, on ? chip.getAttribute('data-locked') : t('offline'));
    }
    root.addEventListener('online', net); root.addEventListener('offline', net); net();

    var wa = $('#support-wa');
    if (CFG.support && CFG.support.whatsapp) {
      wa.href = 'https://wa.me/' + String(CFG.support.whatsapp).replace(/\D/g, '');
      text($('#support-text'), CFG.support.buyText || t('wa_buy'));
    } else $('#support').hidden = true;
    if (CFG.support && CFG.support.hours) text($('#support-hours'), CFG.support.hours); else $('#support-hours').hidden = true;
  }
  function sessionStorageGet(k) { try { return root.sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStoragePut(k, v) { try { root.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  /* ---------- status page ---------- */
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d ? d + ' ' + t('unit_d') + (LANG === 'en' && d > 1 ? 's' : '') + ' ' : '') + p(h) + ':' + p(m) + ':' + p(s);
  }
  function initStatus(HS) {
    init();
    var up = parseInt(HS.uptimeSecs, 10), el = $('#uptime');
    if (isFinite(up) && el) {
      var t0 = Date.now();
      (function tick() { text(el, fmtDur(up + (Date.now() - t0) / 1000)); })();
      root.setInterval(function () { text(el, fmtDur(up + (Date.now() - t0) / 1000)); }, 1000);
    }
    var ask = $('#logout-ask'), box = $('#logout-confirm');
    ask.addEventListener('click', function () { box.hidden = false; ask.hidden = true; $('#logout-yes').focus(); });
    $('#logout-no').addEventListener('click', function () { box.hidden = true; ask.hidden = false; ask.focus(); });
    if (HS.advertPending && HS.advertUrl) {
      try { root.open(HS.advertUrl, 'hotspot_advert', 'toolbar=0,location=0,menubar=0,resizable=1,width=480,height=420'); } catch (e) { /* popup blocked */ }
    }
  }

  /* ---------- success / redirect page ---------- */
  function initSuccess(HS) {
    init();
    try { root.sessionStorage.removeItem('hs_auto'); } catch (e) { /* ignore */ }
    var left = Math.max(0, parseInt(CFG.redirectDelaySec, 10) || 0), el = $('#count'), target = HS.redirect;
    if (!target) return;
    function go() { root.location.replace(target); }
    if (!left) return go();
    text(el, String(left));
    var iv = root.setInterval(function () { left--; text(el, String(Math.max(left, 0))); if (left <= 0) { root.clearInterval(iv); go(); } }, 1000);
  }

  function initAdvert(HS) {
    init();
    var a = CFG.advert || {}, left = parseInt(a.seconds, 10) || 5;
    text($('#ad-title'), a.title || ''); text($('#ad-text'), a.text || '');
    if (a.image) { var im = $('#ad-img'); im.src = a.image; im.hidden = false; }
    var el = $('#count'); text(el, String(left));
    var iv = root.setInterval(function () { left--; text(el, String(Math.max(left, 0))); if (left <= 0) { root.clearInterval(iv); if (HS.redirect) root.location.replace(HS.redirect); } }, 1000);
  }

  root.HSApp = { init: init, initLogin: initLogin, initStatus: initStatus, initSuccess: initSuccess, initAdvert: initAdvert,
    t: t, friendlyError: friendlyError, fmtDur: fmtDur, toByteString: toByteString };
})(window);
