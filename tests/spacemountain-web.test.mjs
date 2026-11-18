import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../apps/spmt-service/src/index.ts", import.meta.url), "utf8");

test("SPMT bridge sign-in loads the Apollo shell instead of the saved-session screen", () => {
  const submit = client.slice(client.indexOf("async function submitLogin"), client.indexOf("async function authRequest"));
  assert.match(submit, /await loadShell\(\);\s*sessionRecovery\.authenticated\(\);\s*redirectToRequestedApp\(\);/);
  assert.doesNotMatch(submit, /showSavedSession\(\)/);
});

test("restoring a session goes straight to loadShell without the cookie-only shortcut", () => {
  const restore = client.slice(client.indexOf("async function restoreShell"), client.indexOf("async function submitLogin"));
  assert.doesNotMatch(restore, /showSavedSession\(\)/);
  assert.match(restore, /await loadShell\(\);/);
});

test("bridge-login bootstraps the owner workspace on first sign-in and reuses it afterwards", () => {
  const start = service.indexOf('url.pathname === "/v1/auth/session/bridge-login"');
  const block = service.slice(start, start + 4000);
  assert.match(block, /data\.getProfileByUsername\(donorUsername\.toLowerCase\(\)\)/);
  assert.match(block, /control\.registerTenant\(\{ tenantId, ownerUserId: userId/);
  assert.match(block, /data\.registerUser\(\{ userId, username: donorUsername\.toLowerCase\(\)/);
  assert.match(block, /issueHumanSession\(\{ userId: profile\.userId, scopes: USER_SCOPES, tenantIds \}\)/);
});

test("the retired /v1/auth/session/bridge path answers 404", () => {
  assert.match(service, /url\.pathname === "\/v1\/auth\/session\/bridge"\) return json\(response, 404/);
});
