#!/usr/bin/env node
/**
 * promote-seed-xp-workspaces.mjs — one-shot promotion of the seed-era
 * (Fly-export) XP ledger, workspace profiles, and user rows into the
 * mirror shapes the SPMT persistence realignment reads and writes
 * (apps/spmt-service/src/turso-hydrate.ts / turso-sync.ts).
 *
 * Why this exists (measured by the read-only recon, PR #643/#645):
 * - The seed import created spmt_xp_ledger / spmt_workspace_profiles /
 *   spmt_users with the recovered export's column shapes and NO primary
 *   keys. Hydrate's shape gates reject them (XP: no tenant_id/body;
 *   workspaces: no tenant_id/body), so 182,648 XP events and 32 workspace
 *   profiles are invisible to the app.
 * - Worse, turso-sync's INSERT OR REPLACE has no conflict target on a
 *   PK-less table, so every 60s sync APPENDS a fresh copy of every local
 *   row: spmt_users grew 653 -> 32,693 rows in ~50 minutes (654 distinct
 *   ids) and spmt_workspace_profiles accumulated revision-only junk rows.
 *
 * Mechanism (replace, never mutate in place):
 * 1. Each legacy table is renamed aside to <table>_legacy_seed, preserved
 *    byte-for-byte as the rollback source and the permanent record of the
 *    seed export (including the wide user columns nothing else reads).
 * 2. A fresh table is created with turso-sync's exact mirror DDL
 *    (primary keys included, so INSERT OR REPLACE dedupes again).
 * 3. Rows are inserted transformed:
 *    - Tenant assignment: the system's only tenant convention is the
 *      personal tenant `tenant_${userId}` minted at registration
 *      (apps/spmt-service/src/index.ts). Every legacy XP event and
 *      workspace is keyed by user, so each row is assigned to its user's
 *      personal tenant. Discord serverIds from XP metadata are NOT SPMT
 *      tenants; they are preserved inside each event's metadata instead.
 *    - XP bodies are synthesized as full XpEventV1 JSON with the original
 *      id and idempotency_key preserved verbatim (balances are sums over
 *      events; re-keying would double-count).
 *    - Workspace bodies keep the full legacy profile, gain body.tenantId,
 *      and rename ttsSubscriptions -> ttsSubscriptionIds and
 *      appThemeMappings -> appThemes so hydrate takes its lossless path.
 *    - User bodies are minimal {id, createdAt}; turso-sync replaces them
 *      with the true local bodies on its next cycle.
 * 4. Live rows always win: the new tables start empty, promotion inserts
 *    with plain INSERT (a primary-key collision fails loudly instead of
 *    overwriting), and the only post-realignment local state (users,
 *    one workspace) lives in Node 1's local store and re-mirrors into the
 *    new tables within a minute, disjoint from the seed tenant keys.
 *    Session and refresh-token tables are never touched.
 *
 * Modes (env PROMOTE_MODE):
 * - "dry-run" (default): read-only preflight, baselines, and transform
 *   validation over a sample. No writes.
 * - "apply": rename, create, populate, verify. Aborts before any write
 *   if a preflight invariant fails (legacy *_seed tables already exist,
 *   unexpected legacy shape, or post-realignment XP rows present in the
 *   legacy ledger).
 * - "rollback": drop the promoted tables and rename *_legacy_seed back.
 *
 * Outputs: report JSON on stdout (between markers) and in
 * seed-promotion-report.json, a bounded digest in seed-promotion-digest.md
 * and the GitHub job summary. The digest carries aggregates only — no
 * emails, usernames, or user bodies.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";

export function personalTenantId(userId) {
  return `tenant_${userId}`;
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return undefined;
}

/** Legacy XP row -> mirror row for spmt_xp_ledger. Ids and idempotency keys are preserved verbatim. */
export function transformXpRow(row) {
  const id = String(row.id ?? "");
  const userId = String(row.user_id ?? "");
  const tenantId = personalTenantId(userId);
  const delta = Number(row.delta ?? 0);
  const sourceAppId = String(row.source_app ?? "spmt");
  const reason = String(row.event_type ?? "imported");
  const idempotencyKey = String(row.idempotency_key ?? id);
  const createdAt = String(row.created_at ?? "1970-01-01T00:00:00.000Z");
  const body = { id, tenantId, userId, delta, sourceAppId, reason, idempotencyKey, createdAt };
  if (row.event_type) body.eventType = String(row.event_type);
  const metadata = parseJsonObject(row.metadata_json);
  if (metadata) body.metadata = metadata;
  return { id, tenantId, userId, idempotencyKey, delta, body: JSON.stringify(body), hasMetadata: Boolean(metadata) };
}

/** Legacy workspace row (user-keyed, JSON in `profile`) -> mirror row for spmt_workspace_profiles. */
export function transformWorkspaceRow(row) {
  const userId = String(row.user_id ?? "");
  const tenantId = personalTenantId(userId);
  const profile = parseJsonObject(row.profile) ?? {};
  const revision = Number(row.revision ?? profile.revision ?? 1) || 1;
  const dockSlotsRaw = Array.isArray(profile.dockSlots) ? profile.dockSlots : [];
  const dockSlots = [dockSlotsRaw[0] ?? null, dockSlotsRaw[1] ?? null, dockSlotsRaw[2] ?? null];
  const body = {
    ...profile,
    tenantId,
    revision,
    appearance: profile.appearance && typeof profile.appearance === "object" && !Array.isArray(profile.appearance) ? profile.appearance : { theme: "system" },
    dockSlots,
    ttsSubscriptionIds: Array.isArray(profile.ttsSubscriptionIds) ? profile.ttsSubscriptionIds : Array.isArray(profile.ttsSubscriptions) ? profile.ttsSubscriptions : [],
    appThemes: profile.appThemes && typeof profile.appThemes === "object" && !Array.isArray(profile.appThemes) ? profile.appThemes : profile.appThemeMappings && typeof profile.appThemeMappings === "object" && !Array.isArray(profile.appThemeMappings) ? profile.appThemeMappings : {},
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : String(row.updated_at ?? "1970-01-01T00:00:00.000Z"),
  };
  delete body.ttsSubscriptions;
  delete body.appThemeMappings;
  return { tenantId, revision, body: JSON.stringify(body), dockSlotsNormalized: dockSlotsRaw.length !== 3 };
}

const LEGACY_SUFFIX = "_legacy_seed";
const TABLES = ["spmt_users", "spmt_workspace_profiles", "spmt_xp_ledger"];
// Exact mirror DDL from apps/spmt-service/src/turso-sync.ts (MIRROR_TABLES).
const MIRROR_DDL = {
  spmt_users: 'CREATE TABLE "spmt_users" ("id" TEXT PRIMARY KEY, "body" TEXT NOT NULL)',
  spmt_workspace_profiles: 'CREATE TABLE "spmt_workspace_profiles" ("tenant_id" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL, "body" TEXT NOT NULL)',
  spmt_xp_ledger: 'CREATE TABLE "spmt_xp_ledger" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "idempotency_key" TEXT NOT NULL, "delta" INTEGER NOT NULL, "body" TEXT NOT NULL)',
};
const ROWS_PER_STATEMENT = 100;
const STATEMENTS_PER_PIPELINE = 20;
const PAGE_SIZE = 2000;

const executedStatements = [];
function track(sql) {
  executedStatements.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
}

async function main() {
  const mode = (process.env.PROMOTE_MODE ?? "dry-run").trim().toLowerCase();
  if (!["dry-run", "apply", "rollback"].includes(mode)) throw new Error(`PROMOTE_MODE must be dry-run, apply, or rollback (got "${mode}")`);
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not set");
  const db = new TursoHttpAdapter({ url, authToken: token });
  const report = { mode, generatedAt: new Date().toISOString(), checks: [], notes: [] };
  const check = (name, expected, actual) => {
    const pass = String(expected) === String(actual);
    report.checks.push({ name, expected, actual, pass });
    if (!pass) report.failed = true;
    return pass;
  };
  const exec = async (sql, args = []) => { track(sql); return db.execute(sql, args, true); };
  const query = async (sql, args = []) => (await exec(sql, args)).rows;
  const one = async (sql, args = []) => (await query(sql, args))[0];
  const tableExists = async (name) => (await query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [name])).length > 0;
  const columnsOf = async (name) => (await query(`PRAGMA table_info("${name}")`)).map((row) => String(row[1]));

  async function insertBatches(table, columns, rows) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT * STATEMENTS_PER_PIPELINE) {
      const statements = [];
      for (let j = i; j < Math.min(i + ROWS_PER_STATEMENT * STATEMENTS_PER_PIPELINE, rows.length); j += ROWS_PER_STATEMENT) {
        const chunk = rows.slice(j, j + ROWS_PER_STATEMENT);
        const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
        statements.push({ sql: `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders}`, args: chunk.flat() });
      }
      if (statements.length) {
        for (const statement of statements) track(statement.sql);
        await db.pipeline(statements);
        inserted += Math.min(ROWS_PER_STATEMENT * STATEMENTS_PER_PIPELINE, rows.length - i);
      }
    }
    return inserted;
  }

  if (mode === "rollback") {
    for (const table of TABLES) {
      const legacy = `${table}${LEGACY_SUFFIX}`;
      if (!(await tableExists(legacy))) throw new Error(`rollback: ${legacy} does not exist; nothing to roll back`);
    }
    report.before = {};
    for (const table of TABLES) report.before[table] = Number((await one(`SELECT COUNT(*) FROM "${table}"`))?.[0] ?? 0);
    for (const table of TABLES) await exec(`DROP TABLE IF EXISTS "${table}"`);
    for (const table of TABLES) await exec(`ALTER TABLE "${table}${LEGACY_SUFFIX}" RENAME TO "${table}"`);
    report.after = {};
    for (const table of TABLES) report.after[table] = Number((await one(`SELECT COUNT(*) FROM "${table}"`))?.[0] ?? 0);
    report.notes.push("Rollback complete: promoted tables dropped, legacy seed tables restored under their original names.");
    return finish(report);
  }

  // ---- Preflight (read-only in every mode; apply aborts on any failure) ----
  for (const table of TABLES) {
    if (!(await tableExists(table))) throw new Error(`preflight: ${table} is missing`);
    if (await tableExists(`${table}${LEGACY_SUFFIX}`)) throw new Error(`preflight: ${table}${LEGACY_SUFFIX} already exists — promotion already ran (or a rollback is pending); refusing to proceed`);
  }
  const xpCols = await columnsOf("spmt_xp_ledger");
  const wsCols = await columnsOf("spmt_workspace_profiles");
  const userCols = await columnsOf("spmt_users");
  if (xpCols.includes("tenant_id") || xpCols.includes("body") || !xpCols.includes("metadata_json")) throw new Error(`preflight: spmt_xp_ledger is not in the expected legacy shape (${xpCols.join(", ")})`);
  if (!wsCols.includes("profile") || !wsCols.includes("user_id") || wsCols.includes("tenant_id")) throw new Error(`preflight: spmt_workspace_profiles is not in the expected legacy shape (${wsCols.join(", ")})`);
  if (!userCols.includes("username") || userCols.includes("body")) throw new Error(`preflight: spmt_users is not in the expected legacy shape (${userCols.join(", ")})`);

  const sessionsBefore = Number((await one("SELECT COUNT(*) FROM spmt_access_sessions"))[0]);
  const refreshBefore = Number((await one("SELECT COUNT(*) FROM spmt_refresh_tokens"))[0]);

  const xpBase = await one("SELECT COUNT(*) AS rows_total, COALESCE(SUM(delta), 0) AS total_delta, COUNT(DISTINCT id) AS distinct_ids, COUNT(DISTINCT idempotency_key) AS distinct_idem, COUNT(DISTINCT user_id) AS distinct_users, SUM(CASE WHEN created_at IS NULL THEN 1 ELSE 0 END) AS live_shape_rows, SUM(CASE WHEN json_extract(metadata_json, '$.serverId') IS NOT NULL THEN 1 ELSE 0 END) AS with_server_id FROM spmt_xp_ledger");
  const baseline = {
    xp: { rows: Number(xpBase[0]), totalDelta: Number(xpBase[1]), distinctIds: Number(xpBase[2]), distinctIdemKeys: Number(xpBase[3]), distinctUsers: Number(xpBase[4]), liveShapeRows: Number(xpBase[5] ?? 0), withServerId: Number(xpBase[6] ?? 0) },
    xpBySourceApp: (await query("SELECT COALESCE(source_app, '(null)') AS app, COUNT(*) AS n, COALESCE(SUM(delta), 0) AS total FROM spmt_xp_ledger GROUP BY app ORDER BY app")).map((r) => ({ app: String(r[0]), rows: Number(r[1]), totalDelta: Number(r[2]) })),
    workspaces: {},
    users: {},
    sessions: sessionsBefore,
    refreshTokens: refreshBefore,
  };
  const wsBase = await one("SELECT SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS seed_rows, COUNT(DISTINCT user_id) AS seed_users, SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS junk_rows, COUNT(*) AS rows_total FROM spmt_workspace_profiles");
  baseline.workspaces = { seedRows: Number(wsBase[0] ?? 0), seedUsers: Number(wsBase[1] ?? 0), junkRows: Number(wsBase[2] ?? 0), rowsTotal: Number(wsBase[3] ?? 0) };
  const userBase = await one("SELECT COUNT(*) AS rows_total, COUNT(DISTINCT id) AS distinct_ids, SUM(CASE WHEN username IS NOT NULL THEN 1 ELSE 0 END) AS full_rows FROM spmt_users");
  baseline.users = { rowsTotal: Number(userBase[0]), distinctIds: Number(userBase[1]), fullRows: Number(userBase[2] ?? 0) };
  report.baseline = baseline;

  if (baseline.xp.liveShapeRows > 0) throw new Error(`preflight: ${baseline.xp.liveShapeRows} XP rows already have the post-realignment shape (created_at IS NULL); promotion design does not cover them — aborting before any write`);
  if (baseline.xp.distinctIds !== baseline.xp.rows || baseline.xp.distinctIdemKeys !== baseline.xp.rows) throw new Error("preflight: legacy XP ids/idempotency keys are not globally distinct; plain-INSERT promotion would collide — aborting");

  // ---- Transform validation over a sample (still read-only) ----
  const sampleRows = await query("SELECT id, user_id, source_app, event_type, idempotency_key, delta, metadata_json, created_at FROM spmt_xp_ledger ORDER BY rowid LIMIT 1000");
  let sampleMetadata = 0;
  for (const row of sampleRows) {
    const t = transformXpRow({ id: row[0], user_id: row[1], source_app: row[2], event_type: row[3], idempotency_key: row[4], delta: row[5], metadata_json: row[6], created_at: row[7] });
    const parsed = JSON.parse(t.body);
    if (parsed.id !== t.id || parsed.tenantId !== `tenant_${t.userId}` || parsed.idempotencyKey !== t.idempotencyKey || parsed.delta !== t.delta) throw new Error(`transform validation failed for XP row ${t.id}`);
    if (t.hasMetadata) sampleMetadata++;
  }
  const wsSampleRows = await query("SELECT user_id, revision, profile, updated_at FROM spmt_workspace_profiles WHERE user_id IS NOT NULL ORDER BY user_id");
  let wsNormalized = 0;
  for (const row of wsSampleRows) {
    const t = transformWorkspaceRow({ user_id: row[0], revision: row[1], profile: row[2], updated_at: row[3] });
    const parsed = JSON.parse(t.body);
    if (parsed.tenantId !== t.tenantId || !Array.isArray(parsed.dockSlots) || parsed.dockSlots.length !== 3 || !parsed.appearance || typeof parsed.appearance !== "object") throw new Error(`transform validation failed for workspace of user ${String(row[0])}`);
    if (t.dockSlotsNormalized) wsNormalized++;
  }
  report.transformValidation = { xpSampleRows: sampleRows.length, xpSampleWithMetadata: sampleMetadata, workspaceRows: wsSampleRows.length, workspaceDockSlotsNormalized: wsNormalized };
  if (wsSampleRows.length !== baseline.workspaces.seedRows) throw new Error("preflight: workspace seed row count changed between baseline and validation");

  if (mode === "dry-run") {
    report.notes.push("Dry run: no writes performed. Projected promotion: " +
      `${baseline.xp.rows} XP events (SUM(delta) ${baseline.xp.totalDelta}) into personal tenants of ${baseline.xp.distinctUsers} users; ` +
      `${baseline.workspaces.seedRows} workspaces; ${baseline.users.distinctIds} user rows (from ${baseline.users.rowsTotal} legacy rows incl. mirror-append duplicates).`);
    return finish(report);
  }

  // ---- Apply: rename aside, create mirror tables, populate ----
  for (const table of TABLES) await exec(`ALTER TABLE "${table}" RENAME TO "${table}${LEGACY_SUFFIX}"`);
  for (const table of TABLES) await exec(MIRROR_DDL[table]);

  // Users: one row per distinct legacy id; the mirror replaces these
  // placeholder bodies with the true local bodies on its next cycle.
  const userRows = await query(`SELECT id, MIN(created_at) FROM "spmt_users${LEGACY_SUFFIX}" GROUP BY id ORDER BY id`);
  const nowIso = new Date().toISOString();
  const userInserted = await insertBatches("spmt_users", ["id", "body"],
    userRows.map((row) => [String(row[0]), JSON.stringify({ id: String(row[0]), createdAt: row[1] ? String(row[1]) : nowIso })]));
  report.inserted = { users: userInserted };

  // Workspaces: seed rows only (user_id IS NOT NULL); revision-only mirror
  // junk rows stay behind in the legacy table and the live workspace
  // re-mirrors from Node 1's local store.
  const wsRows = await query(`SELECT user_id, revision, profile, updated_at FROM "spmt_workspace_profiles${LEGACY_SUFFIX}" WHERE user_id IS NOT NULL ORDER BY user_id`);
  const wsInserted = await insertBatches("spmt_workspace_profiles", ["tenant_id", "revision", "body"],
    wsRows.map((row) => { const t = transformWorkspaceRow({ user_id: row[0], revision: row[1], profile: row[2], updated_at: row[3] }); return [t.tenantId, t.revision, t.body]; }));
  report.inserted.workspaces = wsInserted;

  // XP: paged reads over the renamed legacy table, JS transform, batched
  // plain INSERTs (a PK collision fails loudly rather than overwriting).
  let xpInserted = 0, xpInsertedDelta = 0, xpWithMetadata = 0, offset = 0;
  for (;;) {
    const page = await query(`SELECT id, user_id, source_app, event_type, idempotency_key, delta, metadata_json, created_at FROM "spmt_xp_ledger${LEGACY_SUFFIX}" ORDER BY rowid LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
    if (!page.length) break;
    const rows = page.map((row) => {
      const t = transformXpRow({ id: row[0], user_id: row[1], source_app: row[2], event_type: row[3], idempotency_key: row[4], delta: row[5], metadata_json: row[6], created_at: row[7] });
      xpInsertedDelta += t.delta;
      if (t.hasMetadata) xpWithMetadata++;
      return [t.id, t.tenantId, t.userId, t.idempotencyKey, t.delta, t.body];
    });
    xpInserted += await insertBatches("spmt_xp_ledger", ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"], rows);
    offset += page.length;
    if (page.length < PAGE_SIZE) break;
  }
  report.inserted.xp = xpInserted;
  report.inserted.xpDelta = xpInsertedDelta;
  report.inserted.xpWithMetadata = xpWithMetadata;

  // ---- Verify against the baselines (arithmetic, not vibes) ----
  const xpAfter = await one("SELECT COUNT(*) AS rows_total, COALESCE(SUM(delta), 0) AS total_delta, COUNT(DISTINCT id) AS distinct_ids, COUNT(DISTINCT idempotency_key) AS distinct_idem, COUNT(DISTINCT tenant_id) AS distinct_tenants, SUM(CASE WHEN json_extract(body, '$.metadata.serverId') IS NOT NULL THEN 1 ELSE 0 END) AS with_server_id FROM spmt_xp_ledger");
  check("xp rows", baseline.xp.rows, Number(xpAfter[0]));
  check("xp SUM(delta)", baseline.xp.totalDelta, Number(xpAfter[1]));
  check("xp distinct ids", baseline.xp.distinctIds, Number(xpAfter[2]));
  check("xp distinct idempotency keys", baseline.xp.distinctIdemKeys, Number(xpAfter[3]));
  check("xp distinct personal tenants", baseline.xp.distinctUsers, Number(xpAfter[4]));
  check("xp bodies carrying metadata.serverId", baseline.xp.withServerId, Number(xpAfter[5] ?? 0));
  check("xp inserted delta (JS-side sum)", baseline.xp.totalDelta, xpInsertedDelta);
  const xpByAppAfter = (await query("SELECT json_extract(body, '$.sourceAppId') AS app, COUNT(*) AS n, COALESCE(SUM(delta), 0) AS total FROM spmt_xp_ledger GROUP BY app ORDER BY app")).map((r) => ({ app: String(r[0]), rows: Number(r[1]), totalDelta: Number(r[2]) }));
  check("xp per-source-app reconciliation", JSON.stringify(baseline.xpBySourceApp), JSON.stringify(xpByAppAfter));
  const wsAfter = await one("SELECT COUNT(*) AS rows_total, SUM(CASE WHEN json_extract(body, '$.tenantId') = tenant_id THEN 1 ELSE 0 END) AS tenant_match, SUM(CASE WHEN json_array_length(json_extract(body, '$.dockSlots')) = 3 THEN 1 ELSE 0 END) AS dock3 FROM spmt_workspace_profiles");
  check("workspace rows", baseline.workspaces.seedRows, Number(wsAfter[0]));
  check("workspace body.tenantId matches key", baseline.workspaces.seedRows, Number(wsAfter[1] ?? 0));
  check("workspace dockSlots length 3", baseline.workspaces.seedRows, Number(wsAfter[2] ?? 0));
  const usersAfter = Number((await one("SELECT COUNT(*) FROM spmt_users"))[0]);
  check("user rows", baseline.users.distinctIds, usersAfter);
  report.after = { xpRows: Number(xpAfter[0]), xpTotalDelta: Number(xpAfter[1]), workspaceRows: Number(wsAfter[0]), userRows: usersAfter };
  report.sessionsGuard = {
    accessSessionsBefore: sessionsBefore,
    accessSessionsAfter: Number((await one("SELECT COUNT(*) FROM spmt_access_sessions"))[0]),
    refreshTokensBefore: refreshBefore,
    refreshTokensAfter: Number((await one("SELECT COUNT(*) FROM spmt_refresh_tokens"))[0]),
    note: "Promotion never writes these tables; counts may grow from live traffic during the run.",
  };
  report.notes.push("Rollback: dispatch this workflow with PROMOTE_MODE=rollback — it drops the promoted tables and renames spmt_users_legacy_seed / spmt_workspace_profiles_legacy_seed / spmt_xp_ledger_legacy_seed back. The legacy tables were not modified in place.");
  return finish(report);
}

function finish(report) {
  report.statementKinds = [...new Set(executedStatements.map((s) => s.split(" ")[0].toUpperCase()))];
  report.statementsExecuted = executedStatements.length;
  console.log("===SEED_PROMOTION_JSON_BEGIN===");
  console.log(JSON.stringify(report, null, 2));
  console.log("===SEED_PROMOTION_JSON_END===");
  writeFileSync("seed-promotion-report.json", JSON.stringify(report, null, 2));
  const lines = [];
  lines.push(`# Seed-era XP / workspace promotion — ${report.mode} — ${report.generatedAt}`);
  lines.push("");
  if (report.baseline) {
    lines.push(`Baseline: XP ${report.baseline.xp.rows} rows, SUM(delta) ${report.baseline.xp.totalDelta}, ${report.baseline.xp.distinctUsers} users; workspaces ${report.baseline.workspaces.seedRows} seed rows (+${report.baseline.workspaces.junkRows} mirror junk rows); users ${report.baseline.users.distinctIds} distinct ids in ${report.baseline.users.rowsTotal} rows.`);
  }
  if (report.transformValidation) lines.push(`Transform validation: ${JSON.stringify(report.transformValidation)}`);
  if (report.inserted) lines.push(`Inserted: ${JSON.stringify(report.inserted)}`);
  if (report.after) lines.push(`After: ${JSON.stringify(report.after)}`);
  if (report.before) lines.push(`Before rollback: ${JSON.stringify(report.before)}; after rollback: ${JSON.stringify(report.after)}`);
  for (const entry of report.checks ?? []) lines.push(`- ${entry.pass ? "PASS" : "FAIL"} ${entry.name}: expected ${entry.expected}, got ${entry.actual}`);
  if (report.sessionsGuard) lines.push(`Sessions guard: ${JSON.stringify(report.sessionsGuard)}`);
  for (const note of report.notes ?? []) lines.push(`- ${note}`);
  lines.push(`Statements executed: ${report.statementsExecuted}, kinds: ${report.statementKinds.join(", ")}`);
  const digest = lines.join("\n");
  writeFileSync("seed-promotion-digest.md", digest);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, digest);
  if (report.failed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`seed promotion failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
