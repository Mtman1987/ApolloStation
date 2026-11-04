import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyBlueHearMeOutActivityRoomTransform } from "../apps/hearmeout/dist/blue-import-apply.js";
import { transformBlueHearMeOutActivityRoom } from "../apps/hearmeout/dist/blue-import.js";
import { SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/room-media-core.js";
import { SqliteHearMeOutVoiceBridgeStore } from "../apps/hearmeout/dist/voice-bridge.js";

const principal = {
  tenantId: "tenant-a",
  userId: "owner-a",
  displayName: "Owner A",
  roles: ["admin"],
};

function fixture() {
  return transformBlueHearMeOutActivityRoom({
    collectionPath: "rooms",
    documentId: "discord-activity",
    data: {
      id: "discord-activity",
      name: "Discord Activities",
      systemRoom: true,
      isPrivate: false,
      currentTrackId: "track-1",
      isPlaying: true,
      djActive: true,
      playlist: [{
        id: "track-1",
        title: "Synthetic Track",
        artist: "Synthetic Artist",
        artId: "art-1",
        url: "https://media.invalid/track-1",
        playbackUrl: "https://media.invalid/play/track-1",
        duration: 123,
        addedBy: "blue-user-1",
        addedAt: "2026-08-30T12:00:00.000Z",
        plays: 2,
        source: "discord",
        playbackStrategy: "proxy",
      }],
      voiceBridge: {
        enabled: true,
        guildId: "123456789012345678",
        voiceChannelId: "223456789012345678",
        roomVoiceOutboundEnabled: false,
        audioProfile: "balanced",
        updatedBy: "blue-user-1",
        updatedAt: "2026-08-30T12:00:00.000Z",
      },
    },
  }, principal.tenantId);
}

test("offline Blue import persists Green room, queue, and disabled voice config across reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "hmo-blue-apply-"));
  const roomsPath = join(root, "rooms.db");
  const voicePath = join(root, "voice.db");
  const now = "2026-08-30T17:45:00.000Z";

  try {
    let rooms = new SqliteHearMeOutRoomMediaRuntime(roomsPath);
    let voice = new SqliteHearMeOutVoiceBridgeStore(voicePath);
    const result = applyBlueHearMeOutActivityRoomTransform(fixture(), rooms, voice, principal, now);

    assert.deepEqual(result, {
      schemaVersion: 1,
      roomId: "discord-activity",
      importedQueueItems: 1,
      playbackState: "paused",
      voiceBridgeConfigured: true,
      voiceBridgeEnabled: false,
      requiresExplicitHandoffStart: true,
    });
    assert.equal(rooms.getRoom(principal.tenantId, "discord-activity", now)?.systemRoom, true);
    assert.equal(rooms.getSession(principal.tenantId, "discord-activity", "music", now).playback.status, "paused");
    assert.equal(voice.get(principal.tenantId, "discord-activity").enabled, false);

    rooms.close();
    voice.close();

    rooms = new SqliteHearMeOutRoomMediaRuntime(roomsPath);
    voice = new SqliteHearMeOutVoiceBridgeStore(voicePath);
    const restoredRoom = rooms.getRoom(principal.tenantId, "discord-activity", now);
    const restoredSession = rooms.getSession(principal.tenantId, "discord-activity", "music", now);
    const restoredVoice = voice.get(principal.tenantId, "discord-activity");

    assert.equal(restoredRoom?.roomId, "discord-activity");
    assert.equal(restoredSession.current?.item.itemId, "track-1");
    assert.equal(restoredSession.playback.status, "paused");
    assert.equal(restoredVoice.enabled, false);
    assert.equal(restoredVoice.guildId, "123456789012345678");
    assert.equal(restoredVoice.voiceChannelId, "223456789012345678");
    assert.equal(restoredVoice.roomVoiceOutboundEnabled, false);

    rooms.close();
    voice.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline apply rejects a tenant mismatch before writing voice configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "hmo-blue-tenant-"));
  try {
    const rooms = new SqliteHearMeOutRoomMediaRuntime(join(root, "rooms.db"));
    const voice = new SqliteHearMeOutVoiceBridgeStore(join(root, "voice.db"));
    const transformed = fixture();
    transformed.voiceBridge.tenantId = "tenant-b";
    assert.throws(() => applyBlueHearMeOutActivityRoomTransform(transformed, rooms, voice, principal), /tenant does not match/);
    rooms.close();
    voice.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
