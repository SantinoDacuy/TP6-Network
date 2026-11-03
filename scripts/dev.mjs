// Levanta backend/gateway de laboratorio + Expo (QR para Expo Go) anunciando la IP del Wi-Fi.
// Uso: npm run dev [-- IP]   (la IP es opcional; por defecto se elige la del Wi-Fi/Ethernet)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lanAddress } from '../backend/gateway.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Sin esto Expo puede anunciar un adaptador virtual (VirtualBox/WSL) inalcanzable desde el teléfono.
const ip = process.argv[2] || lanAddress();
const children = [];

const running = await fetch('http://127.0.0.1:8787/health')
  .then(r => r.ok)
  .catch(() => false);
if (running) {
  console.log('Backend/gateway ya activo en :8787');
} else {
  children.push(
    spawn(process.execPath, ['backend/demo.mjs'], { cwd: root, stdio: 'inherit' }),
  );
}
console.log(`\nIP anunciada: ${ip}  ·  backend http://${ip}:8787  ·  token tp6-demo-local-2026`);
console.log('Escaneá el QR con la cámara del iPhone (abre Expo Go). Tecla w = versión web.\n');
children.push(
  spawn('npx expo start --lan', {
    cwd: `${root}expo-app`,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: ip },
  }),
);
const stop = () => {
  children.forEach(child => child.kill());
  process.exit();
};
process.on('SIGINT', stop);
children.at(-1).on('exit', stop);
