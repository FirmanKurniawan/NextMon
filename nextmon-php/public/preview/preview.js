/* Preview-only helpers: icon injection (the PHP app inlines these server-side) + demo data for every component. */
(function () {
  'use strict';
  var P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.6c2 .7 3.5 2.8 3.5 5.4"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    ticket: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 6v12"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>', plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 11a8 8 0 10-2 6M20 4v7h-7"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    check: '<path d="M5 12l5 5 9-10"/>', logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>', filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/>',
    bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 004 0"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'
  };
  document.querySelectorAll('i[data-ic]').forEach(function (el) {
    var s = el.dataset.s || 20;
    el.outerHTML = '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[el.dataset.ic] || '') + '</svg>';
  });

  var K = window.NextMON;
  function ready() {
    K.currency = 'Rp'; document.getElementById('ld').classList.add('loading');
    var daily = [120, 90, 140, 180, 160, 210, 190, 240, 220, 260, 250, 300, 280, 320].map(function (v) { return v * 1000; });
    var live = [8, 9, 9, 11, 10, 12, 13, 12, 14, 15, 14, 16, 18, 17, 19, 21, 20, 22, 24, 23];
    new K.Spark(document.getElementById('sp-active'), live, { color: '--chart-1', zero: false });
    new K.Spark(document.getElementById('sp-today'), daily, { color: '--chart-1' });
    new K.Spark(document.getElementById('sp-count'), [20, 31, 25, 40, 38, 44, 36, 52, 47, 58, 61, 55, 66, 72], { color: '--chart-2' });
    new K.Spark(document.getElementById('spark'), daily, { color: '--chart-5' });

    var lc = new K.LineChart(document.getElementById('traffic'), { series: [{ name: 'RX', color: '--chart-1' }, { name: 'TX', color: '--chart-3' }], max: 60, fmt: K.bps });
    var t = Date.now() - 52 * 2000;
    function tick() {
      t += 2000; var rx = 4e6 + Math.sin(t / 9000) * 2e6 + Math.random() * 4e5, tx = 1.2e6 + Math.cos(t / 7000) * 6e5 + Math.random() * 1e5;
      lc.push(t, [rx, tx]); document.getElementById('rx').textContent = K.bps(rx); document.getElementById('tx').textContent = K.bps(tx);
    }
    for (var i = 0; i < 52; i++) tick();
    setInterval(tick, 2000);

    K.gauge(document.querySelector('[data-g="cpu"]'), 23, { label: 'CPU' });
    K.gauge(document.querySelector('[data-g="mem"]'), 78, { label: 'RAM' });
    K.gauge(document.querySelector('[data-g="disk"]'), 93, { label: 'Disk' });

    var labels = [], vals = [];
    for (var d = 1; d <= 30; d++) { labels.push('2026-10-' + ('0' + d).slice(-2)); vals.push(60000 + Math.round(Math.abs(Math.sin(d)) * 140000)); }
    new K.BarChart(document.getElementById('bars'), labels, vals, { fmt: function (v, axis) { return axis ? (v >= 1000 ? Math.round(v / 1000) + 'k' : v) : K.money(v); } });
    new K.Doughnut(document.getElementById('pie'), ['1Hari', '3Jam', '7Hari', '30Hari', '1Jam'], [42, 25, 18, 10, 5], document.getElementById('pie-legend'), null, { caption: 'user' });
    new K.Doughnut(document.getElementById('pie2'), ['1Hari', '3Jam', '7Hari', '30Hari', '1Jam'], [51, 5, 7, 11, 10], document.getElementById('pie2-legend'), null, { caption: 'user total' });

    var heat = [], seed = 7;
    for (var w = 0; w < 7; w++) { var r = []; for (var h = 0; h < 24; h++) { seed = (seed * 9301 + 49297) % 233280; var base = (h >= 8 && h <= 21) ? Math.sin((h - 8) / 13 * Math.PI) * 7 : 0; r.push(Math.max(0, Math.round(base * (0.4 + seed / 233280) * (w > 4 ? 1.3 : 1)))); } heat.push(r); }
    K.Heatmap(document.getElementById('heat'), heat, { days: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'], unit: 'penjualan', label: 'Peta panas penjualan' });

    document.getElementById('toast-ok').addEventListener('click', function () { K.toast('Pengaturan disimpan.'); });
    document.getElementById('toast-err').addEventListener('click', function () { K.toast('Router tidak terjangkau.', 'err'); });
    document.getElementById('toast-warn').addEventListener('click', function () { K.toast('Disk router hampir penuh (93%).', 'warn'); });
    document.getElementById('toast-info').addEventListener('click', function () { K.toast('12 voucher dibuat dalam batch batchA.', 'info'); });
    document.getElementById('open-help').addEventListener('click', function () { K.openHelp(); });
    document.getElementById('open-pal').addEventListener('click', function () { document.querySelector('[data-palette-open]').click(); });
  }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();
