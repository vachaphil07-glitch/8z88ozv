'use strict';
// Ersatz für Node-"crypto" in der Handy-App: nur das, was die Anbindungen brauchen –
// SHA-1 (Eintrags-IDs) und HMAC-SHA1 (WebUntis-Einmalcodes). Synchron wie am PC.
const { Buffer } = require('buffer');

function toBytes(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

function rotl(x, n) {
  return (x << n) | (x >>> (32 - n));
}

function sha1(bytes) {
  const len = bytes.length;
  const total = ((len + 8) >> 6) * 64 + 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[len] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(total - 4, (len * 8) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = Buffer.alloc(20);
  [h0, h1, h2, h3, h4].forEach((h, i) => out.writeUInt32BE(h, i * 4));
  return out;
}

function hmacSha1(key, data) {
  let k = toBytes(key);
  if (k.length > 64) k = sha1(k);
  const block = Buffer.alloc(64);
  k.copy(block);
  const inner = Buffer.alloc(64);
  const outer = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  return sha1(Buffer.concat([outer, sha1(Buffer.concat([inner, data]))]));
}

function digester(compute) {
  const chunks = [];
  return {
    update(data) {
      chunks.push(toBytes(data));
      return this;
    },
    digest(encoding) {
      const out = compute(Buffer.concat(chunks));
      return encoding ? out.toString(encoding) : out;
    }
  };
}

function checkAlgo(algo) {
  if (String(algo).toLowerCase() !== 'sha1') throw new Error(`Nicht unterstützt in der Handy-App: ${algo}`);
}

module.exports = {
  createHash(algo) {
    checkAlgo(algo);
    return digester(sha1);
  },
  createHmac(algo, key) {
    checkAlgo(algo);
    return digester((data) => hmacSha1(key, data));
  }
};
