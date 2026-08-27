import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommlinkLiveChatStore, createCommlinkLiveChatGatewayConsumer } from "../apps/commlink/dist/index.js";

function message(overrides = {}) {
  return {
    schemaVersion: 1,
    tenantId: "tenant-a",
    provider: "twitch",
    connectionId: "twitch-main",
    channelId: "spacechannel",
    messageId: "message-1",
    text: "hello from chat",
    occurredAt: "2026-08-27T04:00:00.000Z",
    actor: {
      providerUserId: "provider-user-1",
      canonicalUserId: "user-1",
      username: "viewer",
      displayName: "Viewer",
      isBot: false,
      roles: ["member"],
    },
    mentions: [],
    ...overrides,
  };
}

function dbPath() { return join(mkdtempSync(join(tmpdir(), "commlink-live-chat-")), "chat.sqlite"); }

test("Commlink live chat consumes normalized provider messages without mixing them into mail authority", () => {
  const store = new CommlinkLiveChatStore(dbPath());
  const consumer = createCommlinkLiveChatGatewayConsumer(store);
  assert.equal(consumer.accepts(message()), true);
  consumer.deliver({ schemaVersion: 1, deliveryId: "delivery-1", consumerId: consumer.id, message: message(), attempts: 0 });
  const rows = store.list({ tenantId: "tenant-a" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "twitch");
  assert.equal(rows[0].providerUserId, "provider-user-1");
  assert.equal(rows[0].canonicalUserId, "user-1");
  assert.equal(rows[0].text, "hello from chat");
  store.close();
});

test("Commlink live chat preserves provider/channel identity and dedupes replay", () => {
  const store = new CommlinkLiveChatStore(dbPath());
  const first = store.ingest(message());
  const replay = store.ingest(message({ text: "changed replay text" }));
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(store.count("tenant-a"), 1);
  assert.equal(store.list({ tenantId: "tenant-a" })[0].text, "hello from chat");
  store.ingest(message({ provider: "discord", connectionId: "discord-main", channelId: "discord-room", messageId: "discord-1", actor: { providerUserId: "77", username: "same-name", displayName: "Viewer", isBot: false, roles: ["member"] } }));
  store.ingest(message({ provider: "kick", connectionId: "kick-main", channelId: "kick-room", messageId: "kick-1", actor: { providerUserId: "88", username: "same-name", displayName: "Viewer", isBot: false, roles: ["member"] } }));
  assert.equal(store.count("tenant-a"), 3);
  assert.equal(store.list({ tenantId: "tenant-a", provider: "discord" })[0].providerUserId, "77");
  assert.equal(store.list({ tenantId: "tenant-a", provider: "kick" })[0].providerUserId, "88");
  store.close();
});

test("Commlink live chat is tenant-isolated, searchable, and survives reopen", () => {
  const path = dbPath();
  let store = new CommlinkLiveChatStore(path);
  store.ingest(message({ text: "alpha signal" }));
  store.ingest(message({ tenantId: "tenant-b", messageId: "message-b", text: "beta private" }));
  assert.equal(store.list({ tenantId: "tenant-a", search: "alpha" }).length, 1);
  assert.equal(store.list({ tenantId: "tenant-a", search: "beta" }).length, 0);
  assert.equal(store.list({ tenantId: "tenant-b" }).length, 1);
  store.close();
  store = new CommlinkLiveChatStore(path);
  assert.equal(store.count("tenant-a"), 1);
  assert.equal(store.list({ tenantId: "tenant-a", channelId: "spacechannel" })[0].messageId, "message-1");
  store.close();
});

test("Commlink live chat rejects misrouted deliveries instead of silently accepting them", () => {
  const store = new CommlinkLiveChatStore(dbPath());
  const consumer = createCommlinkLiveChatGatewayConsumer(store);
  assert.throws(() => consumer.deliver({ schemaVersion: 1, deliveryId: "delivery-1", consumerId: "someone-else", message: message(), attempts: 0 }), /wrong consumer/);
  assert.equal(store.count("tenant-a"), 0);
  store.close();
});
