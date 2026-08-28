import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCompanionDeviceCommand, planMountainViewVoiceCommand } from "../apps/mountainview/dist/voice-router.js";
import { SqliteCompanionDeviceRelay } from "../apps/companion/dist/device-relay.js";

const context = { schemaVersion: 1, tenantId: "tenant-a", userId: "owner-1", targetCompanionDeviceId: "pc-1", hearMeOutRoomId: "room-1" };
const spmt = { tenantId: "tenant-a", appId: "spmt", scopes: ["devices:pair"] };
const mountainview = { tenantId: "tenant-a", appId: "mountainview", scopes: ["devices:command"] };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-companion-"));
  return new SqliteCompanionDeviceRelay(join(dir, "companion.sqlite"));
}

function obsCommand(overrides = {}) {
  const plan = planMountainViewVoiceCommand("switch OBS to BRB", context);
  return createCompanionDeviceCommand({ plan, context, commandId: "command-1", idempotencyKey: "voice-1", requestedAt: "2026-08-23T12:00:00.000Z", ...overrides });
}

test("MountainView keeps community, Nebula Arcade tag game, HearMeOut, and StreamWeaver voice routes distinct", () => {
  assert.deepEqual(planMountainViewVoiceCommand("who's live", context), {
    kind: "route", targetAppId: "discord-stream-hub", action: "community.live-members.read", payload: {}, risk: "low", requiresConfirmation: false, reason: "Unscoped live status belongs to the community-wide DSH projection",
  });
  assert.equal(planMountainViewVoiceCommand("who's active in Nebula Arcade tag game", context).targetAppId, "nebula-arcade");
  const song = planMountainViewVoiceCommand("play the song Squad Goals by Prof", context);
  assert.equal(song.targetAppId, "hearmeout");
  assert.deepEqual(song.payload, { query: "Squad Goals by Prof", roomId: "room-1" });
  assert.equal(planMountainViewVoiceCommand("shoutout the last raider", context).targetAppId, "streamweaver");
});

test("OBS voice commands route only to a paired local Companion command", () => {
  const missing = planMountainViewVoiceCommand("switch OBS to BRB", { ...context, targetCompanionDeviceId: undefined });
  assert.equal(missing.kind, "clarify");
  const plan = planMountainViewVoiceCommand("switch OBS to BRB", context);
  assert.equal(plan.targetAppId, "companion");
  const command = obsCommand();
  assert.equal(command.targetDeviceId, "pc-1");
  assert.equal(command.capability, "obs.scene");
  assert.equal(command.action, "obs.scene.set");
  assert.equal(command.payload.sceneName, "BRB");
  assert.equal("targetDeviceId" in command.payload, false);
});

test("only SPMT pairs devices and only the source app executes a granted capability once", async () => {
  const relay = fixture();
  try {
    assert.throws(() => relay.pairDevice(mountainview, { deviceId: "pc-1", name: "PC", capabilities: ["obs.scene"], pairedAt: "2026-08-23T12:00:00Z" }), /authority denied/);
    relay.pairDevice(spmt, { deviceId: "pc-1", name: "Streaming PC", capabilities: ["obs.scene"], pairedAt: "2026-08-23T12:00:00Z" });
    let calls = 0;
    const adapter = { async execute(command) { calls += 1; assert.equal(command.payload.sceneName, "BRB"); return { detail: "scene changed" }; } };
    const first = await relay.execute(mountainview, obsCommand(), adapter, "2026-08-23T12:00:01Z");
    const replay = await relay.execute(mountainview, obsCommand(), adapter, "2026-08-23T12:00:02Z");
    assert.equal(first.status, "completed");
    assert.deepEqual(replay, first);
    assert.equal(calls, 1);
    await assert.rejects(() => relay.execute({ ...mountainview, appId: "streamweaver" }, { ...obsCommand(), idempotencyKey: "other" }, adapter), /authority denied/);
  } finally { relay.close(); }
});

test("unpaired, cross-tenant, revoked, and unknown local actions fail closed", async () => {
  const relay = fixture();
  try {
    relay.pairDevice(spmt, { deviceId: "pc-1", name: "Streaming PC", capabilities: ["obs.scene"], pairedAt: "2026-08-23T12:00:00Z" });
    const adapter = { async execute() { throw new Error("must not run"); } };
    const unknown = await relay.execute(mountainview, { ...obsCommand(), commandId: "unknown", idempotencyKey: "unknown", action: "shell.exec" }, adapter);
    assert.equal(unknown.status, "rejected");
    await assert.rejects(() => relay.execute({ ...mountainview, tenantId: "tenant-b" }, { ...obsCommand(), tenantId: "tenant-a", idempotencyKey: "cross" }, adapter), /tenant mismatch/);
    relay.revokeDevice(spmt, "pc-1", "2026-08-23T12:01:00Z");
    const revoked = await relay.execute(mountainview, { ...obsCommand(), idempotencyKey: "revoked" }, adapter);
    assert.equal(revoked.status, "rejected");
  } finally { relay.close(); }
});

test("temporary local failure is redacted, recorded, and retryable with the same command", async () => {
  const relay = fixture();
  try {
    relay.pairDevice(spmt, { deviceId: "pc-1", name: "Streaming PC", capabilities: ["obs.scene"], pairedAt: "2026-08-23T12:00:00Z" });
    let calls = 0;
    const adapter = { async execute() { calls += 1; if (calls === 1) throw new Error("token=very-secret OBS is offline"); return { detail: "scene changed" }; } };
    const unavailable = await relay.execute(mountainview, obsCommand(), adapter, "2026-08-23T12:00:01Z");
    assert.equal(unavailable.status, "unavailable");
    assert.doesNotMatch(unavailable.detail, /very-secret/);
    assert.equal(relay.attempts("tenant-a", "voice-1")?.attempts, 1);
    assert.equal(relay.attempts("tenant-a", "voice-1")?.lastError, "token=[redacted] OBS is offline");
    const completed = await relay.execute(mountainview, obsCommand(), adapter, "2026-08-23T12:00:02Z");
    assert.equal(completed.status, "completed");
    assert.equal(calls, 2);
    assert.equal(relay.attempts("tenant-a", "voice-1"), undefined);
  } finally { relay.close(); }
});
