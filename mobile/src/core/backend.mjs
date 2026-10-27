export function validateBackend(value) {
  const base = value.trim().replace(/\/+$/, '');
  const match = base.match(/^(https?):\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/);
  if (!match || (match[3] && (+match[3] < 1 || +match[3] > 65535))) {
    throw new Error('Usá una URL base, por ejemplo http://192.168.1.10:8787');
  }
  const parts = match[2].split('.');
  const ip =
    parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && +p <= 255)
      ? parts.map(Number)
      : null;
  const privateHost =
    match[2] === 'localhost' ||
    (ip &&
      (ip[0] === 10 ||
        (ip[0] === 127 && ip[1] === 0 && ip[2] === 0 && ip[3] === 1) ||
        (ip[0] === 192 && ip[1] === 168) ||
        (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31)));
  if (match[1] === 'http' && !privateHost) {
    throw new Error(
      'HTTP se admite solo en LAN. Usá HTTPS para un servidor remoto.',
    );
  }
  return base;
}
