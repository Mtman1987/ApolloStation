import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatTagRuntime, SqliteChatTagStore } from "../apps/nebula-arcade/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 23, 8, minute)).toISOString();
const command = (tenantId, kind, commandId, actorUserId, minute, extra = {}) => ({
  schemaVersion: 1,
  tenantId,
  channelId: "mtman1987",
  kind,
  commandId,
  actorUserId,
  occurredAt: at(minute),
  ...extra,
});

function fixture(fetchImpl = async () => Response.json({ ok: true })) {
  const directory = mkdtempSync(join(tmpdir(), "apollo-chat-tag-"));
  const databasePath = join(directory, "chat-tag.sqlite");
  const store = new SqliteChatTagStore(databasePath);
  const spmt = new SpmtClient({ baseUrl: "https://spmt.example", appId: "nebula-arcade", fetchImpl });
  return { directory, databasePath, store, runtime: new ChatTagRuntime(store, spmt) };
}

test("Chat Tag state and command dedupe survive an app restart", async () => {
  const item = fixture();
  try {
    await item.runtime.execute(command("tenant-one", "join", "join-alpha", "user-alpha", 0, { username: "Alpha" }));
    await item.runtime.execute(command("tenant-one", "join", "join-beta", "user-beta", 1, { username: "Beta" }));
    const tag = await item.runtime.execute(command("tenant-one", "tag", "tag-alpha-beta", "user-alpha", 2, { targetUserId: "user-beta" }));
    assert.equal(tag.result.status, "applied");
    assert.equal(tag.state.players["user-alpha"].score, 100);
    assert.equal(tag.delivery.delivered, 1);
    item.store.close();

    const restartedStore = new SqliteChatTagStore(item.databasePath);
    const restarted = new ChatTagRuntime(restartedStore, new SpmtClient({
      baseUrl: "https://spmt.example",
      appId: "nebula-arcade",
      fetchImpl: async () => Response.json({ ok: true }),
    }));
    const restored = restarted.getState("tenant-one");
    assert.equal(restored.revision, 3);
    assert.equal(restored.state.currentItUserId, "user-beta");
    assert.equal(restored.state.players["user-alpha"].score, 100);

    const replay = await restarted.execute(command("tenant-one", "tag", "tag-alpha-beta", "user-alpha", 2, { targetUserId: "user-beta" }));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.result.status, "duplicate");
    assert.equal(replay.revision, 3);
    assert.equal(replay.state.history.length, 1);
    restartedStore.close();
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("private game state is isolated by tenant", async () => {
  const item = fixture();
  try {
    await item.runtime.execute(command("tenant-one", "join", "same-command", "user-one", 0, { username: "One" }));
    await item.runtime.execute(command("tenant-two", "join", "same-command", "user-two", 0, { username: "Two" }));
    assert.deepEqual(Object.keys(item.runtime.getState("tenant-one").state.players), ["user-one"]);
    assert.deepEqual(Object.keys(item.runtime.getState("tenant-two").state.players), ["user-two"]);
  } finally {
    item.store.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("failed SPMT delivery stays durable and retries with the same idempotency keys", async () => {
  const calls = [];
  let available = false;
  const item = fixture(async (url, init = {}) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)) });
    return available ? Response.json({ ok: true }) : new Response("offline", { status: 503 });
  });
  try {
    await item.runtime.execute(command("tenant-retry", "join", "join-alpha", "user-alpha", 0, { username: "Alpha" }));
    await item.runtime.execute(command("tenant-retry", "join", "join-beta", "user-beta", 1, { username: "Beta" }));
    const first = await item.runtime.execute(command("tenant-retry", "tag", "tag-retry", "user-alpha", 2, { targetUserId: "user-beta" }));
    assert.deepEqual(first.delivery, { attempted: 3, delivered: 0, failed: 3 });
    assert.equal(item.store.listPendingDeliveries("tenant-retry").length, 3);

    available = true;
    const retry = await item.runtime.flushPending("tenant-retry");
    assert.deepEqual(retry, { attempted: 3, delivered: 3, failed: 0 });
    assert.equal(item.store.listPendingDeliveries("tenant-retry").length, 0);
    const tagCalls = calls.filter((call) => call.headers["idempotency-key"] === "chat-tag:tag:tag-retry");
    assert.deepEqual(tagCalls.map((call) => new URL(call.url).pathname), ["/v1/events", "/v1/events", "/v1/xp/awards"]);
  } finally {
    item.store.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("normalized provider ingress executes once per provider message id", async () => {
  const item = fixture();
  const inbound = (messageId, userId, username, text, minute) => ({ schemaVersion: 1, provider: "twitch", tenantId: "tenant-ingress", channelId: "mtman1987", messageId, userId, username, text, occurredAt: at(minute), roles: ["member"] });
  try {
    await item.runtime.ingest(inbound("join-alpha", "user-alpha", "Alpha", "spmt join", 0));
    await item.runtime.ingest(inbound("join-beta", "user-beta", "Beta", "spmt chattag", 1));
    const first = await item.runtime.ingest(inbound("tag-1", "user-alpha", "Alpha", "spmt tag beta", 2));
    const duplicate = await item.runtime.ingest(inbound("tag-1", "user-alpha", "Alpha", "spmt tag beta", 2));
    assert.equal(first.kind, "result");
    assert.equal(first.result.status, "applied");
    assert.equal(duplicate.kind, "result");
    assert.equal(duplicate.result.status, "duplicate");
    assert.equal(duplicate.state.history.length, 1);
  } finally {
    item.store.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});
