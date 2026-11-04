import assert from "node:assert/strict";
import test from "node:test";
import { AuthorityConflictError, AuthorityService, MemoryAuthorityStore } from "../packages/authority-core/dist/index.js";

function service() {
  let tick = 0;
  return new AuthorityService({
    store: new MemoryAuthorityStore(),
    now: () => `2026-08-21T21:30:${String(tick++).padStart(2, "0")}.000Z`,
  });
}

test("provider identities cannot silently merge two SPMT users", () => {
  const authority = service();
  authority.linkProvider("user-a", "twitch", "123");
  assert.throws(() => authority.linkProvider("user-b", "twitch", "123"), AuthorityConflictError);
});

test("provider unlink is audited as a tombstone and a verified identity can be linked again", () => {
  const authority = service();
  authority.linkProvider("user-a", "discord", "discord-123");
  assert.equal(authority.listProviderLinks("user-a").length, 1);
  const revoked = authority.unlinkProvider("user-a", "discord", "discord-123");
  assert.ok(revoked.revokedAt);
  assert.deepEqual(authority.listProviderLinks("user-a"), []);
  assert.throws(() => authority.unlinkProvider("user-b", "discord", "discord-123"), AuthorityConflictError);
  const relinked = authority.linkProvider("user-b", "discord", "discord-123");
  assert.equal(relinked.userId, "user-b");
  assert.equal(relinked.revokedAt, undefined);
});

test("workspace uses one revisioned authority and exactly three dock slots", () => {
  const authority = service();
  const initial = authority.getOrCreateWorkspace("tenant-a");
  assert.equal(initial.revision, 1);
  assert.deepEqual(initial.dockSlots, [null, null, null]);
  const updated = authority.updateWorkspace("tenant-a", 1, { dockSlots: ["https://a.example", null, null] });
  assert.equal(updated.revision, 2);
  assert.throws(() => authority.updateWorkspace("tenant-a", 1, { appearance: { theme: "dark" } }), AuthorityConflictError);
  const themed = authority.updateWorkspace("tenant-a", 2, { appearance: { theme: "dark", accent: "#ff7a18", backgroundUrl: "https://images.example/station.jpg" } });
  assert.equal(themed.appearance.backgroundUrl, "https://images.example/station.jpg");
  const productThemed = authority.updateWorkspace("tenant-a", 3, { appearance: { theme: "oceanic-blue", accentSecondary: "#FEDCBA" } });
  assert.equal(productThemed.appearance.theme, "oceanic-blue");
  assert.equal(productThemed.appearance.accentSecondary, "#FEDCBA");
  assert.equal(productThemed.appearance.backgroundUrl, undefined);
  assert.throws(() => authority.updateWorkspace("tenant-a", 4, { appearance: { theme: "night" } }), /theme is invalid/);
  assert.throws(() => authority.updateWorkspace("tenant-a", 4, { appearance: { theme: "dark", backgroundUrl: "http://insecure.example/image.jpg" } }), /credential-free HTTPS/);
});

test("workspace persists a validated canonical Commlink layout", () => {
  const authority = service();
  authority.getOrCreateWorkspace("tenant-a");
  const commlink = { schemaVersion: 1, chatSpaces: [{ id: "all", name: "All messages", sourceIds: ["spacemountain", "discord"] }], desks: [{ id: "show", name: "Live Show", chatSpaceIds: ["all"] }], activeChatSpaceId: "all", activeDeskId: "show", view: "focus", filter: "all", compact: false };
  const updated = authority.updateWorkspace("tenant-a", 1, { commlink });
  assert.deepEqual(updated.commlink, commlink);
  assert.throws(() => authority.updateWorkspace("tenant-a", 2, { commlink: { ...commlink, activeChatSpaceId: "missing" } }), /active workspace selection/);
});

test("workspace owns validated Public and Personal Overlay Bay scene selections", () => {
  const authority = service();
  authority.getOrCreateWorkspace("tenant-a");
  const scenes = [
    { schemaVersion: 1, id: "public-scene", name: "Public", sources: [] },
    { schemaVersion: 1, id: "personal-scene", name: "Personal", sources: [] },
  ];
  const updated = authority.updateWorkspace("tenant-a", 1, { overlayScenes: scenes, activePublicOverlaySceneId: "public-scene", activePersonalOverlaySceneId: "personal-scene" });
  assert.equal(updated.activePublicOverlaySceneId, "public-scene");
  assert.equal(updated.activePersonalOverlaySceneId, "personal-scene");
  assert.throws(() => authority.updateWorkspace("tenant-a", 2, { activePublicOverlaySceneId: "missing" }), /does not exist/);
  assert.throws(() => authority.updateWorkspace("tenant-a", 2, { overlayScenes: [...scenes, { schemaVersion: 1, id: "public-scene", name: "Duplicate", sources: [] }] }), /unique/);
});

test("XP awards are idempotent per tenant and never double count", () => {
  const authority = service();
  const input = {
    tenantId: "tenant-a",
    userId: "user-a",
    delta: 25,
    sourceAppId: "nebula-arcade",
    reason: "game.win",
    idempotencyKey: "round-123:user-a",
  };
  const first = authority.awardXp(input);
  const second = authority.awardXp(input);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.value.id, first.value.id);
  assert.equal(authority.getXpBalance("tenant-a", "user-a"), 25);
  assert.equal(authority.getXpBalance("tenant-b", "user-a"), 0);
});

test("platform events are idempotent and tenant-scoped", () => {
  const authority = service();
  const first = authority.publishEvent({
    tenantId: "tenant-a",
    sourceAppId: "discord-stream-hub",
    type: "stream.live",
    payload: { channel: "example" },
    idempotencyKey: "live:example:1",
  });
  const again = authority.publishEvent({
    tenantId: "tenant-a",
    sourceAppId: "discord-stream-hub",
    type: "stream.live",
    payload: { channel: "changed-but-duplicate" },
    idempotencyKey: "live:example:1",
  });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.value.payload, { channel: "example" });
  authority.publishEvent({ tenantId: "tenant-a", sourceAppId: "streamweaver", type: "chat.message", payload: { messageId: "1" }, idempotencyKey: "chat:1" });
  authority.publishEvent({ tenantId: "tenant-b", sourceAppId: "streamweaver", type: "chat.message", payload: { messageId: "2" }, idempotencyKey: "chat:2" });
  assert.deepEqual(authority.listEvents("tenant-a", { limit: 1 }).map((event) => event.type), ["chat.message"]);
  assert.deepEqual(authority.listEvents("tenant-a", { sourceAppId: "discord-stream-hub" }).map((event) => event.id), [first.value.id]);
  assert.equal(authority.listEvents("tenant-b").length, 1);
});

test("audit records preserve actor/action/outcome without becoming business state", () => {
  const authority = service();
  const record = authority.audit({
    tenantId: "tenant-a",
    actorType: "service",
    actorId: "nebula-arcade",
    action: "xp.award",
    target: "user-a",
    outcome: "accepted",
    correlationId: "corr-1",
  });
  assert.match(record.id, /^audit_/);
  assert.equal(record.outcome, "accepted");
});
