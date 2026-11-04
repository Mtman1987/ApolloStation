import { DatabaseSync } from "node:sqlite";

const TABLE = "apollo_async_json_records_v1";

function keyPart(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`${name} must be a non-empty string of at most 300 characters`);
  return value;
}
function encode(value) {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Record value must be JSON serializable");
  return result;
}
function decode(value) { return value === undefined || value === null ? undefined : JSON.parse(value); }

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(namespace, tenant_id, record_key)
) STRICT`;
const INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${TABLE}_tenant_updated ON ${TABLE}(namespace, tenant_id, updated_at)`;

function validate(namespace, tenantId, recordKey) {
  return {
    namespace: keyPart(namespace, "namespace"),
    tenantId: keyPart(tenantId, "tenantId"),
    recordKey: keyPart(recordKey, "recordKey"),
  };
}

function tursoView(executor) {
  return {
    async get(namespace, tenantId, recordKey) {
      const key = validate(namespace, tenantId, recordKey);
      const result = await executor.execute(
        `SELECT body FROM ${TABLE} WHERE namespace=? AND tenant_id=? AND record_key=?`,
        [key.namespace, key.tenantId, key.recordKey], true,
      );
      return decode(result.rows[0]?.[0]);
    },
    async put(namespace, tenantId, recordKey, value) {
      const key = validate(namespace, tenantId, recordKey);
      await executor.execute(
        `INSERT INTO ${TABLE}(namespace,tenant_id,record_key,body,updated_at)
         VALUES(?,?,?,?,?) ON CONFLICT(namespace,tenant_id,record_key)
         DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`,
        [key.namespace, key.tenantId, key.recordKey, encode(value), new Date().toISOString()],
      );
    },
    async delete(namespace, tenantId, recordKey) {
      const key = validate(namespace, tenantId, recordKey);
      const result = await executor.execute(
        `DELETE FROM ${TABLE} WHERE namespace=? AND tenant_id=? AND record_key=?`,
        [key.namespace, key.tenantId, key.recordKey],
      );
      return result.affectedRows;
    },
    async list(namespace, tenantId) {
      const key = validate(namespace, tenantId, "list");
      const result = await executor.execute(
        `SELECT record_key,body FROM ${TABLE} WHERE namespace=? AND tenant_id=? ORDER BY record_key`,
        [key.namespace, key.tenantId], true,
      );
      return result.rows.map(([recordKey, body]) => ({ key: String(recordKey), value: decode(body) }));
    },
  };
}

export class TursoJsonRecordStore {
  constructor(adapter) {
    if (!adapter || typeof adapter.execute !== "function" || typeof adapter.transaction !== "function") {
      throw new TypeError("A transactional Turso HTTP adapter is required");
    }
    this.adapter = adapter;
    this.ready = false;
  }
  async initialize() {
    await this.adapter.execute(CREATE_SQL);
    await this.adapter.execute(INDEX_SQL);
    this.ready = true;
  }
  assertReady() { if (!this.ready) throw new Error("Record store has not been initialized"); }
  health() {
    this.assertReady();
    return this.adapter.execute("SELECT 1", [], true).then((result) => ({ ready: Number(result.rows[0]?.[0]) === 1 }));
  }
  async get(namespace, tenantId, recordKey) { this.assertReady(); return tursoView(this.adapter).get(namespace, tenantId, recordKey); }
  async put(namespace, tenantId, recordKey, value) { this.assertReady(); return tursoView(this.adapter).put(namespace, tenantId, recordKey, value); }
  async delete(namespace, tenantId, recordKey) { this.assertReady(); return tursoView(this.adapter).delete(namespace, tenantId, recordKey); }
  async list(namespace, tenantId) { this.assertReady(); return tursoView(this.adapter).list(namespace, tenantId); }
  async transaction(work) {
    this.assertReady();
    if (typeof work !== "function") throw new TypeError("Transaction callback is required");
    return this.adapter.transaction((tx) => work(tursoView(tx)));
  }
  close() {}
}

class Mutex {
  tail = Promise.resolve();
  async run(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
}

function sqliteView(db) {
  return {
    async get(namespace, tenantId, recordKey) {
      const key = validate(namespace, tenantId, recordKey);
      const row = db.prepare(`SELECT body FROM ${TABLE} WHERE namespace=? AND tenant_id=? AND record_key=?`).get(key.namespace, key.tenantId, key.recordKey);
      return decode(row?.body);
    },
    async put(namespace, tenantId, recordKey, value) {
      const key = validate(namespace, tenantId, recordKey);
      db.prepare(`INSERT INTO ${TABLE}(namespace,tenant_id,record_key,body,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(namespace,tenant_id,record_key)
        DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`).run(
          key.namespace, key.tenantId, key.recordKey, encode(value), new Date().toISOString(),
        );
    },
    async delete(namespace, tenantId, recordKey) {
      const key = validate(namespace, tenantId, recordKey);
      return Number(db.prepare(`DELETE FROM ${TABLE} WHERE namespace=? AND tenant_id=? AND record_key=?`).run(key.namespace, key.tenantId, key.recordKey).changes);
    },
    async list(namespace, tenantId) {
      const key = validate(namespace, tenantId, "list");
      return db.prepare(`SELECT record_key,body FROM ${TABLE} WHERE namespace=? AND tenant_id=? ORDER BY record_key`)
        .all(key.namespace, key.tenantId).map((row) => ({ key: row.record_key, value: decode(row.body) }));
    },
  };
}

/** Local reference backend with the same async contract and serialized transactions. */
export class SqliteJsonRecordStore {
  constructor(path) {
    if (!path) throw new Error("SQLite record store path is required");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.mutex = new Mutex();
    this.ready = false;
  }
  async initialize() {
    await this.mutex.run(() => { this.db.exec(CREATE_SQL); this.db.exec(INDEX_SQL); this.ready = true; });
  }
  assertReady() { if (!this.ready) throw new Error("Record store has not been initialized"); }
  async health() {
    this.assertReady();
    return this.mutex.run(() => ({ ready: Number(this.db.prepare("SELECT 1 AS ready").get().ready) === 1 }));
  }
  async get(namespace, tenantId, recordKey) { this.assertReady(); return this.mutex.run(() => sqliteView(this.db).get(namespace, tenantId, recordKey)); }
  async put(namespace, tenantId, recordKey, value) { this.assertReady(); return this.mutex.run(() => sqliteView(this.db).put(namespace, tenantId, recordKey, value)); }
  async delete(namespace, tenantId, recordKey) { this.assertReady(); return this.mutex.run(() => sqliteView(this.db).delete(namespace, tenantId, recordKey)); }
  async list(namespace, tenantId) { this.assertReady(); return this.mutex.run(() => sqliteView(this.db).list(namespace, tenantId)); }
  async transaction(work) {
    this.assertReady();
    if (typeof work !== "function") throw new TypeError("Transaction callback is required");
    return this.mutex.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const value = await work(sqliteView(this.db));
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }
  async close() { await this.mutex.run(() => this.db.close()); }
}
