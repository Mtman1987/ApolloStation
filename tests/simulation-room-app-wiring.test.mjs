import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshSimulationRoomDiscordTransport } from "../apps/discord-stream-hub/dist/index.js";
import { HearMeOutWebSuiteActionExecutor, SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/index.js";

test("DSH keeps server/channel reads live while all Discord writes become exact tenant room previews", async () => {
  const providerReads = [];
  const provider = {
    async listGuilds(tenantId) { providerReads.push(["guilds", tenantId]); return [{ id: "11111", name: "Apollo" }]; },
    async listGuildChannels(tenantId, guildId) { providerReads.push(["channels", tenantId, guildId]); return [{ id: "22222", name: "launch-control", type: 0, position: 1 }]; },
  };
  const events = [];
  const client = { async publishSimulationRoomEvent(tenantId, input, idempotencyKey) { events.push({ tenantId, input, idempotencyKey }); return { id: `event-${events.length}` }; } };
  const shadow = new DshSimulationRoomDiscordTransport(provider, client, { guildIds: () => ["11111"], now: () => "2026-09-05T12:00:00.000Z" });
  assert.equal((await shadow.listGuilds("tenant-a"))[0].name, "Apollo");
  assert.equal((await shadow.listGuildChannels("tenant-a", "11111"))[0].name, "launch-control");
  const messageId = await shadow.createMessage("tenant-a", "22222", { content: "Hello shadow", embeds: [{ title: "Launch", description: "Exact payload" }] });
  await shadow.editMessage("tenant-a", "22222", messageId, { content: "Updated shadow" });
  await shadow.deleteMessage("tenant-a", "22222", messageId);
  await shadow.sendDirectMessage("tenant-b", "33333", { content: "Private preview" });
  assert.match(messageId, /^\d{18}$/);
  assert.deepEqual(providerReads, [["guilds", "tenant-a"], ["channels", "tenant-a", "11111"]]);
  assert.deepEqual(events.slice(0, 3).map((event) => event.input.roomId), ["discord:11111:22222", "discord:11111:22222", "discord:11111:22222"]);
  assert.deepEqual(events.slice(0, 3).map((event) => event.input.data.operation), ["create", "edit", "delete"]);
  assert.deepEqual(events[0].input.data.payload, { content: "Hello shadow", embeds: [{ title: "Launch", description: "Exact payload" }] });
  assert.equal(events[3].tenantId, "tenant-b");
  assert.equal(events[3].input.roomId, "discord:dm:33333");
});

test("HearMeOut simulation jobs read the real room but cannot mutate media, persona, or voice state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hmo-simulation-room-"));
  const rooms = new SqliteHearMeOutRoomMediaRuntime(join(directory, "hearmeout.sqlite"));
  const principal = { tenantId: "tenant-a", userId: "user-a", displayName: "Member", roles: ["member"] };
  let mediaCalls = 0;
  const executor = new HearMeOutWebSuiteActionExecutor(rooms, { async resolve() { mediaCalls += 1; throw new Error("simulation must not resolve media"); } });
  try {
    rooms.createRoom(principal, { roomId: "studio", name: "Studio", privacy: "public", operationId: "create-studio", now: "2026-09-05T12:00:00.000Z" });
    const base = { schemaVersion: 1, actor: { userId: "user-a", username: "Member", role: "member" }, source: { kind: "voice-commander", requestId: "request-1", simulation: true } };
    const media = await executor.execute({ ...base, action: "hmo.media.request", args: { roomId: "studio", query: "Space Oddity" } }, { tenantId: "tenant-a", idempotencyKey: "media-1" });
    assert.equal(media.simulation, true);
    assert.match(media.text, /No live room, media provider, persona, or Discord voice state was changed/);
    assert.equal(mediaCalls, 0);
    assert.equal(rooms.getSession("tenant-a", "studio", "music").current, null);
    const voice = await executor.execute({ ...base, action: "hmo.voice.bridge.control", args: { roomId: "studio", control: "start", guildId: "11111", voiceChannelId: "22222" } }, { tenantId: "tenant-a", idempotencyKey: "voice-1" });
    assert.equal(voice.simulation, true);
    assert.match(voice.text, /Discord voice control start/);
  } finally {
    rooms.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
