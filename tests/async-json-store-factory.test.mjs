import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAsyncJsonRecordStore, scopeAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";

test("runtime factory defaults to local SQLite and scopes records by service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-json-factory-"));
  const store = createAsyncJsonRecordStore({ service: "nebula-arcade", databasePath: join(directory, "test.sqlite") });
  try {
    await store.initialize();
    await store.put("mosaic", "tenant-a", "board", { value: 1 });
    assert.deepEqual(await store.get("mosaic", "tenant-a", "board"), { value: 1 });
    assert.deepEqual(await store.list("mosaic", "tenant-a"), [{ key: "board", value: { value: 1 } }]);
    assert.equal((await store.health()).ready, true);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("service scopes cannot read or overwrite another service namespace", async () => {
  const backing = new Map();
  const raw = {
    async initialize() {}, async health() { return { ready: true }; }, async close() {},
    async get(ns, tenant, key) { return backing.get([ns, tenant, key].join("\\0")); },
    async put(ns, tenant, key, value) { backing.set([ns, tenant, key].join("\\0"), value); },
    async delete(ns, tenant, key) { return backing.delete([ns, tenant, key].join("\\0")) ? 1 : 0; },
    async list(ns, tenant) { return [...backing.entries()].filter(([k]) => k.startsWith([ns, tenant].join("\\0")+"\\0")).map(([k,v]) => ({key:k.split("\\0").at(-1),value:v})); },
    async transaction(work) { return work(this); },
  };
  const nebula = scopeAsyncJsonRecordStore(raw, "nebula-arcade");
  const stream = scopeAsyncJsonRecordStore(raw, "streamweaver");
  await nebula.put("state", "tenant-a", "same-key", { owner: "nebula" });
  await stream.put("state", "tenant-a", "same-key", { owner: "streamweaver" });
  assert.deepEqual(await nebula.get("state", "tenant-a", "same-key"), { owner: "nebula" });
  assert.deepEqual(await stream.get("state", "tenant-a", "same-key"), { owner: "streamweaver" });
});

test("Turso mode fails closed when server credentials are missing", () => {
  assert.throws(() => createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "turso", url: "libsql://example.turso.io" }), /TURSO_AUTH_TOKEN is required/);
});

test("unknown runtime database mode is rejected", () => {
  assert.throws(() => createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "memory" }), /APOLLO_DATABASE_MODE must be sqlite or turso/);
});

test("service identifiers are validated before storage access", () => {
  assert.throws(() => scopeAsyncJsonRecordStore({}, "../nebula"), /stable lowercase identifier/);
});
