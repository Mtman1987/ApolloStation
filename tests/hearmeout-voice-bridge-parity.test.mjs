import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HearMeOutVoiceBridgeController, SqliteHearMeOutRoomMediaRuntime, SqliteHearMeOutVoiceBridgeStore } from "../apps/hearmeout/dist/index.js";

function captain(roles = ["member"]) { return { tenantId: "tenant-a", userId: "owner-a", displayName: "Captain", roles }; }
function guest() { return { tenantId: "tenant-a", userId: "guest-a", displayName: "Guest", roles: ["member"] }; }

class FakeVoiceWorker {
  constructor() { this.calls = []; this.failGate = false; this.failStart = false; this.running = false; }
  async status(input) { this.calls.push(["status", input]); return { running: this.running }; }
  async start(input) { this.calls.push(["start", input]); if (this.failStart) throw new Error("token=super-secret worker failed"); this.running = true; return { running: true, mode: "listen-only", guildId: input.guildId, voiceChannelId: input.voiceChannelId }; }
  async stop(input) { this.calls.push(["stop", input]); this.running = false; return { running: false }; }
  async setRoomOutbound(input) { this.calls.push(["gate", input]); if (this.failGate) throw new Error("gate failed"); return { running: this.running, roomVoiceOutboundEnabled: input.roomVoiceOutboundEnabled, mode: input.roomVoiceOutboundEnabled ? "two-way" : "listen-only" }; }
  async setAudioProfile(input) { this.calls.push(["profile", input]); return { running: this.running, audioProfile: input.audioProfile }; }
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
  store.close(); rooms.close(); rmSync(dir, { recursive: true, force: true });
});

test("legacy voice bridge defaults stay two-way and balanced until explicitly changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-voice-default-"));
  const db = join(dir, "hmo.sqlite");
  const store = new SqliteHearMeOutVoiceBridgeStore(db);
  const config = store.get("tenant-a", "room-a");
  assert.equal(config.enabled, false);
  assert.equal(config.roomVoiceOutboundEnabled, true);
  assert.equal(config.audioProfile, "balanced");
  store.close(); rmSync(dir, { recursive: true, force: true });
});

test("enabled voice bridge survives process restart and reconciles worker plus privacy gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-voice-restart-"));
  const db = join(dir, "hmo.sqlite");
  let rooms = new SqliteHearMeOutRoomMediaRuntime(db);
  let store = new SqliteHearMeOutVoiceBridgeStore(db);
  rooms.createRoom(captain(), { roomId: "room-a", name: "Room A", privacy: "public", operationId: "create-restart", now: "2026-08-24T19:00:00.000Z" });
  store.put({ schemaVersion: 1, tenantId: "tenant-a", roomId: "room-a", enabled: true, guildId: "123456789012345678", voiceChannelId: "987654321098765432", roomVoiceOutboundEnabled: false, audioProfile: "resilient", updatedBy: "owner-a", updatedAt: "2026-08-24T19:30:00.000Z" });
  store.close(); rooms.close();

  rooms = new SqliteHearMeOutRoomMediaRuntime(db);
  store = new SqliteHearMeOutVoiceBridgeStore(db);
  const worker = new FakeVoiceWorker();
  const controller = new HearMeOutVoiceBridgeController(rooms, store, worker, () => "2026-08-24T20:00:00.000Z");
  const first = await controller.reconcileEnabled();
  assert.deepEqual(first.map((entry) => entry.outcome), ["resumed"]);
  assert.deepEqual(worker.calls.map(([kind]) => kind), ["status", "start", "gate"]);
  assert.equal(worker.calls.find(([kind]) => kind === "start")[1].audioProfile, "resilient");
  assert.equal(worker.calls.find(([kind]) => kind === "gate")[1].roomVoiceOutboundEnabled, false);

  worker.calls.length = 0;
  const second = await controller.reconcileEnabled();
  assert.deepEqual(second.map((entry) => entry.outcome), ["already-running"]);
  assert.equal(worker.calls.some(([kind]) => kind === "start"), false);
  assert.ok(worker.calls.some(([kind]) => kind === "profile"));
  assert.ok(worker.calls.some(([kind]) => kind === "gate"));
  store.close(); rooms.close(); rmSync(dir, { recursive: true, force: true });
});

test("restart reconciliation disables stale rooms, blocks channel collisions, and keeps transient failures retryable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-voice-guard-"));
  const db = join(dir, "hmo.sqlite");
  const rooms = new SqliteHearMeOutRoomMediaRuntime(db);
  const store = new SqliteHearMeOutVoiceBridgeStore(db);
  rooms.createRoom(captain(), { roomId: "room-a", name: "Room A", privacy: "public", operationId: "create-a", now: "2026-08-24T19:00:00.000Z" });
  rooms.createRoom(captain(), { roomId: "room-b", name: "Room B", privacy: "public", operationId: "create-b", now: "2026-08-24T19:00:00.000Z" });
  const base = { schemaVersion: 1, tenantId: "tenant-a", enabled: true, guildId: "123456789012345678", voiceChannelId: "987654321098765432", roomVoiceOutboundEnabled: true, audioProfile: "balanced", updatedBy: "owner-a", updatedAt: "2026-08-24T19:30:00.000Z" };
  store.put({ ...base, roomId: "room-a" });
  store.put({ ...base, roomId: "room-b" });
  store.put({ ...base, roomId: "missing-room", voiceChannelId: "777777777777777777" });

  const worker = new FakeVoiceWorker(); worker.failStart = true;
  const controller = new HearMeOutVoiceBridgeController(rooms, store, worker, () => "2026-08-24T20:00:00.000Z");
  const results = await controller.reconcileEnabled();
  assert.equal(results.find((entry) => entry.roomId === "room-a").outcome, "retryable-error");
  assert.doesNotMatch(results.find((entry) => entry.roomId === "room-a").message, /super-secret/);
  assert.equal(results.find((entry) => entry.roomId === "room-b").outcome, "conflict");
  assert.equal(results.find((entry) => entry.roomId === "missing-room").outcome, "disabled-stale");
  assert.equal(store.get("tenant-a", "room-a").enabled, true, "transient startup failure preserves desired state for retry");
  assert.equal(store.get("tenant-a", "missing-room").enabled, false);
  assert.equal(worker.calls.filter(([kind]) => kind === "start").length, 1, "collision cannot start a second bridge into one Discord channel");
  store.close(); rooms.close(); rmSync(dir, { recursive: true, force: true });
});
