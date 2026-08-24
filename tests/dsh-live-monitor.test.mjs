import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshLiveRuntime, SqliteDshLiveMonitor } from "../apps/discord-stream-hub/dist/index.js";

const iso = (minute) => new Date(Date.UTC(2026, 7, 23, 14, minute)).toISOString();
const alpha = { canonicalUserId: "user-alpha", discordUserId: "discord-alpha", twitchLogin: "alpha", group: "Crew", shoutoutChannelId: "channel-crew" };
const beta = { canonicalUserId: "user-beta", discordUserId: "discord-beta", twitchLogin: "beta", group: "Honored Guests", shoutoutChannelId: "channel-guests" };
const stream = (login, id, viewers = 10) => ({ twitchLogin: login, twitchStreamId: id, displayName: login.toUpperCase(), title: login + " is live", gameName: "Chatting", viewerCount: viewers, thumbnailUrl: "https://static-cdn.jtvnw.net/" + login + "/{width}x{height}.jpg", startedAt: iso(0) });
const poll = (pollId, minute, streams, tenantId = "tenant-a") => ({ schemaVersion: 1, tenantId, pollId, observedAt: iso(minute), members: [beta, alpha], streams });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-dsh-live-"));
  const path = join(dir, "dsh.db");
  const monitor = new SqliteDshLiveMonitor(path);
  return { dir, path, monitor };
}
function cleanup(value) { value.monitor.close(); rmSync(value.dir, { recursive: true, force: true }); }

test("live transitions create routed shoutouts and rotate every live group through spotlight", () => {
  const value = setup();
  try {
    const first = value.monitor.reconcile(poll("poll-1", 0, [stream("alpha", "stream-a"), stream("beta", "stream-b")]));
    assert.equal(first.liveCount, 2);
    assert.deepEqual(first.actions.filter((action) => action.type === "shoutout.create").map((action) => action.member.shoutoutChannelId).sort(), ["channel-crew", "channel-guests"]);
    const firstSpotlight = first.actions.find((action) => action.type === "spotlight.update");
    assert.equal(firstSpotlight.member.canonicalUserId, "user-alpha");
    assert.equal(firstSpotlight.rotatesEveryMs, 600000);

    const early = value.monitor.reconcile(poll("poll-2", 5, [stream("alpha", "stream-a", 15), stream("beta", "stream-b", 20)]));
    assert.equal(early.actions.some((action) => action.type === "spotlight.update"), false);
    assert.equal(early.actions.filter((action) => action.type === "shoutout.update").length, 2);

    const rotated = value.monitor.reconcile(poll("poll-3", 10, [stream("alpha", "stream-a", 15), stream("beta", "stream-b", 20)]));
    assert.equal(rotated.actions.find((action) => action.type === "spotlight.update").member.canonicalUserId, "user-beta");
  } finally { cleanup(value); }
});

test("offline transitions remove shoutouts and clear the final spotlight", () => {
  const value = setup();
  try {
    value.monitor.reconcile(poll("online", 0, [stream("alpha", "stream-a"), stream("beta", "stream-b")]));
    const oneLeft = value.monitor.reconcile(poll("one-left", 1, [stream("beta", "stream-b")]));
    assert.equal(oneLeft.actions.find((action) => action.type === "shoutout.remove").member.canonicalUserId, "user-alpha");
    assert.equal(oneLeft.actions.find((action) => action.type === "spotlight.update").member.canonicalUserId, "user-beta");
    const none = value.monitor.reconcile(poll("offline", 2, []));
    assert.equal(none.actions.filter((action) => action.type === "shoutout.remove").length, 1);
    assert.equal(none.actions.some((action) => action.type === "spotlight.clear"), true);
    assert.equal(value.monitor.getLiveMembers("tenant-a").length, 0);
  } finally { cleanup(value); }
});

test("poll replay, restart, and tenants cannot duplicate or bleed live state", () => {
  const value = setup();
  const original = value.monitor.reconcile(poll("durable", 0, [stream("alpha", "stream-a")]));
  const replay = value.monitor.reconcile(poll("durable", 0, [stream("alpha", "stream-a")]));
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.actions, original.actions);
  value.monitor.reconcile(poll("tenant-b-live", 0, [stream("beta", "stream-b")], "tenant-b"));
  value.monitor.close();
  const reopened = new SqliteDshLiveMonitor(value.path);
  value.monitor = reopened;
  try {
    assert.deepEqual(reopened.getLiveMembers("tenant-a").map((member) => member.canonicalUserId), ["user-alpha"]);
    assert.deepEqual(reopened.getLiveMembers("tenant-b").map((member) => member.canonicalUserId), ["user-beta"]);
    assert.equal(reopened.reconcile(poll("durable", 0, [stream("alpha", "stream-a")])).duplicate, true);
  } finally { cleanup(value); }
});

test("Discord output actions survive delivery failure and retry with stable idempotency keys", async () => {
  const value = setup();
  let failing = true;
  const delivered = [];
  const runtime = new DshLiveRuntime(value.monitor, { publish: (action) => { if (failing) throw new Error("Bearer discord-token"); delivered.push(action); } });
  try {
    const first = await runtime.reconcile(poll("delivery-1", 0, [stream("alpha", "stream-a")]));
    assert.equal(first.delivery.failed, first.actions.length);
    assert.equal(value.monitor.listPendingActions("tenant-a").every((item) => item.attempts === 1), true);
    const keys = value.monitor.listPendingActions("tenant-a").map((item) => item.action.idempotencyKey);
    failing = false;
    const retry = await runtime.flush("tenant-a");
    assert.equal(retry.delivered, keys.length);
    assert.deepEqual(delivered.map((action) => action.idempotencyKey), keys);
    assert.equal(value.monitor.listPendingActions("tenant-a").length, 0);
  } finally { cleanup(value); }
});
