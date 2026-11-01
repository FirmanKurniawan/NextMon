/* NextMON core UI: theme/accent/density, sidebar rail, toasts, dialogs, confirm, data tables (sort, chips, columns, floating
   bulk bar), tabs, command palette (fuzzy, grouped, recent), keyboard shortcuts, PWA. Vanilla JS, no deps. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var K = window.NextMON = window.NextMON || {};
  K.$ = $; K.$$ = $$;
  K.base = doc.body.dataset.base || '';
  K.csrf = doc.body.dataset.csrf || '';
  K.reduce = reduce;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  K.store = store;

  var I18N = {};
  try { I18N = JSON.parse(($('#i18n') || {}).textContent || '{}'); } catch (e) { /* ignore */ }
  K.t = function (k) { return I18N[k] || k; };

  K.url = function (p) { return K.base + p; };
  K.money = function (n) {
    var cur = (K.currency || 'Rp');
    return cur + ' ' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };
  K.bps = function (v) {
    v = Number(v) || 0;
    var u = ['bps', 'Kbps', 'Mbps', 'Gbps'], i = 0;
    while (v >= 1000 && i < 3) { v /= 1000; i++; }
    return (i ? v.toFixed(v < 10 ? 2 : 1) : Math.round(v)) + ' ' + u[i];
  };
  K.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---- icons (subset, same 24px stroke set as helpers.php) ---- */
  var IC = {
    check: '<path d="M5 12l5 5 9-10"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>', sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', refresh: '<path d="M20 11a8 8 0 10-2 6M20 4v7h-7"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="15.5" cy="10" r="1"/><path d="M12 21c-1.5 0-1.5-2 0-3s1-3 3-3h3"/>',
    rows: '<path d="M4 6h16M4 12h16M4 18h16"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', plus: '<path d="M12 5v14M5 12h14"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', key: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>'
  };
  K.icon = function (n, s) {
    s = s || 16;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (IC[n] || IC.list) + '</svg>';
  };

  /* ---- fetch helper (CSRF + JSON) ---- */
  K.api = function (url, data) {
    var opt = { credentials: 'same-origin', headers: { 'X-CSRF-Token': K.csrf, 'Accept': 'application/json' } };
    if (data) {
      opt.method = 'POST';
      if (data instanceof FormData) { opt.body = data; }
      else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(data); }
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  };

  /* ---- toasts: stacked, progress bar = remaining time, pauses on hover ---- */
  K.toast = function (msg, type, opt) {
    var box = $('#toasts'); if (!box) return;
    type = type === 'err' || type === 'warn' || type === 'info' ? type : 'ok';
    opt = opt || {};
    var dur = opt.duration || (type === 'err' ? 7000 : 4200);
    while (box.children.length >= 4) box.firstElementChild.remove();
    var el = doc.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');
    el.style.setProperty('--dur', dur + 'ms');
    el.innerHTML = K.icon(type === 'ok' ? 'check' : type === 'info' ? 'info' : 'alert', 18) + '<div class="t-msg">' + K.esc(msg) + '</div>' +
      '<button class="t-x" type="button" aria-label="' + K.esc(K.t('close')) + '">' + K.icon('x', 14) + '</button>' + (reduce ? '' : '<i class="t-bar"></i>');
    var gone = false;
    function dismiss() {
      if (gone) return; gone = true; el.classList.add('out');
      setTimeout(function () { el.remove(); }, reduce ? 0 : 200);
    }
    $('.t-x', el).addEventListener('click', dismiss);
    var bar = $('.t-bar', el);
    if (bar) bar.addEventListener('animationend', dismiss); else setTimeout(dismiss, dur);
    box.appendChild(el);
    return el;
  };
  $$('[data-flash]').forEach(function (a) { K.toast(a.textContent.trim(), a.dataset.flash === 'err' ? 'err' : 'ok'); a.remove(); });
  window.addEventListener('offline', function () { K.toast(K.t('offline'), 'err'); });

  /* ---- appearance: theme / accent / density / sidebar rail ---- */
  function syncUI() {
    var th = root.getAttribute('data-theme') || 'auto', ac = root.getAttribute('data-accent') || 'teal', de = root.getAttribute('data-density') || 'compact';
    $$('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.themeSet === th ? 'true' : 'false'); });
    $$('[data-accent-set]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.accentSet === ac ? 'true' : 'false'); });
    $$('[data-density-set]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.densitySet === de ? 'true' : 'false'); });
    var sb = $('[data-sidebar-toggle]'); if (sb) sb.setAttribute('aria-pressed', root.getAttribute('data-sb') === 'collapsed' ? 'true' : 'false');
    /* browser chrome colour follows the chosen scheme (auto = the two media-specific metas decide) */
    $$('meta[name="theme-color"]').forEach(function (m) {
      if (!m.dataset.auto) m.dataset.auto = m.getAttribute('content');
      m.setAttribute('content', th === 'dark' ? '#090f15' : th === 'light' ? '#eaeff3' : m.dataset.auto);
    });
  }
  function changed() { syncUI(); doc.dispatchEvent(new CustomEvent('nextmon:theme')); }
  K.setTheme = function (t) { root.setAttribute('data-theme', t); store.set('nextmon-theme', t); changed(); };
  K.setAccent = function (a) { if (a === 'teal') root.removeAttribute('data-accent'); else root.setAttribute('data-accent', a); store.set('nextmon-accent', a); changed(); };
  K.setDensity = function (d) { root.setAttribute('data-density', d); store.set('nextmon-density', d); changed(); doc.dispatchEvent(new CustomEvent('nextmon:resize')); };
  K.toggleSidebar = function () {
    var c = root.getAttribute('data-sb') === 'collapsed';
    if (c) root.removeAttribute('data-sb'); else root.setAttribute('data-sb', 'collapsed');
    store.set('nextmon-sb', c ? '' : 'collapsed'); syncUI(); hideRailTip();
    setTimeout(function () { doc.dispatchEvent(new CustomEvent('nextmon:resize')); }, 260);
  };
  syncUI();

  var drawer = $('#drawer');
  var drawerFrom = null;
  function setDrawer(open) {
    if (!drawer) return;
    var was = drawer.classList.contains('open');
    drawer.classList.toggle('open', open); drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && !was) {
      drawerFrom = doc.activeElement;
      var f = $('[data-drawer-close].btn', drawer) || $('a, button', drawer); if (f) setTimeout(function () { f.focus(); }, 30);
    } else if (!open && was && drawerFrom && drawerFrom.focus && doc.contains(drawerFrom)) { drawerFrom.focus(); drawerFrom = null; }
  }
  /* focus trap while the drawer is open */
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !drawer || !drawer.classList.contains('open')) return;
    var f = $$('a[href], button:not([disabled])', $('.drawer-panel', drawer)).filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (doc.activeElement === a || !drawer.contains(doc.activeElement))) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && (doc.activeElement === z || !drawer.contains(doc.activeElement))) { e.preventDefault(); a.focus(); }
  });

  doc.addEventListener('click', function (e) {
    var t = e.target;
    var th = t.closest('[data-theme-set]'); if (th) { K.setTheme(th.dataset.themeSet); return; }
    var ac = t.closest('[data-accent-set]'); if (ac) { K.setAccent(ac.dataset.accentSet); return; }
    var ds = t.closest('[data-density-set]'); if (ds) { K.setDensity(ds.dataset.densitySet); return; }
    if (t.closest('button[data-density], a[data-density]')) { K.setDensity(root.getAttribute('data-density') === 'comfortable' ? 'compact' : 'comfortable'); return; }
    if (t.closest('[data-sidebar-toggle]')) { K.toggleSidebar(); return; }
    if (t.closest('[data-drawer-open]')) { setDrawer(true); return; }
    if (t.closest('[data-drawer-close]') || (drawer && drawer.classList.contains('open') && t.closest('#drawer .nav-link'))) { setDrawer(false); }
    if (t.closest('[data-palette-open]')) { openPalette(); return; }
    if (t.closest('[data-help-open]')) { openHelp(); return; }
    if (t.closest('[data-print]')) { window.print(); return; }
    var cp = t.closest('[data-copy]');
    if (cp) {
      var src = $(cp.dataset.copy);
      if (src && navigator.clipboard) navigator.clipboard.writeText(src.textContent.trim()).then(function () { K.toast(K.t('copied')); });
      return;
    }
    // close <details class="menu"> when clicking elsewhere
    $$('details.menu[open]').forEach(function (d) { if (!d.contains(t)) d.removeAttribute('open'); });
  });

  /* ---- rail tooltips (sidebar collapsed to icons) ---- */
  var railTip = null;
  function railOn() { return root.getAttribute('data-sb') === 'collapsed' || (window.matchMedia && matchMedia('(min-width:768px) and (max-width:1023px)').matches); }
  function hideRailTip() { if (railTip) { railTip.remove(); railTip = null; } }
  doc.addEventListener('mouseover', function (e) {
    var a = e.target.closest && e.target.closest('#sidebar .nav-link, #sidebar .brand'); if (!a || !railOn()) return;
    var label = a.getAttribute('aria-label') || a.textContent.trim(); if (!label) return;
    hideRailTip();
    var r = a.getBoundingClientRect(); railTip = doc.createElement('div'); railTip.className = 'rail-tip'; railTip.textContent = label;
    railTip.style.left = (r.right + 10) + 'px'; railTip.style.top = (r.top + r.height / 2) + 'px'; doc.body.appendChild(railTip);
  });
  doc.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('#sidebar .nav-link, #sidebar .brand')) hideRailTip(); });
  doc.addEventListener('focusin', function (e) { var a = e.target.closest && e.target.closest('#sidebar .nav-link'); if (a && railOn()) a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); else hideRailTip(); });

  /* ---- cursor-follow spotlight on cards (pointer devices only) ---- */
  if (!reduce && window.matchMedia && matchMedia('(hover: hover)').matches) {
    var raf = 0;
    doc.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.card'); if (!card) return;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0; var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ---- count-up numbers ---- */
  K.countUp = function (el, to, money) {
    to = Number(to) || 0;
    var token = el._cu = (el._cu || 0) + 1;
    var fmt = function (v) { return money ? K.money(v) : Math.round(v).toLocaleString(K.lang === 'en' ? 'en-US' : 'id-ID'); };
    if (reduce || to === 0) { el.textContent = fmt(to); return; }
    var from = Number(el._from) || 0; el._from = to;
    var t0 = performance.now(), dur = 800;
    (function step(now) {
      if (el._cu !== token) return;
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    })(t0);
  };
  K.lang = doc.body.dataset.lang;
  $$('[data-count]').forEach(function (el) {
    var cur = el.textContent.match(/^[^\d]*/); K.currency = K.currency || (cur && cur[0].trim()) || 'Rp';
    K.countUp(el, el.dataset.count, el.hasAttribute('data-money'));
  });

  /* ---- dialogs ---- */
  function openDialog(dlg) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  K.openDialog = openDialog;
  function fillForm(form, data) {
    Object.keys(data).forEach(function (k) {
      var f = form.elements[k]; if (!f) return;
      if (f.type === 'checkbox') f.checked = data[k] === '1' || data[k] === true || data[k] === 1;
      else f.value = data[k] == null ? '' : data[k];
    });
  }
  doc.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) {
      var dlg = $(o.dataset.open); if (!dlg) return;
      var form = $('form', dlg);
      if (form) {
        form.reset();
        $$('input[type=hidden]:not([name=_csrf]):not([name=back])', form).forEach(function (h) { h.value = ''; });
        var editing = o.hasAttribute('data-edit');
        $$('[data-edit-only]', form).forEach(function (x) { x.hidden = !editing; });
        if (editing) { try { fillForm(form, JSON.parse(o.dataset.edit)); } catch (x) { /* ignore */ } }
        $$('select', form).forEach(function (s) { s.dispatchEvent(new Event('change', { bubbles: true })); });
        var pw = form.elements.password; if (pw && editing && form.elements.username) pw.placeholder = '';
      }
      openDialog(dlg);
      var first = $('input:not([type=hidden]):not([type=checkbox]), select', dlg); if (first && !editing) setTimeout(function () { first.focus(); }, 30);
      return;
    }
    var c = e.target.closest('[data-close]'); if (c) { var d = c.closest('dialog'); if (d) d.close(); return; }
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('modal')) {
      var r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });

  /* ---- confirm dialog for destructive actions ---- */
  var cdlg = $('#confirm-dlg');
  function confirmDlg(msg) {
    return new Promise(function (resolve) {
      if (!cdlg || !cdlg.showModal) { resolve(window.confirm(msg)); return; }
      $('#confirm-msg').textContent = msg || K.t('confirm');
      var done = function (v) { cdlg.close(); cdlg.removeEventListener('click', h); resolve(v); };
      var h = function (e) { if (e.target.closest('[data-confirm-yes]')) done(true); else if (e.target.closest('[data-confirm-no]')) done(false); };
      cdlg.addEventListener('click', h);
      cdlg.addEventListener('close', function () { resolve(false); }, { once: true });
      cdlg.showModal();
    });
  }
  K.confirm = confirmDlg;
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-confirm], a[data-confirm]'); if (!b) return;
    if (b.dataset.ok) { delete b.dataset.ok; return; }
    e.preventDefault();
    confirmDlg(b.dataset.confirm).then(function (ok) { if (ok) { b.dataset.ok = '1'; b.click(); } });
  }, true);
  doc.addEventListener('submit', function (e) {
    var f = e.target; if (!f.dataset || !f.dataset.confirm) return;
    if (f.dataset.ok) { delete f.dataset.ok; return; }
    e.preventDefault();
    confirmDlg(f.dataset.confirm).then(function (ok) { if (ok) { f.dataset.ok = '1'; f.requestSubmit ? f.requestSubmit() : f.submit(); } });
  }, true);
  doc.addEventListener('submit', function (e) {   // loading state on submit buttons
    var b = e.submitter; if (e.defaultPrevented) return;
    if (b && (b.classList.contains('btn-primary') || b.classList.contains('btn-danger'))) setTimeout(function () { b.classList.add('loading'); }, 0);
  });
  window.addEventListener('pageshow', function () { $$('.btn.loading').forEach(function (b) { b.classList.remove('loading'); }); });

  doc.addEventListener('change', function (e) {
    var a = e.target.closest('[data-autosubmit]');
    if (a && a.form) { a.form.requestSubmit ? a.form.requestSubmit() : a.form.submit(); }
  });

  /* ================= data tables ================= */
  var formSeq = 0;
  function barOf(form) { return form._bar || $('[data-sel-bar]', form); }
  function updateSel(form) {
    var boxes = $$('input[name="ids[]"]', form), n = 0;
    boxes.forEach(function (b) { if (b.checked) n++; var tr = b.closest('tr'); if (tr) tr.classList.toggle('is-selected', b.checked); });
    var bar = barOf(form);
    if (bar) { bar.hidden = n === 0; var c = $('[data-sel-count]', bar); if (c) c.textContent = K.t('selected').replace(':n', n); }
    var all = $('[data-check-all]', form); if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
  }
  // lift every bulk bar out of its (backdrop-filtered) card so it can float above the page
  function floatBars() {
    $$('[data-sel-bar]').forEach(function (bar) {
      var form = bar.closest('form'); if (!form || bar.classList.contains('floating')) return;
      if (!form.id) form.id = 'kf-' + (++formSeq);
      $$('button, input, select', bar).forEach(function (x) { x.setAttribute('form', form.id); });
      form._bar = bar; bar.classList.add('floating'); bar.setAttribute('role', 'toolbar'); doc.body.appendChild(bar);
    });
  }
  doc.addEventListener('change', function (e) {
    var t = e.target, form = t.closest('form'); if (!form) return;
    if (t.matches('[data-check-all]')) { $$('input[name="ids[]"]', form).forEach(function (b) { if (!b.closest('tr[hidden]')) b.checked = t.checked; }); updateSel(form); }
    else if (t.matches('input[name="ids[]"]')) updateSel(form);
  });
  // shift+click range selection
  var lastChk = null;
  doc.addEventListener('click', function (e) {
    var t = e.target; if (!t.matches || !t.matches('input[name="ids[]"]')) return;
    if (e.shiftKey && lastChk && lastChk !== t && lastChk.form === t.form) {
      var boxes = $$('input[name="ids[]"]', t.closest('form')), a = boxes.indexOf(lastChk), b = boxes.indexOf(t);
      boxes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { x.checked = t.checked; });
      updateSel(t.closest('form'));
    }
    lastChk = t;
  });
  doc.addEventListener('keydown', function (e) {   // Esc clears the bulk selection
    if (e.key !== 'Escape' || doc.querySelector('dialog[open]')) return;
    $$('form').forEach(function (f) { if (f._bar && !f._bar.hidden) { $$('input[name="ids[]"]', f).forEach(function (b) { b.checked = false; }); updateSel(f); } });
  });

  /* row visibility = text filter AND chip filter */
  function applyRows(tbl) {
    var shown = 0, rows = $$('tbody tr', tbl);
    rows.forEach(function (tr) { var h = !!(tr._q || tr._c); tr.hidden = h; if (!h) shown++; });
    var cnt = tbl._count; if (cnt) cnt.textContent = (shown === rows.length ? rows.length : shown + ' / ' + rows.length) + ' ' + K.t('rows');
  }
  doc.addEventListener('input', function (e) {
    var t = e.target; if (!t.matches || !t.matches('[data-filter]')) return;
    var q = t.value.toLowerCase(), tbl = $(t.dataset.filter); if (!tbl) return;
    $$('tbody tr', tbl).forEach(function (tr) { tr._q = !!q && tr.textContent.toLowerCase().indexOf(q) === -1; });
    applyRows(tbl);
  });

  function sortBy(th) {
    var tbl = th.closest('table'), idx = Array.prototype.indexOf.call(th.parentNode.children, th);
    var asc = th.getAttribute('aria-sort') !== 'ascending';
    $$('th', tbl).forEach(function (x) { x.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
    var rows = $$('tbody tr', tbl), tb = $('tbody', tbl);
    var val = function (tr) { var t = tr.children[idx] ? tr.children[idx].textContent.trim() : ''; var n = parseFloat(t.replace(/[^\d.\-]/g, '')); return isNaN(n) || /[a-z]{3,}/i.test(t) ? t.toLowerCase() : n; };
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); });
    rows.forEach(function (r) { tb.appendChild(r); });
  }
  doc.addEventListener('click', function (e) { var th = e.target.closest('th[data-sort]'); if (th) sortBy(th); });
  doc.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('th[data-sort]')) { e.preventDefault(); sortBy(e.target); } });

  function enhanceTable(tbl, n) {
    var heads = $$('thead th', tbl), card = tbl.closest('.card') || tbl.parentNode;
    var tools = $('.tbl-tools', card), key = 'nextmon-cols:' + (doc.body.dataset.page || '') + ':' + (tbl.id || n);
    heads.forEach(function (th) { if (th.hasAttribute('data-sort')) { th.tabIndex = 0; th.setAttribute('role', 'columnheader'); } });
    var rows = $$('tbody tr', tbl);
    if (tools && rows.length) {
      var cnt = doc.createElement('span'); cnt.className = 'tbl-count'; cnt.textContent = rows.length + ' ' + K.t('rows');
      tbl._count = cnt;
      // chips from <th data-chip> (one group per marked column; groups combine with AND)
      heads.filter(function (th) { return th.hasAttribute('data-chip'); }).forEach(function (chipTh, gi) {
        var ci = heads.indexOf(chipTh), vals = {}, order = [];
        rows.forEach(function (tr) { var c = tr.children[ci], v = c ? c.textContent.trim() : ''; if (!v) return; if (!(v in vals)) { vals[v] = 0; order.push(v); } vals[v]++; });
        if (order.length < 2 || order.length > 8) return;
        var wrap = doc.createElement('div'); wrap.className = 'chips hide-m'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', chipTh.textContent.trim());
        var mk = function (label, v, count) {
          var b = doc.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', v === null ? 'true' : 'false');
          b.innerHTML = K.esc(label) + (count != null ? ' <small>' + count + '</small>' : ''); b.dataset.v = v === null ? '' : v; return b;
        };
        wrap.appendChild(mk(K.t('all'), null, rows.length));
        order.forEach(function (v) { wrap.appendChild(mk(v, v, vals[v])); });
        wrap.addEventListener('click', function (e) {
          var b = e.target.closest('.chip'); if (!b) return;
          var cur = b.dataset.v || null;
          $$('.chip', wrap).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          rows.forEach(function (tr) {
            var c = tr.children[ci]; tr._cf = tr._cf || {}; tr._cf[gi] = cur !== null && (!c || c.textContent.trim() !== cur);
            tr._c = Object.keys(tr._cf).some(function (k) { return tr._cf[k]; });
          });
          applyRows(tbl);
        });
        if (!tbl._chipAnchor) { var br = doc.createElement('span'); br.className = 'tbl-break'; tools.appendChild(br); }
        tools.appendChild(wrap); tbl._chipAnchor = wrap;
      });
      // column toggle
      var cols = heads.map(function (th, i) { return { i: i, th: th, name: th.textContent.trim() }; }).filter(function (c) { return c.name && !c.th.classList.contains('cell-chk'); });
      var saved = []; try { saved = JSON.parse(store.get(key) || '[]'); } catch (x) { saved = []; }
      var setCol = function (i, show) {
        $$('tr', tbl).forEach(function (tr) { var c = tr.children[i]; if (c) c.hidden = !show; });
      };
      if (cols.length >= 4) {
        var det = doc.createElement('details'); det.className = 'menu hide-m';
        det.innerHTML = '<summary class="btn btn-sm btn-ghost" aria-label="' + K.esc(K.t('columns')) + '" data-tip="' + K.esc(K.t('columns')) + '">' + K.icon('rows', 16) + '<span class="hide-m">' + K.esc(K.t('columns')) + '</span></summary><div class="menu-pop cols"></div>';
        var pop = $('.menu-pop', det);
        cols.forEach(function (c) {
          var lb = doc.createElement('label'), cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = saved.indexOf(c.i) === -1;
          lb.appendChild(cb); lb.appendChild(doc.createTextNode(c.name));
          cb.addEventListener('change', function () {
            var hid = $$('input', pop).map(function (x, k) { return x.checked ? -1 : cols[k].i; }).filter(function (x) { return x >= 0; });
            if (hid.length >= cols.length) { cb.checked = true; return; }
            setCol(c.i, cb.checked); store.set(key, JSON.stringify(hid));
          });
          pop.appendChild(lb); if (!cb.checked) setCol(c.i, false);
        });
        tools.appendChild(det);
      }
      var sp = $('.spacer', tools); if (sp) sp.insertAdjacentElement('afterend', cnt); else tools.appendChild(cnt);
    }
  }
  $$('table.tbl').forEach(function (tbl, i) { enhanceTable(tbl, i); });
  floatBars();

  var ar = $('[data-autoreload]');
  if (ar) {
    var secs = Number(ar.dataset.autoreload) || 10, timer = null;
    var set = function () { clearInterval(timer); if (ar.checked) timer = setInterval(function () { if (!doc.hidden) location.reload(); }, secs * 1000); try { sessionStorage.setItem('nextmon-ar', ar.checked ? '1' : ''); } catch (e) { /* ignore */ } };
    try { ar.checked = sessionStorage.getItem('nextmon-ar') === '1'; } catch (e) { /* ignore */ }
    ar.addEventListener('change', set); set();
  }

  /* ---- tabs ---- */
  function selectTab(list, name, push) {
    var tabs = $$('[data-tab]', list), found = false;
    tabs.forEach(function (t) { if (t.dataset.tab === name) found = true; });
    if (!found) name = tabs[0] && tabs[0].dataset.tab;
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      var p = $('#' + t.getAttribute('aria-controls')); if (p) p.hidden = !on;
    });
    if (push && list.hasAttribute('data-hash-tabs')) history.replaceState(null, '', '#' + name);
  }
  $$('[role=tablist]').forEach(function (list) {
    list.addEventListener('click', function (e) { var t = e.target.closest('[data-tab]'); if (t) selectTab(list, t.dataset.tab, true); });
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = $$('[data-tab]', list), i = tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; });
      i = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; selectTab(list, tabs[i].dataset.tab, true); tabs[i].focus();
    });
    if (list.hasAttribute('data-hash-tabs') && location.hash) selectTab(list, location.hash.slice(1), false);
  });
  window.addEventListener('hashchange', function () { var l = $('[data-hash-tabs]'); if (l) selectTab(l, location.hash.slice(1), false); });

  /* ================= keyboard shortcuts ================= */
  var GO = { dashboard: 'd', users: 'u', profiles: 'p', vouchers: 'v', active: 'a', hosts: 'h', bindings: 'b', reports: 'r', pos: 'x', queues: 'q', firewall: 'f', tools: 't', backup: 'k', routers: 'w', notifications: 'n', audit: 'l', settings: 's' };
  var goMap = {};
  $$('#sidebar .nav-link[data-key]').forEach(function (a) {
    var k = GO[a.dataset.key]; if (!k) return; goMap[k] = a;
    var h = doc.createElement('span'); h.className = 'kbd-g'; h.innerHTML = '<kbd>g</kbd> <kbd>' + k + '</kbd>'; a.appendChild(h);
  });
  function typing(e) { var t = e.target; return t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); }
  var gPending = 0;
  doc.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (pal && pal.open) pal.close(); else openPalette(); return; }
    if (e.key === 'Escape') { setDrawer(false); $$('details.menu[open]').forEach(function (d) { d.removeAttribute('open'); }); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || doc.querySelector('dialog[open]')) return;
    if (gPending && Date.now() - gPending < 1200) {
      gPending = 0; var a = goMap[e.key.toLowerCase()];
      if (a) { e.preventDefault(); a.click(); }
      return;
    }
    if (e.key === 'g') { gPending = Date.now(); return; }
    if (e.key === '/') { e.preventDefault(); var s = $('.tbl-tools .search, input[type=search]'); if (s) s.focus(); else openPalette(); }
    else if (e.key === '?') { e.preventDefault(); openHelp(); }
    else if (e.key === '[') { K.toggleSidebar(); }
  });

  var help = null;
  function openHelp() {
    if (!help) {
      help = doc.createElement('dialog'); help.className = 'modal'; help.id = 'kbd-help'; help.setAttribute('aria-label', K.t('shortcuts'));
      var row = function (l, keys) { return '<div><span>' + K.esc(l) + '</span><span>' + keys.map(function (k) { return '<kbd>' + K.esc(k) + '</kbd>'; }).join('') + '</span></div>'; };
      var nav = Object.keys(GO).filter(function (k) { return $('#sidebar .nav-link[data-key="' + k + '"]'); }).map(function (k) { return row($('#sidebar .nav-link[data-key="' + k + '"]').getAttribute('aria-label') || k, ['g', GO[k]]); }).join('');
      help.innerHTML = '<div class="modal-h"><h2>' + K.esc(K.t('shortcuts')) + '</h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="' + K.esc(K.t('close')) + '">' + K.icon('x', 18) + '</button></div>' +
        '<div class="modal-b"><div class="kbd-list"><h3>' + K.esc(K.t('general')) + '</h3>' +
        row(K.t('Command palette'), ['Ctrl', 'K']) + row(K.t('Focus search'), ['/']) + row(K.t('Toggle sidebar'), ['[']) + row(K.t('Show shortcuts'), ['?']) + row(K.t('Close'), ['Esc']) + row(K.t('Select range'), ['Shift', 'click']) +
        '<h3>' + K.esc(K.t('Go to')) + '</h3>' + nav + '</div></div>';
      doc.body.appendChild(help);
    }
    openDialog(help);
  }
  K.openHelp = openHelp;

  /* ================= command palette ================= */
  var pal = $('#palette'), pin = $('#pal-input'), plist = $('#pal-list'), pitems = [], psel = 0, pvis = [];
  function pageActions() {
    var out = [];
    $$('.page-actions .btn, .page-actions a').forEach(function (b) {
      var label = b.textContent.trim(); if (!label || b.hasAttribute('data-palette-open')) return;
      out.push({ id: 'pa:' + label, group: K.t('This page'), label: label, icon: b.querySelector('svg') ? b.querySelector('svg').outerHTML : K.icon('bolt'), run: function () { b.click(); } });
    });
    return out;
  }
  function buildItems() {
    var items = [], A = K.t('Appearance'), G = K.t('pages');
    items = items.concat(pageActions());
    $$('#sidebar .nav-link').forEach(function (a) {
      var k = a.dataset.key, g = GO[k], svg = a.querySelector('svg');
      items.push({ id: 'nav:' + (k || a.href), group: G, label: a.getAttribute('aria-label') || a.textContent.replace(/g\s*\w$/, '').trim(), icon: svg ? svg.outerHTML : '', keys: g ? ['g', g] : null, run: function () { location.href = a.href; } });
    });
    items.push({ id: 'act:refresh', group: K.t('actions'), label: K.t('Refresh data'), icon: K.icon('refresh'), run: function () { var r = $('[data-dash-refresh]'); if (r) r.click(); else location.reload(); } });
    items.push({ id: 'act:help', group: K.t('actions'), label: K.t('Show shortcuts'), icon: K.icon('key'), keys: ['?'], run: openHelp });
    items.push({ id: 'act:sb', group: K.t('actions'), label: K.t('Toggle sidebar'), icon: K.icon('sidebar'), keys: ['['], run: K.toggleSidebar });
    [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'palette']].forEach(function (x) {
      items.push({ id: 'th:' + x[0], group: A, label: K.t('theme') + ': ' + x[1], icon: K.icon(x[2]), run: function () { K.setTheme(x[0]); } });
    });
    ['teal', 'blue', 'violet', 'emerald', 'rose'].forEach(function (c) {
      items.push({ id: 'ac:' + c, group: A, label: K.t('Accent') + ': ' + c.charAt(0).toUpperCase() + c.slice(1), icon: '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="' + { teal: '#0b7285', blue: '#2f66e0', violet: '#7a55e0', emerald: '#0f9d73', rose: '#d6254f' }[c] + '"/></svg>', run: function () { K.setAccent(c); } });
    });
    items.push({ id: 'de:c', group: A, label: K.t('Density') + ': ' + K.t('Compact'), icon: K.icon('rows'), run: function () { K.setDensity('compact'); } });
    items.push({ id: 'de:x', group: A, label: K.t('Density') + ': ' + K.t('Comfortable'), icon: K.icon('rows'), run: function () { K.setDensity('comfortable'); } });
    $$('.menu-pop a[href*="/lang"]').forEach(function (a) { items.push({ id: 'lg:' + a.textContent.trim(), group: K.t('Account'), label: K.t('lang') + ': ' + a.textContent.trim(), icon: K.icon('globe'), run: function () { location.href = a.href; } }); });
    var lo = $('.menu-pop form[action$="/logout"]'); if (lo) items.push({ id: 'act:logout', group: K.t('Account'), label: K.t('logout'), icon: K.icon('logout'), run: function () { lo.submit(); } });
    return items;
  }
  function fuzzy(q, s) {
    var l = s.toLowerCase(), qi = 0, score = 0, last = -2, idx = [];
    for (var i = 0; i < l.length && qi < q.length; i++) {
      if (l[i] === q[qi]) { idx.push(i); score += 1; if (i === last + 1) score += 2.5; if (i === 0 || /[\s\-_/:]/.test(l[i - 1])) score += 3; last = i; qi++; }
    }
    if (qi < q.length) return null;
    var sub = l.indexOf(q); if (sub >= 0) score += 8 - Math.min(6, sub * .5);
    return { score: score - l.length * .03, idx: idx };
  }
  function hl(label, idx) {
    if (!idx || !idx.length) return K.esc(label);
    var out = '', set = {}; idx.forEach(function (i) { set[i] = 1; });
    for (var i = 0; i < label.length; i++) out += set[i] ? '<mark>' + K.esc(label[i]) + '</mark>' : K.esc(label[i]);
    return out;
  }
  function recent() { try { return JSON.parse(store.get('nextmon-recent') || '[]'); } catch (e) { return []; } }
  function renderPal() {
    var q = pin.value.toLowerCase().replace(/\s+/g, ''), groups = [], byG = {};
    var add = function (g, it, hlIdx) { if (!byG[g]) { byG[g] = { name: g, items: [] }; groups.push(byG[g]); } byG[g].items.push({ it: it, idx: hlIdx }); };
    if (!q) {
      var rec = recent().map(function (id) { return pitems.filter(function (i) { return i.id === id; })[0]; }).filter(Boolean).slice(0, 4);
      rec.forEach(function (it) { add(K.t('Recent'), it); });
      pitems.forEach(function (it) { add(it.group, it); });
    } else {
      var scored = [];
      pitems.forEach(function (it) { var m = fuzzy(q, it.label); if (m) scored.push({ it: it, m: m }); });
      scored.sort(function (a, b) { return b.m.score - a.m.score; });
      scored.forEach(function (s) { add(s.it.group, s.it, s.m.idx); });
    }
    pvis = []; plist.innerHTML = '';
    if (!groups.length) { plist.innerHTML = '<li aria-disabled="true">' + K.esc(K.t('noresult')) + '</li>'; psel = 0; return; }
    groups.forEach(function (g) {
      var h = doc.createElement('li'); h.className = 'pal-group'; h.setAttribute('role', 'presentation'); h.textContent = g.name; plist.appendChild(h);
      g.items.forEach(function (x) {
        var i = pvis.length, li = doc.createElement('li'); li.setAttribute('role', 'option'); li.dataset.i = i;
        li.innerHTML = (x.it.icon || '') + '<span>' + hl(x.it.label, x.idx) + '</span>' + (x.it.keys ? '<small>' + x.it.keys.map(function (k) { return '<kbd>' + K.esc(k) + '</kbd>'; }).join('') + '</small>' : '');
        li.addEventListener('click', function () { choose(x.it); });
        li.addEventListener('mousemove', function () { if (psel !== i) { psel = i; markSel(false); } });
        plist.appendChild(li); pvis.push(x.it);
      });
    });
    psel = Math.min(psel, pvis.length - 1); markSel(true);
  }
  function markSel(scroll) {
    $$('li[role=option]', plist).forEach(function (li) {
      var on = Number(li.dataset.i) === psel; li.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && scroll) li.scrollIntoView({ block: 'nearest' });
    });
  }
  function choose(it) {
    var r = recent().filter(function (x) { return x !== it.id; }); r.unshift(it.id); store.set('nextmon-recent', JSON.stringify(r.slice(0, 6)));
    pal.close(); it.run();
  }
  function openPalette() { if (!pal) return; pitems = buildItems(); pin.value = ''; psel = 0; renderPal(); openDialog(pal); pin.focus(); }
  if (pal) {
    if (!$('.pal-top', pal)) { var top = doc.createElement('div'); top.className = 'pal-top'; top.innerHTML = K.icon('search', 18); pal.insertBefore(top, pin); top.appendChild(pin); }
    if (!$('.pal-foot', pal)) {
      var ft = doc.createElement('div'); ft.className = 'pal-foot';
      ft.innerHTML = '<span><kbd>&uarr;</kbd><kbd>&darr;</kbd> ' + K.esc(K.t('navigate')) + '</span><span><kbd>Enter</kbd> ' + K.esc(K.t('select')) + '</span><span><kbd>Esc</kbd> ' + K.esc(K.t('Close')) + '</span><span style="margin-left:auto"><kbd>?</kbd> ' + K.esc(K.t('Show shortcuts')) + '</span>';
      pal.appendChild(ft);
    }
    pin.addEventListener('input', function () { psel = 0; renderPal(); });
    pin.addEventListener('keydown', function (e) {
      var n = pvis.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); psel = (psel + 1) % Math.max(1, n); markSel(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); psel = (psel - 1 + n) % Math.max(1, n); markSel(true); }
      else if (e.key === 'Enter') { e.preventDefault(); var it = pvis[psel]; if (it) choose(it); }
    });
  }

  /* select-all on focus for read-only copy fields (inline onfocus is blocked by CSP) */
  doc.addEventListener('focusin', function (e) { var t = e.target; if (t && t.matches && t.matches('input[data-autoselect]')) t.select(); });

  /* ---- PWA ---- */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    var swPrompted = false;
    function offerUpdate(worker) {
      if (swPrompted || !worker) return; swPrompted = true;
      var el = K.toast(K.t('A new version of NextMON is ready.'), 'info', { duration: 3600000 });
      if (!el) return;
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm btn-primary'; b.textContent = K.t('Update'); b.style.marginTop = '6px'; b.style.display = 'block';
      b.addEventListener('click', function () { b.disabled = true; worker.postMessage('SKIP_WAITING'); });
      $('.t-msg', el).appendChild(b);
    }
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading || !swHadController) return; reloading = true; location.reload();
    });
    var swHadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(K.url('/sw.js'), { scope: (K.base || '') + '/', updateViaCache: 'none' }).then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(nw); });
        });
        setInterval(function () { reg.update().catch(function () {}); }, 3600000);
      }).catch(function () { /* optional */ });
    });
  }

  doc.dispatchEvent(new CustomEvent('nextmon:ready'));
})();
