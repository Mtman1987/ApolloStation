import test from "node:test";
import assert from "node:assert/strict";
import { TursoBulletinStore, createTursoBulletinStoreFromEnvironment } from "./turso-store.mjs";

function memoryAdapter() {
  const rows = new Map();
  const leases = new Map();
  let stateCreates = 0, leaseCreates = 0;
  return {
    rows, leases,
    get creates() { return stateCreates + leaseCreates; },
    async execute(sql, args = []) {
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS apollo_bulletin_state")) { stateCreates += 1; return { rows: [], affectedRows: 0 }; }
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS apollo_bulletin_leases")) { leaseCreates += 1; return { rows: [], affectedRows: 0 }; }
      if (sql.startsWith("SELECT state_json")) {
        const value = rows.get(args[0]);
        return { rows: value === undefined ? [] : [[value]], affectedRows: 0 };
      }
      if (sql.startsWith("INSERT INTO apollo_bulletin_state")) {
        rows.set(args[0], args[1]);
        return { rows: [], affectedRows: 1 };
      }
      if (sql.startsWith("INSERT INTO apollo_bulletin_leases")) {
        const [key, ownerId, expiresAt, updatedAt, now] = args;
        const current = leases.get(key);
        if (!current || current.expiresAt <= now) {
          leases.set(key, { ownerId, expiresAt, updatedAt });
          return { rows: [], affectedRows: 1 };
        }
        return { rows: [], affectedRows: 0 };
      }
      if (sql.startsWith("UPDATE apollo_bulletin_leases")) {
        const [updatedAt, key, ownerId] = args;
        const current = leases.get(key);
        if (!current || current.ownerId !== ownerId) return { rows: [], affectedRows: 0 };
        leases.set(key, { ...current, expiresAt: 0, updatedAt });
        return { rows: [], affectedRows: 1 };
      }
      throw new Error("Unexpected SQL in Bulletin store test: " + sql);
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
  assert.equal(adapter.creates, 4, "each store instance initializes both state and lease tables");
});

test("Turso Bulletin store refuses to replace corrupt persisted state with an empty queue", async () => {
  const adapter = memoryAdapter();
  const store = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  await store.initialize();
  adapter.rows.set("apollo-bulletin:queue:v1", "{invalid");
  await assert.rejects(store.loadQueue(), /Stored Apollo Bulletin state is invalid JSON; refusing to reset it/);
});

test("Turso cron lease is exclusive across store instances and only its owner can release it", async () => {
  const adapter = memoryAdapter();
  const first = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  const second = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  const [firstWon, secondWon] = await Promise.all([
    first.acquireLease("hostless-cron", "worker-a", 1_000, 5_000),
    second.acquireLease("hostless-cron", "worker-b", 1_000, 5_000),
  ]);
  assert.equal(Number(firstWon) + Number(secondWon), 1);
  const owner = firstWon ? "worker-a" : "worker-b";
  const other = firstWon ? second : first;
  assert.equal(await other.acquireLease("hostless-cron", "worker-c", 2_000, 5_000), false);
  assert.equal(await other.releaseLease("hostless-cron", "worker-c", 2_001), false);
  const ownerStore = firstWon ? first : second;
  assert.equal(await ownerStore.releaseLease("hostless-cron", owner, 2_002), true);
  assert.equal(await other.acquireLease("hostless-cron", "worker-c", 2_003, 5_000), true);
});

test("Turso cron lease can be claimed after expiry", async () => {
  const adapter = memoryAdapter();
  const first = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  const second = new TursoBulletinStore({ url: "libsql://test.invalid", authToken: "test-only", adapter });
  assert.equal(await first.acquireLease("hostless-cron", "worker-a", 1_000, 1_000), true);
  assert.equal(await second.acquireLease("hostless-cron", "worker-b", 1_999, 1_000), false);
  assert.equal(await second.acquireLease("hostless-cron", "worker-b", 2_000, 1_000), true);
});

test("Turso Bulletin store is created only when an existing database URL and token are present", () => {
  assert.equal(createTursoBulletinStoreFromEnvironment({}), null);
  const store = createTursoBulletinStoreFromEnvironment({ TURSO_DATABASE_URL: "libsql://test.invalid", NODE1_TURSO_AUTH_TOKEN: "test-only" });
  assert.ok(store instanceof TursoBulletinStore);
});
