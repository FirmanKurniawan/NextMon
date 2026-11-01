/* NextMON (Next.js edition) - live traffic page. One EventSource per page on /api/stream/traffic (the server shares a single
 * upstream per router/interface between all browsers). Draws RX/TX with the shared K.LineChart. */
(function () {
  'use strict';
  var K = window.NextMON;
  var box = document.getElementById('traffic-page');
  if (!K || !box || !K.LineChart) return;
  var chart = new K.LineChart(document.getElementById('traffic'), { series: [{ name: 'RX', color: '--chart-1' }, { name: 'TX', color: '--chart-3' }], max: 120, fmt: K.bps });
  var rx = document.getElementById('rx-now');
  var tx = document.getElementById('tx-now');
  var pk = document.getElementById('peak-now');
  var st = document.getElementById('tr-state');
  var sel = document.getElementById('if-sel');
  var peak = 0;
  var es = null;

  function state(msg) { if (st) st.textContent = msg ? '· ' + msg : ''; }
  function close() { if (es) { es.close(); es = null; } }
  function open(iface) {
    close();
    chart.data = []; chart.draw(); peak = 0;
    rx.textContent = tx.textContent = pk.textContent = '-';
    if (!window.EventSource) { state(K.t('error')); return; }
    state(K.t('Connecting...'));
    es = new EventSource(K.url('/api/stream/traffic?interface=' + encodeURIComponent(iface)));
    es.addEventListener('sample', function (e) {
      var s; try { s = JSON.parse(e.data); } catch (x) { return; }
      state(K.t('Live'));
      chart.push(s.t, [s.rx, s.tx]);
      rx.textContent = K.bps(s.rx); tx.textContent = K.bps(s.tx);
      peak = Math.max(peak, s.rx, s.tx); pk.textContent = K.bps(peak);
    });
    es.addEventListener('status', function (e) {
      var d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (d.state === 'reconnecting') state(K.t('Reconnecting...'));
      else if (d.state === 'error') state(d.error || K.t('error'));
    });
  }
  sel.addEventListener('change', function () {
    history.replaceState(null, '', '?interface=' + encodeURIComponent(sel.value));
    open(sel.value);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) close(); else open(sel.value); });
  window.addEventListener('pagehide', close);
  open(sel.value);
})();
