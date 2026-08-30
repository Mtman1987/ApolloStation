import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OpenAiCompatibleChatProvider } from "../apps/stellar-core/dist/worker.js";
import { ProviderGrantError, SqliteProviderCredentialAuthority, storePinnedProviderAuthorization, theCountTwitchPolicy } from "../packages/provider-grants-core/dist/index.js";

test("Stellar continues token-limited replies and returns a complete sentence", async () => {
  const bodies = [];
  const responses = [
    { choices: [{ message: { content: "The answer begins and" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    { choices: [{ message: { content: "ends cleanly." }, finish_reason: "stop" }], usage: { prompt_tokens: 14, completion_tokens: 4 } },
  ];
  const provider = new OpenAiCompatibleChatProvider({ origin: "http://127.0.0.1:1234", model: "local", fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }); } });
  const completion = await provider.complete([{ role: "user", content: "Explain it" }]);
  assert.equal(completion.text, "The answer begins and ends cleanly.");
  assert.deepEqual(completion.usage, { inputTokens: 24, outputTokens: 9 });
  assert.equal(bodies[0].max_tokens, 1200);
  assert.equal(bodies[1].max_tokens, 600);
  assert.match(bodies[1].messages.at(-1).content, /complete sentences/);
});

test("The Count credential is owner-only, identity-pinned, least-scope, and encrypted", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-count-"));
  const authority = new SqliteProviderCredentialAuthority(path.join(dir, "providers.sqlite"), Buffer.alloc(32, 7));
  const policy = theCountTwitchPolicy({ tenantId: "tenant-a", ownerUserId: "owner-a", providerUserId: "count-provider-id" });
  try {
    assert.throws(() => storePinnedProviderAuthorization(authority, policy, { actorUserId: "member-a", providerUserId: "count-provider-id", providerLogin: "TheCountSPMT", accessToken: "access-token-123", refreshToken: "refresh-token-123", scopes: ["chat:read", "chat:edit"], expiresAt: "2026-08-30T12:00:00Z" }), (error) => error instanceof ProviderGrantError && error.code === "denied");
    assert.throws(() => storePinnedProviderAuthorization(authority, policy, { actorUserId: "owner-a", providerUserId: "wrong-id", providerLogin: "other", accessToken: "access-token-123", refreshToken: "refresh-token-123", scopes: ["chat:read"], expiresAt: "2026-08-30T12:00:00Z" }), /TheCountSPMT/);
    const stored = storePinnedProviderAuthorization(authority, policy, { actorUserId: "owner-a", providerUserId: "count-provider-id", providerLogin: "TheCountSPMT", accessToken: "access-token-123", refreshToken: "refresh-token-123", scopes: ["chat:read", "chat:edit", "user:write:chat"], expiresAt: "2026-08-30T12:00:00Z" });
    assert.equal(stored.metadata.identityPinned, "true");
    assert.deepEqual(stored.allowedAppIds, ["chat-gateway", "streamweaver"]);
    assert.deepEqual(stored.allowedCapabilities, ["chat:write"]);
  } finally { authority.close(); rmSync(dir, { recursive: true, force: true }); }
});
