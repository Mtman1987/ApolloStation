import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshLiveRuntime, DshTwitchLivePoller, SqliteDshLiveMonitor, TwitchHelixError, TwitchHelixLiveClient } from "../apps/discord-stream-hub/dist/index.js";

const observedAt = "2026-08-23T14:00:00.000Z";
const member = (index, tenant = "tenant-a") => ({ canonicalUserId: `${tenant}-user-${index}`, discordUserId: `${tenant}-discord-${index}`, twitchLogin: `streamer${String(index).padStart(3, "0")}`, group: ["Crew", "Partners", "Honored Guests", "Raid Pile", "Everyone Else"][index % 5], shoutoutChannelId: `channel-${index % 5}` });
const stream = (login, index = 1) => ({ id: `stream-${index}`, user_login: login, user_name: login.toUpperCase(), title: `${login} is live`, game_name: "Just Chatting", viewer_count: index, thumbnail_url: `https://static-cdn.jtvnw.net/${login}/{width}x{height}.jpg`, started_at: observedAt });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-poller-"));
  const monitor = new SqliteDshLiveMonitor(join(dir, "dsh.sqlite"));
  const published = [];
  const runtime = new DshLiveRuntime(monitor, { publish: (action) => published.push(action) });
  return { dir, monitor, runtime, published, close() { monitor.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("Twitch polling batches the full community at Helix's 100-login limit", async () => {
  const f = fixture();
  try {
    const members = Array.from({ length: 205 }, (_, index) => member(index));
    const batches = [];
    const client = { async getStreams(input) { batches.push(input.twitchLogins); return input.twitchLogins.filter((_, index) => index === 0).map((login, index) => stream(login, batches.length * 10 + index)); } };
    const poller = new DshTwitchLivePoller({ listLiveTrackedMembers: async () => members }, { getGrant: async () => ({ status: "ready", clientId: "client-id", accessToken: "ephemeral-token", expiresAt: "2026-08-23T15:00:00Z" }) }, client, f.runtime);
    const result = await poller.poll("tenant-a", "poll-205", observedAt);
    assert.equal(result.status, "completed");
    assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
    assert.equal(result.poll.memberCount, 205);
    assert.equal(result.poll.liveCount, 3);
    assert.equal(f.monitor.getLiveMembers("tenant-a").length, 3);
    assert.equal(f.published.filter((action) => action.type === "shoutout.create").length, 3);
  } finally { f.close(); }
});

test("an incomplete Twitch poll never turns the entire community offline", async () => {
  const f = fixture();
  try {
    const tracked = [member(1)];
    let fail = false;
    const client = { async getStreams(input) { if (fail) throw new Error("Bearer private-token upstream timeout"); return [stream(input.twitchLogins[0])]; } };
    const poller = new DshTwitchLivePoller({ listLiveTrackedMembers: async () => tracked }, { getGrant: async () => ({ status: "ready", clientId: "client-id", accessToken: "ephemeral", expiresAt: "2026-08-23T15:00:00Z" }) }, client, f.runtime);
    assert.equal((await poller.poll("tenant-a", "online", observedAt)).status, "completed");
    fail = true;
    const unavailable = await poller.poll("tenant-a", "outage", "2026-08-23T14:10:00Z");
    assert.equal(unavailable.status, "unavailable");
    assert.doesNotMatch(unavailable.reason, /private-token/);
    assert.equal(f.monitor.getLiveMembers("tenant-a")[0].canonicalUserId, tracked[0].canonicalUserId);
    assert.equal(f.published.some((action) => action.type === "shoutout.remove"), false);
  } finally { f.close(); }
});

test("an authoritative empty directory removes departed members without requesting a Twitch token", async () => {
  const f = fixture();
  try {
    const tracked = [member(1)];
    let current = tracked;
    let grantCalls = 0;
    const poller = new DshTwitchLivePoller({ listLiveTrackedMembers: async () => current }, { getGrant: async () => { grantCalls += 1; return { status: "ready", clientId: "client-id", accessToken: "ephemeral", expiresAt: "2026-08-23T15:00:00Z" }; } }, { getStreams: async () => [stream(tracked[0].twitchLogin)] }, f.runtime);
    await poller.poll("tenant-a", "online", observedAt);
    current = [];
    const empty = await poller.poll("tenant-a", "directory-empty", "2026-08-23T14:10:00Z");
    assert.equal(empty.status, "completed");
    assert.equal(grantCalls, 1);
    assert.equal(f.monitor.getLiveMembers("tenant-a").length, 0);
    assert.equal(empty.result.actions.some((action) => action.type === "shoutout.remove"), true);
    assert.equal(empty.result.actions.some((action) => action.type === "spotlight.clear"), true);
  } finally { f.close(); }
});

test("the real Helix adapter sends credentials only in headers and classifies authorization failure", async () => {
  const calls = [];
  const ok = new TwitchHelixLiveClient(async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return new Response(JSON.stringify({ data: [stream("alpha")] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const rows = await ok.getStreams({ clientId: "client-id", accessToken: "access-token", twitchLogins: ["alpha", "beta"] });
  assert.equal(rows.length, 1);
  assert.match(calls[0].url, /user_login=alpha/);
  assert.doesNotMatch(calls[0].url, /access-token|client-id/);
  assert.equal(calls[0].headers.authorization, "Bearer access-token");
  const denied = new TwitchHelixLiveClient(async () => new Response("{}", { status: 401 }));
  await assert.rejects(() => denied.getStreams({ clientId: "client-id", accessToken: "secret", twitchLogins: ["alpha"] }), (error) => error instanceof TwitchHelixError && error.status === 401 && !error.message.includes("secret"));
});
