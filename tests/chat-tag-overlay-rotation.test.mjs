import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_TAG_OVERLAY_CLIENT_JS, ChatTagOverlayHttpAdapter, buildChatTagOverlaySnapshot, createChatTagState, executeChatTagCommand, planChatTagRotation } from "../apps/nebula-arcade/dist/index.js";

const TENANT = "tenant-overlay";
const CHANNEL = "mtman1987";
const at = (minute) => new Date(Date.UTC(2026, 7, 23, 10, minute)).toISOString();
const command = (kind, commandId, actorUserId, minute, extra = {}) => ({ schemaVersion: 1, tenantId: TENANT, channelId: CHANNEL, kind, commandId, actorUserId, occurredAt: at(minute), ...extra });
const apply = (state, value) => executeChatTagCommand(state, value).state;

test("rotation preserves the donor 40-minute active/offline behavior", () => {
  let state = createChatTagState(TENANT);
  state = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" }));
  state = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" }));
  state = apply(state, command("join", "join-c", "user-c", 2, { username: "Gamma" }));
  const notDueAt = new Date(Date.parse(state.lastTagAt ?? at(0)) + 39 * 60 * 1000).toISOString();
  assert.equal(planChatTagRotation(state, { now: notDueAt, channelId: CHANNEL, liveUserIds: ["user-a"] }).reason, "not-due");
  const dueAt = new Date(Date.parse(state.lastTagAt ?? at(0)) + 40 * 60 * 1000).toISOString();
  const active = planChatTagRotation(state, { now: dueAt, channelId: CHANNEL, liveUserIds: ["user-a", "user-b"], random: () => 0 });
  assert.equal(active.action, "assign");
  assert.equal(active.reason, "active-holder-timeout");
  assert.equal(active.command.targetUserId, "user-b");
  state.players["user-a"].lastActiveAt = at(0);
  const inactive = planChatTagRotation(state, { now: dueAt, channelId: CHANNEL, liveUserIds: [], random: () => 0 });
  assert.equal(inactive.action, "free-for-all");
  assert.equal(inactive.reason, "inactive-holder-timeout");
});

test("free-for-all reminder repeats on the donor 60-minute cadence", () => {
  let state = createChatTagState(TENANT);
  state = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" }));
  state = apply(state, command("trigger-ffa", "ffa", "owner", 1, { isModerator: true }));
  const early = planChatTagRotation(state, { now: new Date(Date.parse(state.lastTagAt) + 59 * 60 * 1000).toISOString(), channelId: CHANNEL });
  assert.equal(early.reason, "not-due");
  const reminder = planChatTagRotation(state, { now: new Date(Date.parse(state.lastTagAt) + 60 * 60 * 1000).toISOString(), channelId: CHANNEL });
  assert.equal(reminder.action, "free-for-all");
  assert.equal(reminder.reason, "free-for-all-reminder");
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

test("visual overlay is controls-free and reads only the authenticated tenant principal", () => {
  let tenantA = createChatTagState("tenant-a");
  tenantA = applyFor("tenant-a", tenantA, { schemaVersion: 1, tenantId: "tenant-a", channelId: CHANNEL, kind: "join", commandId: "join-a", actorUserId: "user-a", username: "Alpha", occurredAt: at(0) });
  let tenantB = createChatTagState("tenant-b");
  tenantB = applyFor("tenant-b", tenantB, { schemaVersion: 1, tenantId: "tenant-b", channelId: CHANNEL, kind: "join", commandId: "join-b", actorUserId: "user-b", username: "Beta", occurredAt: at(0) });
  const states = new Map([["tenant-a", tenantA], ["tenant-b", tenantB]]);
  const adapter = new ChatTagOverlayHttpAdapter({ getState: (tenantId) => ({ revision: 7, state: states.get(tenantId) }) }, () => at(4));
  const principal = { schemaVersion: 1, tenantId: "tenant-a", appId: "nebula-arcade", widgetId: "chat-tag", viewerUserId: "user-a" };

  assert.equal(adapter.handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay" }).status, 401);
  assert.equal(adapter.handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay" }, { ...principal, appId: "spoofed-app" }).status, 403);
  const page = adapter.handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay" }, principal);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  assert.doesNotMatch(page.headers["content-security-policy"], /unsafe-inline/);
  assert.doesNotMatch(page.body, /header|navigation|settings/i);

  const state = adapter.handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay/state?tenantId=tenant-b" }, principal);
  assert.equal(state.status, 404);
  const exactState = adapter.handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay/state" }, principal);
  const payload = JSON.parse(exactState.body);
  assert.equal(payload.snapshot.tenantId, "tenant-a");
  assert.equal(payload.snapshot.viewer.username, "alpha");
  assert.equal(/token|secret/i.test(exactState.body), false);
  assert.match(CHAT_TAG_OVERLAY_CLIENT_JS, /setInterval\(poll,1000\)/);
  assert.match(CHAT_TAG_OVERLAY_CLIENT_JS, /leaderboard/);
  assert.match(CHAT_TAG_OVERLAY_CLIENT_JS, /AudioContext/);
  assert.match(CHAT_TAG_OVERLAY_CLIENT_JS, /confetti/);
});

function applyFor(tenantId, state, value) {
  assert.equal(value.tenantId, tenantId);
  return executeChatTagCommand(state, value).state;
}
