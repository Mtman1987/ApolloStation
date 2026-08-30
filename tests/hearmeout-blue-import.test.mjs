import assert from "node:assert/strict";
import test from "node:test";
import { planBlueHearMeOutMigration } from "../apps/hearmeout/dist/blue-import.js";

function liveShapeFixture() {
  return [
    { collectionPath: "config", documentId: "runtime", data: { legacy: true } },
    { collectionPath: "rooms", documentId: "discord-activity", data: { name: "Discord Activities", systemRoom: true } },
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
