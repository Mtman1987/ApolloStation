import assert from "node:assert/strict";
import test from "node:test";
import { StreamWeaverCommunityStore } from "../apps/streamweaver/dist/community-store.js";
import { SqliteStreamWeaverStellaLoungeHostStore, StreamWeaverStellaLoungeHost } from "../apps/streamweaver/dist/stella-lounge-host.js";

test("Stella sends bounded ambient host messages only when Space Mountain is live and due", async () => {
  const community = new StreamWeaverCommunityStore(":memory:");
  const hostStore = new SqliteStreamWeaverStellaLoungeHostStore(":memory:");
  const messages = [];
  const host = new StreamWeaverStellaLoungeHost({
    store: hostStore,
    community,
    twitch: { uptime: async () => ({ id: "stream-1", startedAt: "2026-11-03T20:00:00.000Z", title: "Space Mountain", gameName: "Just Chatting", viewerCount: 42 }) },
    connections: [{ tenantId: "spacemountainlive", provider: "twitch", connectionId: "twitch-connection", channelId: "123456789", desired: true }],
    egress: { send: async message => { messages.push(message); return { providerMessageId: "sent" }; } },
    random: () => 0,
  });
  try {
    const startup = await host.runOnce(500);
    assert.equal(startup.attempted, 0);
    assert.equal(hostStore.view("spacemountainlive").nextAt, 360_500);
    hostStore.setNextAt("spacemountainlive", 1_000);
    const first = await host.runOnce(1_000);
    assert.deepEqual(first, { attempted: 1, sent: 1, skipped: 0, failed: 0 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].provider, "twitch");
    assert.equal(messages[0].channelId, "123456789");
    assert.match(messages[0].text, /Stella/);
    assert.match(messages[0].text, /Just Chatting/);
    assert.equal(messages[0].idempotencyKey, "stella-lounge-host:spacemountainlive:1000");
    assert.equal(hostStore.view("spacemountainlive").lastTopic, "game");
    await host.runOnce(2_000);
    assert.equal(messages.length, 1);
    hostStore.setNextAt("spacemountainlive", 800_000);
    await host.runOnce(800_000);
    assert.equal(messages.length, 2);
    assert.notEqual(hostStore.view("spacemountainlive").lastTopic, "game");
  } finally { host.close(); community.close(); }
});

test("Stella retries a failed send with the same idempotency slot", async () => {
  const community = new StreamWeaverCommunityStore(":memory:");
  const hostStore = new SqliteStreamWeaverStellaLoungeHostStore(":memory:");
  const keys = [];
  let calls = 0;
  const host = new StreamWeaverStellaLoungeHost({
    store: hostStore,
    community,
    twitch: { uptime: async () => ({ id: "stream-1", startedAt: "2026-11-03T20:00:00.000Z", title: "Space Mountain", gameName: "Just Chatting", viewerCount: 42 }) },
    connections: [{ tenantId: "spacemountainlive", provider: "twitch", connectionId: "twitch-connection", channelId: "123456789", desired: true }],
    egress: { send: async message => { keys.push(message.idempotencyKey); if (calls++ === 0) throw new Error("temporary egress failure"); return {}; } },
    random: () => 0,
  });
  try {
    hostStore.setNextAt("spacemountainlive", 1_000);
    assert.equal((await host.runOnce(1_000)).failed, 1);
    assert.equal((await host.runOnce(61_000)).sent, 1);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(hostStore.view("spacemountainlive").slotId, 0);
  } finally { host.close(); community.close(); }
});

test("Stella defers when Twitch is offline and ignores tenants outside its allowlist", async () => {
  const community = new StreamWeaverCommunityStore(":memory:");
  const hostStore = new SqliteStreamWeaverStellaLoungeHostStore(":memory:");
  const messages = [];
  const host = new StreamWeaverStellaLoungeHost({
    store: hostStore,
    community,
    twitch: { uptime: async () => undefined },
    connections: [{ tenantId: "spacemountainlive", provider: "twitch", connectionId: "twitch-connection", channelId: "123456789", desired: true }, { tenantId: "other-tenant", provider: "twitch", connectionId: "other", channelId: "987654321", desired: true }],
    egress: { send: async message => { messages.push(message); return {}; } },
    random: () => 0,
  });
  try {
    hostStore.setNextAt("spacemountainlive", 5_000);
    const offline = await host.runOnce(5_000);
    assert.deepEqual(offline, { attempted: 1, sent: 0, skipped: 1, failed: 0 });
    assert.equal(messages.length, 0);
    assert.equal(hostStore.view("spacemountainlive").nextAt, 125_000);
    assert.equal(hostStore.view("other-tenant").nextAt, 0);
  } finally { host.close(); community.close(); }
});
