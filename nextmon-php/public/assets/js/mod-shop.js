/* Shop module (public /shop pages + /shop/settings row helper). Vanilla, no dependencies. */
(function () {
  'use strict';
  var doc = document;
  function $(s, r) { return (r || doc).querySelector(s); }

  // theme toggle (same storage key as theme.js)
  doc.addEventListener('click', function (e) {
    var t = e.target.closest('[data-shp-theme]');
    if (t) {
      var d = doc.documentElement;
      var cur = d.getAttribute('data-theme');
      var dark = cur === 'dark' || (cur !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      d.setAttribute('data-theme', next);
      try { localStorage.setItem('nextmon-theme', next); } catch (x) { /* ignore */ }
      return;
    }
    var c = e.target.closest('[data-shp-copy]');
    if (c) {
      var txt = c.getAttribute('data-shp-copy');
      var lab = c.querySelector('[data-label]');
      var done = function () {
        if (!lab) return;
        lab.textContent = lab.getAttribute('data-done');
        setTimeout(function () { lab.textContent = lab.getAttribute('data-label'); }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
      } else { fallbackCopy(txt); done(); }
      return;
    }
    if (e.target.closest('[data-shp-addrow]')) {
      var tpl = $('#shp-prow-tpl'), body = $('#shp-ptable tbody');
      if (!tpl || !body) return;
      var n = body.querySelectorAll('tr').length + 100;
      var html = tpl.innerHTML.replace(/\[9999\]/g, '[' + n + ']');
      var tb = doc.createElement('tbody');
      tb.innerHTML = html;
      while (tb.firstChild) body.appendChild(tb.firstChild);
    }
  });

  function fallbackCopy(txt) {
    var ta = doc.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand('copy'); } catch (x) { /* ignore */ }
    doc.body.removeChild(ta);
  }

  // storefront: live total, double-submit guard
  var form = $('#shop-form');
  if (form) {
    var total = $('#shp-total');
    var upd = function () {
      var r = form.querySelector('input[name=package]:checked');
      if (total) total.textContent = r ? r.getAttribute('data-price') : '-';
    };
    form.addEventListener('change', upd);
    upd();
    form.addEventListener('submit', function () {
      var b = $('#shp-submit');
      if (b) { b.disabled = true; b.classList.add('loading'); }
    });
  }

  // order page: poll until the state changes, countdown, optional auto-redirect to the gateway
  var live = $('.shp-live[data-poll]');
  if (live) {
    var st = live.getAttribute('data-status');
    var ready = live.getAttribute('data-ready') === '1';
    var self = live.getAttribute('data-self');
    var go = live.getAttribute('data-go');
    if (go) { setTimeout(function () { window.location.href = go; }, 700); }
    var cd = $('[data-countdown]');
    var left = cd ? parseInt(cd.getAttribute('data-countdown'), 10) : 0;
    var fmt = function (s) { var m = Math.floor(s / 60), x = s % 60; return (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; };
    if (cd && left > 0) {
      cd.textContent = fmt(left);
      setInterval(function () { if (left > 0) { left--; cd.textContent = fmt(left); } }, 1000);
    }
    if (st === 'pending' || (st === 'paid' && !ready)) {
      var busy = false;
      var tick = function () {
        if (busy || doc.hidden) return;
        busy = true;
        fetch(live.getAttribute('data-poll'), { cache: 'no-store', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            busy = false;
            if (!j || !j.ok) return;
            if (j.status !== st || (j.ready && !ready)) { window.location.replace(self); }
          })
          .catch(function () { busy = false; });
      };
      setInterval(tick, 3000);
      doc.addEventListener('visibilitychange', tick);
    }
  }
})();
