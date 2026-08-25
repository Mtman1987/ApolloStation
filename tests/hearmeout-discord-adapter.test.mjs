import assert from "node:assert/strict";
import test from "node:test";
import { HearMeOutDiscordAdapter, HearMeOutDiscordError } from "../apps/hearmeout/dist/index.js";

function fixture({ grant } = {}) {
  const grants = [];
  const requests = [];
  const adapter = new HearMeOutDiscordAdapter({
    grants: {
      async getGrant(input) {
        grants.push(input);
        return grant ?? { authorization: input.kind === "bot" ? "Bot secret-bot-token" : "Bearer secret-user-token", expiresAt: "2099-01-01T00:00:00.000Z" };
      },
    },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/forbidden")) return new Response(JSON.stringify({ message: "nope" }), { status: 403, headers: { "content-type": "application/json" } });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { adapter, grants, requests };
}

test("HearMeOut Discord REST calls request the narrow user/bot capability and keep grants header-only", async () => {
  const fx = fixture();
  await fx.adapter.listGuilds("tenant-a");
  await fx.adapter.getCurrentUser("tenant-a");
  await fx.adapter.listGuildChannels("tenant-a", "123456789012345678");
  await fx.adapter.listMessages("tenant-a", "223456789012345678", 25);
  await fx.adapter.sendMessage("tenant-a", "223456789012345678", "hello", "323456789012345678");
  await fx.adapter.postEmbed("tenant-a", "223456789012345678", { title: "HearMeOut" }, "watch party");
  await fx.adapter.createInvite("tenant-a", "223456789012345678", { maxAgeSeconds: 600, maxUses: 3, temporary: true });
  await fx.adapter.deleteMessage("tenant-a", "223456789012345678", "423456789012345678");

  assert.deepEqual(fx.grants.map((entry) => [entry.kind, entry.capability]), [
    ["user-oauth", "guilds:read"],
    ["user-oauth", "profile:read"],
    ["bot", "channels:read"],
    ["bot", "messages:read"],
    ["bot", "messages:write"],
    ["bot", "messages:write"],
    ["bot", "invites:write"],
    ["bot", "messages:write"],
  ]);
  assert.equal(fx.requests.every((entry) => !entry.url.includes("secret-")), true);
  assert.equal(fx.requests.every((entry) => !String(entry.init.body ?? "").includes("secret-")), true);
  assert.equal(fx.requests[0].init.headers.authorization, "Bearer secret-user-token");
  assert.equal(fx.requests[2].init.headers.authorization, "Bot secret-bot-token");
  const sent = JSON.parse(String(fx.requests[4].init.body));
  assert.equal(sent.content, "hello");
  assert.deepEqual(sent.allowed_mentions, { parse: [] });
  assert.equal(sent.message_reference.message_id, "323456789012345678");
});

test("HearMeOut Discord adapter fails closed before fetch on expired or malformed grants", async () => {
  let fetchCount = 0;
  const expired = new HearMeOutDiscordAdapter({
    grants: { async getGrant() { return { authorization: "Bot old", expiresAt: "2000-01-01T00:00:00.000Z" }; } },
    fetchImpl: async () => { fetchCount += 1; return new Response("{}"); },
  });
  await assert.rejects(() => expired.listGuildChannels("tenant-a", "123456789012345678"), /expired/);
  assert.equal(fetchCount, 0);

  const malformed = new HearMeOutDiscordAdapter({
    grants: { async getGrant() { return { authorization: "Bot token\nInjected: yes" }; } },
    fetchImpl: async () => { fetchCount += 1; return new Response("{}"); },
  });
  await assert.rejects(() => malformed.listGuilds("tenant-a"), /unavailable/);
  assert.equal(fetchCount, 0);
});

test("HearMeOut Discord adapter validates Discord identifiers and bounded payloads locally", async () => {
  const fx = fixture();
  await assert.rejects(() => fx.adapter.listGuildChannels("tenant-a", "not-a-snowflake"), /snowflake/);
  await assert.rejects(() => fx.adapter.listMessages("tenant-a", "123456789012345678", 101), /limit/);
  await assert.rejects(() => fx.adapter.sendMessage("tenant-a", "123456789012345678", "x".repeat(2001)), /content/);
  await assert.rejects(() => fx.adapter.postEmbed("tenant-a", "123456789012345678", []), /embed/);
  assert.equal(fx.requests.length, 0);
});

test("HearMeOut Discord errors expose status/body without ever echoing the authorization grant", async () => {
  const adapter = new HearMeOutDiscordAdapter({
    grants: { async getGrant() { return { authorization: "Bot super-secret" }; } },
    fetchImpl: async () => new Response(JSON.stringify({ message: "Missing Permissions" }), { status: 403 }),
  });
  await assert.rejects(
    () => adapter.listGuildChannels("tenant-a", "123456789012345678"),
    (error) => error instanceof HearMeOutDiscordError && error.status === 403 && !String(error.message).includes("super-secret") && !JSON.stringify(error.responseBody).includes("super-secret"),
  );
});
