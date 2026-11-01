/* NextMON (Next.js edition) - progressive form posting for the network/operations pages.
 *
 * <form data-api="/api/json/pppoe/secret/save"> is posted as FormData through NextMON.api() (CSRF header, session cookie), the
 * JSON answer { ok, message|error, reload } becomes a toast, and a successful change reloads the page (the PHP edition redirected
 * and flashed). The message is kept in sessionStorage across the reload. Buttons outside the form (the floating bulk bar uses the
 * form="" attribute) are supported through e.submitter. app.js has already handled data-confirm before the second, real submit.
 */
(function () {
  'use strict';
  var K = window.NextMON;
  if (!K || !K.api) return;
  var KEY = 'nm_flash';

  function flash(msg, type) {
    if (msg) K.toast(msg, type);
  }
  try {
    var saved = sessionStorage.getItem(KEY);
    if (saved) {
      sessionStorage.removeItem(KEY);
      var f = JSON.parse(saved);
      flash(f.m, f.t);
    }
  } catch (e) { /* ignore */ }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[data-api]') || e.defaultPrevented) return;
    e.preventDefault();
    var fd = new FormData(form);
    var s = e.submitter;
    if (s && s.name) fd.append(s.name, s.value);
    var busy = s || form.querySelector('button.btn-primary');
    if (busy) busy.classList.add('loading');
    K.api(form.dataset.api, fd).then(function (d) {
      var ok = d && d.ok !== false;
      var msg = (d && (d.message || d.error)) || (ok ? K.t('Saved.') : K.t('error'));
      if (ok || (d && d.reload)) {
        try { sessionStorage.setItem(KEY, JSON.stringify({ m: msg, t: ok ? 'ok' : 'err' })); } catch (x) { /* ignore */ }
        location.reload();
      } else {
        flash(msg, 'err');
        if (busy) busy.classList.remove('loading');
      }
    }).catch(function () {
      flash(K.t('error'), 'err');
      if (busy) busy.classList.remove('loading');
    });
  });
})();
