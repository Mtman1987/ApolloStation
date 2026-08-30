import assert from "node:assert/strict";
import test from "node:test";
import { planBlueHearMeOutMigration, transformBlueHearMeOutActivityRoom } from "../apps/hearmeout/dist/blue-import.js";

function liveShapeFixture() {
  return [
    { collectionPath: "config", documentId: "runtime", data: { legacy: true } },
    { collectionPath: "rooms", documentId: "discord-activity", data: { id: "discord-activity", name: "Discord Activities", systemRoom: true, isPrivate: false } },
    { collectionPath: "rooms/discord-activity/users", documentId: "presence-one", data: { lastSeen: 1 } },
    ...Array.from({ length: 28 }, (_, index) => ({
      collectionPath: "users",
      documentId: `blue-user-${String(index + 1).padStart(2, "0")}`,
      data: { legacy: true },
    })),
  ];
}

test("plans the observed 31-document Blue HearMeOut shape without copying identity or presence into HMO authority", () => {
  const plan = planBlueHearMeOutMigration(liveShapeFixture());
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.sourceDocuments, 31);
  assert.deepEqual(plan.counts, {
    ensureActivityRoom: 1,
    reconcileUsersWithSpmt: 28,
    rebuildRoomPresence: 1,
    retainLegacyConfigForReview: 1,
    blocked: 0,
  });
  assert.equal(plan.readyForImport, false, "legacy config review must keep the production import gate closed");
  assert.equal(plan.actions.filter((action) => action.kind === "ensure-activity-room")[0]?.roomId, "discord-activity");
  assert.equal(plan.actions.filter((action) => action.kind === "reconcile-user-with-spmt").length, 28);
  assert.equal(plan.actions.filter((action) => action.kind === "rebuild-room-presence").length, 1);
  assert.equal(plan.actions.some((action) => action.kind === "copy-user-to-hearmeout"), false);
  assert.equal(plan.blockers.length, 0);
});

test("transforms durable activity-room queue and voice config while forcing live effects to restart", () => {
  const transformed = transformBlueHearMeOutActivityRoom({
    collectionPath: "rooms",
    documentId: "discord-activity",
    data: {
      id: "discord-activity",
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
  }, "tenant-a");

  assert.equal(transformed.ensureCanonicalRoom, true);
  assert.equal(transformed.roomId, "discord-activity");
  assert.equal(transformed.musicQueue.length, 1);
  assert.equal(transformed.musicQueue[0].item.itemId, "track-1");
  assert.equal(transformed.musicQueue[0].item.playbackUrl, "https://media.invalid/play/track-1");
  assert.equal(transformed.musicQueue[0].item.metadata.addedBy, "blue-user-1");
  assert.equal(transformed.voiceBridge.importedBlueEnabled, true);
  assert.equal(transformed.voiceBridge.enabled, false, "Green must never auto-start a Blue-owned voice bridge during import");
  assert.equal(transformed.voiceBridge.guildId, "123456789012345678");
  assert.equal(transformed.voiceBridge.voiceChannelId, "223456789012345678");
  assert.equal(transformed.voiceBridge.audioProfile, "balanced");
  assert.deepEqual(transformed.restart, { presence: true, activePlayback: true, djWorker: true });
});

test("rejects private or malformed canonical activity-room data", () => {
  assert.throws(() => transformBlueHearMeOutActivityRoom({
    collectionPath: "rooms",
    documentId: "discord-activity",
    data: { systemRoom: true, isPrivate: true, password: "legacy" },
  }, "tenant-a"), /private-room access state/);

  const plan = planBlueHearMeOutMigration([{ collectionPath: "rooms", documentId: "discord-activity", data: { systemRoom: false } }]);
  assert.equal(plan.readyForImport, false);
  assert.equal(plan.counts.blocked, 1);
  assert.match(plan.blockers[0].reason, /cannot be transformed/);
});

test("fails closed for unknown Blue collections and noncanonical rooms", () => {
  const plan = planBlueHearMeOutMigration([
    { collectionPath: "rooms", documentId: "private-room-old", data: {} },
    { collectionPath: "mystery", documentId: "one", data: {} },
  ]);
  assert.equal(plan.readyForImport, false);
  assert.equal(plan.counts.blocked, 2);
  assert.match(plan.blockers[0].reason, /approved migration|Unknown Blue collection/);
});

test("fails closed on duplicate Blue document identities", () => {
  const plan = planBlueHearMeOutMigration([
    { collectionPath: "users", documentId: "same", data: {} },
    { collectionPath: "users", documentId: "same", data: {} },
  ]);
  assert.equal(plan.readyForImport, false);
  assert.equal(plan.counts.reconcileUsersWithSpmt, 1);
  assert.equal(plan.counts.blocked, 1);
  assert.match(plan.blockers[0].reason, /Duplicate/);
});

test("rejects malformed source identities before planning", () => {
  assert.throws(() => planBlueHearMeOutMigration([
    { collectionPath: "rooms", documentId: "../unsafe id", data: {} },
  ]), /documentId is invalid/);
});
