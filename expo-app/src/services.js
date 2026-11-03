/* global globalThis */
// Casos de uso de la versión Expo Go. Misma interfaz que mobile/src/services.js; las operaciones
// de socket crudo (barrido LAN, UDP/161, SSH) pasan por el gateway de campo del backend.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import * as Network from 'expo-network';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Repository, SyncEngine, newId } from '../../mobile/src/core/store.mjs';
import {
  OIDS,
  interfaceOids,
  getRequest,
  parseResponse,
  counterRate,
} from '../../mobile/src/core/snmp.mjs';
import { validateBackend } from '../../mobile/src/core/backend.mjs';
import { reportPdf } from './core/pdf.mjs';
import { toBase64, fromBase64 } from './core/base64.mjs';
import { storage, secrets, files } from './platform';

export { validateBackend };
export const resolveUri = files.resolve;
export const DEMO_TOKEN = 'tp6-demo-local-2026';
// En Expo Go el PC que sirve el bundle es el mismo que corre el backend/gateway de laboratorio.
export function suggestedBackend() {
  const host =
    Platform.OS === 'web'
      ? globalThis.location?.hostname
      : Constants.expoConfig?.hostUri?.split(':')[0];
  return host && host !== 'localhost'
    ? `http://${host}:8787`
    : 'http://127.0.0.1:8787';
}

export const repo = new Repository(storage);
const pause = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

export async function requestApi(path, options = {}, timeoutMs = 15000) {
  const base = validateBackend(repo.state.settings.backendUrl);
  const token = await secrets.get('sync-token');
  if (!token) {
    throw new Error('Guardá el token del backend en Ajustes');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(base + path, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('El backend/gateway no respondió a tiempo');
    }
    if (
      /network request failed|failed to fetch|load failed/i.test(error.message)
    ) {
      throw new Error(
        `Sin conexión con el gateway ${base}. ¿Está corriendo npm run backend:demo en la misma red?`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const gateway = (operation, body, timeoutMs) =>
  requestApi(
    `/api/gateway/${operation}`,
    { method: 'POST', body: JSON.stringify(body) },
    timeoutMs,
  );

// Adaptador con las mismas firmas que el módulo nativo FieldKit de la versión Android.
export const native = {
  getSecret: name => secrets.get(name),
  setSecret: (name, value) => secrets.set(name, value),
  async sshFingerprint(host, port) {
    return (await gateway('ssh/fingerprint', { host, port }, 20000))
      .fingerprint;
  },
  async executeSsh(host, port, profile, pin) {
    const saved = await secrets.get(`ssh:${host}:${port}`);
    if (!saved) {
      throw new Error('Guardá las credenciales SSH');
    }
    const { username, password } = JSON.parse(saved);
    const { results } = await gateway(
      'ssh/exec',
      { host, port, username, password, profile, pin },
      70000,
    );
    return JSON.stringify(results);
  },
  shareFile: uri => files.share(uri),
  async networkInfo() {
    const ip = await Network.getIpAddressAsync();
    return JSON.stringify({ ip, prefix: ip.split('.').slice(0, 3).join('.') });
  },
};

export const sync = new SyncEngine(repo, {
  async send(eventId, installation) {
    const base = validateBackend(repo.state.settings.backendUrl);
    const token = await secrets.get('sync-token');
    if (!token) {
      throw new Error('Falta token de sincronización');
    }
    const uploaded = [];
    const sources = [
      ...installation.photos.map(p => ({ ...p, contentType: 'image/jpeg' })),
      { ...installation.pdf, contentType: 'application/pdf' },
    ];
    for (const source of sources) {
      const info = await files.info(source.uri);
      const ack = await files.upload(
        `${base}/api/blobs/${source.fileId}`,
        token,
        source.uri,
        source.contentType,
        info.sha256,
      );
      if (ack.sha256 !== info.sha256 || ack.id !== source.fileId) {
        throw new Error('ACK de archivo inválido');
      }
      uploaded.push({
        id: source.fileId,
        sha256: info.sha256,
        contentType: source.contentType,
      });
    }
    const { pdf, photos, ...rest } = installation;
    const report = {
      ...rest,
      pdf: { fileId: pdf.fileId },
      photos: photos.map(({ uri, ...photo }) => photo),
      files: uploaded,
    };
    return requestApi('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ eventId, installation: report }),
    });
  },
});

export function observeNetwork() {
  const unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected) {
      sync.run().catch(() => {});
    }
  });
  // La LAN puede seguir activa sin Internet; el éxito lo decide el ACK del backend.
  const timer = setInterval(() => sync.run().catch(() => {}), 30000);
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}

export async function discover() {
  const { devices } = await gateway('discover', {}, 45000);
  await repo.addDevices(devices);
  return devices.length;
}

async function query(host, community, oids, version) {
  const requestId = Math.floor(Math.random() * 0x7ffffffe) + 1;
  // La PDU se arma y se valida en el teléfono; el gateway solo transporta los bytes por UDP/161.
  const packet = toBase64(getRequest({ requestId, community, oids, version }));
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await gateway(
        'udp',
        { host, port: 161, packet, timeoutMs: 2000 },
        8000,
      );
      return parseResponse([...fromBase64(response.packet)], {
        requestId,
        community,
        version,
        oids,
      });
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
export async function diagnoseSnmp(device, community, index, version) {
  if (!Number.isInteger(index) || index < 1 || index > 2147483647) {
    throw new Error('ifIndex debe ser un entero positivo');
  }
  const base = await query(device.ip, community, Object.values(OIDS), version);
  const oid = interfaceOids(index),
    requested = [...Object.values(oid), OIDS.uptime];
  const first = await query(device.ip, community, requested, version),
    started = Date.now();
  await pause(1000);
  const second = await query(device.ip, community, requested, version),
    elapsed = Date.now() - started;
  const inbound = second[oid.inOctets].value,
    outbound = second[oid.outOctets].value;
  const validCounters = [
    inbound,
    outbound,
    first[oid.inOctets].value,
    first[oid.outOctets].value,
  ].every(Number.isFinite);
  const notRestarted =
    Number.isFinite(first[OIDS.uptime].value) &&
    second[OIDS.uptime].value >= first[OIDS.uptime].value;
  const result = {
    sysName: base[OIDS.sysName].value,
    uptimeTicks: base[OIDS.uptime].value,
    interfaceCount: base[OIDS.ifNumber].value,
    ifIndex: index,
    description: second[oid.description].value,
    inOctets: inbound,
    outOctets: outbound,
    sampleMs: elapsed,
    inBitsPerSecond:
      validCounters && notRestarted
        ? counterRate(first[oid.inOctets].value, inbound, elapsed)
        : null,
    outBitsPerSecond:
      validCounters && notRestarted
        ? counterRate(first[oid.outOctets].value, outbound, elapsed)
        : null,
    version: version === 0 ? 'v1' : 'v2c',
  };
  const macHex = second[oid.mac].hex;
  const mac =
    second[oid.mac].tag === 4 &&
    /^[0-9a-f]{12}$/i.test(macHex) &&
    macHex !== '000000000000'
      ? macHex.match(/../g).join(':')
      : undefined;
  await repo.addDevices([
    {
      ip: device.ip,
      ...(result.sysName ? { hostname: result.sysName } : {}),
      ...(mac ? { mac, macSource: `SNMP ifPhysAddress.${index}` } : {}),
    },
  ]);
  await repo.addDiagnostic(device.id, 'SNMP', result);
  return result;
}

async function locate() {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) {
    throw new Error(
      'Permiso de ubicación denegado. Habilitalo en Ajustes para continuar.',
    );
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(accuracy)) {
    throw new Error(
      'El GPS no informó precisión. Probá de nuevo al aire libre.',
    );
  }
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}
export async function captureEvidence() {
  if (Platform.OS !== 'web') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      throw new Error(
        'Permiso de cámara denegado. Habilitalo en Ajustes para continuar.',
      );
    }
  }
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (shot.canceled || !shot.assets?.length) {
    throw new Error('Captura cancelada');
  }
  // Re-render a JPEG de 1600 px: aplica la orientación EXIF y deja la foto lista para el PDF.
  const rendered = await ImageManipulator.manipulate(shot.assets[0].uri)
    .resize({ width: 1600 })
    .renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
  });
  const fileId = newId();
  const uri = await files.savePhoto(saved.uri, fileId);
  // GPS después del disparo: cada foto conserva su propia fecha y precisión.
  const location = await locate();
  return { fileId, uri, location };
}

export async function readBarcode(device, barcode) {
  await repo.addDevices([{ ip: device.ip, barcode }]);
  let sheet = repo.state.catalog[barcode];
  try {
    sheet = await requestApi('/api/catalog/' + encodeURIComponent(barcode));
    await repo.update(state => {
      state.catalog[barcode] = { ...sheet, cachedAt: new Date().toISOString() };
    });
  } catch (error) {
    if (!sheet) {
      return {
        barcode,
        message:
          'Código guardado localmente. Ficha remota sin conexión o no encontrada.',
      };
    }
  }
  return { barcode, sheet };
}

export async function saveInstallation({
  device,
  site,
  notes,
  technician,
  photos,
}) {
  if (!device) {
    throw new Error('Seleccioná un equipo en Red');
  }
  if (!site.trim() || site.length > 200 || notes.length > 20000) {
    throw new Error(
      'Completá el sitio (máximo 200 caracteres) y revisá las notas (máximo 20000)',
    );
  }
  if (!photos.length || photos.length > 20) {
    throw new Error('Adjuntá entre 1 y 20 fotos con GPS');
  }
  const installation = {
    id: newId(),
    site: site.trim(),
    notes: notes.trim(),
    technician: technician.trim(),
    createdAt: new Date().toISOString(),
    device: { ...device },
    location: photos[0].location,
    photos,
    diagnostics: repo.state.diagnostics.filter(d => d.deviceId === device.id),
  };
  const images = await Promise.all(
    photos.map(async photo => ({
      bytes: await files.bytes(photo.uri),
      location: photo.location,
    })),
  );
  const uri = await files.writePdf(
    installation.id,
    reportPdf(installation, images),
  );
  installation.pdf = { fileId: newId(), uri };
  await repo.addInstallation(installation);
  sync.run().catch(() => {});
  return installation;
}
