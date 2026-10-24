import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
process.env.STREAMWEAVER_DATA_DIR = mkdtempSync(join(tmpdir(), "lounge-"));
const sw = await import("../apps/streamweaver/dist/index.js");

let saved = null;
sw.setLoungeMediaLayoutStorage({ read: async () => saved, write: async (v) => { saved = structuredClone(v); } });
const msg = (text, roles = ["member"], user = "viewer", tenantId = "spacemountainlive") => ({ schemaVersion: 1, tenantId, provider: "twitch", connectionId: "c", channelId: "spacemountainlive", messageId: "m-" + text + user, text, occurredAt: new Date().toISOString(), actor: { providerUserId: user, username: user, isBot: false, roles }, mentions: [] });

test("lounge chat consumer owns lounge commands only in lounge tenants", async () => {
  const sent = [];
  const consumer = new sw.StreamWeaverLoungeChatConsumer({ send: async (m) => { sent.push(m); return { providerMessageId: "x" }; } });
  assert.equal(consumer.willHandle(msg("!commands")), true);
  assert.equal(consumer.willHandle(msg("!commands", ["member"], "v", "othertenant")), false);
  assert.equal(consumer.willHandle(msg("hello")), false);
  await consumer.deliver({ schemaVersion: 1, deliveryId: "d1", consumerId: consumer.id, attempts: 1, message: msg("!commands") });
  await consumer.deliver({ schemaVersion: 1, deliveryId: "d2", consumerId: consumer.id, attempts: 1, message: msg("1") });
  assert.ok(sent.length >= 2);
  assert.equal(sent[0].idempotencyKey, "streamweaver-lounge:d1:0");
});

test("layout voting, mod bump and override over chat", async () => {
  for (const u of ["a", "b"]) assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!bumpmedia", ["member"], u)))[0].text, /voted/);
  assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!bumpmedia", ["member"], "c")))[0].text, /Vote passed/);
  assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!bump")))[0].text, /only the broadcaster/);
  assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!stream big", ["moderator"], "mod")))[0].text, /locked/);
  assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!votebump", ["member"], "z")))[0].text, /locked by a moderator/);
  assert.match((await sw.handleStreamWeaverLoungeCommand(msg("!layout auto", ["moderator"], "mod")))[0].text, /open again/);
});

test("commercial break state machine dedupes and cools down", async () => {
  const t = "spacemountainlive";
  const first = await sw.beginCommercialBreak({ tenantId: t, messageId: "e1", startedAt: new Date().toISOString(), durationSeconds: 90, isAutomatic: true });
  assert.equal(first.accepted, true);
  assert.equal((await sw.beginCommercialBreak({ tenantId: t, messageId: "e1", startedAt: new Date().toISOString(), durationSeconds: 90, isAutomatic: true })).reason, "duplicate-message-id");
  assert.equal((await sw.getCommercialBreakState(t)).phase, "ACTIVE");
});

test("audio mix levels and broadcast level", async () => {
  await sw.setLoungeMixVolume("media", 50);
  const mix = await sw.getLoungeAudioMix();
  assert.equal(mix.levels.media, 50);
  assert.equal(sw.loungeBroadcastLevel(mix, "media", { volume: 1, muted: false }), 0.5);
  assert.equal(sw.loungeBroadcastLevel(mix, "media", { volume: 1, muted: true }), 0);
});

test("checkin shoutout respects cooldown and formats replies", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(url); if (String(url).includes("validate")) return new Response(JSON.stringify({ login: "stellabot87", user_id: "9", client_id: "cid", scopes: ["moderator:manage:shoutouts"] })); if (String(url).includes("/users")) return new Response(JSON.stringify({ data: [{ id: "1", login: "spacemountainlive" }, { id: "2", login: "friend" }] })); return new Response(null, { status: 204 }); };
  let now = 1_000_000;
  const so = sw.createStellaCheckinShoutout({ getCredential: async () => ({ token: "t", clientId: "cid" }), fetchImpl, now: () => now });
  assert.equal((await so.send("friend")).status, "sent");
  assert.equal((await so.send("friend")).status, "cooldown");
  assert.match(sw.formatCheckinShoutoutReply({ status: "sent", channel: "friend" }), /native Twitch/);
});

test("lounge web routes", async () => {
  const handler = sw.createStreamWeaverLoungeWebHandler({ activeGames: () => [{ id: "g", name: "Mosaic", command: "mosaic" }], now: () => 0 });
  const server = createServer(async (req, res) => { if (!(await handler(req, res, new URL(req.url, "http://x")))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const marquee = await (await fetch(base + "/api/lounge/marquee")).json();
    assert.equal(marquee.mode, "commands"); assert.match(marquee.text, /MOSAIC/);
    assert.ok((await (await fetch(base + "/api/lounge/media-layout")).json()).mode);
    assert.equal((await fetch(base + "/api/lounge/marquee?tenant=nope")).status, 404);
    assert.match(await (await fetch(base + "/lounge/commercial-break-player")).text(), /spmt-commercial-ready/);
  } finally { server.close(); }
});

test("BRB playlist prefers chatter clips, falls back to community, filters gifs", async () => {
  const media = await sw.buildLoungeBrbPlaylist("spacemountainlive", {
    chatters: async () => ["SpaceMountainLive", "friend", "nightbot", "x"],
    communityLogins: async () => ["creator"],
    clipsFor: async (l) => l === "friend" ? [{ url: "https://clips.twitch.tv/abc", duration: 10 }] : [],
    gifs: async () => [{ url: "https://cdn/x.gif", user: "friend" }, { url: "http://bad", user: "y" }],
    excluded: (l) => l === "nightbot", random: () => 0,
  });
  assert.equal(media.clips.length, 1); assert.equal(media.clips[0].user, "friend"); assert.equal(media.clips[0].duration, 10700);
  assert.equal(media.gifs.length, 1);
});
