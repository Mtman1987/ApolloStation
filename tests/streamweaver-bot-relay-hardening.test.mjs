import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteStreamWeaverBotRelayStore, StreamWeaverBotRelayConsumer, detectBotRelayRequest, extractRelayQuotedSegments, preserveRelayQuotedSegments } from "../apps/streamweaver/dist/index.js";

function message(overrides = {}) {
  return { schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-a", channelId: "11111", messageId: "msg-1", text: "hello", occurredAt: "2026-08-29T12:00:00.000Z", actor: { providerUserId: "user-a", canonicalUserId: "canonical-a", username: "sender", displayName: "Sender", isBot: false, roles: ["member"] }, mentions: [], ...overrides };
}
function delivery(value, id) { return { schemaVersion: 1, deliveryId: id, consumerId: "streamweaver.bot-relay", message: value, attempts: 0 }; }

test("human relay parsing preserves quoted spans byte-for-byte", () => {
  assert.deepEqual(detectBotRelayRequest("Athena tell mamafeisty I sent her a message in Discord for after stream or when she has time"), { target: "mamafeisty", message: "I sent her a message in Discord for after stream or when she has time" });
  assert.deepEqual(detectBotRelayRequest("pass a message to @mama: keep “This EXACT” and 'that too'"), { target: "mama", message: "keep “This EXACT” and 'that too'" });
  assert.deepEqual(extractRelayQuotedSegments("keep “This EXACT” and 'that too'"), ["“This EXACT”", "'that too'"]);
  assert.equal(preserveRelayQuotedSegments('keep "EXACT"', 'keep "changed"'), 'keep "EXACT"');
});

test("any human can relay without BotShare and the intended recipient can reply both ways", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-relay-"));
  const sent = [];
  const store = new SqliteStreamWeaverBotRelayStore(path.join(dir, "relay.sqlite"));
  const consumer = new StreamWeaverBotRelayConsumer(store, { send: async (outbound) => { sent.push(outbound); return { providerMessageId: `sent-${sent.length}` }; } });
  try {
    const target = message({ tenantId: "tenant-b", connectionId: "discord-b", channelId: "22222", messageId: "seen-b", actor: { providerUserId: "user-b", canonicalUserId: "canonical-b", username: "mamafeisty", displayName: "MamaFeisty", isBot: false, roles: ["member"] } });
    await consumer.deliver(delivery(target, "seen-b"));
    assert.equal(store.botShareEnabled("tenant-a"), false);
    assert.equal(store.botShareEnabled("tenant-b"), false);
    const source = message({ messageId: "relay-a", text: "Athena tell mamafeisty I sent her a message in Discord for after stream" });
    await consumer.deliver(delivery(source, "relay-a"));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].tenantId, "tenant-b");
    assert.match(sent[0].text, /I sent her a message in Discord for after stream/);
    const reply = { ...target, messageId: "reply-b", text: "reply Got it — I will look after stream.", occurredAt: "2026-08-29T12:01:00.000Z" };
    await consumer.deliver(delivery(reply, "reply-b"));
    assert.equal(sent.at(-1).tenantId, "tenant-a");
    assert.match(sent.at(-1).text, /Got it — I will look after stream/);
    const wrong = message({ messageId: "wrong", actor: { providerUserId: "intruder", canonicalUserId: "intruder", username: "intruder", isBot: false, roles: ["member"] }, text: "reply steal this", occurredAt: "2026-08-29T12:02:00.000Z" });
    assert.equal(consumer.willHandle(wrong), false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("autonomous bot relay requires bilateral BotShare", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-botshare-"));
  const sent = [];
  const store = new SqliteStreamWeaverBotRelayStore(path.join(dir, "relay.sqlite"));
  const consumer = new StreamWeaverBotRelayConsumer(store, { send: async (outbound) => { sent.push(outbound); return { providerMessageId: `sent-${sent.length}` }; } });
  try {
    const target = message({ tenantId: "tenant-b", connectionId: "discord-b", channelId: "22222", messageId: "target", actor: { providerUserId: "bot-b", username: "moonbeam", displayName: "Moonbeam", isBot: true, roles: ["member"] } });
    await consumer.deliver(delivery(target, "target"));
    const source = message({ messageId: "bot-1", text: "relay to moonbeam system status green", actor: { providerUserId: "bot-a", username: "athena", displayName: "Athena", isBot: true, roles: ["member"] } });
    await consumer.deliver(delivery(source, "bot-1"));
    assert.match(sent.at(-1).text, /both communities/i);
    store.setBotShare("tenant-a", true);
    await consumer.deliver(delivery({ ...source, messageId: "bot-2" }, "bot-2"));
    assert.match(sent.at(-1).text, /both communities/i);
    store.setBotShare("tenant-b", true);
    await consumer.deliver(delivery({ ...source, messageId: "bot-3" }, "bot-3"));
    assert.equal(sent.at(-1).tenantId, "tenant-b");
    assert.match(sent.at(-1).text, /system status green/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
