import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { hydrateSpmtFromTurso } from "../apps/spmt-service/dist/turso-hydrate.js";
import { syncSpmtToTurso } from "../apps/spmt-service/dist/turso-sync.js";

// Minimal in-memory stand-in for the Turso HTTP (Hrana) endpoint: it stores
// the statements the write-back sends and answers the hydrate's reads, so the
// test proves the full local -> Turso -> local round trip with no network.
function createFakeTurso() {
  const tables = new Map();
  const decode = (v) => !v || v.type === "null" ? null
    : v.type === "integer" ? Number(v.value)
    : v.type === "float" ? v.value
    : v.type === "text" ? v.value
    : Buffer.from(v.base64, "base64");
  const encode = (v) => v === null || v === undefined ? { type: "null" }
    : typeof v === "string" ? { type: "text", value: v }
    : typeof v === "bigint" ? { type: "integer", value: v.toString() }
    : typeof v === "number" ? (Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v })
    : { type: "blob", base64: Buffer.from(v).toString("base64") };
  const ok = (cols, rows, affected = 0) => ({ type: "ok", response: { type: "execute", result: { cols: cols.map((name) => ({ name })), rows, affected_row_count: affected, last_insert_rowid: null } } });
  const splitTopLevel = (text) => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      else if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts;
  };
  function execute(stmt) {
    const sql = stmt.sql.trim();
    const args = (stmt.args ?? []).map(decode);
    let m;
    if ((m = sql.match(/^CREATE TABLE IF NOT EXISTS "([^"]+)" \(([\s\S]+)\)$/))) {
      if (!tables.has(m[1])) {
        const columns = []; let pkCount = 1;
        for (const def of splitTopLevel(m[2])) {
          const column = def.trim().match(/^"([^"]+)"/);
          if (column) columns.push(column[1]);
          const pk = def.match(/PRIMARY KEY \(([^)]+)\)/i);
          if (pk) pkCount = pk[1].split(",").length;
        }
        tables.set(m[1], { columns, pkCount, rows: new Map() });
      }
      return ok([], []);
    }
    if ((m = sql.match(/^INSERT OR REPLACE INTO "([^"]+)" \(([^)]+)\) VALUES ([\s\S]+)$/))) {
      const table = tables.get(m[1]);
      if (!table) throw new Error(`no such table: ${m[1]}`);
      const cols = m[2].split(",").map((s) => s.trim().replaceAll('"', ""));
      const groups = (m[3].match(/\([^)]*\)/g) ?? []).length;
      for (let g = 0; g < groups; g++) {
        const row = new Map(cols.map((c, i) => [c, args[g * cols.length + i]]));
        table.rows.set(JSON.stringify(cols.slice(0, table.pkCount).map((c) => row.get(c))), row);
      }
      return ok([], [], groups);
    }
    if (/^SELECT 1 FROM sqlite_master/.test(sql)) return ok(["1"], tables.has(args[0]) ? [[encode(1)]] : []);
    if ((m = sql.match(/^PRAGMA table_info\("([^"]+)"\)$/))) {
      const table = tables.get(m[1]);
      return ok(["cid", "name", "type", "notnull", "dflt_value", "pk"], table ? table.columns.map((name, i) => [encode(i), encode(name), encode("TEXT"), encode(0), { type: "null" }, encode(i < table.pkCount ? 1 : 0)]) : []);
    }
    if ((m = sql.match(/^SELECT ([\s\S]+?) FROM "([^"]+)"(?: ORDER BY rowid LIMIT (\d+) OFFSET (\d+))?$/))) {
      const table = tables.get(m[2]);
      if (!table) throw new Error(`no such table: ${m[2]}`);
      const cols = m[1].split(",").map((s) => s.trim().replaceAll('"', ""));
      let rows = [...table.rows.values()];
      if (m[3] !== undefined) rows = rows.slice(Number(m[4]), Number(m[4]) + Number(m[3]));
      return ok(cols, rows.map((row) => cols.map((c) => encode(row.get(c) ?? null))));
    }
    throw new Error(`fake turso: unsupported SQL: ${sql.slice(0, 120)}`);
  }
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const results = body.requests.map((request) => request.type === "close" ? { type: "ok", response: { type: "close" } } : execute(request.stmt));
    return new Response(JSON.stringify({ baton: null, base_url: null, results }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, tables };
}

const NOW = "2026-11-25T12:00:00.000Z";

test("spmt identity state survives a local wipe through the Turso write-back and hydrate", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-roundtrip-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  // The production spmt_users table was created by the seed import with the
  // recovered export's shape (keyed by user_id, not id). Pre-create that
  // legacy shape so the test proves the write-back adapts to it.
  fake.tables.set("spmt_users", { columns: ["user_id", "body"], pkCount: 1, rows: new Map() });
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake.turso.local";
  process.env.TURSO_AUTH_TOKEN = "test-token";
  let authority, platform, authority2, platform2;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    authority.putUser({ id: "user_probe", createdAt: NOW });
    authority.putTenant({ id: "tenant_probe", ownerUserId: "user_probe", status: "active", name: "Probe tenant", createdAt: NOW, updatedAt: NOW });
    authority.putWorkspace({ tenantId: "tenant_probe", revision: 7, appearance: { theme: "dark" }, dockSlots: ["app-a", null, "app-c"], ttsSubscriptionIds: ["sub-1"], appThemes: { chat: "midnight" }, updatedAt: NOW });
    authority.putProviderLink({ provider: "discord", providerUserId: "discord-1", userId: "user_probe", linkedAt: NOW });
    platform.putUserProfile({ userId: "user_probe", username: "probeuser", displayName: "Probe User", tenantIds: ["tenant_probe"], createdAt: NOW, updatedAt: NOW });
    platform.putUserCredential("user_probe", "salt123", "hash456");
    authority.appendXp({ id: "xp_probe", tenantId: "tenant_probe", userId: "user_probe", delta: 42, sourceAppId: "spmt", reason: "roundtrip test", idempotencyKey: "xp_probe_key", createdAt: NOW });
    const auth = new AuthService({ store: authority });
    const issued = auth.issueHumanSession({ userId: "user_probe", scopes: ["profile:read"], tenantIds: ["tenant_probe"] });
    assert.ok(issued.accessToken && issued.refreshToken);

    const syncReport = await syncSpmtToTurso({ databasePath, fetchImpl: fake.fetchImpl });
    assert.equal(syncReport.enabled, true);
    for (const [table, stats] of Object.entries(syncReport.tables)) assert.equal(stats.error, undefined, `${table}: ${stats.error}`);
    assert.equal(syncReport.tables.spmt_users.written, 1);
    assert.equal(syncReport.tables.spmt_user_credentials.written, 1);
    assert.equal(syncReport.tables.spmt_access_sessions.written, 1);
    assert.equal(syncReport.tables.spmt_refresh_tokens.written, 1);
    assert.equal(syncReport.tables.spmt_workspace_profiles.written, 1);

    // Simulate the Hostless redeploy: the local database file is wiped.
    authority.close(); platform.close(); authority = platform = undefined;
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });

    authority2 = new SqliteAuthorityStore(databasePath);
    platform2 = new SqlitePlatformDataStore(databasePath);
    assert.equal(authority2.getUser("user_probe"), undefined, "fresh store starts empty");

    const hydrateReport = await hydrateSpmtFromTurso({ authority: authority2, platform: platform2, fetchImpl: fake.fetchImpl });
    assert.equal(hydrateReport.enabled, true);
    for (const [table, stats] of Object.entries(hydrateReport.tables)) assert.equal(stats.error, undefined, `${table}: ${stats.error}`);

    assert.deepEqual(authority2.getUser("user_probe"), { id: "user_probe", createdAt: NOW });
    assert.equal(authority2.getTenant("tenant_probe")?.ownerUserId, "user_probe");
    const workspace = authority2.getWorkspace("tenant_probe");
    assert.equal(workspace?.revision, 7);
    assert.deepEqual(workspace?.dockSlots, ["app-a", null, "app-c"], "workspace restores losslessly, dock slots included");
    assert.equal(workspace?.appearance.theme, "dark");
    assert.equal(authority2.getProviderLink("discord", "discord-1")?.userId, "user_probe");
    assert.equal(platform2.getUserProfile("user_probe")?.username, "probeuser");
    assert.deepEqual(platform2.getUserCredential("user_probe"), { salt: "salt123", hash: "hash456" });
    assert.equal(authority2.listXp("tenant_probe", "user_probe").length, 1);

    const auth2 = new AuthService({ store: authority2 });
    const principal = auth2.authenticateAccessToken(issued.accessToken);
    assert.equal(principal?.actorId, "user_probe", "pre-wipe access token still authenticates after the restart");
    const rotated = auth2.rotateHumanRefresh(issued.refreshToken);
    assert.ok(rotated.accessToken, "pre-wipe refresh token still rotates after the restart");
  } finally {
    authority?.close(); platform?.close(); authority2?.close(); platform2?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test("hydrate preserves XP eventType and metadata so the sync round trip stays lossless", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-xp-meta-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  // A mirrored XP row whose body carries the optional facets (seed-era
  // events keep their Discord server/channel context only in metadata).
  const body = JSON.stringify({
    id: "xp_meta", tenantId: "tenant_meta", userId: "user_meta", delta: 10,
    sourceAppId: "discord-stream-hub", reason: "dsh-twitch-message",
    idempotencyKey: "xp_meta_key", createdAt: NOW,
    eventType: "dsh-twitch-message",
    metadata: { schemaVersion: 1, serverId: "server-1", channel: "general" },
  });
  fake.tables.set("spmt_xp_ledger", {
    columns: ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"],
    pkCount: 1,
    rows: new Map([[JSON.stringify(["xp_meta"]), new Map([
      ["id", "xp_meta"], ["tenant_id", "tenant_meta"], ["user_id", "user_meta"],
      ["idempotency_key", "xp_meta_key"], ["delta", 10], ["body", body],
    ])]]),
  });
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake-turso.invalid";
  process.env.TURSO_AUTH_TOKEN = "fake-token";
  let authority, platform;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    const hydrateReport = await hydrateSpmtFromTurso({ authority, platform, fetchImpl: fake.fetchImpl });
    assert.equal(hydrateReport.tables.spmt_xp_ledger.inserted, 1);
    const events = authority.listXp("tenant_meta", "user_meta");
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "dsh-twitch-message");
    assert.deepEqual(events[0].metadata, { schemaVersion: 1, serverId: "server-1", channel: "general" });

    // The write-back must mirror the facets back instead of stripping them.
    const syncReport = await syncSpmtToTurso({ databasePath, fetchImpl: fake.fetchImpl });
    assert.equal(syncReport.tables.spmt_xp_ledger.error, undefined);
    const mirrored = JSON.parse(fake.tables.get("spmt_xp_ledger").rows.get(JSON.stringify(["xp_meta"])).get("body"));
    assert.equal(mirrored.eventType, "dsh-twitch-message");
    assert.deepEqual(mirrored.metadata, { schemaVersion: 1, serverId: "server-1", channel: "general" });
  } finally {
    authority?.close(); platform?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test("turso sync pages large local tables instead of materializing them", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-paging-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake-turso.invalid";
  process.env.TURSO_AUTH_TOKEN = "fake-token";
  let authority, platform;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    authority.putUser({ id: "user_bulk", createdAt: NOW });
    // More than two 2000-row pages: the promoted seed-era XP ledger is
    // ~180k rows, and the sync must stream it in bounded pages.
    const TOTAL = 4500;
    for (let i = 0; i < TOTAL; i++) {
      authority.appendXp({ id: `xp_bulk_${i}`, tenantId: "tenant_bulk", userId: "user_bulk", delta: 1, sourceAppId: "spmt", reason: "bulk", idempotencyKey: `xp_bulk_key_${i}`, createdAt: NOW });
    }
    const syncReport = await syncSpmtToTurso({ databasePath, fetchImpl: fake.fetchImpl });
    assert.equal(syncReport.tables.spmt_xp_ledger.error, undefined);
    assert.equal(syncReport.tables.spmt_xp_ledger.local, TOTAL);
    assert.equal(syncReport.tables.spmt_xp_ledger.written, TOTAL);
    assert.equal(fake.tables.get("spmt_xp_ledger").rows.size, TOTAL);
  } finally {
    authority?.close(); platform?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test("turso hydrate pages large remote tables instead of fetching them whole", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-hydrate-paging-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  // More than two 2000-row pages: the promoted seed-era XP ledger is ~182k
  // rows in one remote table, and the boot hydrate used to fetch it in a
  // single ~110 MB response before the service ever listened.
  const TOTAL = 4500;
  const rows = new Map();
  for (let i = 0; i < TOTAL; i++) {
    const body = JSON.stringify({
      id: `xp_page_${i}`, tenantId: "tenant_bulk", userId: "user_bulk", delta: 1,
      sourceAppId: "spmt", reason: "bulk", idempotencyKey: `xp_page_key_${i}`, createdAt: NOW,
    });
    rows.set(JSON.stringify([`xp_page_${i}`]), new Map([
      ["id", `xp_page_${i}`], ["tenant_id", "tenant_bulk"], ["user_id", "user_bulk"],
      ["idempotency_key", `xp_page_key_${i}`], ["delta", 1], ["body", body],
    ]));
  }
  fake.tables.set("spmt_xp_ledger", {
    columns: ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"],
    pkCount: 1, rows,
  });
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake-turso.invalid";
  process.env.TURSO_AUTH_TOKEN = "fake-token";
  let authority, platform;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    const hydrateReport = await hydrateSpmtFromTurso({ authority, platform, fetchImpl: fake.fetchImpl });
    assert.equal(hydrateReport.tables.spmt_xp_ledger.remote, TOTAL);
    assert.equal(hydrateReport.tables.spmt_xp_ledger.inserted, TOTAL);
    const events = authority.listXp("tenant_bulk", "user_bulk");
    assert.equal(events.length, TOTAL);
    assert.equal(events[TOTAL - 1].id, `xp_page_${TOTAL - 1}`);
  } finally {
    authority?.close(); platform?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test("turso hydrate retries a failed page fetch instead of aborting the boot", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-hydrate-retry-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  // Two boots of the promoted ledger died with "[spmt] turso hydrate failed:
  // fetch failed" after fetching most of the table: one stale keep-alive
  // connection aborting a single page must not abort the whole hydrate.
  const TOTAL = 4500;
  const rows = new Map();
  for (let i = 0; i < TOTAL; i++) {
    const body = JSON.stringify({
      id: `xp_retry_${i}`, tenantId: "tenant_bulk", userId: "user_bulk", delta: 1,
      sourceAppId: "spmt", reason: "bulk", idempotencyKey: `xp_retry_key_${i}`, createdAt: NOW,
    });
    rows.set(JSON.stringify([`xp_retry_${i}`]), new Map([
      ["id", `xp_retry_${i}`], ["tenant_id", "tenant_bulk"], ["user_id", "user_bulk"],
      ["idempotency_key", `xp_retry_key_${i}`], ["delta", 1], ["body", body],
    ]));
  }
  fake.tables.set("spmt_xp_ledger", {
    columns: ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"],
    pkCount: 1, rows,
  });
  let failedPageAttempts = 0;
  const flakyFetch = async (url, init) => {
    const sql = JSON.parse(init.body).requests?.[0]?.stmt?.sql ?? "";
    if (sql.includes("OFFSET 2000") && failedPageAttempts < 2) {
      failedPageAttempts++;
      throw new TypeError("fetch failed");
    }
    return fake.fetchImpl(url, init);
  };
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake-turso.invalid";
  process.env.TURSO_AUTH_TOKEN = "fake-token";
  let authority, platform;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    const hydrateReport = await hydrateSpmtFromTurso({ authority, platform, fetchImpl: flakyFetch });
    assert.equal(failedPageAttempts, 2, "the middle page's fetch fails twice before succeeding");
    assert.equal(hydrateReport.tables.spmt_xp_ledger.remote, TOTAL);
    assert.equal(hydrateReport.tables.spmt_xp_ledger.inserted, TOTAL);
    assert.equal(authority.listXp("tenant_bulk", "user_bulk").length, TOTAL);
  } finally {
    authority?.close(); platform?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test("turso hydrate logs page progress so a slow boot is visible in the runtime logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-turso-hydrate-progress-"));
  const databasePath = join(root, "apollo.sqlite");
  const fake = createFakeTurso();
  // Six 2000-row pages: progress must be logged mid-scan (page 5), not only
  // when the whole hydrate finishes — a boot that paged ~92 ledger pages
  // used to log nothing at all, so a hung boot looked identical to a dead
  // container in the Hostless runtime logs.
  const TOTAL = 11000;
  const rows = new Map();
  for (let i = 0; i < TOTAL; i++) {
    const body = JSON.stringify({
      id: `xp_progress_${i}`, tenantId: "tenant_bulk", userId: "user_bulk", delta: 1,
      sourceAppId: "spmt", reason: "bulk", idempotencyKey: `xp_progress_key_${i}`, createdAt: NOW,
    });
    rows.set(JSON.stringify([`xp_progress_${i}`]), new Map([
      ["id", `xp_progress_${i}`], ["tenant_id", "tenant_bulk"], ["user_id", "user_bulk"],
      ["idempotency_key", `xp_progress_key_${i}`], ["delta", 1], ["body", body],
    ]));
  }
  fake.tables.set("spmt_xp_ledger", {
    columns: ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"],
    pkCount: 1, rows,
  });
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = "libsql://fake-turso.invalid";
  process.env.TURSO_AUTH_TOKEN = "fake-token";
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => { logged.push(args.join(" ")); };
  let authority, platform;
  try {
    authority = new SqliteAuthorityStore(databasePath);
    platform = new SqlitePlatformDataStore(databasePath);
    const hydrateReport = await hydrateSpmtFromTurso({ authority, platform, fetchImpl: fake.fetchImpl });
    assert.equal(hydrateReport.tables.spmt_xp_ledger.remote, TOTAL);
    assert.equal(hydrateReport.tables.spmt_xp_ledger.inserted, TOTAL);
  } finally {
    console.log = originalLog;
    authority?.close(); platform?.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
  const progress = logged.filter((line) => line.includes("turso hydrate progress"));
  assert.equal(progress.length, 1);
  assert.match(progress[0], /table=spmt_xp_ledger pages=5 rows=10000/);
  const complete = logged.filter((line) => line.includes("turso hydrate scan complete"));
  assert.equal(complete.length, 1);
  assert.match(complete[0], /table=spmt_xp_ledger pages=6 rows=11000/);
});

test("turso sync and hydrate stay disabled without credentials", async () => {
  const previousUrl = process.env.TURSO_DATABASE_URL, previousToken = process.env.TURSO_AUTH_TOKEN;
  const previousShared = process.env.SHARED_TURSO_DATABASE_URL, previousNode = process.env.NODE1_TURSO_AUTH_TOKEN;
  delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.SHARED_TURSO_DATABASE_URL; delete process.env.NODE1_TURSO_AUTH_TOKEN;
  try {
    const syncReport = await syncSpmtToTurso({ databasePath: join(tmpdir(), "never-opened.sqlite") });
    assert.equal(syncReport.enabled, false);
    const hydrateReport = await hydrateSpmtFromTurso({ authority: {}, platform: {} });
    assert.equal(hydrateReport.enabled, false);
  } finally {
    if (previousUrl !== undefined) process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken !== undefined) process.env.TURSO_AUTH_TOKEN = previousToken;
    if (previousShared !== undefined) process.env.SHARED_TURSO_DATABASE_URL = previousShared;
    if (previousNode !== undefined) process.env.NODE1_TURSO_AUTH_TOKEN = previousNode;
  }
});
