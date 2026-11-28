import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const enabled = Boolean(url && authToken && process.env.APOLLO_TURSO_LIVE_TEST === "1");

test("live Turso smoke check", { skip: !enabled }, async () => {
  const namespace = `apollo-live-smoke-${randomUUID()}`;
  const tenantId = `hostless-node-${process.env.HOSTLESS_APP_ID ?? "unknown"}`;
  const recordKey = randomUUID();
  const payload = { marker: "apollo-turso-live-smoke", nonce: randomUUID() };
  const makeStore = () => createAsyncJsonRecordStore({ service: "apollo-live-smoke", mode: "turso", url, authToken });
  const first = makeStore();
  let second;
  try {
    await first.initialize();
    assert.deepEqual(await first.health(), { ready: true });
    await first.put(namespace, tenantId, recordKey, payload);
    assert.deepEqual(await first.get(namespace, tenantId, recordKey), payload);
    await assert.rejects(first.transaction(async (tx) => {
      await tx.put(namespace, tenantId, "rollback-check", { marker: "should-not-persist" });
      throw new Error("intentional rollback probe");
    }), /intentional rollback probe/);
    assert.equal(await first.get(namespace, tenantId, "rollback-check"), undefined);
    await first.close();
    second = makeStore();
    await second.initialize();
    assert.deepEqual(await second.get(namespace, tenantId, recordKey), payload);
  } finally {
    try {
      const cleanup = second ?? first;
      await cleanup.delete(namespace, tenantId, recordKey);
      await cleanup.delete(namespace, tenantId, "rollback-check");
      await cleanup.close();
    } catch { /* unique synthetic namespace only */ }
  }
});

test("live Turso Bulletin store supports its durable control signals and exclusive dispatcher lease", { skip: !enabled }, async () => {
  const { TursoBulletinStore } = await import("../tools/apollo-bulletin/turso-store.mjs");
  const ownerId = "live-smoke-" + randomUUID();
  const store = new TursoBulletinStore({ url, authToken });
  try {
    await store.initialize();
    assert.equal(await store.ping(), true);
    assert.equal(await store.checkSignalPersistence(), true);
    assert.equal(await store.acquireLease("apollo-bulletin-live-smoke", ownerId, Date.now(), 60_000), true);
    assert.equal(await store.acquireLease("apollo-bulletin-live-smoke", "other-" + ownerId, Date.now(), 60_000), false);
    assert.equal(await store.releaseLease("apollo-bulletin-live-smoke", ownerId), true);
  } finally {
    await store.releaseLease("apollo-bulletin-live-smoke", ownerId).catch(() => false);
  }
});
