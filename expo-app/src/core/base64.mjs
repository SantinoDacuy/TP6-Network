/* eslint-disable no-bitwise */
const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(128);
for (let i = 0; i < alphabet.length; i++) {
  lookup[alphabet.charCodeAt(i)] = i;
}
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return out;
}
export function fromBase64(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (lookup[clean.charCodeAt(i)] << 18) |
      (lookup[clean.charCodeAt(i + 1)] << 12) |
      ((lookup[clean.charCodeAt(i + 2)] || 0) << 6) |
      (lookup[clean.charCodeAt(i + 3)] || 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) {
      out[o++] = (n >> 8) & 255;
    }
    if (i + 3 < clean.length) {
      out[o++] = n & 255;
    }
  }
  return out.subarray(0, o);
}
