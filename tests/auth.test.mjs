import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthDeniedError, AuthService, hashToken } from "../packages/auth-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";

function tokenFactory() {
  let sequence = 0;
  return (kind) => `${kind}_${++sequence}_${"x".repeat(32)}`;
}

function makeClock(start = "2026-08-22T02:30:00.000Z") {
  let current = Date.parse(start);
  return {
    now: () => new Date(current).toISOString(),
    advance: (seconds) => { current += seconds * 1000; },
  };
}

test("service credentials are hashed at rest and issue scoped short-lived access", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-"));
  const path = join(dir, "authority.db");
  const store = new SqliteAuthorityStore(path);
  const clock = makeClock();
  const auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory() });
  const credential = "service-bootstrap-secret-123456789";
  const created = auth.registerServiceIdentity({
    serviceId: "streamweaver",
    credential,
    scopes: ["workspace:read", "xp:write"],
    tenantMode: "allow-list",
    tenantIds: ["tenant-a"],
  });
  assert.equal(created.credentialHash, "[REDACTED]");
  const stored = store.getServiceIdentity("streamweaver");
  assert.ok(stored);
  assert.notEqual(stored.credentialHash, credential);
  assert.ok(!JSON.stringify(stored).includes(credential));
  const issued = auth.issueServiceAccess("streamweaver", credential, 120);
  const principal = auth.authorize(issued.accessToken, "xp:write", "tenant-a");
  assert.equal(principal.actorId, "streamweaver");
  assert.throws(() => auth.authorize(issued.accessToken, "workspace:write", "tenant-a"), AuthDeniedError);
  assert.throws(() => auth.authorize(issued.accessToken, "xp:write", "tenant-b"), AuthDeniedError);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("service credential rotation immediately invalidates previously issued access", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const auth = new AuthService({ store, tokenFactory: tokenFactory() });
  auth.registerServiceIdentity({ serviceId: "dsh", credential: "old-service-secret-1234567890", scopes: ["discord:control"], tenantMode: "any" });
  const oldAccess = auth.issueServiceAccess("dsh", "old-service-secret-1234567890").accessToken;
  auth.rotateServiceCredential("dsh", "new-service-secret-1234567890");
  assert.equal(auth.authenticateAccessToken(oldAccess), undefined);
  assert.throws(() => auth.issueServiceAccess("dsh", "old-service-secret-1234567890"), AuthDeniedError);
  assert.ok(auth.issueServiceAccess("dsh", "new-service-secret-1234567890").accessToken);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("supervised identity reconciliation updates stale scopes and tenant policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const auth = new AuthService({ store, tokenFactory: tokenFactory() });
  auth.registerServiceIdentity({ serviceId: "dsh", credential: "old-service-secret-1234567890", scopes: ["jobs:read"], tenantMode: "allow-list", tenantIds: ["tenant-old"] });
  const oldAccess = auth.issueServiceAccess("dsh", "old-service-secret-1234567890").accessToken;
  const reconciled = auth.reconcileServiceIdentity({ serviceId: "dsh", credential: "new-service-secret-1234567890", scopes: ["jobs:read", "jobs:work"], tenantMode: "any" });
  assert.deepEqual(reconciled.scopes, ["jobs:read", "jobs:work"]);
  assert.equal(reconciled.tenantMode, "any");
  assert.deepEqual(reconciled.tenantIds, []);
  assert.equal(auth.authenticateAccessToken(oldAccess), undefined);
  const nextAccess = auth.issueServiceAccess("dsh", "new-service-secret-1234567890").accessToken;
  assert.equal(auth.authorize(nextAccess, "jobs:work", "tenant-new").actorId, "dsh");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("human refresh tokens rotate once and replay revokes the token family", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const clock = makeClock();
  const auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory() });
  const first = auth.issueHumanSession({ userId: "user-1", scopes: ["workspace:read"], tenantIds: ["tenant-a"] });
  assert.ok(first.refreshToken);
  const second = auth.rotateHumanRefresh(first.refreshToken);
  assert.ok(second.refreshToken);
  assert.throws(() => auth.rotateHumanRefresh(first.refreshToken), /replay detected/);
  assert.throws(() => auth.rotateHumanRefresh(second.refreshToken), /revoked/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("parallel human refreshes reuse one restart-safe successor during a bounded overlap", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-overlap-"));
  const path = join(dir, "authority.db");
  const clock = makeClock();
  const rotationKey = Buffer.alloc(32, 7);
  let store = new SqliteAuthorityStore(path);
  let auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory(), refreshRotationKey: rotationKey });
  const first = auth.issueHumanSession({ userId: "user-1", scopes: ["workspace:read"], tenantIds: ["tenant-a"] });
  const rotations = Array.from({ length: 12 }, () => auth.rotateHumanRefresh(first.refreshToken));
  assert.equal(new Set(rotations.map((item) => item.refreshToken)).size, 1);
  assert.equal(new Set(rotations.map((item) => item.accessToken)).size, 12);
  const successor = rotations[0].refreshToken;
  assert.doesNotMatch(JSON.stringify(store.getRefreshTokenByTokenHash(hashToken(first.refreshToken))), new RegExp(successor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "only the successor hash may be stored");
  store.close();

  store = new SqliteAuthorityStore(path);
  auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory(), refreshRotationKey: rotationKey });
  assert.equal(auth.rotateHumanRefresh(first.refreshToken).refreshToken, successor, "overlap survives a process restart without storing plaintext tokens");
  clock.advance(61);
  assert.throws(() => auth.rotateHumanRefresh(first.refreshToken), /replay detected/);
  assert.throws(() => auth.rotateHumanRefresh(successor), /revoked/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("refresh overlap fails closed after a server-key change", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-key-change-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const clock = makeClock();
  const firstAuthority = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory(), refreshRotationKey: Buffer.alloc(32, 3) });
  const first = firstAuthority.issueHumanSession({ userId: "user-1", scopes: ["workspace:read"], tenantIds: ["tenant-a"] });
  const second = firstAuthority.rotateHumanRefresh(first.refreshToken);
  const changedAuthority = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory(), refreshRotationKey: Buffer.alloc(32, 4) });
  assert.throws(() => changedAuthority.rotateHumanRefresh(first.refreshToken), /replay detected/);
  assert.throws(() => firstAuthority.rotateHumanRefresh(second.refreshToken), /revoked/);
  assert.throws(() => new AuthService({ store, refreshRotationKey: Buffer.alloc(31) }), /at least 32 bytes/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an older refresh ancestor cannot revive after its successor rotates", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-ancestor-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const clock = makeClock();
  const auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory(), refreshRotationKey: Buffer.alloc(32, 9) });
  const first = auth.issueHumanSession({ userId: "user-1", scopes: ["workspace:read"], tenantIds: ["tenant-a"] });
  const second = auth.rotateHumanRefresh(first.refreshToken);
  auth.rotateHumanRefresh(second.refreshToken);
  assert.throws(() => auth.rotateHumanRefresh(first.refreshToken), /replay detected/);
  assert.throws(() => auth.rotateHumanRefresh(second.refreshToken), /revoked/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("access tokens expire and auth state survives sqlite reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-auth-"));
  const path = join(dir, "authority.db");
  const clock = makeClock();
  let store = new SqliteAuthorityStore(path);
  let auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory() });
  auth.registerServiceIdentity({ serviceId: "hearmeout", credential: "hearmeout-service-secret-123456", scopes: ["rooms:control"], tenantMode: "any" });
  const issued = auth.issueServiceAccess("hearmeout", "hearmeout-service-secret-123456", 60);
  store.close();
  store = new SqliteAuthorityStore(path);
  auth = new AuthService({ store, now: clock.now, tokenFactory: tokenFactory() });
  assert.equal(auth.authenticateAccessToken(issued.accessToken)?.actorId, "hearmeout");
  assert.ok(store.listJournal().some((entry) => entry.kind === "service-identity" && entry.recordId === "hearmeout"));
  clock.advance(61);
  assert.equal(auth.authenticateAccessToken(issued.accessToken), undefined);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
