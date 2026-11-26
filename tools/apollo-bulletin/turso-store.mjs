import { TursoHttpAdapter } from "../../packages/turso-http/index.mjs";

const QUEUE_KEY = "apollo-bulletin:queue:v1";
const BROWSER_KEY = "apollo-bulletin:chatgpt-browser-storage-state:v1";

export class TursoBulletinStore {
  constructor({ url, authToken, adapter = new TursoHttpAdapter({ url, authToken }) }) {
    this.adapter = adapter;
    this.ready = false;
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
      "INSERT INTO apollo_bulletin_leases (lease_key, owner_id, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(lease_key) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at, updated_at = excluded.updated_at WHERE apollo_bulletin_leases.expires_at <= ?",
      [key, ownerId, now + ttlMs, now, now],
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

  loadQueue() { return this.read(QUEUE_KEY); }
  saveQueue(state) { return this.write(QUEUE_KEY, state); }
  loadBrowserState() { return this.read(BROWSER_KEY); }
  saveBrowserState(state) { return this.write(BROWSER_KEY, state); }
}

export function createTursoBulletinStoreFromEnvironment(environment = process.env) {
  const url = environment.TURSO_DATABASE_URL || environment.SHARED_TURSO_DATABASE_URL;
  const authToken = environment.NODE1_TURSO_AUTH_TOKEN || environment.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  return new TursoBulletinStore({ url, authToken });
}
