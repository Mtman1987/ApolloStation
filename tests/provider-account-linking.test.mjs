import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";

test("signed-in users can verify and link Twitch and Discord through the existing OAuth callback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-provider-link-"));
  const calls = [];
  const providerFetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://id.twitch.tv/oauth2/token") return Response.json({ access_token: "twitch-access" });
    if (url === "https://api.twitch.tv/helix/users") return Response.json({ data: [{ id: "twitch-user-7", login: "captain_live" }] });
    if (url === "https://discord.com/api/oauth2/token") return Response.json({ access_token: "discord-access" });
    if (url === "https://discord.com/api/v10/users/@me") return Response.json({ id: "discord-user-8", username: "captain" });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  const service = createSpmtService({ runtimeMode: "sandbox",
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 9),
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://spmt.test",
    fetchImpl: providerFetch,
    providerOAuthClients: {
      twitch: { clientId: "twitch-client", clientSecret: "twitch-secret" },
      discord: { clientId: "discord-client", clientSecret: "discord-secret" },
    },
  });
  let web;
  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    web = createSpaceMountainWebHost({ spmtOrigin: base, host: "127.0.0.1", port: 0 });
    await web.listen();
    const webAddress = web.server.address();
    assert.ok(webAddress && typeof webAddress !== "string");
    const browserBase = `http://127.0.0.1:${webAddress.port}`;
    await fetch(`${base}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Captain", username: "captain", password: "correct horse battery staple" }) });
    const login = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "captain", password: "correct horse battery staple" }) });
    const sessionCookie = cookiePair(login.headers.get("set-cookie"));
    assert.match(sessionCookie, /^spmt_token=/);
    const session = await (await fetch(`${base}/v1/session`, { headers: { cookie: sessionCookie } })).json();
    const tenantId = session.tenantIds[0];

    for (const provider of ["twitch", "discord"]) {
      const start = await fetch(`${browserBase}/v1/identity/providers/${provider}/start?tenantId=${encodeURIComponent(tenantId)}`, { headers: { cookie: sessionCookie }, redirect: "manual" });
      assert.equal(start.status, 302);
      const authorization = new URL(start.headers.get("location"));
      assert.equal(authorization.hostname, provider === "twitch" ? "id.twitch.tv" : "discord.com");
      assert.equal(authorization.searchParams.get("redirect_uri"), "https://spmt.test/v1/onboarding/twitch/callback");
      const state = authorization.searchParams.get("state");
      assert.ok(state);
      const pendingCookie = cookiePair(start.headers.get("set-cookie"));
      assert.match(pendingCookie, /^spmt_provider_link=/);
      const callback = await fetch(`${browserBase}/v1/onboarding/twitch/callback?state=${encodeURIComponent(state)}&code=${provider}-code`, { headers: { cookie: `${sessionCookie}; ${pendingCookie}` }, redirect: "manual" });
      assert.equal(callback.status, 302);
      assert.equal(new URL(callback.headers.get("location")).searchParams.get("providerLinked"), provider);
    }

    const links = await (await fetch(`${base}/v1/identity/providers`, { headers: { cookie: sessionCookie } })).json();
    assert.deepEqual(links.map((item) => `${item.provider}:${item.providerUserId}`).sort(), ["discord:discord-user-8", "twitch:twitch-user-7"]);
    assert.deepEqual(calls, ["https://id.twitch.tv/oauth2/token", "https://api.twitch.tv/helix/users", "https://discord.com/api/oauth2/token", "https://discord.com/api/v10/users/@me"]);
  } finally {
    if (web) await web.close();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});



test("signed-out provider recovery reuses the registered Apollo callback and restores the existing account", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-provider-recovery-"));
  const calls = [];
  const providerFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body?.toString?.() ?? "" });
    if (url === "https://id.twitch.tv/oauth2/token") return Response.json({ access_token: "twitch-access" });
    if (url === "https://api.twitch.tv/helix/users") return Response.json({ data: [{ id: "twitch-owner-77", login: "owner_live" }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  const service = createSpmtService({
    runtimeMode: "sandbox",
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 7),
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://apollo-node-1.hostless.app",
    fetchImpl: providerFetch,
    providerOAuthClients: { twitch: { clientId: "twitch-client", clientSecret: "twitch-secret" } },
  });
  let web;
  try {
    const account = service.accounts.grandfatherProviderIdentity({
      sourceAppId: "discord-stream-hub",
      provider: "twitch",
      providerUserId: "twitch-owner-77",
      providerUsername: "owner_live",
    });
    const tenantId = "tenant-recovery-owner";
    service.control.registerTenant({ tenantId, ownerUserId: account.userId, displayName: "Owner workspace" });
    service.authority.getOrCreateWorkspace(tenantId);
    service.data.setUserTenants(account.userId, [tenantId]);
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    web = createSpaceMountainWebHost({ spmtOrigin: base, host: "127.0.0.1", port: 0 });
    await web.listen();
    const webAddress = web.server.address();
    assert.ok(webAddress && typeof webAddress !== "string");
    const browserBase = `http://127.0.0.1:${webAddress.port}`;

    const start = await fetch(`${browserBase}/v1/auth/linked-provider-recovery/start?provider=twitch`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get("location"));
    assert.equal(authorization.searchParams.get("redirect_uri"), "https://apollo-node-1.hostless.app/v1/onboarding/twitch/callback");
    const state = authorization.searchParams.get("state");
    const pendingCookie = cookiePair(start.headers.get("set-cookie"));
    assert.match(pendingCookie, /^spmt_linked_recovery=/);

    const callback = await fetch(`${browserBase}/v1/onboarding/twitch/callback?state=${encodeURIComponent(state)}&code=valid-code`, {
      headers: { cookie: pendingCookie },
      redirect: "manual",
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "https://apollo-node-1.hostless.app/");
    const cookies = callback.headers.get("set-cookie");
    assert.match(cookies, /spmt_token=/);
    assert.match(cookies, /spmt_linked_recovery=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
    assert.equal(calls.length, 2);
    const tokenRequest = new URLSearchParams(calls[0].body);
    assert.equal(tokenRequest.get("redirect_uri"), "https://apollo-node-1.hostless.app/v1/onboarding/twitch/callback");
    const browserCookie = cookiePair(cookies);
    const check = await fetch(`${base}/v1/auth/session/check`, { headers: { cookie: browserCookie } });
    assert.equal(check.status, 200);
    const principal = await check.json();
    assert.equal(principal.authenticated, true);
    assert.equal(principal.actorId, account.userId);
    assert.deepEqual(principal.tenantIds, [tenantId]);
  } finally {
    if (web) await web.close();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function cookiePair(value) { return String(value ?? "").split(";", 1)[0]; }
