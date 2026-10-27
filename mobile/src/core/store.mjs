export const emptyState = () => ({
  revision: 0,
  devices: [],
  diagnostics: [],
  installations: [],
  outbox: [],
  catalog: {},
  draft: { deviceId: null, site: '', notes: '', technician: '', photos: [] },
  settings: { backendUrl: 'http://10.0.2.2:8787' },
});
export const newId = () =>
  `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`;
export class Repository {
  constructor(driver) {
    this.driver = driver;
    this.tail = Promise.resolve();
    this.listeners = new Set();
  }
  async load() {
    const value = await this.driver.read();
    this.state = value ? JSON.parse(value) : emptyState();
    await this.update(state => {
      for (const job of state.outbox) {
        if (job.status === 'sending') {
          job.status = 'pending';
          job.nextAt = 0;
        }
      }
    });
    return this.state;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  update(change) {
    const operation = this.tail.then(async () => {
      const next = JSON.parse(JSON.stringify(this.state));
      change(next);
      next.revision++;
      await this.driver.commit(JSON.stringify(next), this.state.revision);
      this.state = next;
      this.listeners.forEach(listener => listener(next));
      return next;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async addDevices(devices) {
    return this.update(state => {
      for (const device of devices) {
        const old = state.devices.find(d => d.ip === device.ip);
        if (old) {
          Object.assign(old, device, { id: old.id });
        } else {
          state.devices.push({ id: newId(), ...device });
        }
      }
    });
  }
  addDiagnostic(deviceId, protocol, result) {
    return this.update(state =>
      state.diagnostics.unshift({
        id: newId(),
        deviceId,
        protocol,
        result,
        createdAt: new Date().toISOString(),
      }),
    );
  }
  addInstallation(installation) {
    return this.update(state => {
      state.installations.unshift(installation);
      state.outbox.push({
        id: newId(),
        installationId: installation.id,
        status: 'pending',
        attempts: 0,
        nextAt: 0,
        createdAt: new Date().toISOString(),
      });
      state.draft = {
        deviceId: installation.device?.id || null,
        site: '',
        notes: '',
        technician: installation.technician || '',
        photos: [],
      };
    });
  }
}
export class SyncEngine {
  constructor(repository, transport, now = Date.now, random = Math.random) {
    this.repo = repository;
    this.transport = transport;
    this.now = now;
    this.random = random;
    this.running = false;
  }
  async run(force = false) {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const jobs = this.repo.state.outbox.filter(
        job =>
          ['pending', 'failed'].includes(job.status) &&
          (force || job.nextAt <= this.now()),
      );
      for (const queued of jobs) {
        await this.repo.update(state => {
          const job = state.outbox.find(j => j.id === queued.id);
          job.status = 'sending';
          job.error = null;
        });
        try {
          const installation = this.repo.state.installations.find(
            i => i.id === queued.installationId,
          );
          if (!installation) {
            throw new Error('Instalación local no encontrada');
          }
          const ack = await this.transport.send(queued.id, installation);
          if (
            ack.eventId !== queued.id ||
            ack.installationId !== installation.id
          ) {
            throw new Error('ACK de sincronización inválido');
          }
          await this.repo.update(state => {
            const job = state.outbox.find(j => j.id === queued.id);
            job.status = 'done';
            job.syncedAt = new Date(this.now()).toISOString();
            job.nextAt = 0;
          });
        } catch (error) {
          await this.repo.update(state => {
            const job = state.outbox.find(j => j.id === queued.id);
            job.status = 'failed';
            job.attempts++;
            job.nextAt =
              this.now() +
              Math.min(300000, 2000 * 2 ** Math.min(job.attempts - 1, 8)) +
              Math.floor(this.random() * 1000);
            job.error = String(error.message || error).slice(0, 240);
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
