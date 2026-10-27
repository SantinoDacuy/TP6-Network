import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "../backend/server.mjs";
import { Repository, SyncEngine } from "../mobile/src/core/store.mjs";
const token = "test-token-0123456789";
const digest = (b) => createHash("sha256").update(b).digest("hex");
const location = {
  latitude: -32.48,
  longitude: -58.23,
  accuracy: 5,
  capturedAt: "2026-10-27T15:00:00Z",
};
async function harness(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "tp6-"));
  let server, url;
  async function start() {
    server = await createServer({ dataDir, token });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const call = (path, options = {}) =>
    fetch(url + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
  return {
    call,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
function fixture() {
  const photo = Buffer.from([255, 216, 255, 224, 1, 2]),
    pdf = Buffer.from("%PDF-1.4\nfixture");
  const files = [
    { id: "photo-12345678", contentType: "image/jpeg", sha256: digest(photo) },
    { id: "pdf-12345678", contentType: "application/pdf", sha256: digest(pdf) },
  ];
  return {
    photo,
    pdf,
    event: {
      eventId: "event-12345678",
      installation: {
        id: "report-12345678",
        site: "Sitio real",
        notes: "Cableado relevado",
        createdAt: "2026-10-27T15:00:00Z",
        device: { ip: "192.168.1.1" },
        diagnostics: [],
        location,
        photos: [{ fileId: files[0].id, location }],
        pdf: { fileId: files[1].id },
        files,
      },
    },
  };
}
test("authenticated evidence upload, sync, retry, restart deduplication and immutable conflicts", async (t) => {
  const h = await harness(t),
    f = fixture();
  const post = (value) =>
    h.call("/api/sync", { method: "POST", body: JSON.stringify(value) });
  assert.equal((await post(f.event)).status, 409);
  for (const [index, binary] of [f.photo, f.pdf].entries()) {
    const file = f.event.installation.files[index];
    const upload = () =>
      h.call(`/api/blobs/${file.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": file.contentType,
          "X-Content-SHA256": file.sha256,
        },
        body: binary,
      });
    assert.equal((await upload()).status, 200);
    assert.equal((await upload()).status, 200);
  }
  const first = await post(f.event);
  assert.equal(first.status, 200);
  const ack = await first.json();
  await h.restart();
  assert.deepEqual(await (await post(f.event)).json(), ack);
  assert.equal((await (await h.call("/api/installations")).json()).length, 1);
  const changed = structuredClone(f.event);
  changed.installation.notes = "Otro contenido";
  assert.equal((await post(changed)).status, 409);
  changed.eventId = "event-87654321";
  assert.equal((await post(changed)).status, 409);
  assert.equal(
    (await h.call("/api/blobs/pdf-12345678")).headers.get("content-type"),
    "application/pdf"
  );
});
test("reject invalid auth, checksum, content type, invalid JSON and private report fields", async (t) => {
  const h = await harness(t),
    f = fixture();
  assert.equal(
    (
      await h.call("/api/installations", {
        headers: { Authorization: "Bearer bad" },
      })
    ).status,
    401
  );
  assert.equal(
    (
      await h.call("/api/blobs/photo-12345678", {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg", "X-Content-SHA256": "bad" },
        body: f.photo,
      })
    ).status,
    400
  );
  assert.equal(
    (await h.call("/api/sync", { method: "POST", body: "invalid" })).status,
    400
  );
  assert.equal(
    (await h.call("/api/sync", { method: "POST", body: "null" })).status,
    400
  );
  assert.equal(
    (await h.call("/api/sync", { method: "POST", body: "{}" })).status,
    400
  );
  f.event.installation.password = "should-never-arrive";
  assert.equal(
    (
      await h.call("/api/sync", {
        method: "POST",
        body: JSON.stringify(f.event),
      })
    ).status,
    400
  );
  assert.equal((await h.call("/api/catalog/ONT-DEMO-001")).status, 200);
  assert.equal((await h.call("/api/catalog/missing")).status, 404);
  assert.equal((await h.call("/api/catalog/toString")).status, 404);
});

test("outbox retries after a lost HTTP ACK without duplicating a server-confirmed report", async (t) => {
  const h = await harness(t),
    f = fixture();
  let state = null,
    loseAck = true;
  const repo = new Repository({
    async read() {
      return state;
    },
    async commit(next) {
      state = next;
    },
  });
  await repo.load();
  await repo.addInstallation(f.event.installation);
  const engine = new SyncEngine(repo, {
    async send(eventId, installation) {
      for (const [index, binary] of [f.photo, f.pdf].entries()) {
        const file = installation.files[index];
        const response = await h.call(`/api/blobs/${file.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": file.contentType,
            "X-Content-SHA256": file.sha256,
          },
          body: binary,
        });
        assert.equal(response.status, 200);
      }
      const response = await h.call("/api/sync", {
        method: "POST",
        body: JSON.stringify({ eventId, installation }),
      });
      assert.equal(response.status, 200);
      const ack = await response.json();
      if (loseAck) {
        loseAck = false;
        throw new Error("ACK perdido después del commit remoto");
      }
      return ack;
    },
  });
  await engine.run();
  assert.equal(repo.state.outbox[0].status, "failed");
  assert.equal((await (await h.call("/api/installations")).json()).length, 1);
  await h.restart();
  const recovered = new Repository({
    async read() {
      return state;
    },
    async commit(next) {
      state = next;
    },
  });
  await recovered.load();
  engine.repo = recovered;
  await engine.run(true);
  assert.equal(recovered.state.outbox[0].status, "done");
  assert.equal((await (await h.call("/api/installations")).json()).length, 1);
});
