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
  const block = service.slice(start, start + 4000);
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

test("a rejected or missing session always reveals the SPMT bridge recovery form", () => {
  const restore = client.slice(client.indexOf("async function restoreShell"), client.indexOf("async function submitLogin"));
  const gate = client.slice(client.indexOf("function showAuth"), client.indexOf("function showSessionUnavailable"));
  assert.match(restore, /Your existing SPMT session is not active in this browser/);
  assert.match(gate, /authView\.dataset\.mode = "signin"/);
  assert.match(gate, /selectTab\("spmt"\)/);
  assert.match(gate, /reportBrowserDiagnostic\("auth-gate-shown"/);
});


test("SPMT proxy promise rejections are caught by the HTTP handler", () => {
  const server = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
  assert.match(server, /return await proxy\(response,request,url,spmtOrigin,fetchImpl,false,true\);/);
  assert.match(server, /return await proxy\(response, request, url, spmtOrigin, fetchImpl\);/);
});
test("account recovery accepts either Discord or Twitch independently", () => {
  assert.match(page, /id="apollo-recovery-discord"/);
  assert.match(page, /id="apollo-recovery-twitch"/);
  assert.doesNotMatch(page, /id="apollo-recover-account"/);
  assert.doesNotMatch(page, /id="apollo-recovery-start" hidden/);
  assert.match(client, /recoveryDiscord\.addEventListener\("click", \(\) => window\.location\.assign/);
  assert.match(client, /recoveryTwitch\.addEventListener\("click", \(\) => window\.location\.assign/);
  assert.match(client, /linked-provider-recovery\/start\?provider=discord/);
  assert.match(client, /linked-provider-recovery\/start\?provider=twitch/);
  assert.doesNotMatch(client, /apollo-recovery-provider|apollo-recovery-verify/);

  const start = service.slice(service.indexOf('url.pathname === "/v1/auth/linked-provider-recovery/start"'));
  const callback = start.slice(0, start.indexOf('url.pathname === "/v1/auth/linked-provider-recovery/password"'));
  assert.match(callback, /provider !== "discord" && provider !== "twitch"/);
  assert.match(callback, /accounts\.resolveProviderIdentity\(provider, identity\.id\)/);
  assert.match(callback, /resolveDonorWorkspace\(/);
  assert.match(callback, /issueHumanSession\(\{ userId: workspace\.profile\.userId, scopes: USER_SCOPES, tenantIds: workspace\.tenantIds \}\)/);
  assert.doesNotMatch(callback, /both providers|required provider pair|identity_account_mismatch/);
});

test("missing local Apollo passwords immediately expose direct provider recovery", () => {
  const login = client.slice(client.indexOf("async function submitApolloLogin"), client.indexOf("async function submitApolloRegistration"));
  assert.match(login, /valid local password/);
  assert.match(login, /recoveryStart\.hidden = false/);
  assert.match(login, /recoveryDiscord\.focus/);
  assert.match(page, /Continue with Discord/);
  assert.match(page, /Continue with Twitch/);
});
