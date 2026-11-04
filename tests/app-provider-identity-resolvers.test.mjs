import test from "node:test";
import assert from "node:assert/strict";
import { DshSpmtIdentityResolver } from "../apps/discord-stream-hub/dist/provider-identity.js";
import { StreamWeaverSpmtIdentityResolver } from "../apps/streamweaver/dist/provider-identity-resolver.js";

function fakeClient() {
  const identities = new Map();
  const calls = [];
  return {
    identities,
    calls,
    request: async (path, init = {}) => {
      calls.push([path, init]);
      const tenantId = init.tenantId;
      if (path.startsWith("/v1/identity/provider?")) {
        const params = new URL(`https://spmt.test${path}`).searchParams;
        const key = `${params.get("provider")}:${params.get("providerUserId")}`;
        const userId = identities.get(key);
        if (!userId) { const error = new Error("not found"); error.status = 404; throw error; }
        return { provider: params.get("provider"), providerUserId: params.get("providerUserId"), userId, profile: { userId, username: userId, displayName: userId, tenantIds: [] }, credentialState: "setup-required", createdUser: false, linkedProvider: false, recoveredRevokedLink: false, tenantId };
      }
      if (path === "/v1/identity/provider/grandfather") {
        const body = JSON.parse(init.body);
        const key = `${body.provider}:${body.providerUserId}`;
        const userId = identities.get(key) ?? `spmt-${body.provider}-${body.providerUserId}`;
        identities.set(key, userId);
        return { ...body, userId, profile: { userId, username: body.providerUsername ?? userId, displayName: body.displayName ?? body.providerUsername ?? userId, tenantIds: [] }, credentialState: "setup-required", createdUser: true, linkedProvider: true, recoveredRevokedLink: false };
      }
      throw new Error(`unexpected request ${path}`);
    },
  };
}

test("DSH resolves once then grandfathers an immutable Discord identity through SPMT", async () => {
  const client = fakeClient();
  const resolver = new DshSpmtIdentityResolver(client);
  const first = await resolver.resolveOrGrandfather({ tenantId: "tenant-1", provider: "discord", providerUserId: "discord-1", username: "Captain", displayName: "Captain" });
  assert.equal(first.userId, "spmt-discord-discord-1");
  assert.deepEqual(client.calls.map(([path]) => path.split("?")[0]), ["/v1/identity/provider", "/v1/identity/provider/grandfather"]);
  client.calls.length = 0;
  const second = await resolver.resolveOrGrandfather({ tenantId: "tenant-1", provider: "discord", providerUserId: "discord-1", username: "Renamed" });
  assert.equal(second.userId, first.userId);
  assert.equal(client.calls.length, 1, "existing immutable provider link is resolved without another grandfather mutation");
});

test("StreamWeaver command identity resolver grandfathers Twitch/Discord but never invents a Kick identity", async () => {
  const client = fakeClient();
  const resolver = new StreamWeaverSpmtIdentityResolver(client);
  assert.equal(await resolver.resolve({ tenantId: "tenant-1", provider: "twitch", providerUserId: "twitch-4", username: "streamer", displayName: "Streamer" }), "spmt-twitch-twitch-4");
  assert.equal(await resolver.resolve({ tenantId: "tenant-1", provider: "discord", providerUserId: "discord-4", username: "streamer" }), "spmt-discord-discord-4");
  const beforeKick = client.calls.length;
  assert.equal(await resolver.resolve({ tenantId: "tenant-1", provider: "kick", providerUserId: "kick-4", username: "streamer" }), undefined);
  assert.equal(client.calls.length, beforeKick, "Kick stays provider-scoped until a verified SPMT link exists");
});
