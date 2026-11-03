// Sirve dist/NetworkDiagnostics-release.apk en la LAN y muestra un QR para descargarlo desde el teléfono.
// Uso: npm run apk:share [-- IP]   (la IP es opcional; por defecto se elige la del Wi-Fi/Ethernet)
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apk = new URL('../dist/NetworkDiagnostics-release.apk', import.meta.url);
const port = 8788;
const size = statSync(apk).size;

const virtual = /vethernet|virtualbox|vmware|wsl|docker|hyper-v|loopback/i;
const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => !virtual.test(name))
  // Wi-Fi primero: el teléfono se conecta por ahí y los adaptadores virtuales suelen llamarse "Ethernet N".
  .sort(([a], [b]) => /wi-?fi|wlan/i.test(b) - /wi-?fi|wlan/i.test(a))
  .flatMap(([, list]) => list)
  .filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('192.168.56.'));
const ip = process.argv[2] || candidates[0]?.address;
if (!ip) {
  console.error('No se encontró una IPv4 de LAN. Pasala a mano: npm run apk:share -- 192.168.x.y');
  process.exit(1);
}

createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/NetworkDiagnostics.apk') {
    res.writeHead(404).end();
    return;
  }
  console.log(`Descarga desde ${req.socket.remoteAddress}`);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': size,
    'Content-Disposition': 'attachment; filename="NetworkDiagnostics.apk"',
  });
  createReadStream(apk).pipe(res);
}).listen(port, '0.0.0.0', () => {
  const url = `http://${ip}:${port}/NetworkDiagnostics.apk`;
  console.log(`\nEscaneá el QR con la cámara del teléfono (mismo Wi-Fi):\n${url}\n`);
  const png = fileURLToPath(new URL('../dist/apk-qr.png', import.meta.url));
  // El mismo QR se guarda como imagen por si la terminal no dibuja bien los bloques.
  const qr = `npx --yes qrcode@1.5.4 --small "${url}" && npx --yes qrcode@1.5.4 -w 400 -o "${png}" "${url}"`;
  spawn(qr, { stdio: 'inherit', shell: true }).on('exit', () =>
    console.log(`\nQR también en: ${png}\nCtrl+C para detener.`),
  );
});
