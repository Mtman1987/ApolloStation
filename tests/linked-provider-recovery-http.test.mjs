import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";

const PUBLIC_ORIGIN = "https://apollo-node-1.hostless.app";
const PASSWORD = "new-recovery-password-2026";

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function providerFetch() {
  const identities = new Map([
    ["discord:discord-good", "discord-linked"],
    ["discord:discord-proxy", "discord-linked"],
    ["discord:discord-other", "discord-unlinked"],
    ["twitch:twitch-good", "twitch-linked"],
  ]);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    calls.push({ url: url.href, method: init.method ?? "GET" });

    if (url.hostname === "discord.com" && url.pathname === "/api/oauth2/token") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("redirect_uri"), `${PUBLIC_ORIGIN}/v1/onboarding/twitch/callback`);
      return json({ access_token: `discord:${form.get("code") ?? ""}` });
    }
    if (url.hostname === "discord.com" && url.pathname === "/api/v10/users/@me") {
      const accessToken = new Headers(init.headers).get("authorization")?.replace(/^Bearer /i, "") ?? "";
      const code = accessToken.startsWith("discord:") ? accessToken.slice("discord:".length) : "";
      return json({ id: identities.get(`discord:${code}`) ?? "discord-unlinked", username: "linked-user" });
    }
    if (url.hostname === "id.twitch.tv" && url.pathname === "/oauth2/token") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("redirect_uri"), `${PUBLIC_ORIGIN}/v1/onboarding/twitch/callback`);
      return json({ access_token: `twitch:${form.get("code") ?? ""}` });
    }
    if (url.hostname === "api.twitch.tv" && url.pathname === "/helix/users") {
      const accessToken = new Headers(init.headers).get("authorization")?.replace(/^Bearer /i, "") ?? "";
      const code = accessToken.startsWith("twitch:") ? accessToken.slice("twitch:".length) : "";
      return json({ data: [{ id: identities.get(`twitch:${code}`) ?? "twitch-unlinked", login: "linkeduser" }] });
    }
    throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`);
  };
  return { fetchImpl, calls };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function setCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,]+=)/) : [];
}

function cookiePair(headers, name) {
  const line = setCookieLines(headers).find((value) => value.startsWith(`${name}=`));
  assert.ok(line, `expected ${name} cookie; got ${setCookieLines(headers).join(" | ")}`);
  return line.split(";", 1)[0];
}

async function fixture() {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const directory = mkdtempSync(join(tmpdir(), "apollo-linked-recovery-http-"));
  const oauth = providerFetch();
  const service = createSpmtService({
    databasePath: join(directory, "apollo.db"),
    webhookKey: Buffer.alloc(32, 7),
    publicBaseUrl: PUBLIC_ORIGIN,
    runtimeMode: "production",
    providerOAuthClients: {
      discord: { clientId: "discord-client-id-test", clientSecret: "discord-client-secret-test" },
      twitch: { clientId: "twitch-client-id-test", clientSecret: "twitch-client-secret-test" },
    },
    fetchImpl: oauth.fetchImpl,
  });
  const account = service.accounts.provisionAccount({
    tenantId: "tenant-linked-recovery-http",
    sourceAppId: "spacemountain",
    username: "routeuser",
    displayName: "Route User",
  });
  service.authority.linkProvider(account.userId, "discord", "discord-linked");
  service.authority.linkProvider(account.userId, "twitch", "twitch-linked");
  const serviceOrigin = await listen(service.server);

  return {
    service,
    account,
    oauth,
    serviceOrigin,
    async close(web) {
      if (web) await web.close();
      await service.close();
      rmSync(directory, { recursive: true, force: true });
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    },
  };
}

async function startAndCallback(f, provider, username, code) {
  const startUrl = new URL("/v1/auth/linked-provider-recovery/start", f.serviceOrigin);
  startUrl.searchParams.set("provider", provider);
  startUrl.searchParams.set("username", username);
  const start = await fetch(startUrl, { redirect: "manual" });
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get("location"));
  assert.equal(authorization.hostname, provider === "discord" ? "discord.com" : "id.twitch.tv");
  assert.equal(authorization.searchParams.get("redirect_uri"), `${PUBLIC_ORIGIN}/v1/onboarding/twitch/callback`);
  const pendingCookie = cookiePair(start.headers, "spmt_linked_recovery");
  const state = authorization.searchParams.get("state");
  assert.ok(state && /^[A-Za-z0-9_-]{32,100}$/.test(state));

  const callbackUrl = new URL("/v1/onboarding/twitch/callback", f.serviceOrigin);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("state", state);
  const callback = await fetch(callbackUrl, {
    headers: { cookie: pendingCookie },
    redirect: "manual",
  });
  return { start, authorization, pendingCookie, state, callback };
}

async function completePassword(f, ticketCookie, username, password = PASSWORD, origin = f.serviceOrigin) {
  return fetch(`${origin}/v1/auth/linked-provider-recovery/password`, {
    method: "POST",
    headers: { cookie: ticketCookie, "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

test("Discord and Twitch linked-provider recovery set a password and establish the normal Apollo browser session", async () => {
  const f = await fixture();
  try {
    for (const [provider, code] of [["discord", "discord-good"], ["twitch", "twitch-good"]]) {
      const flow = await startAndCallback(f, provider, "routeuser", code);
      assert.equal(flow.callback.status, 302);
      const destination = new URL(flow.callback.headers.get("location"));
      assert.equal(destination.searchParams.get("recovery"), "verified");
      assert.equal(destination.searchParams.get("recoveryUsername"), "routeuser");

      const ticketCookie = cookiePair(flow.callback.headers, "spmt_linked_recovery_ticket");
      const completed = await completePassword(f, ticketCookie, "routeuser");
      assert.equal(completed.status, 200);
      assert.deepEqual(await completed.json(), { ok: true });

      const sessionCookie = cookiePair(completed.headers, "spmt_token");
      const sessionHeader = setCookieLines(completed.headers).find((value) => value.startsWith("spmt_token=")) ?? "";
      assert.match(sessionHeader, /HttpOnly/i);
      assert.match(sessionHeader, /Secure/i);
      assert.match(sessionHeader, /Domain=\.hostless\.app/i);

      const sessionCheck = await fetch(`${f.serviceOrigin}/v1/auth/session/check`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(sessionCheck.status, 200);
      assert.equal(f.service.data.login("routeuser", PASSWORD, ["workspace:read"]).profile.userId, f.account.userId);

      const replay = await completePassword(f, ticketCookie, "routeuser", "another-recovery-password-2026");
      assert.equal(replay.status, 400, "a consumed recovery ticket cannot be replayed");
    }
  } finally {
    await f.close();
  }
});

test("unknown usernames, mismatched provider IDs, and invalid OAuth state fail closed without creating or relinking accounts", async () => {
  const f = await fixture();
  try {
    const beforeLinks = f.service.authority.listProviderLinks(f.account.userId)
      .map((link) => `${link.provider}:${link.providerUserId}`).sort();

    const unknown = await startAndCallback(f, "discord", "not-a-real-user", "discord-good");
    assert.equal(unknown.start.status, 302, "start does not reveal whether the username exists");
    assert.equal(unknown.callback.status, 302);
    const unknownDestination = new URL(unknown.callback.headers.get("location"));
    assert.equal(unknownDestination.searchParams.get("recoveryError"), "recovery_failed");
    assert.equal(f.service.data.getProfileByUsername("not-a-real-user"), undefined);

    const mismatched = await startAndCallback(f, "discord", "routeuser", "discord-other");
    assert.equal(mismatched.callback.status, 302);
    const mismatchDestination = new URL(mismatched.callback.headers.get("location"));
    assert.equal(mismatchDestination.searchParams.get("recoveryError"), "recovery_failed");
    assert.equal(f.service.store.getProviderLink("discord", "discord-unlinked"), undefined);

    const callsBeforeInvalidState = f.oauth.calls.length;
    const startUrl = new URL("/v1/auth/linked-provider-recovery/start", f.serviceOrigin);
    startUrl.searchParams.set("provider", "twitch");
    startUrl.searchParams.set("username", "routeuser");
    const start = await fetch(startUrl, { redirect: "manual" });
    const pendingCookie = cookiePair(start.headers, "spmt_linked_recovery");
    const authorization = new URL(start.headers.get("location"));
    const callbackUrl = new URL("/v1/onboarding/twitch/callback", f.serviceOrigin);
    callbackUrl.searchParams.set("code", "twitch-good");
    callbackUrl.searchParams.set("state", `${authorization.searchParams.get("state")}x`);
    const invalidState = await fetch(callbackUrl, {
      headers: { cookie: pendingCookie },
      redirect: "manual",
    });
    assert.equal(invalidState.status, 302);
    assert.equal(new URL(invalidState.headers.get("location")).searchParams.get("recoveryError"), "invalid_state");
    assert.equal(f.oauth.calls.length, callsBeforeInvalidState, "invalid OAuth state is rejected before provider token exchange");

    const afterLinks = f.service.authority.listProviderLinks(f.account.userId)
      .map((link) => `${link.provider}:${link.providerUserId}`).sort();
    assert.deepEqual(afterLinks, beforeLinks, "recovery never changes the account's provider links");
    assert.equal(f.service.data.getProfileByUsername("not-a-real-user"), undefined);
  } finally {
    await f.close();
  }
});

test("SpaceMountain proxy enforces same-origin password submission and forwards the new Apollo session", async () => {
  const f = await fixture();
  let web;
  try {
    const flow = await startAndCallback(f, "discord", "routeuser", "discord-proxy");
    assert.equal(flow.callback.status, 302);
    const ticketCookie = cookiePair(flow.callback.headers, "spmt_linked_recovery_ticket");

    web = createSpaceMountainWebHost({
      spmtOrigin: f.serviceOrigin,
      port: 0,
      host: "127.0.0.1",
    });
    await web.listen();
    const address = web.server.address();
    assert.ok(address && typeof address === "object");
    const webOrigin = `http://127.0.0.1:${address.port}`;

    const canonicalStart = await fetch(`${webOrigin}/v1/auth/linked-provider-recovery/start?provider=discord&username=routeuser`, {
      redirect: "manual",
    });
    assert.equal(canonicalStart.status, 302);
    const canonicalLocation = new URL(canonicalStart.headers.get("location"));
    assert.equal(canonicalLocation.origin, PUBLIC_ORIGIN, "recovery is anchored to the registered Node 1 OAuth callback origin");

    const crossOrigin = await fetch(`${webOrigin}/v1/auth/linked-provider-recovery/password`, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        cookie: ticketCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "routeuser", password: PASSWORD }),
    });
    assert.equal(crossOrigin.status, 403, "the browser proxy blocks cross-origin password changes");

    const sameOrigin = await fetch(`${webOrigin}/v1/auth/linked-provider-recovery/password`, {
      method: "POST",
      headers: {
        origin: webOrigin,
        cookie: ticketCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "routeuser", password: PASSWORD }),
    });
    assert.equal(sameOrigin.status, 200);
    const sessionCookie = cookiePair(sameOrigin.headers, "spmt_token");

    const sessionCheck = await fetch(`${webOrigin}/v1/auth/session/check`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(sessionCheck.status, 200, "the proxy forwards the standard HttpOnly Apollo session cookie");
  } finally {
    await f.close(web);
  }
});
