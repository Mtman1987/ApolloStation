import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscordGatewayProviderDriver,
  KickPusherProviderDriver,
  TwitchIrcProviderDriver,
  createFirstPartyChatProviderAdapters,
  decodeDiscordCursor,
} from "../apps/chat-gateway/dist/index.js";

class FakeSocket {
  readyState = 0;
  sent = [];
  listeners = { open: [], message: [], close: [], error: [] };
  addEventListener(type, listener) { this.listeners[type].push(listener); }
  send(data) { this.sent.push(data); }
  close(code = 1000, reason = "closed") { this.readyState = 3; this.emit("close", { code, reason }); }
  emit(type, event = {}) { for (const listener of this.listeners[type]) listener(event); }
  open() { this.readyState = 1; this.emit("open", {}); }
  message(data) { this.emit("message", { data }); }
}

function socketFactoryCapture() {
  const sockets = [];
  const urls = [];
  return { sockets, urls, factory(url) { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket; } };
}

const connection = (provider, channelId) => ({ schemaVersion: 1, tenantId: "tenant-a", provider, connectionId: `${provider}-main`, channelId, providerAccountId: provider === "twitch" ? "spacechannel" : "12345", desired: true });

function openInput(provider, channelId, metadata = {}) {
  const envelopes = [];
  const cursors = [];
  const disconnects = [];
  return {
    envelopes, cursors, disconnects,
    input: {
      connection: connection(provider, channelId), accessToken: "ephemeral-token", grantExpiresAt: "2026-08-27T05:00:00Z", grantMetadata: metadata,
      onEnvelope: (envelope) => envelopes.push(envelope), onCursor: (cursor) => cursors.push(cursor), onDisconnect: (failure) => disconnects.push(failure),
    },
  };
}

test("Twitch IRC driver authenticates, joins, normalizes PRIVMSG, replies to PING, and sends outbound chat", async () => {
  const f = socketFactoryCapture();
  const driver = new TwitchIrcProviderDriver({ websocketFactory: f.factory, handshakeTimeoutMs: 2_000, now: () => new Date("2026-08-27T04:00:00Z") });
  const opened = openInput("twitch", "spacechannel", { username: "spacemountainlive" });
  const pending = driver.open(opened.input);
  const socket = f.sockets[0];
  socket.open();
  assert.ok(socket.sent.some((line) => line.includes("PASS oauth:ephemeral-token")));
  assert.ok(socket.sent.some((line) => line.includes("JOIN #spacechannel")));
  socket.message(":tmi.twitch.tv 001 spacemountainlive :Welcome\r\n");
  const handle = await pending;
  socket.message("PING :tmi.twitch.tv\r\n");
  assert.ok(socket.sent.some((line) => line.startsWith("PONG")));
  socket.message("@badge-info=;badges=moderator/1;display-name=Viewer;id=msg-1;mod=1;tmi-sent-ts=1787803200000;user-id=user-1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #spacechannel :hello world\r\n");
  assert.equal(opened.envelopes.length, 1);
  assert.equal(opened.envelopes[0].provider, "twitch");
  assert.deepEqual(opened.envelopes[0].roles, ["moderator", "member"]);
  assert.equal(opened.cursors.at(-1), "msg-1");
  const sent = await driver.send({ schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "twitch-main", channelId: "spacechannel", text: "reply text", idempotencyKey: "send-1", replyToMessageId: "msg-1" });
  assert.equal(sent.providerMessageId, "twitch:send-1");
  assert.ok(socket.sent.some((line) => line.includes("@reply-parent-msg-id=msg-1 PRIVMSG #spacechannel :reply text")));
  await handle.close();
  assert.equal(opened.disconnects.length, 0);
});

test("Discord driver identifies, stores a resumable cursor, normalizes messages, and sends through REST", async () => {
  const f = socketFactoryCapture();
  const requests = [];
  const driver = new DiscordGatewayProviderDriver({ websocketFactory: f.factory, handshakeTimeoutMs: 2_000, fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, status: 200, async json() { return { id: "discord-out-1" }; }, async text() { return ""; } }; } });
  const opened = openInput("discord", "channel-1");
  const pending = driver.open(opened.input);
  const socket = f.sockets[0];
  socket.open();
  socket.message(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
  assert.ok(socket.sent.some((line) => JSON.parse(line).op === 2));
  socket.message(JSON.stringify({ op: 0, t: "READY", s: 10, d: { session_id: "session-1", resume_gateway_url: "wss://gateway-us-east.discord.gg" } }));
  const handle = await pending;
  const cursor = decodeDiscordCursor(opened.cursors.at(-1));
  assert.deepEqual(cursor, { sessionId: "session-1", seq: 10, resumeGatewayUrl: "wss://gateway-us-east.discord.gg" });
  socket.message(JSON.stringify({ op: 0, t: "MESSAGE_CREATE", s: 11, d: { id: "discord-msg-1", channel_id: "channel-1", content: "hello discord", timestamp: "2026-08-27T04:00:00Z", author: { id: "user-1", username: "viewer", global_name: "Viewer", bot: false }, mentions: [{ id: "user-2", username: "friend" }] } }));
  assert.equal(opened.envelopes.length, 1);
  assert.equal(opened.envelopes[0].mentions[0].providerUserId, "user-2");
  const sent = await driver.send({ schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-main", channelId: "channel-1", text: "reply", idempotencyKey: "nonce-1", replyToMessageId: "discord-msg-1" });
  assert.equal(sent.providerMessageId, "discord-out-1");
  assert.match(requests[0].url, /channels\/channel-1\/messages$/);
  assert.equal(requests[0].init.headers.Authorization, "Bot ephemeral-token");
  assert.equal(JSON.parse(requests[0].init.body).nonce, "nonce-1");
  await handle.close();
});

test("Kick driver subscribes to donor Pusher chatroom, normalizes ChatMessageEvent, and preserves outbound API shape", async () => {
  const f = socketFactoryCapture();
  const requests = [];
  const driver = new KickPusherProviderDriver({ websocketFactory: f.factory, handshakeTimeoutMs: 2_000, now: () => new Date("2026-08-27T04:00:00Z"), fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, status: 200, async json() { return { data: { id: "kick-out-1" } }; }, async text() { return ""; } }; } });
  const opened = openInput("kick", "kick-channel", { chatroomId: "777", broadcasterUserId: "888" });
  const pending = driver.open(opened.input);
  const socket = f.sockets[0];
  socket.open();
  socket.message(JSON.stringify({ event: "pusher:connection_established", data: JSON.stringify({ socket_id: "1.2" }) }));
  const subscription = JSON.parse(socket.sent.at(-1));
  assert.equal(subscription.data.channel, "chatrooms.777.v2");
  socket.message(JSON.stringify({ event: "pusher:subscription_succeeded", channel: "chatrooms.777.v2", data: "{}" }));
  const handle = await pending;
  socket.message(JSON.stringify({ event: "App\\Events\\ChatMessageEvent", channel: "chatrooms.777.v2", data: JSON.stringify({ id: "kick-msg-1", content: "hello kick", created_at: "2026-08-27T04:00:00Z", sender: { id: 42, slug: "viewer", username: "Viewer", identity: { badges: [{ type: "moderator" }] } } }) }));
  assert.equal(opened.envelopes.length, 1);
  assert.deepEqual(opened.envelopes[0].roles, ["moderator", "member"]);
  const sent = await driver.send({ schemaVersion: 1, tenantId: "tenant-a", provider: "kick", connectionId: "kick-main", channelId: "kick-channel", text: "hello back", idempotencyKey: "kick-send-1" });
  assert.equal(sent.providerMessageId, "kick-out-1");
  assert.match(requests[0].url, /api\.kick\.com\/public\/v1\/chat$/);
  assert.deepEqual(JSON.parse(requests[0].init.body), { content: "hello back", type: "user", broadcaster_user_id: 888 });
  await handle.close();
});

test("Discord gateway provisions a Nebula-only webhook, applies avatar identity, and edits the durable dashboard", async () => {
  const f = socketFactoryCapture(), requests = [];
  const response = (status, value) => ({ ok: status >= 200 && status < 300, status, async json() { return value; }, async text() { return value === undefined ? "" : JSON.stringify(value); } });
  const driver = new DiscordGatewayProviderDriver({ websocketFactory: f.factory, handshakeTimeoutMs: 2_000, fetch: async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/webhooks") && init.method === "GET") return response(200, []);
    if (url.endsWith("/webhooks") && init.method === "POST") return response(200, { id: "77777", token: "scoped-webhook-token" });
    if (url.includes("/webhooks/77777/scoped-webhook-token")) return response(200, { id: "88888" });
    return response(500, { message: "unexpected" });
  } });
  const opened = openInput("discord", "123456"), pending = driver.open(opened.input), socket = f.sockets[0];
  socket.open(); socket.message(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })); socket.message(JSON.stringify({ op: 0, t: "READY", s: 1, d: { session_id: "session", resume_gateway_url: "wss://gateway.discord.gg" } }));
  const handle = await pending;
  const input = { schemaVersion: 1, tenantId: "tenant-a", connectionId: "discord-main", channelId: "123456", webhookName: "Nebula Arcade", avatarUrl: "https://apollo.example/assets/nebula-arcade/icon.png", payload: { embeds: [{ title: "🎮 Nebula Arcade · Chat Tag Live" }], components: [], allowed_mentions: { parse: [] } } };
  const created = await driver.upsertDiscordDashboard(input);
  assert.deepEqual(created, { providerMessageId: "88888", transport: "webhook" });
  const executed = requests.find((request) => request.url.includes("?wait=true"));
  assert.ok(executed);
  const body = JSON.parse(executed.init.body);
  assert.equal(body.username, "Nebula Arcade");
  assert.equal(body.avatar_url, "https://apollo.example/assets/nebula-arcade/icon.png");
  assert.equal(body.embeds[0].title, "🎮 Nebula Arcade · Chat Tag Live");
  const edited = await driver.upsertDiscordDashboard({ ...input, previousMessageId: "88888", previousTransport: "webhook" });
  assert.deepEqual(edited, { providerMessageId: "88888", transport: "webhook" });
  assert.ok(requests.some((request) => request.init.method === "PATCH" && request.url.endsWith("/messages/88888")));
  await handle.close();
});

test("first-party adapter factory exposes all three drivers and matching senders", () => {
  const f = socketFactoryCapture();
  const adapters = createFirstPartyChatProviderAdapters({ websocketFactory: f.factory, fetch: async () => ({ ok: true, status: 200, async json() { return {}; }, async text() { return ""; } }) });
  assert.deepEqual(adapters.drivers.map((driver) => driver.provider), ["twitch", "discord", "kick"]);
  assert.deepEqual(adapters.senders.map((sender) => sender.provider), ["twitch", "discord", "kick"]);
});
