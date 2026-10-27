import test from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../mobile/src/core/store.mjs";
test("draft survives process recreation and finalization clears it atomically with the report/outbox", async () => {
  let saved = null;
  const disk = {
    async read() {
      return saved;
    },
    async commit(next) {
      saved = next;
    },
  };
  const repo = new Repository(disk);
  await repo.load();
  await repo.update((state) => {
    state.draft = {
      deviceId: "device-123",
      site: "Sitio offline",
      technician: "Técnico",
      notes: "Medición",
      photos: [{ fileId: "photo-123" }],
    };
  });
  const restarted = new Repository(disk);
  await restarted.load();
  assert.equal(restarted.state.draft.site, "Sitio offline");
  assert.equal(restarted.state.draft.photos.length, 1);
  await restarted.addInstallation({
    id: "report-123",
    device: { id: "device-123" },
    technician: "Técnico",
  });
  const persisted = JSON.parse(saved);
  assert.equal(persisted.draft.photos.length, 0);
  assert.equal(persisted.draft.site, "");
  assert.equal(persisted.installations.length, 1);
  assert.equal(persisted.outbox.length, 1);
});
