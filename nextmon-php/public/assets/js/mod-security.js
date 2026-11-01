/* Reseller module helpers (CSP: script-src 'self', so no inline JS). */
(function () {
  'use strict';
  // reseller edit dialog: fill from data-rs-edit JSON (app.js opens the dialog via data-open and resets the form first)
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rs-edit]');
    if (!b) return;
    var d; try { d = JSON.parse(b.getAttribute('data-rs-edit')); } catch (x) { return; }
    var dlg = document.querySelector(b.getAttribute('data-open') || '#dlg-rs');
    if (!dlg) return;
    setTimeout(function () { fill(dlg, d); }, 0);   // after app.js has reset the form
  });
  function fill(dlg, d) {
    dlg.querySelector('[name=id]').value = d.id || '';
    dlg.querySelector('[data-rs-title]').textContent = d.username || '';
    ['commission', 'adj', 'credit'].forEach(function (k) { var f = dlg.querySelector('[name=' + k + ']'); if (f) f.value = d[k] == null ? '' : d[k]; });
    dlg.querySelector('[name=active]').checked = !!d.active;
    dlg.querySelector('[name=allow_all]').checked = !!d.allow_all;
    dlg.querySelectorAll('[data-prof]').forEach(function (row) {
      var n = row.getAttribute('data-prof'), on = d.profiles && Object.prototype.hasOwnProperty.call(d.profiles, n);
      row.querySelector('input[type=checkbox]').checked = on;
      row.querySelector('input[type=number]').value = on && d.profiles[n] !== null && d.profiles[n] !== '' ? d.profiles[n] : '';
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rs-fund]');
    if (!b) return;
    var dlg = document.querySelector('#dlg-fund');
    if (!dlg) return;
    setTimeout(function () {
      dlg.querySelector('[name=id]').value = b.getAttribute('data-rs-fund');
      dlg.querySelector('[data-rs-title]').textContent = b.getAttribute('data-name') || '';
    }, 0);
  });
})();
