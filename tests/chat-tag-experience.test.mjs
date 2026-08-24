import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatTagExperienceService, ChatTagRuntime, SqliteChatTagExperienceStore, SqliteChatTagStore, buildChatTagDirectoryPage, createChatTagGatewayConsumer, createChatTagState, executeChatTagCommand, getChatTagPinRanking } from "../apps/nebula-arcade/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const TENANT = "tenant-experience";
const CHANNEL = "mtman1987";
const at = (minute) => new Date(Date.UTC(2026, 7, 23, 10, minute)).toISOString();
const inbound = (messageId, userId, username, text, minute, roles = ["member"]) => ({ schemaVersion: 1, provider: "twitch", tenantId: TENANT, channelId: CHANNEL, messageId, userId, username, text, occurredAt: at(minute), roles });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "apollo-chat-tag-experience-"));
  const path = join(directory, "chat-tag.sqlite");
  const game = new SqliteChatTagStore(path);
  const experience = new SqliteChatTagExperienceStore(path);
  const runtime = new ChatTagRuntime(game, new SpmtClient({ baseUrl: "https://spmt.invalid", appId: "nebula-arcade", fetchImpl: async () => Response.json({ ok: true }) }));
  const service = new ChatTagExperienceService(runtime, experience, "pin", () => at(20));
  return { directory, path, game, experience, runtime, service };
}

test("complete ingress replies to mutations and ordinary chat clears away state", async () => {
  const item = fixture();
  try {
    const joined = await item.service.ingest(inbound("join-a", "alpha", "Alpha", "spmt join", 0));
    assert.equal(joined.kind, "executed");
    assert.equal(joined.route, "chat");
    assert.match(joined.message, /joined/i);
    await item.service.ingest(inbound("sleep-a", "alpha", "Alpha", "spmt sleep", 1));
    assert.equal(item.runtime.getState(TENANT).state.players.alpha.sleeping, true);
    const activity = await item.service.ingest(inbound("chat-a", "alpha", "Alpha", "hello everyone", 2));
    assert.deepEqual(activity, { kind: "ignored", code: "activity-recorded" });
    assert.equal(item.runtime.getState(TENANT).state.players.alpha.sleeping, false);
    assert.equal(item.runtime.getState(TENANT).state.players.alpha.lastActiveAt, at(2));
  } finally { item.game.close(); item.experience.close(); rmSync(item.directory, { recursive: true, force: true }); }
});

test("live and player directories retain status ordering and bounded pagination", () => {
  let state = createChatTagState(TENANT);
  for (const [index, name] of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].entries()) {
    state = executeChatTagCommand(state, { schemaVersion: 1, tenantId: TENANT, channelId: CHANNEL, kind: "join", commandId: `join-${name}`, actorUserId: name.toLowerCase(), username: name, occurredAt: at(index) }).state;
  }
  state.players.gamma.lastActiveAt = at(-90);
  state.players.gamma.sleeping = true;
  const page = buildChatTagDirectoryPage(state, { kind: "players", now: at(20), presence: { liveUserIds: ["beta"] }, maxCharacters: 18 });
  assert.equal(page.liveCount, 1);
  assert.equal(page.chattingCount, 3);
  assert.ok(page.totalPages > 1);
  assert.match(page.entries[0], /^🟢beta$/);
  const live = buildChatTagDirectoryPage(state, { kind: "live", now: at(20), presence: { liveUserIds: ["beta"] } });
  assert.doesNotMatch(live.message, /gamma/);
});

test("Pin ranking, support, overlay mode, and permanent opt-out are durable", async () => {
  const item = fixture();
  try {
    await item.service.ingest(inbound("join-pin", "pin", "Pin", "spmt join", 0));
    await item.service.ingest(inbound("join-a", "alpha", "Alpha", "spmt join", 1));
    await item.service.ingest(inbound("tag-a", "pin", "Pin", "spmt tag alpha", 2));
    assert.deepEqual(getChatTagPinRanking(item.runtime.getState(TENANT).state, "pin"), [{ userId: "alpha", username: "alpha", count: 1 }]);
    const pin = await item.service.ingest(inbound("pinrank", "alpha", "Alpha", "spmt pinrank", 3));
    assert.match(pin.message, /#1 alpha: 1/);

    const support = await item.service.ingest(inbound("ticket-1", "alpha", "Alpha", "spmt support overlay is hidden", 4));
    assert.equal(support.code, "support-ticket-created");
    assert.equal(item.experience.listSupportTickets(TENANT, "open")[0].note, "overlay is hidden");

    const mute = await item.service.ingest(inbound("mute", "owner", "Owner", "spmt mute", 5, ["broadcaster"]));
    assert.equal(mute.route, "chat");
    const score = await item.service.ingest(inbound("score", "alpha", "Alpha", "spmt score", 6));
    assert.equal(score.route, "overlay");
    assert.equal(item.experience.listOverlayMessages(TENANT, CHANNEL).at(-1).code, "score");

    const denied = await item.service.ingest(inbound("optout-denied", "alpha", "Alpha", "spmt optout", 7));
    assert.equal(denied.code, "moderator-required");
    const optedOut = await item.service.ingest(inbound("optout", "owner", "Owner", "spmt optout", 8, ["broadcaster"]));
    assert.equal(optedOut.code, "channel-opted-out");
    assert.equal((await item.service.ingest(inbound("after", "alpha", "Alpha", "spmt score", 9))).code, "channel-opted-out");
    item.experience.close();
    const reopened = new SqliteChatTagExperienceStore(item.path);
    assert.equal(reopened.getChannelSettings(TENANT, CHANNEL).optedOut, true);
    assert.equal(reopened.listSupportTickets(TENANT).length, 1);
    reopened.close();
  } finally { item.game.close(); try { item.experience.close(); } catch {} rmSync(item.directory, { recursive: true, force: true }); }
});

test("shared gateway uses the complete experience and keeps muted replies in OBS", async () => {
  const item = fixture(); const sent = [];
  const consumer = createChatTagGatewayConsumer(item.service, { send: async (message) => { sent.push(message); return { providerMessageId: `out-${sent.length}` }; } });
  const delivery = (id, text, roles = ["member"]) => ({ deliveryId: `delivery-${id}`, attempt: 1, message: { schemaVersion: 1, tenantId: TENANT, provider: "twitch", connectionId: "twitch-main", channelId: CHANNEL, messageId: id, text, occurredAt: at(sent.length), actor: { providerUserId: roles.includes("broadcaster") ? "owner" : "alpha", canonicalUserId: roles.includes("broadcaster") ? "owner" : "alpha", username: roles.includes("broadcaster") ? "Owner" : "Alpha", isBot: false, roles }, mentions: [] } });
  try {
    await consumer.deliver(delivery("join", "spmt join"));
    await consumer.deliver(delivery("mute", "spmt mute", ["broadcaster"]));
    await consumer.deliver(delivery("score", "spmt score"));
    assert.equal(sent.length, 2);
    assert.match(sent[0].text, /joined/i);
    assert.match(sent[1].text, /Overlay mode is on/);
    assert.equal(item.experience.listOverlayMessages(TENANT, CHANNEL).at(-1).code, "score");
  } finally { item.game.close(); item.experience.close(); rmSync(item.directory, { recursive: true, force: true }); }
});
