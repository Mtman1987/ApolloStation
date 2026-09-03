import assert from "node:assert/strict";
import test from "node:test";
import { STREAMWEAVER_BOT_ACTION_CATALOG, StreamWeaverBotActionConsumer, detectStreamWeaverBotAction } from "../apps/streamweaver/dist/index.js";

test("suite bot action catalog exposes all 21 app-owned operations without persona names", () => {
  assert.equal(STREAMWEAVER_BOT_ACTION_CATALOG.length, 21);
  assert.equal(STREAMWEAVER_BOT_ACTION_CATALOG.find((entry) => entry.id === "hmo.bot.control").minimumRole, "member");
  assert.equal(STREAMWEAVER_BOT_ACTION_CATALOG.find((entry) => entry.id === "hmo.voice.bridge.control").minimumRole, "member");
  assert.equal(JSON.stringify(STREAMWEAVER_BOT_ACTION_CATALOG).includes("Athena"), false);
});

test("explicit action detection runs before conversational AI", () => {
  assert.deepEqual(detectStreamWeaverBotAction("approve Jordan's moderator application"), { action: "dsh.applications.decide", args: { decision: "approved", type: "mod", application: "Jordan" }, detection: "explicit" });
  assert.deepEqual(detectStreamWeaverBotAction("post a DSH shoutout for @creator in #shoutouts"), { action: "dsh.shoutouts.post", args: { target: "creator", channel: "shoutouts" }, detection: "explicit" });
  assert.deepEqual(detectStreamWeaverBotAction("tell Moonbeam to join my Hear Me Out chat"), { action: "hmo.bot.control", args: { control: "join", bot: "Moonbeam", roomId: "" }, detection: "explicit" });
  assert.deepEqual(detectStreamWeaverBotAction("bridge HearMeOut to Discord VC General"), { action: "hmo.voice.bridge.control", args: { control: "start", audioProfile: "", voiceChannelId: "General", roomId: "" }, detection: "explicit" });
  assert.deepEqual(detectStreamWeaverBotAction("generate an image of a rocket flying past Saturn"), { action: "sw.image.generate", args: { prompt: "a rocket flying past Saturn" }, detection: "explicit" });
});

test("natural Admin Calendar event details are parsed without AI invention", () => {
  assert.deepEqual(detectStreamWeaverBotAction('add an event to Discord Stream Hubs Admin Calendar with title "record help video" for 3 AM UTC Tuesday September 1st 2026'), { action: "dsh.calendar.event.create", args: { missionName: "record help video", missionDescription: "", missionDate: "2026-09-01", missionTime: "03:00", missionTimeZone: "UTC" }, detection: "explicit" });
});

test("role gates block broadcasts before an app adapter executes", async () => {
  let executions = 0;
  const sent = [];
  const consumer = new StreamWeaverBotActionConsumer({ execute: async () => { executions += 1; return { response: "done" }; } }, { send: async (message) => { sent.push(message); return { providerMessageId: "sent" }; } });
  const message = { schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-a", channelId: "12345", messageId: "m1", text: "deploy the admin calendar to #storage", occurredAt: "2026-08-29T12:00:00Z", actor: { providerUserId: "u1", canonicalUserId: "c1", username: "member", isBot: false, roles: ["member"] }, mentions: [] };
  await consumer.deliver({ schemaVersion: 1, deliveryId: "delivery-1", consumerId: consumer.id, message, attempts: 0 });
  assert.equal(executions, 0);
  assert.match(sent[0].text, /requires admin access/);
});
