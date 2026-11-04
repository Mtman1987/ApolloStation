import { SqliteJsonRecordStore, TursoJsonRecordStore } from "./index.mjs";
import { TursoHttpAdapter } from "@spmt/turso-http";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function serviceKey(value) {
  const key = required(value, "service").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(key)) throw new Error("service must be a stable lowercase identifier");
  return key;
}

/** Adds a mandatory service namespace prefix so apps sharing one Turso DB do not collide. */
export function scopeAsyncJsonRecordStore(store, service) {
  const prefix = serviceKey(service);
  const namespace = (value) => `${prefix}:${required(value, "namespace")}`;
  const view = (target) => ({
    get: (name, tenantId, key) => target.get(namespace(name), tenantId, key),
    put: (name, tenantId, key, value) => target.put(namespace(name), tenantId, key, value),
    delete: (name, tenantId, key) => target.delete(namespace(name), tenantId, key),
    list: (name, tenantId) => target.list(namespace(name), tenantId),
  });
  return {
    initialize: () => store.initialize(),
    health: () => store.health(),
    ...view(store),
    transaction: (work) => store.transaction((tx) => work(view(tx))),
    close: () => store.close(),
  };
}

/**
 * Runtime factory. SQLite remains the development/test default. Production
 * must explicitly opt into Turso and supply server-side credentials.
 */
export function createAsyncJsonRecordStore(options = {}) {
  const service = serviceKey(options.service);
  const mode = options.mode ?? process.env.APOLLO_DATABASE_MODE ?? "sqlite";
  let store;
  if (mode === "sqlite") {
    store = new SqliteJsonRecordStore(required(options.databasePath ?? process.env.DATABASE_PATH, "DATABASE_PATH"));
  } else if (mode === "turso") {
    const url = required(options.url ?? process.env.TURSO_DATABASE_URL, "TURSO_DATABASE_URL");
    const authToken = required(options.authToken ?? process.env.TURSO_AUTH_TOKEN, "TURSO_AUTH_TOKEN");
    store = new TursoJsonRecordStore(new TursoHttpAdapter({ url, authToken }));
  } else {
    throw new Error("APOLLO_DATABASE_MODE must be sqlite or turso");
  }
  return scopeAsyncJsonRecordStore(store, service);
}
