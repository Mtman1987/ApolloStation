import assert from "node:assert/strict";
import test from "node:test";
import { personalTenantId, transformWorkspaceRow, transformXpRow } from "../scripts/promote-seed-xp-workspaces.mjs";

test("seed promotion assigns the personal tenant convention", () => {
  assert.equal(personalTenantId("usr_abc"), "tenant_usr_abc");
  assert.equal(personalTenantId("5e0645e3-8aba-4758-861a-42b8f26bdc71"), "tenant_5e0645e3-8aba-4758-861a-42b8f26bdc71");
});

test("XP transform preserves ids and idempotency keys verbatim and folds metadata into the body", () => {
  const row = {
    id: "e18ac4f6-6deb-48e6-8f53-cc8d4bc28102",
    user_id: "5e0645e3-8aba-4758-861a-42b8f26bdc71",
    source_app: "discord-stream-hub",
    event_type: "dsh-discord-message",
    idempotency_key: "discord-stream-hub:dsh-discord-message:unknown:5e0645e3-8aba-4758-861a-42b8f26bdc71",
    delta: 10,
    metadata_json: JSON.stringify({ schemaVersion: 1, serverId: "1240832965865635881", localUserId: "local-1", username: "someone", channel: "general" }),
    created_at: "2026-07-24T14:23:15.990Z",
  };
  const t = transformXpRow(row);
  assert.equal(t.id, row.id);
  assert.equal(t.idempotencyKey, row.idempotency_key);
  assert.equal(t.tenantId, "tenant_5e0645e3-8aba-4758-861a-42b8f26bdc71");
  assert.equal(t.delta, 10);
  assert.equal(t.hasMetadata, true);
  const body = JSON.parse(t.body);
  assert.deepEqual(body, {
    id: row.id,
    tenantId: "tenant_5e0645e3-8aba-4758-861a-42b8f26bdc71",
    userId: row.user_id,
    delta: 10,
    sourceAppId: "discord-stream-hub",
    reason: "dsh-discord-message",
    idempotencyKey: row.idempotency_key,
    createdAt: "2026-07-24T14:23:15.990Z",
    eventType: "dsh-discord-message",
    metadata: { schemaVersion: 1, serverId: "1240832965865635881", localUserId: "local-1", username: "someone", channel: "general" },
  });
});

test("XP transform tolerates missing metadata and falls back to the event id as idempotency key", () => {
  const t = transformXpRow({ id: "xp-1", user_id: "u-1", source_app: null, event_type: null, idempotency_key: null, delta: null, metadata_json: null, created_at: null });
  const body = JSON.parse(t.body);
  assert.equal(body.sourceAppId, "spmt");
  assert.equal(body.reason, "imported");
  assert.equal(body.idempotencyKey, "xp-1");
  assert.equal(body.delta, 0);
  assert.equal("metadata" in body, false);
  assert.equal("eventType" in body, false);
  assert.equal(t.hasMetadata, false);
});

test("workspace transform renames legacy fields and stamps the personal tenant for the lossless hydrate path", () => {
  const profile = {
    schemaVersion: 1,
    revision: 4,
    appearance: { theme: "dark", accent: "violet" },
    dockSlots: ["overlay-bay", null, "chat"],
    activeOverlaySceneId: "scene-1",
    ttsSubscriptions: ["sub-a", "sub-b"],
    appThemeMappings: { chat: "midnight" },
    savedThemes: [{ name: "Saved" }],
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const t = transformWorkspaceRow({ user_id: "user-9", revision: 4, profile: JSON.stringify(profile), updated_at: "2026-10-02T00:00:00.000Z" });
  assert.equal(t.tenantId, "tenant_user-9");
  assert.equal(t.revision, 4);
  const body = JSON.parse(t.body);
  assert.equal(body.tenantId, "tenant_user-9");
  assert.deepEqual(body.dockSlots, ["overlay-bay", null, "chat"]);
  assert.deepEqual(body.appearance, { theme: "dark", accent: "violet" });
  assert.deepEqual(body.ttsSubscriptionIds, ["sub-a", "sub-b"]);
  assert.deepEqual(body.appThemes, { chat: "midnight" });
  assert.equal("ttsSubscriptions" in body, false);
  assert.equal("appThemeMappings" in body, false);
  assert.equal(body.activeOverlaySceneId, "scene-1");
  assert.deepEqual(body.savedThemes, [{ name: "Saved" }], "unknown legacy fields are preserved, not dropped");
  assert.equal(body.updatedAt, "2026-10-01T00:00:00.000Z");
});

test("workspace transform normalizes a malformed dock slot list to exactly three slots", () => {
  const t = transformWorkspaceRow({ user_id: "user-1", revision: 1, profile: JSON.stringify({ dockSlots: ["only-one"] }), updated_at: "2026-01-01T00:00:00.000Z" });
  assert.equal(t.dockSlotsNormalized, true);
  assert.deepEqual(JSON.parse(t.body).dockSlots, ["only-one", null, null]);
});
