import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../apps/spacemountain-web/src/page.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../apps/spmt-service/src/index.ts", import.meta.url), "utf8");

test("SPMT bridge sign-in loads the Apollo shell instead of the saved-session screen", () => {
  const submit = client.slice(client.indexOf("async function submitLogin"), client.indexOf("async function authRequest"));
  assert.match(submit, /await loadShell\(\);\s*sessionRecovery\.authenticated\(\);\s*refreshOnceSignedIn\(\);/);
  assert.doesNotMatch(submit, /showSavedSession\(\)/);
});

test("restoring a session goes straight to loadShell without the cookie-only shortcut", () => {
  const restore = client.slice(client.indexOf("async function restoreShell"), client.indexOf("async function submitLogin"));
  assert.doesNotMatch(restore, /showSavedSession\(\)/);
  assert.match(restore, /await loadShell\(\);/);
});

test("bridge-login bootstraps the owner workspace on first sign-in and reuses it afterwards", () => {
  const start = service.indexOf("const resolveDonorWorkspace");
  assert.notEqual(start, -1, "resolveDonorWorkspace helper must exist");
  const block = service.slice(start, start + 8000);
  assert.match(service, /resolveDonorWorkspace\(\{ id: donorId/);
  assert.match(block, /data\.getProfileByUsername\(donorUsername\)/);
  assert.match(block, /linkedProfile \?\? usernameProfile/, "verified provider-linked account outranks stale shell username");
  assert.match(block, /linkedUserIds\.length > 1/, "conflicting Discord and Twitch links fail closed");
  assert.match(block, /data\.setUserTenants\(ownerUserId, tenantIds\)/, "canonical owned tenant IDs replace stale profile tenant links");
  assert.match(block, /control\.registerTenant\(\{ tenantId, ownerUserId: userId/);
  assert.match(block, /data\.registerUser\(\{ userId, username: donorUsername/);
  assert.match(service, /issueHumanSession\(\{ userId: profile\.userId, scopes: USER_SCOPES, tenantIds \}\)/);
});

test("the retired /v1/auth/session/bridge path answers 404", () => {
  assert.match(service, /url\.pathname === "\/v1\/auth\/session\/bridge"\) return json\(response, 404/);
});

test("SPMT sign-in starts and completes through a PKCE public client with no client secret", () => {
  const start = service.indexOf('url.pathname === "/v1/auth/spmt/start"');
  const callback = service.indexOf('url.pathname === "/v1/auth/spmt/callback"');
  assert.ok(start > 0 && callback > start, "start and callback routes exist in order");
  const flow = service.slice(start, service.indexOf('url.pathname === "/v1/auth/login"', callback));
  assert.match(flow, /client_id: SPMT_APOLLO_CLIENT_ID/);
  assert.match(flow, /code_challenge_method", "S256"/);
  assert.match(flow, /code_verifier: pending\.verifier/);
  assert.doesNotMatch(flow, /client_secret/i);
  assert.match(flow, /resolveDonorWorkspace\(\{ id: donorId/);
  assert.match(flow, /issueBrowserSession\(issued\.accessToken\)/);
  assert.match(flow, /timingSafeEqual\(Buffer\.from\(state\)/);
});

test("a rejected or missing session defaults to Apollo provider recovery with SPMT bridge optional", () => {
  const restore = client.slice(client.indexOf("async function restoreShell"), client.indexOf("async function submitLogin"));
  const gate = client.slice(client.indexOf("function showAuth"), client.indexOf("function showSessionUnavailable"));
  assert.match(restore, /No active Apollo session was found in this browser/);
  assert.match(restore, /recover your existing account with its linked Twitch or Discord identity/);
  assert.match(gate, /authView\.dataset\.mode = "signin"/);
  assert.match(gate, /selectTab\("apollo"\)/);
  assert.doesNotMatch(gate, /selectTab\("spmt"\)/);
  assert.match(gate, /reportBrowserDiagnostic\("auth-gate-shown"/);
});


test("SPMT proxy promise rejections are caught by the HTTP handler", () => {
  const server = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
  assert.match(server, /return await proxy\(response,request,url,spmtOrigin,fetchImpl,false,true\);/);
  assert.match(server, /return await proxy\(response, request, url, spmtOrigin, fetchImpl\);/);
});
test("linked-provider recovery is username-bound, password-setting, and automatically signs into Apollo", () => {
  assert.match(page, /id="apollo-recovery-discord"/);
  assert.match(page, /id="apollo-recovery-twitch"/);
  assert.match(page, /Recover \/ Set Password/);
  assert.match(page, /id="apollo-recovery-password"[^>]*\bhidden\b/);
  assert.ok(page.indexOf('<form id="apollo-recovery-password"') > page.indexOf('</form>', page.indexOf('<form id="apollo-login-form"')), "recovery password entry must be a separate form, not nested");
  assert.match(page, /id="apollo-recovery-password-value" type="password"[^>]*minlength="12"/);
  assert.match(page, /id="apollo-recovery-password-confirm"/);
  assert.match(page, /id="apollo-recovery-submit"/);
  assert.doesNotMatch(page, /id="apollo-recovery-start" hidden/);
  assert.match(client, /startLinkedProviderRecovery\("discord"\)/);
  assert.match(client, /startLinkedProviderRecovery\("twitch"\)/);
  assert.match(client, /new URLSearchParams\(\{ provider, username \}\)/);
  assert.match(client, /sessionStorage\.setItem\("apollo-recovery-username"/);
  assert.match(client, /fetch\("\/v1\/auth\/linked-provider-recovery\/password"/);
  assert.match(client, /await hasSavedSessionCookie\(\)/);

  const start = service.slice(service.indexOf('url.pathname === "/v1/auth/linked-provider-recovery/start"'), service.indexOf('url.pathname === "/v1/auth/linked-provider-recovery/password"'));
  const callbackStart = service.indexOf('url.pathname === "/v1/onboarding/twitch/callback"');
  const callback = service.slice(callbackStart, service.indexOf("const pendingLink = decodeProviderLinkCookie", callbackStart));
  const password = service.slice(service.indexOf('url.pathname === "/v1/auth/linked-provider-recovery/password"'), service.indexOf('url.pathname === "/v1/auth/login"'));
  assert.match(start, /provider !== "discord" && provider !== "twitch"/);
  assert.match(start, /url\.searchParams\.get\("username"\)/);
  assert.match(start, /state, username/);
  assert.match(start, /onboarding\/twitch\/callback/);
  assert.match(callback, /timingSafeEqual\(Buffer\.from\(state\), Buffer\.from\(recovery\.state\)\)/);
  assert.match(callback, /accounts\.createLinkedProviderPasswordReset\(recovery\.username, provider, identity\.id, state\)/);
  assert.doesNotMatch(callback, /issueBrowserSession|resolveDonorWorkspace/);
  assert.match(password, /completeLinkedProviderPasswordReset\(ticket, username, password\)/);
  assert.match(password, /auth\.issueBrowserSession\(result\.tokens\.accessToken\)/);

  const server = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
  assert.match(server, /linked-provider-recovery\/password"\) return method === "POST"/);
});

test("missing local Apollo passwords immediately expose direct provider recovery", () => {
  const login = client.slice(client.indexOf("async function submitApolloLogin"), client.indexOf("async function submitApolloRegistration"));
  assert.match(login, /Password setup required — verify your linked account to continue/);
  assert.match(login, /recoveryStart\.hidden = false/);
  assert.match(login, /recoveryDiscord\.focus/);
  assert.match(page, /Verify with Discord/);
  assert.match(page, /Verify with Twitch/);
  assert.match(page, /data-tab="apollo" aria-selected="true"/);
  assert.match(page, /data-tab="spmt" aria-selected="false"/);
});
