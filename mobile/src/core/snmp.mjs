/* eslint-disable no-bitwise */
// Minimal BER/ASN.1 codec: SNMP v1/v2c GetRequest / GetResponse, no external codec.
const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => [...p]));
const utf8 = value => {
  const encoded = unescape(encodeURIComponent(value));
  return Uint8Array.from(encoded, c => c.charCodeAt(0));
};
function text(value) {
  const raw = Array.from(
    value,
    b => '%' + b.toString(16).padStart(2, '0'),
  ).join('');
  try {
    return decodeURIComponent(raw);
  } catch {
    return Array.from(value, b => String.fromCharCode(b)).join('');
  }
}
function length(n) {
  if (n < 128) {
    return [n];
  }
  const out = [];
  while (n) {
    out.unshift(n & 255);
    n = Math.floor(n / 256);
  }
  return [128 | out.length, ...out];
}
export function tlv(tag, content) {
  return bytes([tag], length(content.length), content);
}
export function integer(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
    throw new Error('INTEGER fuera de rango');
  }
  const out = [n & 255];
  while ((n = Math.floor(n / 256))) {
    out.unshift(n & 255);
  }
  if (out[0] & 128) {
    out.unshift(0);
  }
  return tlv(2, out);
}
function base128(n) {
  const out = [n % 128];
  while ((n = Math.floor(n / 128))) {
    out.unshift(n % 128 | 128);
  }
  return out;
}
export function oid(value) {
  const arcs = value.split('.').map(Number);
  if (
    arcs.length < 2 ||
    arcs.some(n => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) ||
    arcs[0] > 2 ||
    (arcs[0] < 2 && arcs[1] > 39)
  ) {
    throw new Error('OID inválido');
  }
  return tlv(6, [40 * arcs[0] + arcs[1], ...arcs.slice(2)].flatMap(base128));
}
export const OIDS = {
  sysName: '1.3.6.1.2.1.1.5.0',
  uptime: '1.3.6.1.2.1.1.3.0',
  ifNumber: '1.3.6.1.2.1.2.1.0',
};
export const interfaceOids = index => ({
  description: `1.3.6.1.2.1.2.2.1.2.${index}`,
  mac: `1.3.6.1.2.1.2.2.1.6.${index}`,
  inOctets: `1.3.6.1.2.1.2.2.1.10.${index}`,
  outOctets: `1.3.6.1.2.1.2.2.1.16.${index}`,
});
export function getRequest({ requestId, community, oids, version = 1 }) {
  if (![0, 1].includes(version)) {
    throw new Error('Solo SNMP v1/v2c');
  }
  if (
    !community ||
    utf8(community).length > 255 ||
    !oids.length ||
    oids.length > 32
  ) {
    throw new Error('Consulta SNMP inválida');
  }
  const bindings = tlv(
    48,
    bytes(...oids.map(o => tlv(48, bytes(oid(o), tlv(5, []))))),
  );
  return tlv(
    48,
    bytes(
      integer(version),
      tlv(4, utf8(community)),
      tlv(160, bytes(integer(requestId), integer(0), integer(0), bindings)),
    ),
  );
}
class Reader {
  constructor(data) {
    this.data = Uint8Array.from(data);
    this.offset = 0;
  }
  read(expected) {
    if (this.offset + 2 > this.data.length) {
      throw new Error('BER truncado');
    }
    const tag = this.data[this.offset++];
    let size = this.data[this.offset++];
    if (size & 128) {
      const count = size & 127;
      if (!count || count > 4 || this.offset + count > this.data.length) {
        throw new Error('Longitud BER inválida');
      }
      size = 0;
      for (let i = 0; i < count; i++) {
        size = size * 256 + this.data[this.offset++];
      }
    }
    if (
      size > 65535 ||
      this.offset + size > this.data.length ||
      (expected !== undefined && tag !== expected)
    ) {
      throw new Error('PDU inválido');
    }
    const value = this.data.slice(this.offset, this.offset + size);
    this.offset += size;
    return { tag, value };
  }
  end() {
    if (this.offset !== this.data.length) {
      throw new Error('Datos BER sobrantes');
    }
  }
}
function number(value, signed = true) {
  if (!value.length || value.length > 8) {
    throw new Error('INTEGER inválido');
  }
  let n = 0;
  for (const b of value) {
    n = n * 256 + b;
  }
  if (signed && value[0] & 128) {
    n -= 2 ** (8 * value.length);
  }
  if (!Number.isSafeInteger(n)) {
    throw new Error('Contador fuera de precisión JS');
  }
  return n;
}
function decodeOid(value) {
  const groups = [];
  let n = 0,
    open = false;
  for (const b of value) {
    n = n * 128 + (b & 127);
    open = Boolean(b & 128);
    if (!Number.isSafeInteger(n)) {
      throw new Error('OID demasiado grande');
    }
    if (!open) {
      groups.push(n);
      n = 0;
    }
  }
  if (open || !groups.length) {
    throw new Error('OID truncado');
  }
  const first = groups.shift();
  const root = Math.min(2, Math.floor(first / 40));
  return [root, first - root * 40, ...groups].join('.');
}
function decodeValue({ tag, value }) {
  if (tag === 2) {
    return number(value);
  }
  if ([65, 66, 67].includes(tag)) {
    return number(value, false);
  }
  if (tag === 70) {
    return Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
  }
  if (tag === 4) {
    return text(value);
  }
  if (tag === 6) {
    return decodeOid(value);
  }
  if (tag === 64) {
    if (value.length !== 4) {
      throw new Error('IpAddress inválida');
    }
    return [...value].join('.');
  }
  if ([5, 128, 129, 130].includes(tag)) {
    return null;
  }
  throw new Error(`Tipo ASN.1 no soportado: ${tag}`);
}
export function parseResponse(packet, expected) {
  const outer = new Reader(packet),
    root = new Reader(outer.read(48).value);
  outer.end();
  const version = number(root.read(2).value),
    community = text(root.read(4).value);
  if (version !== expected.version || community !== expected.community) {
    throw new Error('Versión/community no coinciden');
  }
  const pdu = new Reader(root.read(162).value);
  root.end();
  const requestId = number(pdu.read(2).value);
  if (requestId !== expected.requestId) {
    throw new Error('request-id no coincide');
  }
  const error = number(pdu.read(2).value),
    errorIndex = number(pdu.read(2).value);
  if (error !== 0) {
    throw new Error(`Error SNMP ${error}, varbind ${errorIndex}`);
  }
  const bindings = new Reader(pdu.read(48).value);
  pdu.end();
  const result = {};
  while (bindings.offset < bindings.data.length) {
    const binding = new Reader(bindings.read(48).value);
    const key = decodeOid(binding.read(6).value),
      raw = binding.read();
    binding.end();
    result[key] = {
      value: decodeValue(raw),
      tag: raw.tag,
      hex: Array.from(raw.value, b => b.toString(16).padStart(2, '0')).join(''),
    };
  }
  if (
    expected.oids &&
    (Object.keys(result).length !== expected.oids.length ||
      expected.oids.some(o => !(o in result)))
  ) {
    throw new Error('OIDs de respuesta no coinciden');
  }
  return result;
}
export function counterRate(before, after, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    throw new Error('Intervalo inválido');
  }
  return (((after - before + 2 ** 32) % 2 ** 32) * 8 * 1000) / elapsedMs;
}
