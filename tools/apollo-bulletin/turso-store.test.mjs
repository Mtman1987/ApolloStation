import test from "node:test";
import assert from "node:assert/strict";
import { TursoBulletinStore, createTursoBulletinStoreFromEnvironment } from "./turso-store.mjs";

function memoryAdapter() {
  const rows = new Map();
  let creates = 0;
  return {
    rows,
    get creates() { return creates; },
    async execute(sql, args = []) {
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS apollo_bulletin_state")) { creates += 1; return { rows: [] }; }
      if (sql.startsWith("SELECT state_json")) {
        const value = rows.get(args[0]);
        return { rows: value === undefined ? [] : [[value]] };
      }
      if (sql.startsWith("INSERT INTO apollo_bulletin_state")) {
        rows.set(args[0], args[1]);
        return { rows: [] };
      }
      throw new Error("Unexpected SQL in Bulletin store test");
    },
  };
}

test("Turso Bulletin store restores queue and browser state through a new store instance", async () => {
  const adapter = memoryAdapter();
  const first = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  const queue = { tasks: [{ id: "task-1", status: "awaiting_review", nextRunAt: null }], activity: [{ event: "task-created" }] };
  const browser = { cookies: [{ name: "test-cookie", value: "test-only" }], origins: [] };
  await first.saveQueue(queue);
  await first.saveBrowserState(browser);

  const restarted = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  assert.deepEqual(await restarted.loadQueue(), queue);
  assert.deepEqual(await restarted.loadBrowserState(), browser);
  assert.equal(adapter.creates, 2, "each store instance initializes the table before reading or writing");
});

test("Turso Bulletin store refuses to replace corrupt persisted state with an empty queue", async () => {
  const adapter = memoryAdapter();
  const store = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  await store.initialize();
  adapter.rows.set("apollo-bulletin:queue:v1", "{invalid");
  await assert.rejects(store.loadQueue(), /Stored Apollo Bulletin state is invalid JSON; refusing to reset it/);
});

test("Turso Bulletin store is created only when an existing database URL and token are present", () => {
  assert.equal(createTursoBulletinStoreFromEnvironment({}), null);
  const store = createTursoBulletinStoreFromEnvironment({ TURSO_DATABASE_URL: "libsql://test.invalid", NODE1_TURSO_AUTH_TOKEN: "test-only" });
  assert.ok(store instanceof TursoBulletinStore);
});
