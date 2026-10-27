import test from "node:test";
import assert from "node:assert/strict";
import { Repository, SyncEngine } from "../mobile/src/core/store.mjs";
function driver(initial = null) {
  return {
    value: initial,
    fail: false,
    async read() {
      return this.value;
    },
    async commit(next, expected) {
      if (this.fail) {
        throw new Error("Disco lleno");
      }
      assert.equal(
        JSON.parse(this.value || '{"revision":0}').revision,
        expected
      );
      this.value = next;
    },
  };
}
const installation = { id: "report-12345678", site: "Gabinete A", photos: [] };
test("installation and outbox commit together; failed disk writes change neither", async () => {
  const disk = driver(),
    repo = new Repository(disk);
  await repo.load();
  disk.fail = true;
  await assert.rejects(repo.addInstallation(installation), /Disco lleno/);
  assert.equal(repo.state.installations.length, 0);
  assert.equal(repo.state.outbox.length, 0);
  disk.fail = false;
  await repo.addInstallation(installation);
  const persisted = JSON.parse(disk.value);
  assert.equal(
    persisted.installations[0].id,
    persisted.outbox[0].installationId
  );
});
test("concurrent UI writes preserve all changes", async () => {
  const repo = new Repository(driver());
  await repo.load();
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      repo.addDevices([{ ip: `192.168.1.${i + 1}` }])
    )
  );
  assert.equal(repo.state.devices.length, 30);
});
test("failed transfer persists backoff, ignores early retry, retries idempotently and survives restart", async () => {
  const disk = driver(),
    repo = new Repository(disk);
  await repo.load();
  await repo.addInstallation(installation);
  let calls = 0;
  const engine = new SyncEngine(
    repo,
    {
      async send(id, report) {
        calls++;
        if (calls === 1) {
          throw new Error("Conexión perdida");
        }
        return { eventId: id, installationId: report.id };
      },
    },
    () => 1000,
    () => 0
  );
  await engine.run();
  assert.equal(repo.state.outbox[0].status, "failed");
  assert.equal(repo.state.outbox[0].nextAt, 3000);
  await engine.run();
  assert.equal(calls, 1);
  await engine.run(true);
  assert.equal(repo.state.outbox[0].status, "done");
  const reopened = new Repository(disk);
  await reopened.load();
  assert.equal(reopened.state.outbox[0].status, "done");
});
test("only a matching ACK completes a job and duplicate workers are suppressed", async () => {
  const repo = new Repository(driver());
  await repo.load();
  await repo.addInstallation(installation);
  let calls = 0;
  const engine = new SyncEngine(repo, {
    async send() {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { eventId: "wrong", installationId: installation.id };
    },
  });
  await Promise.all([engine.run(), engine.run()]);
  assert.equal(calls, 1);
  assert.equal(repo.state.outbox[0].status, "failed");
  assert.match(repo.state.outbox[0].error, /ACK/);
});
test("interrupted sending jobs recover as pending after reopening", async () => {
  const disk = driver(),
    repo = new Repository(disk);
  await repo.load();
  await repo.addInstallation(installation);
  await repo.update((state) => {
    state.outbox[0].status = "sending";
  });
  const restarted = new Repository(disk);
  await restarted.load();
  assert.equal(restarted.state.outbox[0].status, "pending");
});
