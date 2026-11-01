// Dev helper (NOT uploaded to the router): renders the hotspot pages with sample RouterOS variables so they can be
// previewed in a normal browser, and checks that every $(if ...) has a matching $(endif).
//   node tools/preview-render.js [outDir] [scenario]
//   scenarios: fresh (default) | error | chap | trial
// Then serve outDir (e.g. `python -m http.server 8080 -d outDir`) and open /login.html, /status.html, ...
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'hs-preview'));
const scenario = process.argv[3] || 'fresh';

const base = {
  'link-login': 'login.html', 'link-login-only': 'login.html', 'link-status': 'status.html', 'link-logout': 'logout.html',
  'link-orig': 'http://example.com/', 'link-orig-esc': 'http%3A%2F%2Fexample.com%2F', 'link-redirect': 'http://example.com/',
  'link-advert': 'radvert.html', identity: 'RB-Demo', ip: '10.5.50.23', mac: 'AA:BB:CC:11:22:33', 'mac-esc': 'AA%3ABB%3ACC%3A11%3A22%3A33',
  username: 'ab12cd', uptime: '1h12m', 'uptime-secs': '4320', 'session-time-left': '22h47m', 'remain-bytes-total': '1', 'remain-bytes-total-nice': '812.4 MiB',
  'bytes-in-nice': '184.2 MiB', 'bytes-out-nice': '21.7 MiB', 'refresh-timeout': '1m', 'refresh-timeout-secs': '60', error: '', 'error-orig': ''
};
const sc = {
  fresh: {},
  error: { error: 'invalid username or password' },
  chap: { 'chap-id': '\\275', 'chap-challenge': '\\061\\372\\001\\100\\246\\300\\010\\377\\120\\000\\111\\222\\333\\144\\005\\177' },
  trial: { trial: 'yes' }
}[scenario];
const vars = Object.assign({}, base, sc);

function render(src, file) {
  // conditionals (supports nesting, $(else), == / != on quoted values)
  const tok = /\$\((if|else|endif)(?:\s+([^)]*))?\)/g;
  let out = '', last = 0, m; const stack = [];
  const active = () => stack.every(s => s.on);
  const truthy = (expr) => {
    const e = expr.trim(), cmp = e.match(/^([\w-]+)\s*(==|!=)\s*'([^']*)'$/);
    if (cmp) { const eq = (vars[cmp[1]] || '') === cmp[3]; return cmp[2] === '==' ? eq : !eq; }
    return !!vars[e];
  };
  while ((m = tok.exec(src))) {
    if (active()) out += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === 'if') stack.push({ on: truthy(m[2] || ''), parent: true });
    else if (m[1] === 'else') { if (!stack.length) throw new Error(file + ': $(else) without if'); stack[stack.length - 1].on = !stack[stack.length - 1].on; }
    else { if (!stack.length) throw new Error(file + ': $(endif) without if'); stack.pop(); }
  }
  if (stack.length) throw new Error(file + ': unclosed $(if)');
  if (active()) out += src.slice(last);
  return out.replace(/\$\(([\w-]+)\)/g, (all, k) => (k in vars ? vars[k] : ''));
}

function copy(dir) {
  const from = path.join(root, dir), to = path.join(out, dir);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const p = path.join(from, f);
    if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(to, f));
  }
}
fs.mkdirSync(out, { recursive: true });
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
for (const f of pages) fs.writeFileSync(path.join(out, f), render(fs.readFileSync(path.join(root, f), 'utf8'), f));
for (const f of ['md5.js', 'favicon.svg']) fs.copyFileSync(path.join(root, f), path.join(out, f));
['css', 'js', 'img'].forEach(copy);
console.log('rendered', pages.length, 'pages (' + scenario + ') ->', out);
