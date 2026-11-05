import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncStreamWeaverSocialReactionStore } from "../apps/streamweaver/dist/async-social-reaction-store.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "streamweaver-social-reactions-"));
  const databasePath = join(directory, "records.sqlite");
  const store = new AsyncStreamWeaverSocialReactionStore({ mode: "sqlite", databasePath, now: () => "2026-11-05T12:00:00.000Z" });
  await store.initialize();
  return { directory, databasePath, store, async close() { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("async social reactions preserve idempotent enqueue, global tenant queue, and job lifecycle", async () => {
  const t = await fixture();
  try {
    await t.store.enqueue({ tenantId: "tenant-a", deliveryId: "delivery-1", trigger: "!boop", actor: "Alice", target: "Bob", animationKey: "boop" });
    await t.store.enqueue({ tenantId: "tenant-a", deliveryId: "delivery-1", trigger: "!hug", actor: "Other", target: "", animationKey: "hug" });
    await t.store.enqueue({ tenantId: "tenant-b", deliveryId: "delivery-2", trigger: "!cuddle", actor: "Carol", animationKey: "cuddle" });
    const pending = await t.store.pending();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].trigger, "!boop");
    assert.deepEqual((await t.store.count("tenant-a")), 0);
    await t.store.setJob("tenant-a", "delivery-1", "job-1", 1);
    assert.equal((await t.store.pending()).find((item) => item.deliveryId === "delivery-1").state, "waiting");
    await t.store.retry("tenant-a", "delivery-1");
    assert.equal((await t.store.pending()).find((item) => item.deliveryId === "delivery-1").jobId, undefined);
    await t.store.complete("tenant-a", "delivery-1", "Alice boops Bob");
    assert.deepEqual(await t.store.recent("tenant-a"), ["Alice boops Bob"]);
    assert.equal(await t.store.count("tenant-a"), 1);
    assert.equal((await t.store.pending()).some((item) => item.deliveryId === "delivery-1"), false);
  } finally { await t.close(); }
});

test("async social reaction jobs survive restart and preserve tenant isolation", async () => {
  const t = await fixture();
  await t.store.enqueue({ tenantId: "tenant-a", deliveryId: "delivery-a", trigger: "!boop", actor: "Alice", animationKey: "boop" });
  await t.store.enqueue({ tenantId: "tenant-b", deliveryId: "delivery-b", trigger: "!hug", actor: "Bob", animationKey: "hug" });
  await t.store.close();
  const reopened = new AsyncStreamWeaverSocialReactionStore({ mode: "sqlite", databasePath: t.databasePath });
  await reopened.initialize();
  try {
    assert.deepEqual((await reopened.pending()).map((item) => item.tenantId), ["tenant-a", "tenant-b"]);
    await reopened.complete("tenant-b", "delivery-b", "Bob hugs Alice");
    assert.deepEqual(await reopened.recent("tenant-b"), ["Bob hugs Alice"]);
    assert.deepEqual(await reopened.recent("tenant-a"), []);
  } finally {
    await reopened.close();
    await rm(t.directory, { recursive: true, force: true });
  }
});

test("social action executor and reconciler await the async store", async () => {
  const t = await fixture();
  try {
    const events = [];
    const client = { publishEvent: async (...args) => { events.push(args); return {}; } };
    const { StreamWeaverSocialActionExecutor, StreamWeaverSocialReactionReconciler } = await import("../apps/streamweaver/dist/donor-social-actions.js");
    const executor = new StreamWeaverSocialActionExecutor(client, t.store);
    const invocation = {
      tenantId: "tenant-a", deliveryId: "delivery-social-1", canonicalTrigger: "!boop",
      actor: { userId: "alice-id", providerUserId: "alice-provider", username: "alice", displayName: "Alice" },
      target: { userId: "bob-id", providerUserId: "bob-provider", username: "bob" },
      provider: "twitch", channelId: "room-a",
    };
    assert.equal(await executor.execute(invocation), undefined);
    assert.equal((await t.store.pending()).length, 1);
    const reconciler = new StreamWeaverSocialReactionReconciler(t.store, client, () => undefined);
    const result = await reconciler.runOnce();
    assert.deepEqual(result, { observed: 1, waiting: 0, published: 0, failed: 1 });
    assert.equal(await t.store.count("tenant-a"), 1);
    assert.equal((await t.store.pending()).length, 0);
    assert.equal(events.length, 2);
    assert.match((await t.store.recent("tenant-a"))[0], /Alice/);
  } finally { await t.close(); }
});
