import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPdf, jpegInfo } from '../expo-app/src/core/pdf.mjs';
import { toBase64, fromBase64 } from '../expo-app/src/core/base64.mjs';

// JPEG real de 16x8 px generado con ffmpeg.
const jpeg = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAFBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJkAqn7/2Q==', 'base64'));
const location = { latitude: -34.6, longitude: -58.38, accuracy: 7, capturedAt: '2026-10-28T19:40:00.000Z' };
const report = {
  id: 'test-report-0001', site: 'Sitio (azotea) \ norte', technician: 'Técnico', notes: 'Señal −18 dBm\n'.repeat(200),
  createdAt: '2026-10-28T19:41:00.000Z', device: { ip: '192.168.1.1' }, location,
  diagnostics: [{ protocol: 'SNMP', createdAt: '2026-10-28T19:39:00.000Z', result: { sysName: 'x' } }],
};
const text = bytes => Buffer.from(bytes).toString('latin1');

test('base64 round-trip matches Node', () => {
  for (const size of [0, 1, 2, 3, 4, 100]) {
    const data = new Uint8Array(size).map((_, i) => (i * 37) & 255);
    assert.equal(toBase64(data), Buffer.from(data).toString('base64'));
    assert.deepEqual(fromBase64(toBase64(data)), data);
  }
});

test('jpegInfo reads SOF dimensions and rejects non-JPEG', () => {
  assert.deepEqual(jpegInfo(jpeg), { width: 16, height: 8, components: 3 });
  assert.throws(() => jpegInfo(new Uint8Array([0x89, 0x50])), /JPEG/);
});

test('reportPdf builds a valid xref, paginates long notes and embeds photos untouched', () => {
  const pdf = reportPdf(report, [{ bytes: jpeg, location }, { bytes: jpeg, location }]);
  const raw = text(pdf);
  assert.ok(raw.startsWith('%PDF-1.4'));
  assert.ok(raw.trimEnd().endsWith('%%EOF'));
  const startxref = Number(raw.match(/startxref\n(\d+)/)[1]);
  assert.ok(raw.slice(startxref).startsWith('xref'));
  const entries = [...raw.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  entries.forEach((offset, i) => assert.ok(raw.slice(offset).startsWith(`${i + 1} 0 obj`)));
  const pages = Number(raw.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.ok(pages >= 4, 'notas largas + 2 fotos deben ocupar varias páginas');
  assert.equal(raw.split('/Filter /DCTDecode').length - 1, 2);
  assert.ok(raw.includes(text(jpeg)), 'el JPEG se embebe sin recomprimir');
  assert.ok(!raw.includes('(azotea)'), 'el texto va como cadena hexadecimal, sin paréntesis crudos');
});
