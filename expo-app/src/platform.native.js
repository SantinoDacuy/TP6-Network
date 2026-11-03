// iOS/Android en Expo Go: SQLite transaccional, Keychain/Keystore y archivos privados de la app.
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { File, Directory, Paths } from 'expo-file-system';

let opening;
const database = () =>
  (opening ??= SQLite.openDatabaseAsync('fieldkit.db').then(async db => {
    await db.execAsync(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);',
    );
    return db;
  }));

export const storage = {
  async read() {
    const row = await (
      await database()
    ).getFirstAsync('SELECT payload FROM state WHERE id=1');
    return row?.payload ?? null;
  },
  async commit(payload, expectedRevision) {
    const db = await database();
    const next = JSON.parse(payload).revision;
    if (next !== expectedRevision + 1) {
      throw new Error('Revisión inválida');
    }
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync(
        'SELECT revision FROM state WHERE id=1',
      );
      if ((row?.revision ?? 0) !== expectedRevision) {
        throw new Error('Conflicto de escritura local');
      }
      await db.runAsync(
        'INSERT OR REPLACE INTO state(id,revision,payload) VALUES(1,?,?)',
        next,
        payload,
      );
    });
    return true;
  },
};

// SecureStore solo admite claves [A-Za-z0-9._-]; "ssh:host:puerto" se normaliza.
const key = name => name.replace(/[^A-Za-z0-9._-]/g, '_');
export const secrets = {
  get: name => SecureStore.getItemAsync(key(name)),
  async set(name, value) {
    if (value) {
      await SecureStore.setItemAsync(key(name), value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(key(name));
    }
    return true;
  },
};

const folder = name => {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
};
// El contenedor de la app puede cambiar de ruta entre actualizaciones de iOS: se resuelve por nombre.
const resolve = uri => {
  const match = String(uri).match(/\/(evidence|reports)\/([^/]+)$/);
  return match ? new File(Paths.document, match[1], match[2]).uri : uri;
};
export const files = {
  resolve,
  async savePhoto(uri, id) {
    const target = new File(folder('evidence'), `${id}.jpg`);
    await new File(uri).copy(target);
    return target.uri;
  },
  bytes: uri => new File(resolve(uri)).bytes(),
  async writePdf(id, bytes) {
    const target = new File(folder('reports'), `${id}.pdf`);
    if (target.exists) {
      target.delete();
    }
    target.create();
    await target.write(bytes);
    return target.uri;
  },
  async info(uri) {
    const file = new File(resolve(uri));
    const size = file.info().size ?? 0;
    if (size > 20 * 1024 * 1024) {
      throw new Error('Archivo demasiado grande');
    }
    return { sha256: await file.digest('SHA-256'), size };
  },
  async upload(url, token, uri, contentType, sha) {
    const result = await new File(resolve(uri)).upload(url, {
      httpMethod: 'PUT',
      mimeType: contentType,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'X-Content-SHA256': sha,
      },
    });
    if (result.status !== 200) {
      throw new Error(`Error de carga HTTP ${result.status}`);
    }
    return JSON.parse(result.body);
  },
  async share(uri) {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Compartir no está disponible en este dispositivo');
    }
    await Sharing.shareAsync(resolve(uri), {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    });
    return true;
  },
};
