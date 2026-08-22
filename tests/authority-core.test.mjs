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

test("workspace uses one revisioned authority and exactly three dock slots", () => {
  const authority = service();
  const initial = authority.getOrCreateWorkspace("tenant-a");
  assert.equal(initial.revision, 1);
  assert.deepEqual(initial.dockSlots, [null, null, null]);
  const updated = authority.updateWorkspace("tenant-a", 1, { dockSlots: ["https://a.example", null, null] });
  assert.equal(updated.revision, 2);
  assert.throws(() => authority.updateWorkspace("tenant-a", 1, { appearance: { theme: "dark" } }), AuthorityConflictError);
});

test("XP awards are idempotent per tenant and never double count", () => {
  const authority = service();
  const input = {
    tenantId: "tenant-a",
    userId: "user-a",
    delta: 25,
    sourceAppId: "chat-tag",
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
});

test("audit records preserve actor/action/outcome without becoming business state", () => {
  const authority = service();
  const record = authority.audit({
    tenantId: "tenant-a",
    actorType: "service",
    actorId: "chat-tag",
    action: "xp.award",
    target: "user-a",
    outcome: "accepted",
    correlationId: "corr-1",
  });
  assert.match(record.id, /^audit_/);
  assert.equal(record.outcome, "accepted");
});
