/* Page-specific behaviour. Each module is activated by <body data-page="..."> or by the presence of its elements. */
(function () {
  'use strict';
  var K = window.NextMON, doc = document;
  var $ = K.$, $$ = K.$$;
  var page = doc.body.dataset.page || '';
  var P = {};

  function alertBox(msg, kind) {
    return '<div class="alert ' + (kind || 'info') + '" role="status"><div>' + K.esc(msg) + '</div></div>';
  }
  function table(cols, rows) {
    if (!rows || !rows.length) return alertBox(K.t('nodata'));
    var h = '<div class="table-wrap" style="max-height:420px"><table class="tbl resp"><thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + K.esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + cols.map(function (c) {
        var v = c.f ? c.f(r) : r[c.k]; return '<td data-label="' + K.esc(c.h) + '" class="mono' + (c.num ? ' num' : '') + '">' + K.esc(v == null || v === '' ? '-' : v) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ================= dashboard ================= */
  P.dashboard = function () {
    var box = $('#dash'); if (!box) return;
    var poll = Number(box.dataset.poll) || 15000;
    var spActive = new K.Spark($('#sp-active'), [], { color: '--chart-1', zero: false });
    var spToday = new K.Spark($('#sp-today'), [], { color: '--chart-1' });
    var spCount = new K.Spark($('#sp-count'), [], { color: '--chart-2' });
    var spark = new K.Spark($('#spark'), [], { color: '--chart-5' });
    var chart = new K.LineChart($('#traffic'), { series: [{ name: 'RX', color: '--chart-1' }, { name: 'TX', color: '--chart-3' }], max: 60, fmt: K.bps });
    var sel = $('#if-sel'), iface = null, failed = false, donut = null, heatDone = false, hist = [];
    var loc = K.lang === 'en' ? 'en-US' : 'id-ID';

    function unskel(id) { $$('[data-skel]', $(id)).forEach(function (n) { n.classList.add('skel-out'); setTimeout(function () { n.remove(); }, 220); }); }
    function setNum(n, v, money) {
      n.classList.remove('skeleton'); n.classList.add('skel-done');
      if (n._v === v) return; n._v = v;
      K.countUp(n, v, money);
    }
    function days() {
      var out = []; for (var i = 0; i < 7; i++) out.push(new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' }));
      return out;
    }
    function gauge(key, pct, text) {
      var g = $('[data-g="' + key + '"]'); if (!g) return;
      K.gauge(g, pct, { label: key.toUpperCase() });
      var t = $('#' + key + '-v'); if (t) t.textContent = text;
    }
    function delta(today, yest) {
      var el = $('#delta-today'); if (!el) return;
      if (!yest) { el.hidden = true; return; }
      if (!today) { el.hidden = false; el.className = 'delta'; el.textContent = '—'; el.title = K.t('vs yesterday'); return; }
      var p = Math.round((today - yest) / yest * 100);
      el.hidden = false; el.className = 'delta ' + (p >= 0 ? 'up' : 'down'); el.textContent = (p >= 0 ? '+' : '') + p + '%'; el.title = K.t('vs yesterday');
    }
    function render(d) {
      K.currency = d.currency || K.currency;
      $$('[data-bind]').forEach(function (n) {
        var k = n.dataset.bind, v = d[k] != null ? d[k] : (d.resource ? d.resource[k] : null);
        if (v == null) return;
        if (typeof v === 'number') setNum(n, v, n.hasAttribute('data-money')); else { n.classList.remove('skeleton'); n.classList.add('skel-done'); n.textContent = v; }
      });
      var r = d.resource || {};
      gauge('cpu', r.cpu || 0, r.cpu + '%');
      gauge('mem', r.mem_pct || 0, r.mem_used + ' / ' + r.mem_total);
      gauge('disk', r.disk_pct || 0, (r.disk_used || '-') + ' / ' + (r.disk_total || '-'));
      if (!hist.length) hist = [d.active, d.active];
      else { hist.push(d.active); if (hist.length > 30) hist.shift(); }
      spActive.set(hist.slice());
      spToday.set(d.spark || []); spCount.set(d.spark_count || []); spark.set(d.spark || []);
      var sum = (d.spark || []).reduce(function (a, b) { return a + b; }, 0), sn = $('#spark-sum');
      if (sn) { sn.classList.remove('skeleton'); sn.classList.add('skel-done'); K.countUp(sn, sum, true); }
      $('#spark-note').textContent = (d.spark_labels ? d.spark_labels[0] + ' - ' + d.spark_labels[d.spark_labels.length - 1] : '');
      delta(d.income_today, d.yesterday);
      if (sel && !sel.options.length && d.interfaces) {
        d.interfaces.forEach(function (n) { var o = doc.createElement('option'); o.textContent = n; sel.appendChild(o); });
        iface = d.interfaces[0]; sel.value = iface; traffic();
      }
      if (d.profiles) {
        var labels = d.profiles.map(function (x) { return x.name; }), vals = d.profiles.map(function (x) { return x.count; });
        if (!donut) {
          unskel('#card-donut');
          donut = new K.Doughnut($('#donut'), labels, vals, $('#donut-legend'), null, { caption: K.t('users total') || 'users', fmtVal: function (v) { return v; } });
          donut._sig = JSON.stringify(vals);
        } else if (donut._sig !== JSON.stringify(vals)) { donut._sig = JSON.stringify(vals); donut.update(labels, vals); }
      }
      if (d.heat && !heatDone) {
        heatDone = true; unskel('#card-heat');
        K.Heatmap($('#heat'), d.heat, { days: days(), unit: K.t('sales'), label: K.t('Sales heatmap') });
        var best = [0, 0, 0]; d.heat.forEach(function (row, di) { row.forEach(function (v, h) { if (v > best[0]) best = [v, di, h]; }); });
        var byH = [], byD = [], tot = 0; d.heat.forEach(function (row, di) { byD[di] = 0; row.forEach(function (v, h) { byH[h] = (byH[h] || 0) + v; byD[di] += v; tot += v; }); });
        var ph = byH.indexOf(Math.max.apply(null, byH)), pd = byD.indexOf(Math.max.apply(null, byD)), ins = $('#heat-ins');
        if (ins && tot) {
          ins.hidden = false;
          ins.innerHTML = [[K.t('sales'), tot], [K.t('Peak hour'), ('0' + ph).slice(-2) + ':00-' + ('0' + (ph + 1) % 24).slice(-2) + ':00'], [K.t('Busiest day'), days()[pd]]].map(function (x) { return '<div><span>' + K.esc(x[0]) + '</span><b>' + K.esc(x[1]) + '</b></div>'; }).join('');
        }
        if (best[0]) $('#heat-peak').textContent = K.t('Peak') + ': ' + days()[best[1]] + ' ' + ('0' + best[2]).slice(-2) + ':00 (' + best[0] + ')';
      }
      var rs = $('#recent-sales');
      if (rs) {
        rs.innerHTML = (d.recent && d.recent.length) ? '<ul class="feed">' + d.recent.map(function (x) {
          return '<li><span><span class="mono">' + K.esc(x.user) + '</span> <span class="muted">' + K.esc(x.profile) + '</span></span><span class="nowrap"><span class="muted">' + K.esc(x.time) + '</span> &middot; <b>' + K.money(x.price) + '</b></span></li>';
        }).join('') + '</ul>' : '<p class="muted">' + K.esc(K.t('nodata')) + '</p>';
      }
    }
    function load() {
      K.api(K.url('/json/dashboard')).then(function (d) {
        if (!d.ok) { if (!failed) K.toast(d.error || K.t('error'), 'err'); failed = true; return; }
        failed = false; render(d);
      }).catch(function () { /* offline: keep last values */ });
      K.api(K.url('/json/logs')).then(function (d) {
        var el = $('#hs-log'); if (!el || !d.ok) return;
        el.innerHTML = d.data.length ? '<ul class="feed">' + d.data.slice(0, 8).map(function (l) {
          return '<li style="justify-content:flex-start;align-items:flex-start"><span class="t">' + K.esc(l.time) + '</span><span>' + K.esc(l.message) + '</span></li>';
        }).join('') + '</ul>' : '<p class="muted">' + K.esc(K.t('nodata')) + '</p>';
      }).catch(function () { /* ignore */ });
    }
    function traffic() {
      if (!iface || doc.hidden) return;
      K.api(K.url('/json/traffic?interface=' + encodeURIComponent(iface))).then(function (d) {
        if (!d.ok) return;
        unskel('#card-traffic');
        chart.push(Date.now(), [d.rx, d.tx]);
        $('#rx-now').textContent = K.bps(d.rx); $('#tx-now').textContent = K.bps(d.tx);
      }).catch(function () { /* ignore */ });
    }
    if (sel) sel.addEventListener('change', function () { iface = sel.value; chart.data = []; chart.draw(); });
    var rf = $('[data-dash-refresh]'); if (rf) rf.addEventListener('click', function () { load(); K.toast(K.t('Refresh data')); });
    load(); setInterval(function () { if (!doc.hidden) load(); }, poll);
    setInterval(traffic, 2000);
  };

  /* ================= routers ================= */
  P.routers = function () {
    var sel = $('[data-toggle-real]'); if (!sel) return;
    var sync = function () { $$('[data-real]').forEach(function (x) { x.hidden = sel.value === 'demo'; }); };
    sel.addEventListener('change', sync); sync();
    var btn = $('[data-test-conn]'), out = $('#test-out');
    btn.addEventListener('click', function () {
      var form = btn.closest('form'); btn.classList.add('loading');
      K.api(form.dataset.testUrl, new FormData(form)).then(function (d) {
        out.innerHTML = alertBox(d.message || d.error || '?', d.ok ? 'info' : 'err');
      }).catch(function () { out.innerHTML = alertBox(K.t('error'), 'err'); }).then(function () { btn.classList.remove('loading'); });
    });
  };

  /* ================= profiles ================= */
  P.profiles = function () {
    var btn = $('[data-preview-script]'); if (!btn) return;
    btn.addEventListener('click', function () {
      var form = btn.closest('form'), out = $('#script-out');
      K.api(form.dataset.previewUrl, new FormData(form)).then(function (d) {
        out.hidden = false; out.textContent = d.ok ? d.script : d.error;
      });
    });
  };

  /* ================= vouchers ================= */
  P.vouchers = function () {
    var sel = $('#g-prof'); if (!sel) return;
    var meta = {}; try { meta = JSON.parse(sel.dataset.meta || '{}'); } catch (e) { /* ignore */ }
    var info = $('#g-prof-info');
    var show = function () {
      var m = meta[sel.value];
      info.textContent = m ? (m.sprice ? K.money(m.sprice) + ' - ' : '') + 'validity ' + (m.validity || '-') + ' - mode ' + m.mode + (m.lock_user ? ' - lock MAC' : '') : '';
    };
    sel.addEventListener('change', show); show();
  };

  /* ================= voucher templates ================= */
  P.templates = function () {
    var html = $('#tpl-html'), prev = $('#tpl-preview'); if (!html) return;
    var sample = { '{{hotspot}}': 'NextMON WiFi', '{{user}}': 'ab12cd', '{{pass}}': 'ab12cd', '{{price}}': 'Rp 5.000', '{{validity}}': '1d', '{{profile}}': '1Hari', '{{limit}}': '', '{{comment}}': 'vc-123-batch', '{{login_url}}': 'http://hotspot.local/login', '{{qr}}': '<div style="width:70px;height:70px;background:repeating-conic-gradient(#000 0 25%,#fff 0 50%) 0 0/14px 14px"></div>' };
    var render = function () {
      var h = html.value; Object.keys(sample).forEach(function (k) { h = h.split(k).join(sample[k]); });
      prev.srcdoc = h.replace(/<script[\s\S]*?<\/script>/gi, '');
    };
    html.addEventListener('input', render); render();
    $$('[data-tpl-load]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = JSON.parse(b.dataset.tplLoad); $('#tpl-id').value = t.id; $('#tpl-name').value = t.name; html.value = t.html; render(); $('#tpl-name').focus();
      });
    });
    var nw = $('[data-tpl-new]'); if (nw) nw.addEventListener('click', function () { $('#tpl-id').value = ''; $('#tpl-name').value = ''; });
  };

  /* ================= reports ================= */
  P.reports = function () {
    var raw = $('#report-data'); if (!raw) return;
    var d = JSON.parse(raw.textContent); K.currency = d.currency;
    var compact = function (v, axis) { if (!axis) return K.money(v); return v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + 'k' : String(Math.round(v)); };
    new K.BarChart($('#rp-bars'), d.labels, d.values, { fmt: compact });
    new K.Doughnut($('#rp-pie'), d.plabels, d.pvalues, $('#rp-legend'));
    var per = $('[data-period]'), val = $('#rp-value');
    if (per) per.addEventListener('change', function () {
      var t = { day: 'date', month: 'month', year: 'number', all: 'hidden' }[per.value];
      var n = new Date(), p2 = function (x) { return ('0' + x).slice(-2); };
      val.type = t; val.value = { day: n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n.getDate()), month: n.getFullYear() + '-' + p2(n.getMonth() + 1), year: String(n.getFullYear()), all: '' }[per.value];
    });
  };

  /* ================= thermal printing (RawBT intent + Web Bluetooth ESC/POS) ================= */
  var Thermal = {
    data: function () { try { return JSON.parse($('#thermal-data').textContent); } catch (e) { return { hotspot: '', items: [] }; } },
    text: function (d) {
      var w = 32, line = new Array(w + 1).join('-'), out = '';
      var center = function (s) { s = String(s); return s.length >= w ? s : new Array(Math.floor((w - s.length) / 2) + 1).join(' ') + s; };
      d.items.forEach(function (it) {
        out += center(d.hotspot || 'WiFi') + '\n' + line + '\n';
        if (it.pr) out += 'Paket : ' + it.pr + '\n';
        if (it.price) out += 'Harga : ' + it.price + '\n';
        if (it.v) out += 'Aktif : ' + it.v + '\n';
        out += line + '\n';
        if (it.p && it.p !== it.u) out += 'User  : ' + it.u + '\nPass  : ' + it.p + '\n'; else out += 'Kode  : ' + it.u + '\n';
        out += line + '\n\n\n';
      });
      return out.replace(/[^\x20-\x7E\n]/g, '?');
    },
    share: function () {
      var d = Thermal.data(); if (!d.items.length) return;
      var b64 = btoa(Thermal.text(d));
      window.location.href = 'intent:base64,' + b64 + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
    },
    ble: function () {
      var d = Thermal.data();
      if (!d.items.length) return;
      if (!navigator.bluetooth) { K.toast(K.t('Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).'), 'err'); return; }
      var bytes = [0x1B, 0x40];
      var txt = Thermal.text(d);
      for (var i = 0; i < txt.length; i++) bytes.push(txt.charCodeAt(i));
      bytes.push(0x0A, 0x0A, 0x1D, 0x56, 0x00);
      navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0xFFE0, 0xFF00, 0x18F0, '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'] })
        .then(function (dev) { return dev.gatt.connect(); })
        .then(function (srv) { return srv.getPrimaryServices(); })
        .then(function (services) {
          return Promise.all(services.map(function (s) { return s.getCharacteristics().catch(function () { return []; }); })).then(function (lists) {
            var all = [].concat.apply([], lists);
            var ch = all.filter(function (c) { return c.properties.write || c.properties.writeWithoutResponse; })[0];
            if (!ch) throw new Error('No writable characteristic found');
            var chunks = [], pos = 0;
            while (pos < bytes.length) { chunks.push(new Uint8Array(bytes.slice(pos, pos + 100))); pos += 100; }
            return chunks.reduce(function (p, c) {
              return p.then(function () { return ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(c) : ch.writeValue(c); }).then(function () { return new Promise(function (r) { setTimeout(r, 30); }); });
            }, Promise.resolve());
          });
        })
        .then(function () { K.toast('OK'); })
        .catch(function (e) { if (e && e.name !== 'NotFoundError') K.toast(String(e.message || e), 'err'); });
    }
  };
  doc.addEventListener('click', function (e) {
    if (e.target.closest('[data-thermal-share]')) Thermal.share();
    else if (e.target.closest('[data-thermal-ble]')) Thermal.ble();
  });

  /* ================= POS ================= */
  P.pos = function () {
    var box = $('#pos-items'); var last = null;
    var rc = $('#receipt'), dlg = $('#dlg-receipt');
    function receiptHtml(d) {
      return '<div style="text-align:center"><b>' + K.esc(d.hotspot) + '</b><br>' + K.esc(d.time) + '</div><hr>' +
        K.esc(d.profile) + ' &middot; ' + K.esc(d.price) + (d.validity ? ' &middot; ' + K.esc(d.validity) : '') + '<hr>' +
        '<div>User: <b>' + K.esc(d.user) + '</b></div>' + (d.pass !== d.user ? '<div>Pass: <b>' + K.esc(d.pass) + '</b></div>' : '') +
        '<div class="qr" data-qr="' + K.esc(d.url) + '"></div>';
    }
    if (box) box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sell]'); if (!b) return;
      b.classList.add('loading');
      var fd = new FormData(); fd.append('profile', b.dataset.sell);
      K.api(box.dataset.sellUrl, fd).then(function (d) {
        if (!d.ok) { K.toast(d.error || K.t('error'), 'err'); return; }
        last = d; rc.innerHTML = receiptHtml(d); K.renderQR(rc); K.openDialog(dlg);
        $('#thermal-data').textContent = JSON.stringify({ hotspot: d.hotspot, items: [{ u: d.user, p: d.pass, pr: d.profile, price: d.price, v: d.validity }] });
        $('#pos-total').textContent = d.total;
        var ul = $('#pos-list'), em = $('#pos-empty'); if (em) em.remove();
        var li = doc.createElement('li'); li.className = 'row'; li.style.cssText = 'justify-content:space-between;font-size:13px';
        li.innerHTML = '<span><span class="mono">' + K.esc(d.user) + '</span> <span class="muted">' + K.esc(d.profile) + '</span></span><span class="nowrap">' + K.esc(d.time.slice(-5)) + ' &middot; ' + K.esc(d.price) + '</span>';
        ul.insertBefore(li, ul.firstChild);
      }).catch(function () { K.toast(K.t('error'), 'err'); }).then(function () { b.classList.remove('loading'); });
    });
    doc.addEventListener('click', function (e) {
      if (e.target.closest('[data-copy-voucher]') && last && navigator.clipboard) navigator.clipboard.writeText(last.user + (last.pass !== last.user ? ' / ' + last.pass : '')).then(function () { K.toast(K.t('copied')); });
      if (e.target.closest('[data-print-receipt]')) {
        var w = window.open('', '_blank', 'width=360,height=640'); if (!w) { K.toast(K.t('Popup blocked'), 'err'); return; }
        w.document.write('<!doctype html><title>Receipt</title><style>body{font:12px/1.4 monospace;width:58mm;margin:0;padding:4px}hr{border:0;border-top:1px dashed #000}.qr{width:34mm;margin:6px auto}.qr svg{width:100%;height:auto}</style>' + rc.innerHTML);
        w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 150);
      }
    });

    // QR scanner via BarcodeDetector
    var scanDlg = $('#dlg-scan'), video = $('#scan-video'), msg = $('#scan-msg'), stream = null, stop = false;
    function stopScan() { stop = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (scanDlg) scanDlg.addEventListener('close', stopScan);
    doc.addEventListener('click', function (e) {
      if (!e.target.closest('[data-scan-open]')) return;
      K.openDialog(scanDlg); stop = false;
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { msg.textContent = K.t('BarcodeDetector / camera not supported in this browser. Use Chrome on Android or desktop (HTTPS).'); return; }
      var det = new BarcodeDetector({ formats: ['qr_code'] });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
        stream = s; video.srcObject = s; video.play(); msg.textContent = '...';
        (function tick() {
          if (stop) return;
          det.detect(video).then(function (codes) {
            if (codes.length) {
              var v = codes[0].rawValue, user = v;
              try { var u = new URL(v); user = u.searchParams.get('username') || v; } catch (x) { /* plain text code */ }
              stopScan(); scanDlg.close(); location.href = K.url('/hotspot/users?q=' + encodeURIComponent(user));
            } else setTimeout(tick, 250);
          }).catch(function () { setTimeout(tick, 400); });
        })();
      }).catch(function (err) { msg.textContent = String(err.message || err); });
    });
  };

  /* ================= tools ================= */
  P.tools = function () {
    var box = $('#tools'); if (!box) return;
    var out = $('#tool-out');
    var renderers = {
      ping: function (d) {
        var last = d.rows[d.rows.length - 1] || {};
        return '<p class="muted" style="margin-bottom:8px">' + K.t('Sent') + ' ' + K.esc(last.sent || 0) + ' &middot; ' + K.t('received') + ' ' + K.esc(last.received || 0) + ' &middot; ' + K.t('loss') + ' ' + K.esc(last['packet-loss'] || 0) + '%</p>' +
          table([{ h: '#', k: 'seq' }, { h: K.t('Host'), k: 'host' }, { h: K.t('Time'), f: function (r) { return r.time || r.status || K.t('timeout'); }, num: 1 }, { h: K.t('TTL'), k: 'ttl', num: 1 }, { h: K.t('Size'), k: 'size', num: 1 }], d.rows);
      },
      traceroute: function (d) { return table([{ h: K.t('Hop'), f: function (r, i) { return r.hop || ''; } }, { h: K.t('Address'), k: 'address' }, { h: K.t('Loss %'), k: 'loss', num: 1 }, { h: K.t('Last'), k: 'last', num: 1 }, { h: K.t('Avg'), k: 'avg', num: 1 }, { h: K.t('Best'), k: 'best', num: 1 }, { h: K.t('Worst'), k: 'worst', num: 1 }], d.rows); },
      torch: function (d) { return table([{ h: K.t('Source'), k: 'src-address' }, { h: K.t('Destination'), k: 'dst-address' }, { h: K.t('Proto'), k: 'ip-protocol' }, { h: K.t('Port'), k: 'dst-port' }, { h: K.t('TX'), f: function (r) { return K.bps(r.tx); }, num: 1 }, { h: K.t('RX'), f: function (r) { return K.bps(r.rx); }, num: 1 }], d.rows); },
      logs: function (d) { return table([{ h: K.t('Time'), k: 'time' }, { h: K.t('Topics'), k: 'topics' }, { h: K.t('Message'), k: 'message' }], d.rows); },
      health: function (d) {
        var r = d.resource || {}, h = d.health || {}, tot = +r['total-memory'] || 1, free = +r['free-memory'] || 0, pct = Math.round(100 * (tot - free) / tot);
        var kv = [[K.t('Identity'), d.identity], [K.t('Board'), r['board-name']], [K.t('RouterOS'), r.version], [K.t('Uptime'), r.uptime], [K.t('CPU load'), (r['cpu-load'] || 0) + '%'], [K.t('Memory'), pct + '%'],
          [K.t('Temperature'), h.temperature ? h.temperature + ' C' : '-'], [K.t('CPU temperature'), h['cpu-temperature'] ? h['cpu-temperature'] + ' C' : '-'], [K.t('Voltage'), h.voltage ? h.voltage + ' V' : '-']];
        return '<dl class="kv" style="max-width:520px">' + kv.map(function (x) { return '<dt>' + K.esc(x[0]) + '</dt><dd class="mono">' + K.esc(x[1] == null ? '-' : x[1]) + '</dd>'; }).join('') + '</dl>';
      }
    };
    doc.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-tool]'); if (!f) return;
      e.preventDefault();
      var tool = f.dataset.tool, btn = e.submitter || $('button', f), fd = new FormData(f); fd.append('tool', tool);
      btn.classList.add('loading'); out.innerHTML = '<div class="skeleton" style="height:96px"></div>';
      K.api(box.dataset.runUrl, fd).then(function (d) {
        out.innerHTML = d.ok ? renderers[tool](d) : alertBox(d.error || K.t('error'), 'err');
      }).catch(function () { out.innerHTML = alertBox(K.t('error'), 'err'); }).then(function () { btn.classList.remove('loading'); });
    });
  };

  /* ---- activate ---- */
  if (P[page]) P[page]();
  if (page === 'vouchers' && $('#tpl-html')) P.templates();
})();
