import assert from "node:assert/strict";
import test from "node:test";
import { StreamWeaverTwitchCommandAdapter } from "../apps/streamweaver/dist/index.js";

function response(status, body) { return new Response(body === undefined ? undefined : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function fixture() {
  const calls = [];
  const grants = { getGrant: async ({ tenantId, capability }) => ({ status: "ready", clientId: "client-1", accessToken: `token-${capability}`, broadcasterId: "100", moderatorId: "100", expiresAt: "2099-01-01T00:00:00.000Z" }) };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers, body: init.body });
    const value = String(url);
    if (value.includes("/clips?")) return response(202, { data: [{ id: "clip123", edit_url: "https://clips.twitch.tv/edit/clip123" }] });
    if (value.includes("/channels/followers?")) return response(200, { total: 321, data: [] });
    if (value.includes("/channels/followed?")) return response(200, { data: [{ broadcaster_id: "100", user_id: "200", followed_at: "2026-01-01T00:00:00Z" }] });
    if (value.includes("/streams?")) return response(200, { data: [{ id: "stream1", started_at: "2026-08-24T18:00:00Z", title: "Live", game_name: "Space Game", viewer_count: 42 }] });
    if (value.includes("/search/categories?")) return response(200, { data: [{ id: "game1", name: "Space Game" }] });
    if (value.includes("/users?")) return response(200, { data: [{ id: "200", login: "friend", display_name: "Friend", profile_image_url: "https://example.com/friend.png" }] });
    if (value.includes("/chat/shoutouts?")) return response(204);
    if (value.includes("/channels?")) return response(204);
    throw new Error(`unexpected url ${value}`);
  };
  return { calls, adapter: new StreamWeaverTwitchCommandAdapter(grants, fetchImpl) };
}

test("clip, followers, follow history and uptime use scoped Twitch grants", async () => {
  const f = fixture();
  assert.equal((await f.adapter.createClip("tenant-a")).url, "https://clips.twitch.tv/clip123");
  assert.equal(await f.adapter.followers("tenant-a"), 321);
  assert.equal((await f.adapter.followed("tenant-a", "200")).followedAt, "2026-01-01T00:00:00.000Z");
  assert.equal((await f.adapter.uptime("tenant-a")).viewerCount, 42);
  assert.ok(f.calls.every((call) => String(call.headers.authorization).startsWith("Bearer token-")));
  assert.ok(f.calls.every((call) => call.headers["client-id"] === "client-1"));
});

test("settitle and setgame mutate the authenticated broadcaster only", async () => {
  const f = fixture();
  assert.equal((await f.adapter.setTitle("tenant-a", "New title")).title, "New title");
  assert.equal((await f.adapter.setGame("tenant-a", "Space Game")).name, "Space Game");
  const patches = f.calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.ok(patches.every((call) => call.url.includes("broadcaster_id=100")));
});

test("shoutout resolves the target then calls Twitch shoutouts with broadcaster/moderator identity", async () => {
  const f = fixture();
  const user = await f.adapter.sendShoutout("tenant-a", "@friend");
  assert.equal(user.displayName, "Friend");
  const call = f.calls.find((entry) => entry.url.includes("/chat/shoutouts?"));
  assert.ok(call.url.includes("from_broadcaster_id=100"));
  assert.ok(call.url.includes("to_broadcaster_id=200"));
  assert.ok(call.url.includes("moderator_id=100"));
});

test("expired or unavailable provider grants fail closed before Twitch is called", async () => {
  let calls = 0;
  const grants = { getGrant: async () => ({ status: "reauthorization-required", reason: "link twitch again" }) };
  const adapter = new StreamWeaverTwitchCommandAdapter(grants, async () => { calls += 1; return response(500); });
  await assert.rejects(() => adapter.createClip("tenant-a"), /link twitch again/);
  assert.equal(calls, 0);
});
