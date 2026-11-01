/*! fill.js - fills {{placeholders}} of voucher templates for preview/standalone use. MIT.
 * Server-side generators (nextmon-php / nextmon-next) normally replace the placeholders themselves
 * and repeat the element marked [data-voucher]; in that case this script finds no "{{" and does nothing.
 * Placeholders: {{username}} {{password}} {{price}} {{validity}} {{profile}} {{qr}} {{dns}} {{brand}}
 * {{qr}} becomes a data: URL (SVG) - use it as <img src="{{qr}}">.
 * Query string (preview): ?count=12&username=..&password=..&price=..&validity=..&profile=..&dns=..&brand=..&ecc=M
 *   When username/password are not given, random sample codes are generated for every card.
 */
(function (root) {
  'use strict';
  var QRlib = root.QR || (typeof require !== 'undefined' ? require('./qr.js') : null);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loginUrl(d) {
    var base = 'http://' + (d.dns || 'hotspot.lan') + '/login?username=' + encodeURIComponent(d.username);
    if (d.password && d.password !== d.username) base += '&password=' + encodeURIComponent(d.password);
    return base;
  }
  function render(html, d, ecc) {
    var qr = QRlib ? QRlib.toDataURL(loginUrl(d), { ecc: ecc || 'M', margin: 1 }) : '';
    return html.replace(/\{\{\s*(username|password|price|validity|profile|qr|dns|brand)\s*\}\}/g, function (m, k) {
      return k === 'qr' ? qr : esc(d[k] == null ? '' : d[k]);
    });
  }
  function randCode(n) {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < n; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  }

  function boot() {
    var doc = root.document;
    if (!doc || !doc.body || doc.body.innerHTML.indexOf('{{') < 0) return;
    var q = new URLSearchParams(root.location.search);
    var count = Math.max(1, Math.min(500, parseInt(q.get('count') || '9', 10) || 1));
    var base = {
      price: q.get('price') || 'Rp 5.000', validity: q.get('validity') || '1 Hari',
      profile: q.get('profile') || 'paket-1hari', dns: q.get('dns') || 'wifi.net',
      brand: q.get('brand') || 'NextMONNet'
    };
    var ecc = q.get('ecc') || 'M';
    var nodes = doc.querySelectorAll('[data-voucher]');
    Array.prototype.forEach.call(nodes, function (node) {
      var tpl = node.outerHTML, parent = node.parentNode, frag = doc.createDocumentFragment();
      for (var i = 0; i < count; i++) {
        var d = Object.assign({}, base);
        d.username = q.get('username') || randCode(6);
        d.password = q.get('password') || (q.get('username') ? d.username : d.username); // single-code vouchers: password = username
        if (q.get('mode') === 'userpass' && !q.get('password')) d.password = randCode(6);
        var holder = doc.createElement('div');
        holder.innerHTML = render(tpl, d, ecc);
        frag.appendChild(holder.firstChild);
      }
      parent.replaceChild(frag, node);
    });
    // title/brand placeholders outside cards
    doc.title = render(doc.title, base);
  }

  var API = { render: render, loginUrl: loginUrl, esc: esc, boot: boot };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else {
    root.VoucherFill = API;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
