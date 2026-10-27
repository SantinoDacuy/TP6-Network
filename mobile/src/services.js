import { validateBackend } from './core/backend.mjs';
export { validateBackend };
import {
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Repository, SyncEngine, newId } from './core/store.mjs';
import {
  OIDS,
  interfaceOids,
  getRequest,
  parseResponse,
  counterRate,
} from './core/snmp.mjs';

export const native = NativeModules.FieldKit;
export const repo = new Repository({
  read: () => native.readState(),
  commit: (payload, revision) => native.commitState(payload, revision),
});
const pause = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
export async function requestApi(path, options = {}) {
  const base = validateBackend(repo.state.settings.backendUrl);
  const token = await native.getSecret('sync-token');
  if (!token) {
    throw new Error('Guardá el token del backend en Ajustes');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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
  } finally {
    clearTimeout(timer);
  }
}
export const sync = new SyncEngine(repo, {
  async send(eventId, installation) {
    const base = validateBackend(repo.state.settings.backendUrl);
    const token = await native.getSecret('sync-token');
    if (!token) {
      throw new Error('Falta token de sincronización');
    }
    const files = [];
    const sources = [
      ...installation.photos.map(p => ({ ...p, contentType: 'image/jpeg' })),
      { ...installation.pdf, contentType: 'application/pdf' },
    ];
    for (const source of sources) {
      const info = JSON.parse(await native.fileInfo(source.uri));
      const ack = JSON.parse(
        await native.uploadFile(
          `${base}/api/blobs/${source.fileId}`,
          token,
          source.uri,
          source.contentType,
          info.sha256,
        ),
      );
      if (ack.sha256 !== info.sha256 || ack.id !== source.fileId) {
        throw new Error('ACK de archivo inválido');
      }
      files.push({
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
      files,
    };
    return requestApi('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ eventId, installation: report }),
    });
  },
});
export function observeNetwork() {
  const emitter = new NativeEventEmitter(native);
  const subscription = emitter.addListener('FieldKitNetworkChanged', () =>
    sync.run().catch(() => {}),
  );
  // Android may keep LAN access even without Internet; success is decided by the backend ACK.
  const timer = setInterval(() => sync.run().catch(() => {}), 30000);
  return () => {
    subscription.remove();
    clearInterval(timer);
  };
}
export async function permission(kind) {
  if (Platform.OS !== 'android') {
    throw new Error('Esta entrega implementa el módulo nativo para Android');
  }
  const permissions =
    kind === 'camera'
      ? [PermissionsAndroid.PERMISSIONS.CAMERA]
      : [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  const granted =
    kind === 'camera'
      ? result[permissions[0]] === 'granted'
      : permissions.some(p => result[p] === 'granted');
  if (!granted) {
    throw new Error(
      'Permiso denegado. Habilitalo en Ajustes de Android para continuar.',
    );
  }
}
export async function discover() {
  const { prefix } = JSON.parse(await native.networkInfo());
  const [tcp, mdns] = await Promise.allSettled([
    native.scanSubnet(prefix),
    native.discoverMdns(),
  ]);
  const devices = new Map();
  for (const result of [tcp, mdns]) {
    if (result.status === 'fulfilled') {
      for (const d of JSON.parse(result.value)) {
        devices.set(d.ip, { ...devices.get(d.ip), ...d });
      }
    }
  }
  if (tcp.status === 'rejected' && mdns.status === 'rejected') {
    throw tcp.reason;
  }
  const found = [...devices.values()];
  await repo.addDevices(found);
  return found.length;
}
async function query(host, community, oids, version) {
  const requestId = Math.floor(Math.random() * 0x7ffffffe) + 1;
  const packet = getRequest({ requestId, community, oids, version });
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await native.udpExchange(host, 161, [...packet], 2000);
      return parseResponse(response, { requestId, community, version, oids });
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
export async function captureEvidence() {
  await permission('camera');
  await permission('location');
  const uri = await native.capturePhoto();
  // GPS is obtained after the shutter; each photo keeps its own timestamp and accuracy.
  const location = JSON.parse(await native.getLocation());
  return { fileId: newId(), uri, location };
}
export async function readBarcode(device) {
  await permission('camera');
  const uri = await native.capturePhoto();
  const barcode = await native.decodeBarcode(uri);
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
  const uri = await native.generatePdf(JSON.stringify(installation));
  installation.pdf = { fileId: newId(), uri };
  await repo.addInstallation(installation);
  sync.run().catch(() => {});
  return installation;
}
