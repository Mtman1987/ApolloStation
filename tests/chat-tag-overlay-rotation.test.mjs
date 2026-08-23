import assert from "node:assert/strict";
import test from "node:test";
import { buildChatTagOverlaySnapshot, createChatTagState, executeChatTagCommand, planChatTagRotation } from "../apps/nebula-arcade/dist/index.js";

const TENANT = "tenant-overlay";
const CHANNEL = "mtman1987";
const at = (minute) => new Date(Date.UTC(2026, 7, 23, 10, minute)).toISOString();
const command = (kind, commandId, actorUserId, minute, extra = {}) => ({ schemaVersion: 1, tenantId: TENANT, channelId: CHANNEL, kind, commandId, actorUserId, occurredAt: at(minute), ...extra });
const apply = (state, value) => executeChatTagCommand(state, value).state;

test("rotation preserves active-holder assignment and inactive-holder free for all", () => {
  let state = createChatTagState(TENANT);
  state = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" }));
  state = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" }));
  state = apply(state, command("join", "join-c", "user-c", 2, { username: "Gamma" }));
  const dueAt = new Date(Date.parse(state.lastTagAt ?? at(0)) + 61 * 60 * 1000).toISOString();
  const active = planChatTagRotation(state, { now: dueAt, channelId: CHANNEL, liveUserIds: ["user-a", "user-b"], random: () => 0 });
  assert.equal(active.action, "assign");
  assert.equal(active.reason, "active-holder-timeout");
  assert.equal(active.command.targetUserId, "user-b");
  state.players["user-a"].lastActiveAt = at(0);
  const inactive = planChatTagRotation(state, { now: dueAt, channelId: CHANNEL, liveUserIds: [], random: () => 0 });
  assert.equal(inactive.action, "free-for-all");
  assert.equal(inactive.reason, "inactive-holder-timeout");
});

test("forced rotation prefers a live eligible player and restarts the timer", () => {
  let state = createChatTagState(TENANT);
  state = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" }));
  state = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" }));
  const forcedAt = new Date(Date.parse(state.lastTagAt ?? at(0)) + 5 * 60 * 60 * 1000).toISOString();
  const plan = planChatTagRotation(state, { now: forcedAt, channelId: CHANNEL, liveUserIds: ["user-b"], random: () => 0.9 });
  assert.equal(plan.reason, "forced-timeout");
  state = apply(state, plan.command);
  assert.equal(state.currentItUserId, "user-b");
  assert.equal(state.lastTagAt, forcedAt);
});

test("overlay projection is viewer-scoped, crown-aware, and provider-secret free", () => {
  let state = createChatTagState(TENANT);
  state = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" }));
  state = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" }));
  state = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" }));
  state = apply(state, command("set-winner", "crown-a", "owner", 3, { targetUserId: "user-a", place: 1, isModerator: true }));
  const snapshot = buildChatTagOverlaySnapshot(state, { viewerUserId: "user-a", generatedAt: at(4) });
  assert.equal(snapshot.currentIt.userId, "user-b");
  assert.equal(snapshot.viewer.username, "👑alpha");
  assert.equal(snapshot.viewer.rank, 1);
  assert.match(snapshot.recentHistory[0].announcement, /👑alpha tagged beta/);
  assert.equal(/token|secret/i.test(JSON.stringify(snapshot)), false);
});
