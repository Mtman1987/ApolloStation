import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HearMeOutVoiceBridgeController, SqliteHearMeOutRoomMediaRuntime, SqliteHearMeOutVoiceBridgeStore } from "../apps/hearmeout/dist/index.js";

function captain(roles = ["member"]) { return { tenantId: "tenant-a", userId: "owner-a", displayName: "Captain", roles }; }
function guest() { return { tenantId: "tenant-a", userId: "guest-a", displayName: "Guest", roles: ["member"] }; }

class FakeVoiceWorker {
  constructor() { this.calls = []; this.failGate = false; }
  async status(input) { this.calls.push(["status", input]); return { running: true }; }
  async start(input) { this.calls.push(["start", input]); return { running: true, mode: "listen-only" }; }
  async stop(input) { this.calls.push(["stop", input]); return { running: false }; }
  async setRoomOutbound(input) { this.calls.push(["gate", input]); if (this.failGate) throw new Error("gate failed"); return { running: true, roomVoiceOutboundEnabled: input.roomVoiceOutboundEnabled, mode: input.roomVoiceOutboundEnabled ? "two-way" : "listen-only" }; }
  async setAudioProfile(input) { this.calls.push(["profile", input]); return { running: true, audioProfile: input.audioProfile }; }
}

test("HearMeOut voice bridge preserves owner/admin control, privacy gate, profiles and rollback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-voice-"));
  const db = join(dir, "hmo.sqlite");
  const rooms = new SqliteHearMeOutRoomMediaRuntime(db);
  const store = new SqliteHearMeOutVoiceBridgeStore(db);
  const worker = new FakeVoiceWorker();
  const controller = new HearMeOutVoiceBridgeController(rooms, store, worker, () => "2026-08-24T20:00:00.000Z");
  const owner = captain();
  rooms.createRoom(owner, { roomId: "room-a", name: "Room A", privacy: "public", operationId: "create-1", now: "2026-08-24T19:00:00.000Z" });

  await assert.rejects(() => controller.start(guest(), { roomId: "room-a", guildId: "123456789012345678", voiceChannelId: "987654321098765432" }), /owner or an admin/);

  const started = await controller.start(owner, { roomId: "room-a", guildId: "123456789012345678", voiceChannelId: "987654321098765432" });
  assert.equal(started.config.enabled, true);
  assert.equal(started.config.roomVoiceOutboundEnabled, true);
  assert.deepEqual(worker.calls.slice(0, 2).map(([kind]) => kind), ["start", "gate"]);

  const listenOnly = await controller.setRoomOutbound(owner, "room-a", false);
  assert.equal(listenOnly.config.roomVoiceOutboundEnabled, false);
  assert.equal(listenOnly.worker.mode, "listen-only");

  const resilient = await controller.setAudioProfile(owner, "room-a", "resilient");
  assert.equal(resilient.config.audioProfile, "resilient");

  const stopped = await controller.stop(owner, "room-a");
  assert.equal(stopped.config.enabled, false);

  worker.failGate = true;
  await assert.rejects(() => controller.start(owner, { roomId: "room-a", guildId: "123456789012345678", voiceChannelId: "987654321098765432" }), /gate failed/);
  assert.equal(store.get("tenant-a", "room-a").enabled, false);
  assert.ok(worker.calls.some(([kind]) => kind === "stop"));

  store.close();
  rooms.close();
  rmSync(dir, { recursive: true, force: true });
});

test("legacy voice bridge defaults stay two-way and balanced until explicitly changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-voice-default-"));
  const db = join(dir, "hmo.sqlite");
  const store = new SqliteHearMeOutVoiceBridgeStore(db);
  const config = store.get("tenant-a", "room-a");
  assert.equal(config.enabled, false);
  assert.equal(config.roomVoiceOutboundEnabled, true);
  assert.equal(config.audioProfile, "balanced");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
