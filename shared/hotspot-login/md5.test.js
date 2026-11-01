// Run: node md5.test.js -- verifies hexMD5 and the CHAP computation used by login.html against node's crypto
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const hexMD5 = require('./md5.js');

assert.strictEqual(hexMD5(''), 'd41d8cd98f00b204e9800998ecf8427e');
assert.strictEqual(hexMD5('abc'), '900150983cd24fb0d6963f7d28e17f72');
assert.strictEqual(hexMD5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
for (let n = 0; n < 300; n++) { // all padding boundaries, binary content
  const b = crypto.randomBytes(n), s = b.toString('latin1');
  assert.strictEqual(hexMD5(s), crypto.createHash('md5').update(b).digest('hex'), 'len ' + n);
}
// CHAP as RouterOS delivers it: octal-escaped literals inside a JS string
const chapId = '\\275', chapChallenge = '\\061\\372\\001\\100\\246\\300\\010\\377\\120\\000\\111\\222\\333\\144\\005\\177';
const idBytes = (0, eval)("'" + chapId + "'"), chBytes = (0, eval)("'" + chapChallenge + "'"); // same parse the browser does
const pw = 'rahasia123';
const expect = crypto.createHash('md5').update(Buffer.concat([Buffer.from(idBytes, 'latin1'), Buffer.from(pw), Buffer.from(chBytes, 'latin1')])).digest('hex');
assert.strictEqual(hexMD5(idBytes + pw + chBytes), expect);
console.log('md5.js OK (vectors, 300 random binary lengths, CHAP id+password+challenge)');
