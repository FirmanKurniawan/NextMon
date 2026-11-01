// Node harness for public/assets/js/sw.js (the Browser pane here cannot register service workers).  node tests/sw_test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = 'const BASE="/k";\n' + fs.readFileSync(__dirname + '/../public/assets/js/sw.js', 'utf8');
const store = {}; const handlers = {}; const fetched = []; let online = true; let skipped = false;
class Req { constructor(u, o = {}) { this.url = new URL(u, 'http://h').href; this.method = o.method || 'GET'; this.mode = o.mode || 'no-cors'; this.headers = new Map(Object.entries(o.headers || {})); this.headers.has = k => [...this.headers.keys()].some(x => x.toLowerCase() === k); } }
const mkRes = (u, ok = true) => ({ ok, type: 'basic', url: u, clone() { return this; } });
const caches = {
  async open(n) { store[n] = store[n] || {}; return { async add(r) { const u = r.url || r; const res = await ctx.fetch(r); if (!res.ok) throw new Error('bad ' + u); store[n][u] = res; }, async put(r, res) { store[n][r.url] = res; }, async keys() { return Object.keys(store[n]).map(url => ({ url })); } }; },
  async match(r) { const u = r.url || new Req(r).url; for (const n in store) if (store[n][u]) return store[n][u]; },
  async keys() { return Object.keys(store); }, async delete(k) { delete store[k]; return true; },
};
const ctx = { URL, Response: { error: () => ({ error: true }) }, Request: Req, caches, location: { origin: 'http://h' }, self: { addEventListener: (t, f) => handlers[t] = f, skipWaiting: () => skipped = true, clients: { claim() {} } },
  fetch: async (r) => { const u = r.url || r; fetched.push(u); if (!online) throw new Error('offline'); return mkRes(u, !/missing/.test(u)); } };
vm.createContext(ctx); vm.runInContext(src, ctx);
const wait = async (ev) => { let p; ev.waitUntil = x => p = x; return p; };
(async () => {
  const inst = { waitUntil: null }; let p; inst.waitUntil = x => p = x; handlers.install(inst); await p;
  assert(store['nextmon-v3']['http://h/k/offline.html'], 'offline page precached');
  assert(!Object.keys(store['nextmon-v3']).some(u => /\/(offline|login)$/.test(u)), 'no redirecting routes precached');
  const respond = async (req) => { let r; handlers.fetch({ request: req, respondWith: x => r = x }); return r && await r; };
  assert.strictEqual(await respond(new Req('/k/vouchers', { method: 'POST' })), undefined, 'POST untouched');
  assert.strictEqual(await respond(new Req('/k/json/active')), undefined, 'json untouched');
  assert.strictEqual(await respond(new Req('/k/hotspot/users', { headers: { Authorization: 'x' } })), undefined);
  online = true; await respond(new Req('/k/hotspot/users', { mode: 'navigate' }));
  assert(!Object.keys(store['nextmon-v3']).some(u => /hotspot\/users/.test(u)), 'HTML navigation never stored');
  online = false; const off = await respond(new Req('/k/hotspot/users', { mode: 'navigate' }));
  assert.strictEqual(off, store['nextmon-v3']['http://h/k/offline.html'], 'offline fallback');
  online = true; await respond(new Req('/k/assets/css/new.css'));
  assert(store['nextmon-v3']['http://h/k/assets/css/new.css'], 'static asset cached');
  handlers.message({ data: 'SKIP_WAITING' }); assert(skipped);
  console.log('sw_test: ok');
})().catch(e => { console.error(e); process.exit(1); });
