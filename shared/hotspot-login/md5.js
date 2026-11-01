/* md5.js - hexMD5(str) for the MikroTik hotspot CHAP flow. MIT License. Standalone implementation.
 * Input is treated as a "binary string": every character's low 8 bits is one byte (this is what the RouterOS
 * chap-id / chap-challenge values expand to once the "\ooo" octal escapes are parsed by JavaScript).
 * Compatible with the stock MikroTik md5.js function name, so older custom pages keep working.
 */
(function (root) {
  'use strict';
  var K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], i;
  for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  function rol(x, n) { return (x << n) | (x >>> (32 - n)); }

  function hexMD5(str) {
    var n = str.length, words = [], j;
    for (j = 0; j < n; j++) words[j >> 2] |= (str.charCodeAt(j) & 0xFF) << ((j % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    var len = (((n + 8) >> 6) + 1) * 16;
    for (j = 0; j < len; j++) if (words[j] === undefined) words[j] = 0;
    words[len - 2] = (n * 8) >>> 0;
    words[len - 1] = Math.floor(n / 536870912);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (var off = 0; off < len; off += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        var sh = S[(i >> 4) * 4 + (i % 4)];
        var tmp = D; D = C; C = B;
        B = (B + rol((A + F + K[i] + words[off + g]) | 0, sh)) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = '', v = [a0, b0, c0, d0];
    for (j = 0; j < 16; j++) out += ('0' + ((v[j >> 2] >>> ((j % 4) * 8)) & 0xFF).toString(16)).slice(-2);
    return out;
  }
  root.hexMD5 = hexMD5;
  if (typeof module !== 'undefined' && module.exports) module.exports = hexMD5;
})(typeof window !== 'undefined' ? window : this);
