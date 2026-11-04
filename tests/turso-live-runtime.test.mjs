import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";
import { TursoJsonRecordStore } from "../packages/async-json-store/index.mjs";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const enabled = Boolean(url && authToken && process.env.APOLLO_TURSO_LIVE_TEST === "1");

test("live Turso connection can write, read back, roll back, and survive a fresh client", {
  skip: !enabled && "Set APOLLO_TURSO_LIVE_TEST=1, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the deployment environment",
}, async () => {
  const namespace = `apollo-live-smoke-${randomUUID()}`;
  const tenantId = `hostless-node-${process.env.HOSTLESS_APP_ID ?? "unknown"}`;
  const recordKey = randomUUID();
  const payload = { marker: "apollo-turso-live-smoke", createdAt: new Date().toISOString(), nonce: randomUUID() };
  const makeStore = () => new TursoJsonRecordStore(new TursoHttpAdapter({ url, authToken }));
  const first = makeStore();
  let second;
  try {
    await first.initialize();
    assert.deepEqual(await first.health(), { ready: true });

    await first.put(namespace, tenantId, recordKey, payload);
    assert.deepEqual(await first.get(namespace, tenantId, recordKey), payload);

    await assert.rejects(first.transaction(async (tx) => {
      await tx.put(namespace, tenantId, "rollback-check", { mustNotPersist: true });
      throw new Error("intentional rollback probe");
    }), /intentional rollback probe/);
    assert.equal(await first.get(namespace, tenantId, "rollback-check"), undefined);

    await first.close();
    second = makeStore();
    await second.initialize();
    assert.deepEqual(await second.get(namespace, tenantId, recordKey), payload);
    assert.deepEqual(await second.health(), { ready: true });
  } finally {
    try {
      if (second) {
        await second.delete(namespace, tenantId, recordKey);
        await second.delete(namespace, tenantId, "rollback-check");
        await second.close();
      } else {
        await first.delete(namespace, tenantId, recordKey);
        await first.delete(namespace, tenantId, "rollback-check");
      }
    } catch {
      // A failed connection may prevent cleanup. The namespace is unique and
      // contains only synthetic smoke-test data; it never targets app records.
    }
  }
});
