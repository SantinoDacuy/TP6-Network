/* eslint-env node */
// Gateway de campo: ejecuta en la LAN las operaciones de socket que iOS/Expo Go no permiten
// a la app (barrido TCP + tabla ARP, UDP/161 para SNMP y SSH). La app sigue construyendo y
// parseando las PDUs SNMP con su propio codec BER: el gateway solo reenvía bytes.
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { networkInterfaces, platform } from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
const ipv4 = (value) =>
  typeof value === "string" &&
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value) &&
  value.split(".").every((n) => +n <= 255);
const privateIp = (value) =>
  ipv4(value) &&
  (/^(10|127)\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value));
const port = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;
const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

const virtual = /vethernet|virtualbox|vmware|wsl|docker|hyper-v|loopback/i;
export function lanAddress(preferred) {
  const local = preferred?.replace(/^::ffff:/, "");
  if (privateIp(local) && !local.startsWith("127.")) {
    return local;
  }
  const found = Object.entries(networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .sort(([a], [b]) => /wi-?fi|wlan/i.test(b) - /wi-?fi|wlan/i.test(a))
    .flatMap(([, list]) => list)
    .find(
      (a) =>
        a.family === "IPv4" &&
        !a.internal &&
        privateIp(a.address) &&
        !a.address.startsWith("192.168.56.")
    );
  return found?.address || fail("El gateway no tiene una IPv4 de LAN", 503);
}

function tcpAlive(host, probePort, timeout) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: probePort });
    const done = (alive) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    // Un RST (ECONNREFUSED) prueba que el host existe aunque el puerto esté cerrado.
    socket.once("error", (e) => done(e.code === "ECONNREFUSED"));
  });
}
function arpTable() {
  const [command, args] =
    platform() === "win32" ? ["arp", ["-a"]] : ["ip", ["neigh"]];
  return new Promise((resolve) =>
    execFile(command, args, { timeout: 5000 }, (error, stdout) => {
      const table = new Map();
      for (const match of String(stdout || "").matchAll(
        /(\d{1,3}(?:\.\d{1,3}){3})\D+?((?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2})/gi
      )) {
        const mac = match[2].toLowerCase().replaceAll("-", ":");
        if (mac !== "ff:ff:ff:ff:ff:ff" && !mac.startsWith("01:00:5e")) {
          table.set(match[1], mac);
        }
      }
      resolve(table);
    })
  );
}
export async function discover(localAddress) {
  const self = lanAddress(localAddress);
  const prefix = self.split(".").slice(0, 3).join(".");
  const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
  const alive = new Set();
  let next = 0;
  // El barrido también puebla la caché ARP del sistema con los hosts que respondieron a ARP.
  await Promise.all(
    Array.from({ length: 64 }, async () => {
      while (next < hosts.length) {
        const host = hosts[next++];
        for (const probe of [22, 23, 80, 443, 8080]) {
          if (await tcpAlive(host, probe, 350)) {
            alive.add(host);
            break;
          }
        }
      }
    })
  );
  const arp = await arpTable();
  const seen = new Date().toISOString();
  const ips = new Set([...alive, ...[...arp.keys()].filter((ip) => ip.startsWith(`${prefix}.`) && !ip.endsWith(".255"))]);
  const devices = await Promise.all(
    [...ips].map(async (ip) => {
      const names = await withTimeout(dns.reverse(ip).catch(() => []), 800, []);
      return {
        ip,
        ...(arp.get(ip) ? { mac: arp.get(ip), macSource: "ARP del gateway" } : {}),
        ...(names[0] ? { hostname: names[0] } : {}),
        source: alive.has(ip) ? (arp.has(ip) ? "TCP+ARP" : "TCP") : "ARP",
        lastSeen: seen,
      };
    })
  );
  return { gateway: self, prefix, devices };
}

export function udpExchange({ host, port: target, packet, timeoutMs = 2000 }) {
  if (!privateIp(host) || target !== 161) {
    fail("El relay UDP solo admite SNMP (UDP/161) hacia IPv4 privadas");
  }
  const data = Buffer.from(String(packet || ""), "base64");
  if (!data.length || data.length > 65507) {
    fail("Paquete UDP inválido");
  }
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      const e = new Error(
        `El agente SNMP de ${host} no respondió en UDP/161. Revisá que el equipo tenga SNMP activo (para el equipo de laboratorio: Docker Desktop abierto y npm run lab), la community y el ifIndex.`
      );
      e.status = 504;
      reject(e);
    }, Math.min(Math.max(timeoutMs, 200), 10000));
    socket.once("message", (message, info) => {
      if (info.address !== host) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve({ packet: message.toString("base64") });
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      socket.close();
      e.status = 502;
      reject(e);
    });
    socket.send(data, target, host);
  });
}

// Traduce errores de socket a un mensaje accionable para el técnico.
function sshError(e, host, target) {
  e.status = 502;
  if (e.code === "ECONNREFUSED") {
    e.message = `No hay servidor SSH en ${host}:${target}. Revisá el puerto (el equipo de laboratorio usa 2222) y que esté encendido.`;
  } else if (["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(e.code) || /timed out/i.test(e.message)) {
    e.message = `${host}:${target} no responde por SSH (timeout). Revisá IP, puerto y firewall.`;
  } else if (/authentication/i.test(e.message)) {
    e.message = "Usuario o contraseña SSH incorrectos.";
  }
  return e;
}
const fingerprint = (key) =>
  "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/[=]+$/, "");
const profiles = {
  linux: ["uptime", "ip -s link", "ip route"],
  routeros: ["/system resource print", "/interface print stats"],
  cisco: ["show version", "show interfaces", "show ip route"],
};
async function sshClient() {
  try {
    return (await import("ssh2")).default.Client;
  } catch {
    fail("Falta la dependencia ssh2 en el gateway: ejecutá npm install en la raíz", 503);
  }
}
export async function sshFingerprint({ host, port: target }) {
  if (!privateIp(host) || !port(target)) {
    fail("Host/puerto SSH inválido");
  }
  const Client = await sshClient();
  return new Promise((resolve, reject) => {
    let observed;
    const client = new Client();
    client.on("error", (e) => {
      client.end();
      if (observed) {
        resolve({ fingerprint: observed });
      } else {
        reject(sshError(e, host, target));
      }
    });
    client.on("ready", () => client.end());
    client.connect({
      host,
      port: target,
      username: "fieldkit-probe",
      readyTimeout: 8000,
      // Se rechaza la clave a propósito: solo interesa observarla para que el técnico la verifique.
      hostVerifier: (key) => {
        observed = fingerprint(key);
        return false;
      },
    });
  });
}
export async function executeSsh({ host, port: target, username, password, profile, pin }) {
  const commands = profiles[profile] || fail("Perfil SSH no permitido");
  if (!privateIp(host) || !port(target) || !String(pin).startsWith("SHA256:")) {
    fail("Verificá la huella SSH antes de conectar");
  }
  if (typeof username !== "string" || !username || typeof password !== "string") {
    fail("Guardá las credenciales SSH");
  }
  const Client = await sshClient();
  const client = new Client();
  const session = new Promise((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", (e) => {
      if (/verification failed/i.test(e.message)) {
        e.status = 502;
        e.message = "La huella SSH del equipo cambió. Volvé a verificarla.";
        reject(e);
      } else {
        reject(sshError(e, host, target));
      }
    });
  });
  client.on("keyboard-interactive", (_n, _i, _l, prompts, finish) =>
    finish(prompts.map(() => password))
  );
  client.connect({
    host,
    port: target,
    username,
    password,
    tryKeyboard: true,
    readyTimeout: 12000,
    hostVerifier: (key) => fingerprint(key) === pin,
  });
  try {
    await session;
    const results = [];
    for (const command of commands) {
      results.push(
        await new Promise((resolve, reject) => {
          client.exec(command, (error, stream) => {
            if (error) {
              reject(error);
              return;
            }
            let stdout = "",
              stderr = "";
            const timer = setTimeout(() => {
              stream.close();
              reject(Object.assign(new Error("Timeout de comando SSH"), { status: 504 }));
            }, 15000);
            stream.on("data", (d) => (stdout = (stdout + d).slice(0, 65536)));
            stream.stderr.on("data", (d) => (stderr = (stderr + d).slice(0, 65536)));
            stream.on("close", (exitCode) => {
              clearTimeout(timer);
              resolve({ command, stdout, stderr, exitCode: exitCode ?? -1 });
            });
          });
        })
      );
    }
    return { results };
  } finally {
    client.end();
  }
}
