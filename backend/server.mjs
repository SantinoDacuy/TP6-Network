import http from "node:http";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const idPattern = /^[a-zA-Z0-9_-]{8,100}$/;
const validId = (value) => typeof value === "string" && idPattern.test(value);
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function atomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
async function body(req, max) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) {
      fail("Payload demasiado grande", 413);
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}
function validateReport(report) {
  if (
    !report ||
    !validId(report.id) ||
    typeof report.site !== "string" ||
    !report.site.trim() ||
    report.site.length > 200 ||
    typeof report.notes !== "string" ||
    report.notes.length > 20000
  ) {
    fail("Instalación inválida");
  }
  if (
    !Array.isArray(report.photos) ||
    report.photos.length < 1 ||
    report.photos.length > 20 ||
    !Array.isArray(report.diagnostics) ||
    report.diagnostics.length > 1000
  ) {
    fail("Evidencia inválida");
  }
  const location = (point) =>
    point &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180 &&
    Number.isFinite(point.accuracy) &&
    point.accuracy >= 0 &&
    Number.isFinite(Date.parse(point.capturedAt));
  if (
    !location(report.location) ||
    !Number.isFinite(Date.parse(report.createdAt)) ||
    !report.device ||
    typeof report.device.ip !== "string"
  ) {
    fail("GPS/fecha/equipo inválidos");
  }
  if (
    !report.pdf ||
    !Array.isArray(report.files) ||
    report.files.length !== report.photos.length + 1
  ) {
    fail("Falta PDF o foto");
  }
  const fileIds = new Set();
  for (const file of report.files) {
    if (
      !validId(file.id) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !["image/jpeg", "application/pdf"].includes(file.contentType) ||
      fileIds.has(file.id)
    ) {
      fail("Archivo inválido");
    }
    fileIds.add(file.id);
  }
  const lookup = new Map(report.files.map((f) => [f.id, f]));
  if (lookup.get(report.pdf.fileId)?.contentType !== "application/pdf") {
    fail("PDF inválido");
  }
  if (
    report.photos.some(
      (photo) =>
        !location(photo.location) ||
        lookup.get(photo.fileId)?.contentType !== "image/jpeg"
    )
  ) {
    fail("Foto/GPS inválidos");
  }
  // Local URIs and secrets never belong in the transport document.
  if (/"(?:password|community|token|uri)"\s*:/i.test(JSON.stringify(report))) {
    fail("Campo privado en reporte");
  }
}
export async function createServer({ dataDir, token }) {
  if (!token || token.length < 16) {
    throw new Error("Definir SYNC_TOKEN de al menos 16 caracteres");
  }
  const dir = resolve(dataDir),
    blobs = join(dir, "blobs"),
    dbPath = join(dir, "store.json");
  await mkdir(blobs, { recursive: true });
  let store;
  try {
    store = JSON.parse(await readFile(dbPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    store = {
      events: {},
      installations: {},
      catalog: {
        "ONT-DEMO-001": {
          model: "ONT laboratorio",
          vendor: "Genérico",
          serial: "ONT-DEMO-001",
          notes: "Ficha de ejemplo: reemplazar por el inventario real.",
        },
      },
    };
  }
  let tail = Promise.resolve();
  const transact = (action) => {
    const op = tail.then(action);
    tail = op.catch(() => {});
    return op;
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        send(200, { ok: true, service: "network-diagnostics-sync" });
        return;
      }
      const supplied = Buffer.from(req.headers.authorization || ""),
        expected = Buffer.from(`Bearer ${token}`);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        send(401, { error: "No autorizado" });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/catalog/")) {
        const code = decodeURIComponent(
          url.pathname.slice("/api/catalog/".length)
        );
        const found = Object.hasOwn(store.catalog, code);
        send(
          found ? 200 : 404,
          found ? store.catalog[code] : { error: "Ficha no encontrada" }
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/installations") {
        send(200, Object.values(store.installations));
        return;
      }
      const match = url.pathname.match(
        /^\/api\/blobs\/([a-zA-Z0-9_-]{8,100})$/
      );
      if (req.method === "PUT" && match) {
        const data = await body(req, 20 * 1024 * 1024),
          digest = sha(data);
        const contentType = req.headers["content-type"];
        if (req.headers["x-content-sha256"] !== digest) {
          fail("Checksum inválido");
        }
        if (!["image/jpeg", "application/pdf"].includes(contentType)) {
          fail("Tipo de archivo no permitido", 415);
        }
        if (
          (contentType === "application/pdf" &&
            data.subarray(0, 5).toString() !== "%PDF-") ||
          (contentType === "image/jpeg" && (data[0] !== 255 || data[1] !== 216))
        ) {
          fail("Contenido no coincide con tipo");
        }
        await transact(async () => {
          const path = join(blobs, match[1]);
          try {
            if (sha(await readFile(path)) !== digest) {
              fail("ID de archivo ya utilizado", 409);
            }
          } catch (e) {
            if (e.code !== "ENOENT") {
              throw e;
            }
            await atomic(path, data);
          }
        });
        send(200, { id: match[1], sha256: digest });
        return;
      }
      if (req.method === "GET" && match) {
        const path = join(blobs, match[1]);
        try {
          await stat(path);
          const data = await readFile(path);
          res.writeHead(200, {
            "Content-Type":
              data.subarray(0, 5).toString() === "%PDF-"
                ? "application/pdf"
                : "image/jpeg",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(data);
        } catch (e) {
          if (e.code === "ENOENT") {
            send(404, { error: "Archivo no encontrado" });
          } else {
            throw e;
          }
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/sync") {
        let event;
        try {
          event = JSON.parse(
            (await body(req, 2 * 1024 * 1024)).toString("utf8")
          );
        } catch (e) {
          if (e.status) {
            throw e;
          }
          fail("JSON inválido");
        }
        if (!event || !validId(event.eventId)) {
          fail("eventId inválido");
        }
        validateReport(event.installation);
        const ack = await transact(async () => {
          const digest = sha(JSON.stringify(event.installation));
          if (store.events[event.eventId]) {
            if (store.events[event.eventId].digest !== digest) {
              fail("eventId con contenido distinto", 409);
            }
            return store.events[event.eventId].ack;
          }
          if (store.installations[event.installation.id]) {
            fail("Instalación inmutable ya registrada", 409);
          }
          for (const file of event.installation.files) {
            let data;
            try {
              data = await readFile(join(blobs, file.id));
            } catch {
              fail("Subir evidencia antes del reporte", 409);
            }
            if (sha(data) !== file.sha256) {
              fail("Checksum de evidencia no coincide", 409);
            }
            if (
              (file.contentType === "application/pdf" &&
                data.subarray(0, 5).toString() !== "%PDF-") ||
              (file.contentType === "image/jpeg" &&
                (data[0] !== 255 || data[1] !== 216))
            ) {
              fail("Tipo de evidencia no coincide", 409);
            }
          }
          const result = {
            eventId: event.eventId,
            installationId: event.installation.id,
            acceptedAt: new Date().toISOString(),
          };
          const next = structuredClone(store);
          next.installations[event.installation.id] = event.installation;
          next.events[event.eventId] = { digest, ack: result };
          await atomic(dbPath, JSON.stringify(next, null, 2));
          store = next;
          return result;
        });
        send(200, ack);
        return;
      }
      send(404, { error: "Ruta no encontrada" });
    } catch (e) {
      send(e.status || 500, {
        error: e.status ? e.message : "Error interno del backend",
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createServer({
    dataDir: process.env.DATA_DIR || "./backend/data",
    token: process.env.SYNC_TOKEN,
  });
  server.listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () => console.log(`Sync backend: puerto ${server.address().port}`)
  );
}
