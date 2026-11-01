/* NextMON service worker. `BASE` is prepended by the PHP route /sw.js.
   Rules (privacy): HTML pages, JSON, API and any POST are NEVER cached. Only versioned static files under /assets/ and the public
   static offline page are cached, so nothing user- or role-specific can leak from one user to another on a shared device.
   Static assets: stale-while-revalidate. Navigations: network-only, offline.html fallback when the network fails.
   Updates: a new worker waits; the page shows a toast and posts SKIP_WAITING when the user accepts. */
const VERSION = 'nextmon-v3';
const OFFLINE = BASE + '/offline.html';
const ASSETS = ['/assets/css/app.css', '/assets/js/theme.js', '/assets/js/app.js', '/assets/js/charts.js', '/assets/js/qr.js', '/assets/js/pages.js',
  '/assets/js/offline.js', '/assets/icon.svg', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png'].map(p => BASE + p);

// drop older builds of the same asset (dist/<name>.<hash>.<ext> or <file>?v=<mtime>) so the cache does not grow with every release
async function prune(c, url) {
  try {
    const u = new URL(url); const key = u.pathname.replace(/.[0-9a-f]{10}.(css|js)$/, '.$1');
    for (const k of await c.keys()) {
      const o = new URL(k.url);
      if (o.href !== u.href && o.pathname.replace(/.[0-9a-f]{10}.(css|js)$/, '.$1') === key && (o.pathname !== u.pathname || o.search !== u.search) && o.pathname.indexOf('/assets/') >= 0) await c.delete(k);
    }
  } catch (err) { /* ignore */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.add(new Request(OFFLINE, { cache: 'reload' })); // required: public static page (no redirect, no auth)
    // best-effort: one missing asset must not abort installation
    await Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // best-effort: also precache the content-hashed build (assets/dist) listed in its manifest, so the next page loads from cache
    try {
      const mr = await fetch(BASE + '/assets/dist/manifest.json', { cache: 'no-cache' });
      const man = mr.ok ? await mr.json() : {};
      await Promise.all(Object.keys(man).map(k => c.add(new Request(BASE + '/assets/dist/' + man[k].f)).catch(() => {})));
    } catch (err) { /* no build present: sources are cached on first use */ }
  }));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range') || req.headers.has('authorization')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname.slice(BASE.length);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then(r => r || Response.error())));
    return;
  }
  if (path.startsWith('/assets/')) {
    const hashed = path.startsWith('/assets/dist/') && !path.endsWith('manifest.json'); // content-hashed name: immutable, cache-first
    e.respondWith(caches.match(req).then(hit => {
      if (hit && hashed) return hit;
      const net = fetch(req).then(res => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy).then(() => prune(c, req.url))).catch(() => {}); }
        return res;
      });
      return hit || net;
    }));
  }
  // everything else (json, api, status, print, downloads): untouched, straight to the network
});
