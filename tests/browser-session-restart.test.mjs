import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";

const key = Buffer.alloc(32, 7);

function open(path) {
  const store = new SqliteAuthorityStore(path);
  return { store, auth: new AuthService({ store, refreshRotationKey: key }) };
}

test("signed browser session survives restart and DB reset", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-bsess-"));
  const path = join(dir, "authority.db");
  try {
    const first = open(path);
    const human = first.auth.issueHumanSession({ userId: "usr_owner", scopes: ["workspace:read"], tenantIds: ["tenant_owner"] });
    const browser = first.auth.issueBrowserSession(human.accessToken).accessToken;
    assert.ok(browser.startsWith("bsess_"));
    assert.equal(first.auth.isBrowserSession(browser), true);

    // Restart: a new AuthService over the same DB.
    const second = open(path);
    assert.equal(second.auth.authenticateAccessToken(browser)?.actorId, "usr_owner");
    assert.equal(second.auth.isBrowserSession(browser), true);

    // DB reset: fresh empty DB, same server key.
    rmSync(path, { force: true });
    const reset = open(path);
    const principal = reset.auth.authenticateAccessToken(browser);
    assert.equal(principal?.actorId, "usr_owner");
    assert.deepEqual(principal?.tenantIds, ["tenant_owner"]);
    assert.equal(reset.auth.isBrowserSession(browser), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered or wrong-key browser token is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-bsess-"));
  const path = join(dir, "authority.db");
  try {
    const a = open(path);
    const human = a.auth.issueHumanSession({ userId: "usr_owner", scopes: ["workspace:read"], tenantIds: ["tenant_owner"] });
    const browser = a.auth.issueBrowserSession(human.accessToken).accessToken;
    const [prefix, body, sig] = [browser.slice(0, 7), ...browser.slice(7).split(".")];
    const forged = Buffer.from(JSON.stringify({ a: "usr_admin", s: ["*"], m: "any", t: [], i: new Date().toISOString(), e: "9999-01-01T00:00:00.000Z", sid: "x" })).toString("base64url");
    assert.equal(a.auth.authenticateAccessToken(`${prefix}${forged}.${sig}`), undefined);

    rmSync(path, { force: true });
    const other = new AuthService({ store: new SqliteAuthorityStore(path), refreshRotationKey: Buffer.alloc(32, 9) });
    assert.equal(other.authenticateAccessToken(browser), undefined);
    assert.equal(body.length > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("logout revokes a signed browser token, even after a DB reset", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-bsess-"));
  const path = join(dir, "authority.db");
  try {
    const a = open(path);
    const human = a.auth.issueHumanSession({ userId: "usr_owner", scopes: ["workspace:read"], tenantIds: ["tenant_owner"] });
    const browser = a.auth.issueBrowserSession(human.accessToken).accessToken;
    a.auth.revokeBrowserSession(browser);
    assert.equal(a.auth.authenticateAccessToken(browser), undefined);

    rmSync(path, { force: true });
    const reset = open(path);
    reset.auth.revokeBrowserSession(browser);
    assert.equal(reset.auth.authenticateAccessToken(browser), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
