import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { request as httpRequest } from "node:http";
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



test("signed-out provider recovery verifies the entered username, sets a password, and opens the normal Apollo session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-provider-recovery-"));
  const calls = [];
  const providerFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body?.toString?.() ?? "" });
    if (url === "https://id.twitch.tv/oauth2/token") return Response.json({ access_token: "twitch-access" });
    if (url === "https://api.twitch.tv/helix/users") return Response.json({ data: [{ id: "twitch-owner-77", login: "owner_live" }] });
    if (url === "https://discord.com/api/oauth2/token") return Response.json({ access_token: "discord-access" });
    if (url === "https://discord.com/api/v10/users/@me") return Response.json({ id: "discord-owner-88", username: "owner" });
    throw new Error("Unexpected provider request: " + url);
  };
  const service = createSpmtService({
    runtimeMode: "sandbox",
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 7),
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://apollo-node-1.hostless.app",
    fetchImpl: providerFetch,
    providerOAuthClients: { twitch: { clientId: "twitch-client", clientSecret: "twitch-secret" }, discord: { clientId: "discord-client", clientSecret: "discord-secret" } },
  });
  let web;
  try {
    const account = service.accounts.grandfatherProviderIdentity({
      sourceAppId: "discord-stream-hub",
      provider: "twitch",
      providerUserId: "twitch-owner-77",
      providerUsername: "owner_live",
    });
    service.authority.linkProvider(account.userId, "discord", "discord-owner-00");
    service.authority.linkProvider(account.userId, "discord", "discord-owner-88");
    const username = account.profile.username;
    const tenantId = "tenant-recovery-owner";
    service.control.registerTenant({ tenantId, ownerUserId: account.userId, displayName: "Owner workspace" });
    service.authority.getOrCreateWorkspace(tenantId);
    service.data.setUserTenants(account.userId, [tenantId]);
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    web = createSpaceMountainWebHost({ spmtOrigin: base, host: "127.0.0.1", port: 0 });
    await web.listen();
    const webAddress = web.server.address();
    assert.ok(webAddress && typeof webAddress !== "string");
    const browserBase = "http://127.0.0.1:" + webAddress.port;

    const missingUsername = await fetch(browserBase + "/v1/auth/linked-provider-recovery/start?provider=twitch", { redirect: "manual" });
    assert.equal(missingUsername.status, 400);

    const customDomainStart = await requestWithHost(browserBase + "/v1/auth/linked-provider-recovery/start?provider=twitch&username=" + encodeURIComponent(username), "spacemountain.live");
    assert.equal(customDomainStart.status, 302);
    const canonicalStart = new URL(customDomainStart.headers.location);
    assert.equal(canonicalStart.origin, "https://apollo-node-1.hostless.app");
    assert.equal(canonicalStart.pathname, "/v1/auth/linked-provider-recovery/start");
    assert.equal(canonicalStart.searchParams.get("username"), username);
    assert.equal(cookieValue(customDomainStart.headers["set-cookie"], "spmt_linked_recovery"), undefined,
      "the custom alias must not receive host-bound OAuth state when the callback is on Node 1");

    const wrongStart = await requestWithHost(browserBase + "/v1/auth/linked-provider-recovery/start?provider=twitch&username=not-owner", "apollo-node-1.hostless.app");
    assert.equal(wrongStart.status, 302);
    const wrongAuthorization = new URL(wrongStart.headers.location);
    const wrongPending = cookiePair(wrongStart.headers["set-cookie"]);
    const wrongCallback = await fetch(browserBase + "/v1/onboarding/twitch/callback?state=" + encodeURIComponent(wrongAuthorization.searchParams.get("state")) + "&code=twitch-valid-code", {
      headers: { cookie: wrongPending },
      redirect: "manual",
    });
    assert.equal(new URL(wrongCallback.headers.get("location")).searchParams.get("recoveryError"), "recovery_failed");
    assert.equal(cookieValue(wrongCallback.headers.get("set-cookie"), "spmt_linked_recovery_ticket"), undefined);

    const stateStart = await requestWithHost(browserBase + "/v1/auth/linked-provider-recovery/start?provider=discord&username=" + encodeURIComponent(username), "apollo-node-1.hostless.app");
    const stateCookie = cookiePair(stateStart.headers["set-cookie"]);
    const badState = await fetch(browserBase + "/v1/onboarding/twitch/callback?state=wrong-state&code=discord-valid-code", { headers: { cookie: stateCookie }, redirect: "manual" });
    assert.equal(new URL(badState.headers.get("location")).searchParams.get("recoveryError"), "invalid_state");

    for (const provider of ["twitch", "discord"]) {
      const start = await requestWithHost(browserBase + "/v1/auth/linked-provider-recovery/start?provider=" + provider + "&username=" + encodeURIComponent(username), "apollo-node-1.hostless.app");
      assert.equal(start.status, 302);
      const authorization = new URL(start.headers.location);
      assert.equal(authorization.hostname, provider === "twitch" ? "id.twitch.tv" : "discord.com");
      assert.equal(authorization.searchParams.get("redirect_uri"), "https://apollo-node-1.hostless.app/v1/onboarding/twitch/callback");
      const state = authorization.searchParams.get("state");
      const pendingCookie = cookiePair(start.headers["set-cookie"]);
      assert.match(pendingCookie, /^spmt_linked_recovery=/);
      const pendingPayload = JSON.parse(Buffer.from(decodeURIComponent(pendingCookie.split("=")[1]), "base64url").toString("utf8"));
      assert.equal(pendingPayload.username, username);
      assert.equal(pendingPayload.provider, provider);

      const callback = await fetch(browserBase + "/v1/onboarding/twitch/callback?state=" + encodeURIComponent(state) + "&code=" + provider + "-valid-code", {
        headers: { cookie: pendingCookie },
        redirect: "manual",
      });
      assert.equal(callback.status, 302);
      assert.equal(new URL(callback.headers.get("location")).searchParams.get("recovery"), "verified");
      assert.equal(new URL(callback.headers.get("location")).searchParams.get("recoveryUsername"), username);
      const callbackCookies = callback.headers.get("set-cookie") ?? "";
      assert.match(callbackCookies, /spmt_linked_recovery_ticket=/);
      assert.doesNotMatch(callbackCookies, /spmt_token=/, "OAuth verification alone must not establish the Apollo session");
      assert.match(callbackCookies, /spmt_linked_recovery=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
      const ticket = cookieValue(callbackCookies, "spmt_linked_recovery_ticket");
      assert.ok(ticket);

      const blockedCrossOrigin = await fetch(browserBase + "/v1/auth/linked-provider-recovery/password", {
        method: "POST",
        headers: { origin: "https://attacker.invalid", "content-type": "application/json", cookie: "spmt_linked_recovery_ticket=" + ticket },
        body: JSON.stringify({ username, password: "cross-origin-attempt-123" }),
      });
      assert.equal(blockedCrossOrigin.status, 403, "the browser proxy rejects cross-origin password changes");

      const password = "recovered-" + provider + "-password-123";
      const complete = await fetch(browserBase + "/v1/auth/linked-provider-recovery/password", {
        method: "POST",
        headers: { origin: browserBase, "content-type": "application/json", cookie: "spmt_linked_recovery_ticket=" + ticket },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(complete.status, 200, await complete.text());
      assert.match(complete.headers.get("set-cookie") ?? "", /spmt_linked_recovery_ticket=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
      const sessionCookie = cookiePair(complete.headers.get("set-cookie"));
      assert.match(sessionCookie, /^spmt_token=/);
      const check = await fetch(base + "/v1/auth/session/check", { headers: { cookie: sessionCookie } });
      assert.equal(check.status, 200);
      const principal = await check.json();
      assert.equal(principal.authenticated, true);
      assert.equal(principal.actorId, account.userId);
      assert.deepEqual(principal.tenantIds, [tenantId]);
      assert.equal(service.data.login(username, password, ["workspace:read"]).profile.userId, account.userId);

      const replay = await fetch(browserBase + "/v1/auth/linked-provider-recovery/password", {
        method: "POST",
        headers: { origin: browserBase, "content-type": "application/json", cookie: "spmt_linked_recovery_ticket=" + ticket },
        body: JSON.stringify({ username, password: "replay-" + provider + "-password-123" }),
      });
      assert.equal(replay.status, 400, "a completed recovery ticket cannot be reused");
    }
    assert.equal(calls.length, 6);
    assert.deepEqual(
      service.authority.listProviderLinks(account.userId).map(link => link.provider + ":" + link.providerUserId).sort(),
      ["discord:discord-owner-00", "discord:discord-owner-88", "twitch:twitch-owner-77"],
      "recovery must not relink or replace either existing provider identity",
    );
  } finally {
    if (web) await web.close();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function requestWithHost(value, host) {
  const target = new URL(value);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: Number(target.port), path: target.pathname + target.search, method: "GET", headers: { host } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

function cookieValue(value, name) {
  const source = String(value ?? "");
  const match = source.match(new RegExp("(?:^|[,;] *)" + name + "=([^;,]*)"));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function cookiePair(value) { return String(value ?? "").split(";", 1)[0]; }
