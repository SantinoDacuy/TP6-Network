/* eslint-disable no-bitwise */
// Generador PDF 1.4 mínimo en JS puro: texto Helvetica (WinAnsi) y fotos JPEG embebidas con
// DCTDecode, sin recomprimir. Funciona igual en Expo Go (iOS/Android) y en el navegador.
const W = 595,
  H = 842,
  MARGIN = 36,
  TEXT_WIDTH = 523;

const ascii = text => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 255;
  }
  return out;
};
const replacements = {
  '–': '-',
  '—': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  '•': '·',
  '−': '-',
};
// Cadena hexadecimal: evita escapar paréntesis/barras y conserva acentos latin-1.
function pdfString(text) {
  let hex = '';
  for (const ch of String(text)) {
    let code = (replacements[ch] ?? ch).codePointAt(0);
    if (code > 255 || (code < 32 && code !== 9)) {
      code = 63;
    }
    hex += code.toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}
function wrap(text, size, bold) {
  const max = Math.max(
    8,
    Math.floor(TEXT_WIDTH / (size * (bold ? 0.58 : 0.52))),
  );
  const lines = [];
  for (const raw of String(text).replace(/\t/g, '  ').split('\n')) {
    let line = raw;
    if (!line) {
      lines.push('');
    }
    while (line.length > max) {
      const cut = line.lastIndexOf(' ', max);
      const at = cut > max * 0.5 ? cut : max;
      lines.push(line.slice(0, at));
      line = line.slice(at).replace(/^ /, '');
    }
    if (line) {
      lines.push(line);
    }
  }
  return lines;
}
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('La foto no es JPEG');
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + length;
  }
  throw new Error('JPEG sin dimensiones');
}

export function reportPdf(report, photos) {
  const images = photos.map(photo => ({
    ...photo,
    ...jpegInfo(photo.bytes),
  }));
  const pages = [];
  let ops, y;
  const point = p =>
    `GPS ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(
      6,
    )} | precisión ±${Math.round(p.accuracy)} m | ${p.capturedAt}`;
  const start = () => {
    ops = [];
    pages.push(ops);
    ops.push('0.059 0.118 0.192 rg 0 752 595 90 re f');
    ops.push(
      `BT /F2 20 Tf 1 1 1 rg ${MARGIN} 798 Td ${pdfString(
        'NETWORK / FIELD REPORT',
      )} Tj ET`,
    );
    ops.push(
      `BT /F1 10 Tf 1 1 1 rg ${MARGIN} 775 Td ${pdfString(
        `Network Diagnostics Suite · TP6 · ${report.id}`,
      )} Tj ET`,
    );
    ops.push(
      `BT /F1 9 Tf 0.5 0.5 0.5 rg ${MARGIN} 25 Td ${pdfString(
        `${report.createdAt}    |    Página ${pages.length}`,
      )} Tj ET`,
    );
    y = 118;
  };
  const line = (text, bold = false) => {
    const size = bold ? 13 : 10;
    for (const piece of wrap(text, size, bold)) {
      if (y > 778) {
        start();
      }
      const color = bold ? '0 0.439 0.412' : '0.118 0.161 0.231';
      ops.push(
        `BT /F${bold ? 2 : 1} ${size} Tf ${color} rg ${MARGIN} ${
          H - y
        } Td ${pdfString(piece)} Tj ET`,
      );
      y += bold ? 21 : 15;
    }
  };
  start();
  const device = report.device;
  line(`Instalación: ${report.site}`, true);
  line(`Técnico: ${report.technician || 'Sin especificar'}`);
  line(`Equipo: ${device.hostname || device.ip} · ${device.ip}`);
  line(
    `MAC: ${device.mac || 'No disponible'} | Código: ${
      device.barcode || 'Sin código'
    }`,
  );
  line(point(report.location));
  y += 10;
  line('Notas técnicas', true);
  line(report.notes || 'Sin notas');
  y += 10;
  line('Diagnósticos adjuntos', true);
  if (!report.diagnostics.length) {
    line('Sin diagnósticos guardados para este equipo.');
  }
  for (const diagnostic of report.diagnostics) {
    line(`${diagnostic.protocol} · ${diagnostic.createdAt}`, true);
    line(JSON.stringify(diagnostic.result, null, 2));
    y += 8;
  }
  images.forEach((image, index) => {
    start();
    line(`Evidencia fotográfica ${index + 1} / ${images.length}`, true);
    line(point(image.location));
    y += 8;
    const scale = Math.min(TEXT_WIDTH / image.width, 560 / image.height);
    const w = image.width * scale,
      h = image.height * scale;
    ops.push(
      `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN} ${(H - y - h).toFixed(
        2,
      )} cm /Im${index + 1} Do Q`,
    );
  });

  // Objetos: 1 catálogo, 2 páginas, 3-4 fuentes, luego imágenes y pares página/contenido.
  const objects = [];
  const add = parts => objects.push(parts) && objects.length;
  add(['<< /Type /Catalog /Pages 2 0 R >>']);
  add(null);
  add([
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]);
  add([
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]);
  const imageRefs = images.map(image => {
    const space =
      image.components === 1
        ? '/DeviceGray'
        : image.components === 4
        ? '/DeviceCMYK'
        : '/DeviceRGB';
    return add([
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      '\nendstream',
    ]);
  });
  const xobjects = imageRefs
    .map((ref, i) => `/Im${i + 1} ${ref} 0 R`)
    .join(' ');
  const pageRefs = pages.map(pageOps => {
    const content = ascii(pageOps.join('\n'));
    const contentRef = add([
      `<< /Length ${content.length} >>\nstream\n`,
      content,
      '\nendstream',
    ]);
    return add([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects} >> >> >>`,
    ]);
  });
  objects[1] = [
    `<< /Type /Pages /Kids [${pageRefs
      .map(r => `${r} 0 R`)
      .join(' ')}] /Count ${pageRefs.length} >>`,
  ];

  const chunks = [];
  let length = 0;
  const push = part => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets = objects.map((parts, index) => {
    const offset = length;
    push(`${index + 1} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
    return offset;
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach(offset =>
    push(`${String(offset).padStart(10, '0')} 00000 n \n`),
  );
  push(
    `trailer\n<< /Size ${
      objects.length + 1
    } /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(length);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}
