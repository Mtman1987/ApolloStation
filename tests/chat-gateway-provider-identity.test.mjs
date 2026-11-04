import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalizingChatIngress } from "../apps/chat-gateway/dist/canonical-identity.js";

function message(provider = "discord") {
  return {
    schemaVersion: 1,
    tenantId: "tenant-1",
    provider,
    connectionId: `${provider}-connection`,
    channelId: "channel-1",
    messageId: "message-1",
    text: "hello @friend",
    occurredAt: "2026-08-24T19:00:00.000Z",
    actor: { providerUserId: "actor-provider", username: "captain", displayName: "Captain", isBot: false, roles: ["member"] },
    mentions: [{ token: "@friend", providerUserId: "mention-provider", username: "friend" }],
  };
}

test("gateway decorates actor and mentions with existing canonical SPMT identities", async () => {
  const seen = [];
  const downstream = { ingest(value) { seen.push(value); return { accepted: true }; } };
  const resolver = { async resolve(input) { return input.providerUserId === "actor-provider" ? "spmt-actor" : input.providerUserId === "mention-provider" ? "spmt-friend" : undefined; } };
  const ingress = new CanonicalizingChatIngress(downstream, resolver);
  const result = await ingress.ingest(message());
  assert.deepEqual(result, { accepted: true });
  assert.equal(seen[0].actor.canonicalUserId, "spmt-actor");
  assert.equal(seen[0].mentions[0].canonicalUserId, "spmt-friend");
});

test("gateway preserves an already canonical identity and never asks resolver to replace it", async () => {
  const requests = [];
  const seen = [];
  const original = message("twitch");
  original.actor.canonicalUserId = "existing-actor";
  original.mentions[0].canonicalUserId = "existing-friend";
  const ingress = new CanonicalizingChatIngress({ ingest(value) { seen.push(value); } }, { resolve(input) { requests.push(input); return "wrong"; } });
  await ingress.ingest(original);
  assert.equal(requests.length, 0);
  assert.equal(seen[0].actor.canonicalUserId, "existing-actor");
  assert.equal(seen[0].mentions[0].canonicalUserId, "existing-friend");
});

test("unlinked users remain provider-scoped instead of being merged by username", async () => {
  const seen = [];
  const ingress = new CanonicalizingChatIngress({ ingest(value) { seen.push(value); } }, { resolve() { return undefined; } });
  await ingress.ingest(message("discord"));
  assert.equal(seen[0].actor.canonicalUserId, undefined);
  assert.equal(seen[0].mentions[0].canonicalUserId, undefined);
  assert.equal(seen[0].actor.providerUserId, "actor-provider");
});

test("Kick is allowed to remain provider scoped without an SPMT grandfather path", async () => {
  const seen = [];
  const ingress = new CanonicalizingChatIngress({ ingest(value) { seen.push(value); } }, { resolve(input) { assert.equal(input.provider, "kick"); return undefined; } });
  await ingress.ingest(message("kick"));
  assert.equal(seen[0].actor.canonicalUserId, undefined);
});
