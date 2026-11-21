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
