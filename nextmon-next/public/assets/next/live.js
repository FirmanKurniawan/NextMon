/* NextMON (Next.js edition) - realtime adapter for the shared pages.js.
 *
 * pages.js polls K.api('/json/traffic?interface=X') every 2 s (that is all the PHP edition can do: php -S is single threaded).
 * Here the server keeps ONE streaming `/interface/monitor-traffic` subscription per router/interface and pushes every sample over
 * Server-Sent Events (/api/stream/traffic), shared by all browsers. This adapter answers those poll calls from the SSE feed, so
 * pages.js stays untouched and never opens a second upstream. Falls back to the one-shot endpoint when EventSource is missing or
 * the stream has not delivered yet. The stream is closed while the tab is hidden and when the page is left.
 */
(function () {
  'use strict';
  var K = window.NextMON;
  if (!K || !K.api || !window.EventSource) return;
  var orig = K.api;
  var cur = null; // { iface, es, last, served }

  function close() {
    if (cur && cur.es) cur.es.close();
    cur = null;
  }
  function open(iface) {
    if (cur && cur.iface === iface && cur.es) return cur;
    close();
    var s = (cur = { iface: iface, es: null, last: null, served: 0, state: 'live' });
    var es = (s.es = new EventSource(K.url('/api/stream/traffic?interface=' + encodeURIComponent(iface))));
    es.addEventListener('sample', function (e) {
      try { s.last = JSON.parse(e.data); } catch (err) { /* ignore */ }
    });
    es.addEventListener('status', function (e) {
      try { s.state = JSON.parse(e.data).state; } catch (err) { /* ignore */ }
    });
    // EventSource reconnects by itself (server sends retry: 3000); a 401/403 closes it for good
    return s;
  }

  K.api = function (url, data) {
    if (!data && typeof url === 'string') {
      var m = /\/json\/traffic\?interface=([^&]+)/.exec(url);
      if (m) {
        var s = open(decodeURIComponent(m[1]));
        if (s.last && Date.now() - s.last.t < 8000) {
          if (s.served === s.last.t) return Promise.resolve({ ok: false }); // nothing new since the previous poll
          s.served = s.last.t;
          return Promise.resolve({ ok: true, t: Math.floor(s.last.t / 1000), rx: s.last.rx, tx: s.last.tx, live: true });
        }
        if (!s.last && s.es.readyState !== 2) return Promise.resolve({ ok: false }); // first sample is on its way
        return orig.call(this, url); // stream broken or stale: one-shot fallback
      }
    }
    return orig.apply(this, arguments);
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) close();
  });
  window.addEventListener('pagehide', close);
})();
