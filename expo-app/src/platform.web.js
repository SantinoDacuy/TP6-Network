/* eslint-env browser */
// Modo navegador: localStorage y Web Crypto. Pensado para la demo desde el PC del laboratorio;
// el navegador no tiene Keychain, así que los secretos quedan en el almacenamiento del sitio.
import { toBase64, fromBase64 } from './core/base64.mjs';

const STATE = 'fieldkit-state';
const read = name => {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
};
const write = (name, value) => {
  try {
    if (value === null) {
      localStorage.removeItem(name);
    } else {
      localStorage.setItem(name, value);
    }
  } catch {
    throw new Error(
      'El navegador no tiene espacio local suficiente (probá con menos fotos)',
    );
  }
};

export const storage = {
  read: async () => read(STATE),
  async commit(payload, expectedRevision) {
    const current = JSON.parse(read(STATE) || '{"revision":0}').revision;
    if (
      current !== expectedRevision ||
      JSON.parse(payload).revision !== expectedRevision + 1
    ) {
      throw new Error('Conflicto de escritura local');
    }
    write(STATE, payload);
    return true;
  },
};

export const secrets = {
  get: async name => read(`fieldkit-secret:${name}`),
  async set(name, value) {
    write(`fieldkit-secret:${name}`, value || null);
    return true;
  },
};

const dataBytes = uri =>
  fromBase64(String(uri).slice(String(uri).indexOf(',') + 1));
export const files = {
  resolve: uri => uri,
  async savePhoto(uri) {
    if (String(uri).startsWith('data:')) {
      return uri;
    }
    const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
    return `data:image/jpeg;base64,${toBase64(bytes)}`;
  },
  bytes: async uri => dataBytes(uri),
  writePdf: async (_id, bytes) =>
    `data:application/pdf;base64,${toBase64(bytes)}`,
  async info(uri) {
    const bytes = dataBytes(uri);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return {
      sha256: [...digest].map(b => b.toString(16).padStart(2, '0')).join(''),
      size: bytes.length,
    };
  },
  async upload(url, token, uri, contentType, sha) {
    const response = await fetch(url, {
      method: 'PUT',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'X-Content-SHA256': sha,
      },
      body: dataBytes(uri),
    });
    if (response.status !== 200) {
      throw new Error(`Error de carga HTTP ${response.status}`);
    }
    return response.json();
  },
  async share(uri) {
    const blob = new Blob([dataBytes(uri)], { type: 'application/pdf' });
    window.open(URL.createObjectURL(blob), '_blank');
    return true;
  },
};
