/* NextMON charts, no deps, theme/accent aware, DPR aware:
   Canvas: LineChart (area, crosshair, hover dots, tooltip), BarChart, Doughnut (hover + centre label), Spark (live mini).
   DOM/SVG: gauge() radial gauge, Heatmap (weekday x hour). Palette = CSS vars --chart-1..6 (chart-1 follows the accent). */
(function () {
  'use strict';
  var K = window.NextMON = window.NextMON || {};
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; };
  var FONT = '11px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
  var FONT_B = '600 11px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');

  function rgba(c, a) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (m) { var h = m[1]; if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')'; }
    m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) { var p = m[1].split(',').map(function (x) { return parseFloat(x); }); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
    return c;
  }
  K.rgba = rgba;
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function setup(canvas) {
    var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    var w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function tip(ctx, x, y, w, h, lines) {
    ctx.font = FONT;
    var tw = 0; lines.forEach(function (l) { tw = Math.max(tw, ctx.measureText(l.text).width + (l.color ? 14 : 0)); });
    var bw = tw + 18, bh = lines.length * 17 + 10;
    var bx = x + 14 + bw > w - 4 ? x - 14 - bw : x + 14; bx = Math.max(4, bx);
    var by = Math.min(Math.max(4, y - bh / 2), h - bh - 4);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillStyle = css('--surface-modal'); rr(ctx, bx, by, bw, bh, 7); ctx.fill(); ctx.restore();
    ctx.strokeStyle = css('--border-strong'); ctx.lineWidth = 1; rr(ctx, bx + .5, by + .5, bw - 1, bh - 1, 7); ctx.stroke();
    lines.forEach(function (l, i) {
      var ty = by + 18 + i * 17, tx = bx + 9;
      if (l.color) { ctx.fillStyle = l.color; rr(ctx, tx, ty - 8, 8, 8, 2); ctx.fill(); tx += 14; }
      ctx.fillStyle = l.color || css('--muted'); ctx.fillStyle = i === 0 && !l.color ? css('--muted') : css('--text'); ctx.font = i === 0 && !l.color ? FONT : FONT_B; ctx.textAlign = 'left'; ctx.fillText(l.text, tx, ty);
    });
  }
  function observe(canvas, draw) {
    if (window.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(canvas.parentNode);
    document.addEventListener('nextmon:theme', draw);
    document.addEventListener('nextmon:resize', draw);
    if (window.matchMedia) { var m = matchMedia('(prefers-color-scheme: dark)'); if (m.addEventListener) m.addEventListener('change', draw); }
  }
  function ease(p) { return 1 - Math.pow(1 - p, 3); }
  /* run draw(progress 0..1) once as an entrance animation */
  function intro(self, ms) {
    self._p = reduce ? 1 : 0;
    if (reduce) return;
    var t0 = performance.now();
    (function step(now) { self._p = Math.min(1, (now - t0) / ms); self.draw(); if (self._p < 1) requestAnimationFrame(step); })(t0);
  }
  function smooth(ctx, pts, first) {
    if (pts.length < 2) return;
    if (first !== false) ctx.moveTo(pts[0][0], pts[0][1]); else ctx.lineTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = .18;
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
    }
  }

  /* ---- Area/line chart (rolling window, crosshair) ---- */
  K.LineChart = function (canvas, o) {
    var self = this; o = o || {};
    self.series = o.series || []; self.max = o.max || 60; self.fmt = o.fmt || String; self.data = []; self.hover = -1;
    var L = 58, R = 12, T = 12, B = 22;
    self.push = function (t, vals) { self.data.push({ t: t, v: vals }); if (self.data.length > self.max) self.data.shift(); self.draw(); };
    self.draw = function () {
      var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
      var pw = w - L - R, ph = h - T - B, n = self.data.length;
      var mx = 0; self.data.forEach(function (d) { d.v.forEach(function (v) { if (v > mx) mx = v; }); });
      mx = niceMax(Math.max(mx * 1.12, 1000));
      ctx.font = FONT; ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.textAlign = 'right';
      for (var i = 0; i <= 4; i++) {
        var y = Math.round(T + ph - ph * i / 4) + .5;
        ctx.strokeStyle = css('--grid'); ctx.setLineDash(i ? [3, 4] : []); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText(self.fmt(mx * i / 4), L - 8, y + 4);
      }
      if (n < 2) { ctx.textAlign = 'center'; ctx.fillText('...', L + pw / 2, T + ph / 2); return; }
      var x0 = function (i) { return L + pw * (i + (self.max - n)) / (self.max - 1); };
      var yv = function (v) { return T + ph - ph * Math.min(1, v / mx); };
      self.series.forEach(function (sr, si) {
        var col = css(sr.color), pts = self.data.map(function (d, i) { return [x0(i), yv(d.v[si])]; });
        var g = ctx.createLinearGradient(0, T, 0, T + ph); g.addColorStop(0, rgba(col, si ? .16 : .30)); g.addColorStop(1, rgba(col, 0));
        ctx.beginPath(); smooth(ctx, pts); ctx.lineTo(pts[n - 1][0], T + ph); ctx.lineTo(pts[0][0], T + ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); smooth(ctx, pts); ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        var last = pts[n - 1]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(last[0], last[1], 2.6, 0, 7); ctx.fill();
      });
      var tf = function (t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); };
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.fillText(tf(self.data[0].t), L, h - 6); ctx.textAlign = 'right'; ctx.fillText(tf(self.data[n - 1].t), w - R, h - 6);
      if (self.hover >= 0 && self.hover < n) {
        var d = self.data[self.hover], hx = Math.round(x0(self.hover)) + .5;
        var cg = ctx.createLinearGradient(0, T, 0, T + ph); cg.addColorStop(0, rgba(css('--text'), .0)); cg.addColorStop(.5, rgba(css('--text'), .35)); cg.addColorStop(1, rgba(css('--text'), .0));
        ctx.strokeStyle = cg; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, T + ph); ctx.stroke();
        self.series.forEach(function (sr, si) {
          var col = css(sr.color), hy = yv(d.v[si]);
          ctx.fillStyle = css('--surface-solid'); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, 7); ctx.fill(); ctx.stroke();
        });
        tip(ctx, hx, T + ph / 3, w, h, [{ text: tf(d.t), color: null }].concat(self.series.map(function (sr, si) { return { text: sr.name + '  ' + self.fmt(d.v[si]), color: css(sr.color) }; })));
      }
    };
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), n = self.data.length; if (n < 2) return;
      var pw = r.width - L - R, rel = (e.clientX - r.left - L) / pw * (self.max - 1) - (self.max - n);
      self.hover = Math.max(0, Math.min(n - 1, Math.round(rel))); self.draw();
    });
    canvas.addEventListener('pointerleave', function () { self.hover = -1; self.draw(); });
    observe(canvas, self.draw); self.draw();
  };

  /* ---- Bar chart ---- */
  K.BarChart = function (canvas, labels, values, o) {
    var self = this; o = o || {}; self.hover = -1; var fmt = o.fmt || String;
    function geom(s) { var L = 56, R = 8, T = 12, B = 24; return { L: L, R: R, T: T, B: B, pw: s.w - L - R, ph: s.h - T - B }; }
    self.draw = function () {
      var s = setup(canvas), ctx = s.ctx, g = geom(s), n = values.length, p = ease(self._p == null ? 1 : self._p);
      var mx = niceMax(Math.max.apply(null, values.concat([1])) * 1.05);
      ctx.font = FONT; ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.textAlign = 'right';
      for (var i = 0; i <= 4; i++) {
        var y = Math.round(g.T + g.ph - g.ph * i / 4) + .5;
        ctx.strokeStyle = css('--grid'); ctx.setLineDash(i ? [3, 4] : []); ctx.beginPath(); ctx.moveTo(g.L, y); ctx.lineTo(s.w - g.R, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText(fmt(mx * i / 4, true), g.L - 8, y + 4);
      }
      if (!n) { ctx.textAlign = 'center'; ctx.fillText(K.t('nodata'), g.L + g.pw / 2, g.T + g.ph / 2); return; }
      var slot = g.pw / n, bw = Math.max(2, Math.min(30, slot * .62)), col = css('--chart-1'), every = Math.ceil(n / Math.max(1, Math.floor(g.pw / 46)));
      ctx.textAlign = 'center';
      values.forEach(function (v, i) {
        var bh = Math.max(v > 0 ? 2 : 0, g.ph * v / mx * p), x = g.L + slot * i + (slot - bw) / 2, y = g.T + g.ph - bh, on = i === self.hover;
        var gr = ctx.createLinearGradient(0, y, 0, g.T + g.ph); gr.addColorStop(0, rgba(col, on ? 1 : .92)); gr.addColorStop(1, rgba(col, on ? .55 : .35));
        ctx.globalAlpha = self.hover >= 0 && !on ? .5 : 1; ctx.fillStyle = gr; rr(ctx, x, y, bw, bh, [4, 4, 1, 1]); ctx.fill(); ctx.globalAlpha = 1;
        if (i % every === 0) { ctx.fillStyle = css('--muted'); ctx.fillText(String(labels[i]).slice(-5).replace(/^(\d{2})-(\d{2})$/, '$2/$1'), x + bw / 2, s.h - 7); }
      });
      if (self.hover >= 0) {
        var hx = g.L + slot * self.hover + slot / 2;
        tip(ctx, hx, g.T + g.ph / 3, s.w, s.h, [{ text: labels[self.hover], color: null }, { text: fmt(values[self.hover]), color: col }]);
      }
    };
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), n = values.length; if (!n) return;
      var slot = (r.width - 64) / n, i = Math.floor((e.clientX - r.left - 56) / slot);
      var h = i >= 0 && i < n ? i : -1; if (h !== self.hover) { self.hover = h; self.draw(); }
    });
    canvas.addEventListener('pointerleave', function () { self.hover = -1; self.draw(); });
    observe(canvas, self.draw); intro(self, 600); self.draw();
  };

  /* ---- Doughnut (hover segment, centre total) ---- */
  K.Doughnut = function (canvas, labels, values, legendEl, fmt, o) {
    var self = this, pal = ['--chart-1', '--chart-3', '--chart-2', '--chart-5', '--chart-6', '--chart-4']; o = o || {};
    var total = values.reduce(function (a, b) { return a + b; }, 0); self.hover = -1;
    var seg = [];   // {a0,a1} angles for hit-testing
    self.draw = function () {
      var s = setup(canvas), ctx = s.ctx, cx = s.w / 2, cy = s.h / 2, R = Math.min(cx, cy) - 8, p = ease(self._p == null ? 1 : self._p);
      ctx.font = FONT;
      if (!total) { ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.fillText(K.t('nodata'), cx, cy); return; }
      var a = -Math.PI / 2; seg = [];
      values.forEach(function (v, i) {
        var d = v / total * Math.PI * 2 * p, on = i === self.hover, ro = R + (on ? 4 : 0), ri = R * .64;
        seg.push({ a0: a, a1: a + v / total * Math.PI * 2 });
        ctx.beginPath(); ctx.arc(cx, cy, ro, a + .015, a + d - .015); ctx.arc(cx, cy, ri, a + d - .015, a + .015, true); ctx.closePath();
        ctx.globalAlpha = self.hover >= 0 && !on ? .45 : 1; ctx.fillStyle = css(pal[i % pal.length]); ctx.fill(); ctx.globalAlpha = 1;
        a += v / total * Math.PI * 2 * p;
      });
      var hv = self.hover >= 0 ? self.hover : -1;
      ctx.textAlign = 'center'; ctx.fillStyle = css('--text'); ctx.font = '650 ' + Math.round(R * .3) + 'px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      ctx.fillText(hv >= 0 ? Math.round(values[hv] / total * 100) + '%' : (o.fmtTotal ? o.fmtTotal(total) : total.toLocaleString()), cx, cy + R * .06);
      ctx.fillStyle = css('--muted'); ctx.font = FONT; ctx.fillText(hv >= 0 ? String(labels[hv]).slice(0, 14) : (o.caption || ''), cx, cy + R * .3);
    };
    function setHover(i) {
      if (i === self.hover) return; self.hover = i; self.draw();
      if (legendEl) Array.prototype.forEach.call(legendEl.children, function (c, k) { c.classList.toggle('on', k === i); });
    }
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2, d = Math.sqrt(x * x + y * y), R = Math.min(r.width, r.height) / 2 - 8;
      if (d < R * .6 || d > R + 8 || !total) { setHover(-1); return; }
      var ang = Math.atan2(y, x); if (ang < -Math.PI / 2) ang += Math.PI * 2;
      var idx = -1; seg.forEach(function (sg, i) { if (ang >= sg.a0 && ang < sg.a1) idx = i; }); setHover(idx);
    });
    canvas.addEventListener('pointerleave', function () { setHover(-1); });
    var list = legendEl && legendEl.classList.contains('legend-list');
    function legend() {
      if (!legendEl) return;
      legendEl.innerHTML = labels.map(function (l, i) {
        var pct = Math.round(values[i] / (total || 1) * 100);
        return list ? '<div data-i="' + i + '"><i style="background:var(' + pal[i % pal.length] + ')"></i><span>' + K.esc(l) + '</span><span>' + (o.fmtVal ? o.fmtVal(values[i]) + ' &middot; ' : '') + pct + '%</span></div>'
          : '<span><i style="background:var(' + pal[i % pal.length] + ')"></i>' + K.esc(l) + ' ' + pct + '%</span>';
      }).join('');
    }
    if (legendEl && list) {
      legendEl.addEventListener('pointerover', function (e) { var d = e.target.closest('[data-i]'); if (d) setHover(+d.dataset.i); });
      legendEl.addEventListener('pointerleave', function () { setHover(-1); });
    }
    self.update = function (l, v) { labels = l; values = v; total = v.reduce(function (a, b) { return a + b; }, 0); self.hover = -1; legend(); self.draw(); };
    legend();
    observe(canvas, self.draw); intro(self, 800); self.draw();
  };

  /* ---- Sparkline (live): K.Spark(canvas, values, {color, fill}) ---- */
  K.Spark = function (canvas, values, o) {
    var self = this; o = o || {}; self.hover = -1;
    self.set = function (v) { values = v; self.draw(); };
    self.push = function (v, max) { values.push(v); if (values.length > (max || 30)) values.shift(); self.draw(); };
    self.draw = function () {
      var s = setup(canvas), ctx = s.ctx, n = values.length; if (n < 2) return;
      var mx = Math.max.apply(null, values.concat([1])), mn = o.zero === false ? Math.min.apply(null, values) : 0, p = 8, top = 8;
      var rng = mx - mn || 1, prog = ease(self._p == null ? 1 : self._p);
      var X = function (i) { return p + (s.w - 2 * p) * i / (n - 1); }, Y = function (v) { return s.h - 7 - (s.h - 7 - top) * (v - mn) / rng; };
      var col = css(o.color || '--chart-1'), pts = values.map(function (v, i) { return [X(i), Y(v)]; });
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, s.w * prog, s.h); ctx.clip();
      var g = ctx.createLinearGradient(0, 0, 0, s.h); g.addColorStop(0, rgba(col, .32)); g.addColorStop(1, rgba(col, 0));
      ctx.beginPath(); smooth(ctx, pts); ctx.lineTo(pts[n - 1][0], s.h); ctx.lineTo(pts[0][0], s.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); smooth(ctx, pts); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
      var lp = self.hover >= 0 ? pts[self.hover] : pts[n - 1];
      if (prog >= 1) { ctx.fillStyle = css('--surface-solid'); ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(lp[0], lp[1], 3, 0, 7); ctx.fill(); ctx.stroke(); }
    };
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), n = values.length; if (n < 2) return;
      var i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - 4) / (r.width - 8) * (n - 1)))); if (i !== self.hover) { self.hover = i; self.draw(); if (o.onHover) o.onHover(i, values[i], e); }
    });
    canvas.addEventListener('pointerleave', function () { self.hover = -1; self.draw(); if (o.onHover) o.onHover(-1); });
    observe(canvas, self.draw); intro(self, 700); self.draw();
  };

  /* ---- Radial gauge (SVG). K.gauge(el, pct, {unit}) creates once, then animates to the new value ---- */
  K.gauge = function (el, pct, o) {
    o = o || {}; pct = Math.max(0, Math.min(100, Number(pct) || 0));
    var C = 2 * Math.PI * 40, arc = C * .75;
    if (!el._g) {
      el.innerHTML = '<svg viewBox="0 0 100 100" role="img" aria-label="' + K.esc(o.label || '') + '"><circle class="g-bg" cx="50" cy="50" r="40" stroke-dasharray="' + arc + ' ' + C + '" transform="rotate(135 50 50)"/>' +
        '<circle class="g-fg" cx="50" cy="50" r="40" stroke-dasharray="' + arc + ' ' + C + '" stroke-dashoffset="' + arc + '" transform="rotate(135 50 50)"/>' +
        '<text class="g-val" x="50" y="55">0</text><text class="g-unit" x="50" y="70">' + K.esc(o.unit || '%') + '</text></svg>';
      el._g = { fg: el.querySelector('.g-fg'), val: el.querySelector('.g-val'), svg: el.querySelector('svg') };
      el._g.fg.getBoundingClientRect();   // commit the start state so the transition runs
    }
    var host = el.closest('.gauge') || el; host.classList.toggle('warn', pct > 75 && pct <= 90); host.classList.toggle('err', pct > 90);
    el._g.fg.style.strokeDashoffset = arc * (1 - pct / 100);
    if (o.label) el._g.svg.setAttribute('aria-label', o.label + ' ' + pct + '%');
    var from = Number(el._g.val.textContent) || 0, t0 = performance.now();
    if (reduce) { el._g.val.textContent = Math.round(pct); return; }
    (function step(now) { var p = Math.min(1, (now - t0) / 800); el._g.val.textContent = Math.round(from + (pct - from) * ease(p)); if (p < 1) requestAnimationFrame(step); })(t0);
  };

  /* ---- Heatmap: K.Heatmap(el, matrix[7][24], {days:[..7 labels], unit:'sales'}) ---- */
  K.Heatmap = function (el, m, o) {
    o = o || {};
    var days = o.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], mx = 0;
    m.forEach(function (r) { r.forEach(function (v) { if (v > mx) mx = v; }); });
    var lvl = function (v) { if (!v || !mx) return 0; var r = v / mx; return r > .75 ? 4 : r > .5 ? 3 : r > .25 ? 2 : 1; };
    var h = '<span></span>';
    for (var x = 0; x < 24; x++) h += '<span class="h-x">' + (x % 3 === 0 ? x : '') + '</span>';
    m.forEach(function (r, d) {
      h += '<span class="h-d">' + K.esc(days[d]) + '</span>';
      r.forEach(function (v, hr) { h += '<i class="h-c" data-l="' + lvl(v) + '" data-d="' + d + '" data-h="' + hr + '" data-v="' + v + '"></i>'; });
    });
    el.classList.add('heat'); el.innerHTML = h; el.setAttribute('role', 'img'); el.setAttribute('aria-label', o.label || '');
    var tipEl = null;
    el.addEventListener('pointerover', function (e) {
      var c = e.target.closest('.h-c'); if (!c) return;
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; document.body.appendChild(tipEl); }
      var r = c.getBoundingClientRect(), hr = +c.dataset.h;
      tipEl.textContent = days[+c.dataset.d] + ' ' + ('0' + hr).slice(-2) + ':00 - ' + c.dataset.v + ' ' + (o.unit || ''); tipEl.style.left = (r.left + r.width / 2) + 'px'; tipEl.style.top = r.top + 'px';
    });
    el.addEventListener('pointerleave', function () { if (tipEl) { tipEl.remove(); tipEl = null; } });
  };
})();
