import { randomUUID } from "node:crypto";
import { TursoHttpAdapter } from "../../packages/turso-http/index.mjs";

const QUEUE_KEY = "apollo-bulletin:queue:v1";
const BROWSER_KEY = "apollo-bulletin:chatgpt-browser-storage-state:v1";

export class TursoBulletinStore {
  constructor({ url, authToken, adapter = new TursoHttpAdapter({ url, authToken }) }) {
    this.adapter = adapter;
    this.ready = false;
    this.leaseProbePromise = null;
  }

  async initialize() {
    if (this.ready) return;
    await this.adapter.execute(
      "CREATE TABLE IF NOT EXISTS apollo_bulletin_state (state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    await this.adapter.execute(
      "CREATE TABLE IF NOT EXISTS apollo_bulletin_leases (lease_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    );
    this.ready = true;
  }

  async read(key) {
    await this.initialize();
    const result = await this.adapter.execute(
      "SELECT state_json FROM apollo_bulletin_state WHERE state_key = ? LIMIT 1",
      [key],
      true,
    );
    if (!result.rows.length) return null;
    try { return JSON.parse(String(result.rows[0][0])); }
    catch { throw new Error("Stored Apollo Bulletin state is invalid JSON; refusing to reset it"); }
  }

  async write(key, value) {
    await this.initialize();
    await this.adapter.execute(
      "INSERT INTO apollo_bulletin_state (state_key, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
      [key, JSON.stringify(value), Date.now()],
    );
  }

  async acquireLease(key, ownerId, now = Date.now(), ttlMs = 600_000) {
    if (typeof key !== "string" || !key.trim() || typeof ownerId !== "string" || !ownerId.trim()) {
      throw new TypeError("Bulletin lease key and owner ID are required");
    }
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new TypeError("Bulletin lease time and duration must be positive safe integers");
    }
    await this.initialize();
    const result = await this.adapter.execute(
      "INSERT INTO apollo_bulletin_leases (lease_key, owner_id, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(lease_key) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at, updated_at = excluded.updated_at WHERE apollo_bulletin_leases.expires_at <= ? OR apollo_bulletin_leases.owner_id = ?",
      [key, ownerId, now + ttlMs, now, now, ownerId],
    );
    return Number(result.affectedRows ?? 0) > 0;
  }

  async releaseLease(key, ownerId, now = Date.now()) {
    if (typeof key !== "string" || typeof ownerId !== "string" || !Number.isSafeInteger(now) || now < 0) {
      throw new TypeError("Bulletin lease release requires a key, owner ID, and valid timestamp");
    }
    await this.initialize();
    const result = await this.adapter.execute(
      "UPDATE apollo_bulletin_leases SET expires_at = 0, updated_at = ? WHERE lease_key = ? AND owner_id = ?",
      [now, key, ownerId],
    );
    return Number(result.affectedRows ?? 0) > 0;
  }

  async ping() {
    await this.initialize();
    const result = await this.adapter.execute("SELECT 1 AS ready", [], true);
    if (Number(result.rows?.[0]?.[0]) !== 1) throw new Error("Turso Bulletin health probe returned an unexpected result");
    return true;
  }

  async checkDispatcherLease() {
    if (this.leaseProbePromise) return this.leaseProbePromise;
    this.leaseProbePromise = (async () => {
      const key = "apollo-bulletin-readiness-probe:" + process.pid;
      const ownerId = "readiness:" + randomUUID();
      const acquired = await this.acquireLease(key, ownerId, Date.now(), 15_000);
      if (!acquired) return false;
      return this.releaseLease(key, ownerId, Date.now());
    })();
    try { return await this.leaseProbePromise; }
    finally { this.leaseProbePromise = null; }
  }

  async requestReview(taskId, requestedAt = Date.now()) {
    if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId) || !Number.isSafeInteger(requestedAt) || requestedAt < 0) {
      throw new TypeError("Bulletin review signal requires a valid task ID and timestamp");
    }
    await this.write("apollo-bulletin:review-request:" + taskId, { requestedAt });
    return true;
  }

  async loadReviewRequests() {
    await this.initialize();
    const prefix = "apollo-bulletin:review-request:";
    const result = await this.adapter.execute(
      "SELECT state_key, state_json FROM apollo_bulletin_state WHERE state_key LIKE ?",
      [prefix + "%"],
      true,
    );
    const requests = {};
    for (const row of result.rows || []) {
      const key = String(row[0] || "");
      if (!key.startsWith(prefix)) continue;
      try {
        const request = JSON.parse(String(row[1]));
        if (!Number.isSafeInteger(request?.requestedAt) || request.requestedAt < 0) throw new Error("invalid timestamp");
        requests[key.slice(prefix.length)] = request;
      } catch { throw new Error("Stored Apollo Bulletin review signal is invalid"); }
    }
    return requests;
  }

  async checkSignalPersistence() {
    const probeId = "readiness-" + randomUUID();
    try {
      const controlRequestedAt = Date.now();
      await this.requestTaskControl(probeId, "pause", controlRequestedAt);
      const controls = await this.loadTaskControls();
      const visibleControl = controls[probeId]?.action === "pause" && controls[probeId]?.requestedAt === controlRequestedAt;
      const consumedControl = await this.consumeTaskControl(probeId);
      const reviewRequestedAt = Date.now();
      await this.requestReview(probeId, reviewRequestedAt);
      const reviews = await this.loadReviewRequests();
      const visibleReview = reviews[probeId]?.requestedAt === reviewRequestedAt;
      const consumedReview = await this.consumeReviewRequest(probeId);
      return visibleControl && consumedControl?.action === "pause" && visibleReview && Number.isSafeInteger(consumedReview?.requestedAt);
    } finally {
      await Promise.allSettled([this.consumeTaskControl(probeId), this.consumeReviewRequest(probeId)]);
    }
  }

  async requestTaskControl(taskId, action, requestedAt = Date.now()) {
    if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId) || !["pause", "stop"].includes(action) || !Number.isSafeInteger(requestedAt) || requestedAt < 0) {
      throw new TypeError("Bulletin task control requires a valid task ID, action, and timestamp");
    }
    await this.write("apollo-bulletin:task-control:" + taskId, { action, requestedAt });
    return true;
  }

  async loadTaskControls() {
    await this.initialize();
    const prefix = "apollo-bulletin:task-control:";
    const result = await this.adapter.execute(
      "SELECT state_key, state_json FROM apollo_bulletin_state WHERE state_key LIKE ?",
      [prefix + "%"],
      true,
    );
    const controls = {};
    for (const row of result.rows || []) {
      const key = String(row[0] || "");
      if (!key.startsWith(prefix)) continue;
      try { controls[key.slice(prefix.length)] = JSON.parse(String(row[1])); }
      catch { throw new Error("Stored Apollo Bulletin task control is invalid JSON"); }
    }
    return controls;
  }

  async consumeTaskControl(taskId) {
    if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
      throw new TypeError("Bulletin task control requires a valid task ID");
    }
    await this.initialize();
    const result = await this.adapter.execute(
      "DELETE FROM apollo_bulletin_state WHERE state_key = ? RETURNING state_json",
      ["apollo-bulletin:task-control:" + taskId],
      true,
    );
    if (!result.rows.length) return null;
    try {
      const control = JSON.parse(String(result.rows[0][0]));
      return ["pause", "stop"].includes(control.action) ? control : null;
    } catch { throw new Error("Stored Apollo Bulletin task control is invalid JSON"); }
  }

  async consumeReviewRequest(taskId) {
    if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
      throw new TypeError("Bulletin review signal requires a valid task ID");
    }
    await this.initialize();
    const result = await this.adapter.execute(
      "DELETE FROM apollo_bulletin_state WHERE state_key = ? RETURNING state_json",
      ["apollo-bulletin:review-request:" + taskId],
      true,
    );
    if (!result.rows.length) return null;
    try { return JSON.parse(String(result.rows[0][0])); }
    catch { throw new Error("Stored Apollo Bulletin review signal is invalid JSON"); }
  }

  loadQueue() { return this.read(QUEUE_KEY); }
  saveQueue(state) { return this.write(QUEUE_KEY, state); }
  loadBrowserState() { return this.read(BROWSER_KEY); }
  saveBrowserState(state) { return this.write(BROWSER_KEY, state); }
}

export function createTursoBulletinStoreFromEnvironment(environment = process.env) {
  const url = environment.TURSO_DATABASE_URL || environment.SHARED_TURSO_DATABASE_URL;
  // The already-provisioned shared runtime token is the durable application
  // credential. Node-scoped GitHub tokens may be read-only and are fallback
  // credentials only; do not let one shadow the existing runtime writer.
  const authTokenSource = environment.TURSO_AUTH_TOKEN ? "TURSO_AUTH_TOKEN"
    : environment.NODE1_TURSO_AUTH_TOKEN ? "NODE1_TURSO_AUTH_TOKEN" : null;
  const authToken = authTokenSource ? environment[authTokenSource] : "";
  if (!url || !authToken) return null;
  const store = new TursoBulletinStore({ url, authToken });
  store.credentialSource = authTokenSource;
  return store;
}
