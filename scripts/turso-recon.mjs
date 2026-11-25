#!/usr/bin/env node
/**
 * turso-recon.mjs — READ-ONLY Turso reconnaissance for the Apollo
 * persistence recovery (seed-era XP / workspace promotion groundwork).
 *
 * Safety contract:
 * - Every statement sent to Turso passes assertReadOnly(): it must be a
 *   single SELECT or PRAGMA statement. Anything else throws before it
 *   reaches the wire. This script never writes to Turso.
 * - Sampled row values are summarized before they are stored or printed:
 *   sensitive columns are redacted, JSON bodies are reduced to their key
 *   shapes, and long strings are truncated. No full user bodies, password
 *   material, or token material ever leaves this script.
 *
 * Inputs (env): TURSO_DATABASE_URL, NODE1_TURSO_AUTH_TOKEN,
 * NODE2_TURSO_AUTH_TOKEN. Both tokens are pointed at the same shared URL,
 * mirroring how the deploy preflight and the seed workflows resolve it, so
 * the run also settles whether the two tokens see the same database state.
 *
 * Outputs: the full JSON report on stdout (between markers) and in
 * turso-recon-report.json, a bounded markdown digest in
 * turso-recon-digest.md, and the digest appended to the GitHub job summary
 * when GITHUB_STEP_SUMMARY is set.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { TursoHttpAdapter, normalizeTursoUrl } from "../packages/turso-http/index.mjs";

const executedStatements = [];

function assertReadOnly(sql) {
  const trimmed = String(sql).trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) throw new Error(`Refused multi-statement SQL: ${sql.slice(0, 80)}`);
  if (!/^(SELECT|PRAGMA)\b/i.test(trimmed)) throw new Error(`Refused non-read-only SQL: ${sql.slice(0, 80)}`);
  return trimmed;
}

const SENSITIVE_COLUMN = /(token|secret|password|passwd|pwd|hash|salt|credential|cookie|authorization|api[-_]?key|webhook)/i;

function summarizeJsonText(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const fieldTypes = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number") fieldTypes[key] = `number(${value})`;
        else if (Array.isArray(value)) fieldTypes[key] = `array(${value.length})`;
        else if (value === null) fieldTypes[key] = "null";
        else if (typeof value === "object") fieldTypes[key] = "object";
        else fieldTypes[key] = typeof value;
      }
      return { json: "object", chars: text.length, fieldTypes };
    }
    return { json: Array.isArray(parsed) ? "array" : typeof parsed, chars: text.length };
  } catch {
    return { textPreview: text.slice(0, 48), chars: text.length };
  }
}

function summarizeValue(column, value) {
  if (SENSITIVE_COLUMN.test(column)) return "[redacted: sensitive column]";
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value instanceof Uint8Array) return { blobBytes: value.length };
  const text = String(value);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return summarizeJsonText(text);
  const limit = column === "source_path" ? 300 : 96;
  return text.length > limit ? `${text.slice(0, limit)}…(${text.length} chars)` : text;
}

function summarizeResult(result, rowLimit = 12) {
  if (!result.ok) return result;
  return {
    ...result,
    rows: result.rows.slice(0, rowLimit).map((row) =>
      Object.fromEntries(result.columns.map((column, i) => [column, summarizeValue(column, row[i])])),
    ),
    rowCount: result.rows.length,
  };
}

async function reconTarget(label, url, token) {
  const target = { label, endpointHost: new URL(normalizeTursoUrl(url)).host, results: {} };
  const db = new TursoHttpAdapter({ url, authToken: token });
  const run = async (id, sql, rowLimit) => {
    const statement = assertReadOnly(sql);
    executedStatements.push(statement);
    let raw;
    try {
      const result = await db.execute(statement, [], true);
      raw = { id, sql: statement, ok: true, columns: result.columns, rows: result.rows };
    } catch (error) {
      raw = { id, sql: statement, ok: false, error: String(error?.message ?? error).slice(0, 300) };
    }
    target.results[id] = summarizeResult(raw, rowLimit);
    return raw;
  };

  const ping = await run("ping", "SELECT 1 AS ok");
  target.reachable = ping.ok;

  const tablesResult = await run(
    "candidate_tables",
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    300,
  );
  const tables = tablesResult.ok ? tablesResult.rows.map((row) => String(row[0])) : [];
  target.tables = tables;
  const has = (name) => tables.includes(name);

  target.schemas = {};
  for (const name of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const pragma = await run(`pragma:${name}`, `PRAGMA table_info(${name})`);
    if (pragma.ok) {
      target.schemas[name] = pragma.rows.map((row) => ({
        name: String(row[1]),
        type: String(row[2]),
        notnull: Number(row[3]),
        pk: Number(row[5]),
      }));
    }
  }
  const cols = (name) => (target.schemas[name] ?? []).map((column) => column.name);

  target.counts = {};
  for (const name of [
    "spmt_xp_ledger", "xp_events", "xp_ledger",
    "spmt_workspace_profiles", "workspaces", "workspace_profiles",
    "spmt_users", "users", "spmt_user_profiles", "spmt_tenants", "tenants",
    "spmt_user_credentials", "spmt_provider_links",
    "spmt_access_sessions", "spmt_refresh_tokens",
    "apollo_recovered_json_stage_v1", "apollo_async_json_records_v1",
  ]) {
    if (!has(name)) continue;
    const count = await run(`count:${name}`, `SELECT COUNT(*) AS n FROM ${name}`);
    if (count.ok) target.counts[name] = Number(count.rows[0][0]);
  }

  if (has("spmt_xp_ledger") && ["tenant_id", "user_id", "delta", "idempotency_key"].every((c) => cols("spmt_xp_ledger").includes(c))) {
    await run("xp_ledger_shape", "SELECT COUNT(DISTINCT tenant_id) AS tenants, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(delta), 0) AS total_delta, SUM(CASE WHEN body IS NULL THEN 1 ELSE 0 END) AS null_bodies FROM spmt_xp_ledger");
  }
  if (has("spmt_xp_ledger")) await run("sample:spmt_xp_ledger", "SELECT * FROM spmt_xp_ledger LIMIT 5", 5);
  if (has("spmt_workspace_profiles")) await run("sample:spmt_workspace_profiles", "SELECT * FROM spmt_workspace_profiles LIMIT 3", 3);
  if (has("spmt_users")) await run("sample:spmt_users", "SELECT * FROM spmt_users LIMIT 3", 3);

  if (has("apollo_recovered_json_stage_v1")) {
    await run("staged:by_source", "SELECT source, COUNT(*) AS n, COUNT(DISTINCT tenant_key) AS tenants FROM apollo_recovered_json_stage_v1 GROUP BY source ORDER BY source");
    await run("staged:redacted", "SELECT source, COUNT(*) AS n FROM apollo_recovered_json_stage_v1 WHERE payload_json LIKE '%[REDACTED]%' GROUP BY source ORDER BY source");
    await run("staged:sw_segment1", "SELECT CASE WHEN instr(source_path, '/') > 0 THEN substr(source_path, 1, instr(source_path, '/') - 1) ELSE source_path END AS segment, COUNT(*) AS n FROM apollo_recovered_json_stage_v1 WHERE source = 'streamweaver' GROUP BY segment ORDER BY n DESC LIMIT 40", 40);
    await run("staged:sw_markers", "SELECT SUM(CASE WHEN source_path LIKE '%ride%' THEN 1 ELSE 0 END) AS ride_like, SUM(CASE WHEN source_path LIKE '%bic%' THEN 1 ELSE 0 END) AS bic_like, SUM(CASE WHEN source_path LIKE '%social%' OR source_path LIKE '%reaction%' THEN 1 ELSE 0 END) AS social_like, SUM(CASE WHEN source_path LIKE '%bot-action%' OR source_path LIKE '%bot_action%' THEN 1 ELSE 0 END) AS bot_action_like, SUM(CASE WHEN source_path LIKE '%/tenants/%' THEN 1 ELSE 0 END) AS tenant_scoped, COUNT(*) AS total FROM apollo_recovered_json_stage_v1 WHERE source = 'streamweaver'");
    await run("staged:sw_sample", "SELECT tenant_key, source_path, record_counts_json, source_schema_version, length(payload_json) AS payload_chars FROM apollo_recovered_json_stage_v1 WHERE source = 'streamweaver' ORDER BY tenant_key, source_path LIMIT 200", 200);
  }

  if (has("apollo_async_json_records_v1")) {
    await run("async_records:by_namespace", "SELECT namespace, COUNT(DISTINCT tenant_id) AS tenants, COUNT(*) AS records FROM apollo_async_json_records_v1 GROUP BY namespace ORDER BY records DESC", 100);
  }

  target.sessions = {};
  for (const [name, key] of [["spmt_access_sessions", "accessSessions"], ["spmt_refresh_tokens", "refreshTokens"]]) {
    if (!has(name)) continue;
    const entry = { total: target.counts[name] ?? null };
    if (cols(name).includes("expires_at")) {
      const live = await run(`live:${name}`, `SELECT COUNT(*) AS n FROM ${name} WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
      entry.liveByExpiresAt = live.ok ? Number(live.rows[0][0]) : `error: ${live.error}`;
    } else {
      entry.liveByExpiresAt = "no expires_at column";
    }
    target.sessions[key] = entry;
  }

  // ---- Step-1 battery: seed-era XP / workspace promotion groundwork ----
  // Settles the 653-vs-12,419 users question (hydrate-identical row count
  // vs COUNT(*)), identifies the tenants that exist, and measures how the
  // legacy XP / workspace rows key back to users. Aggregates and opaque ids
  // only: no emails, no user bodies, usernames only as a known-test-account
  // boolean.
  if (has("spmt_users")) {
    await run("users:hydrate_rows", "SELECT id FROM spmt_users", 3);
    if (cols("spmt_users").includes("username")) {
      await run("users:aggregates", "SELECT COUNT(*) AS rows_total, COUNT(DISTINCT id) AS distinct_ids, SUM(CASE WHEN id IS NULL OR id = '' THEN 1 ELSE 0 END) AS empty_ids, SUM(CASE WHEN username IS NOT NULL THEN 1 ELSE 0 END) AS with_username, SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) AS with_email, SUM(CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END) AS with_password_hash FROM spmt_users");
    }
  }
  if (has("spmt_user_profiles")) {
    await run("profiles:detail", "SELECT user_id, (username IN ('athena', 'persistenceprobe')) AS is_known_test_account, json_extract(body, '$.createdAt') AS body_created_at, json_extract(body, '$.tenantIds[0]') AS tenant0, json_extract(body, '$.tenantIds[1]') AS tenant1, json_extract(body, '$.tenantIds[2]') AS tenant2 FROM spmt_user_profiles LIMIT 10", 10);
  }
  if (has("spmt_tenants")) {
    await run("tenants:detail", "SELECT id, owner_user_id, status, json_extract(body, '$.name') AS name, json_extract(body, '$.displayName') AS display_name, json_extract(body, '$.slug') AS slug FROM spmt_tenants LIMIT 10", 10);
  }
  if (has("spmt_xp_ledger") && cols("spmt_xp_ledger").includes("metadata_json")) {
    await run("xp:aggregates", "SELECT COUNT(*) AS rows_total, COALESCE(SUM(delta), 0) AS total_delta, COUNT(DISTINCT user_id) AS distinct_users, COUNT(DISTINCT id) AS distinct_ids, COUNT(DISTINCT idempotency_key) AS distinct_idem_keys, SUM(CASE WHEN idempotency_key IS NULL OR idempotency_key = '' THEN 1 ELSE 0 END) AS empty_idem_keys, SUM(CASE WHEN created_at IS NULL THEN 1 ELSE 0 END) AS null_created_at, MIN(created_at) AS first_created_at, MAX(created_at) AS last_created_at FROM spmt_xp_ledger");
    await run("xp:by_source_app", "SELECT COALESCE(source_app, '(null)') AS source_app, COUNT(*) AS n, COALESCE(SUM(delta), 0) AS total_delta FROM spmt_xp_ledger GROUP BY source_app ORDER BY n DESC LIMIT 20", 20);
    await run("xp:by_event_type", "SELECT COALESCE(event_type, '(null)') AS event_type, COUNT(*) AS n FROM spmt_xp_ledger GROUP BY event_type ORDER BY n DESC LIMIT 20", 20);
    await run("xp:by_server", "SELECT COALESCE(json_extract(metadata_json, '$.serverId'), '(none)') AS server_id, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM spmt_xp_ledger GROUP BY server_id ORDER BY n DESC LIMIT 20", 20);
    await run("xp:by_schema_version", "SELECT COALESCE(json_extract(metadata_json, '$.schemaVersion'), '(none)') AS schema_version, COUNT(*) AS n FROM spmt_xp_ledger GROUP BY schema_version ORDER BY n DESC LIMIT 10", 10);
    if (has("spmt_users") && cols("spmt_users").includes("username")) {
      await run("xp:user_id_match", "SELECT COUNT(*) AS rows_matched, COUNT(DISTINCT user_id) AS users_matched FROM spmt_xp_ledger WHERE user_id IN (SELECT id FROM spmt_users)");
      await run("xp:metadata_username_match", "SELECT COUNT(*) AS rows_matched, COUNT(DISTINCT json_extract(metadata_json, '$.username')) AS usernames_matched FROM spmt_xp_ledger WHERE json_extract(metadata_json, '$.username') IN (SELECT username FROM spmt_users)");
    }
  }
  if (has("spmt_workspace_profiles") && cols("spmt_workspace_profiles").includes("profile")) {
    await run("workspaces:aggregates", "SELECT COUNT(*) AS rows_total, COUNT(DISTINCT user_id) AS distinct_users, MIN(revision) AS min_revision, MAX(revision) AS max_revision FROM spmt_workspace_profiles");
    if (has("spmt_users")) {
      await run("workspaces:user_match", "SELECT COUNT(*) AS rows_matched FROM spmt_workspace_profiles WHERE user_id IN (SELECT id FROM spmt_users)");
    }
    if (has("spmt_user_profiles")) {
      await run("workspaces:profile_match", "SELECT COUNT(*) AS rows_matched FROM spmt_workspace_profiles WHERE user_id IN (SELECT user_id FROM spmt_user_profiles)");
    }
  }

  return target;
}

function digestMarkdown(report) {
  const lines = [];
  lines.push(`# Turso read-only recon — ${report.generatedAt}`);
  lines.push("");
  lines.push(`Endpoint host (both targets): \`${report.endpointHost}\``);
  lines.push(`Statements executed: ${report.executedStatements.length}, kinds: ${report.statementKinds.join(", ")}`);
  for (const target of report.targets) {
    lines.push("");
    lines.push(`## Target: ${target.label}`);
    if (target.error) { lines.push(`ERROR: ${target.error}`); continue; }
    lines.push(`Reachable: ${target.reachable}`);
    lines.push(`Tables found: ${target.tables.join(", ") || "(none)"}`);
    lines.push("");
    lines.push("### Schemas");
    for (const [name, columns] of Object.entries(target.schemas)) {
      lines.push(`- ${name}: ${columns.map((c) => `${c.name} ${c.type}${c.pk ? " PK" : ""}`).join(", ")}`);
    }
    lines.push("");
    lines.push("### Counts");
    for (const [name, n] of Object.entries(target.counts)) lines.push(`- ${name}: ${n}`);
    lines.push("");
    lines.push("### Query results");
    for (const [id, result] of Object.entries(target.results)) {
      if (id.startsWith("pragma:") || id.startsWith("count:") || id === "candidate_tables" || id === "ping") continue;
      lines.push(`#### ${id}`);
      if (!result.ok) { lines.push(`ERROR: ${result.error}`); continue; }
      lines.push("```json");
      lines.push(JSON.stringify(result.rows, null, 1).slice(0, 6000));
      lines.push("```");
    }
    lines.push("");
    lines.push(`Sessions: \`${JSON.stringify(target.sessions)}\``);
  }
  return lines.join("\n");
}

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is not set");
const report = {
  generatedAt: new Date().toISOString(),
  endpointHost: new URL(normalizeTursoUrl(url)).host,
  targets: [],
};
for (const [label, token] of [
  ["node1-token (app read path)", process.env.NODE1_TURSO_AUTH_TOKEN],
  ["node2-token (seed write path)", process.env.NODE2_TURSO_AUTH_TOKEN],
]) {
  if (!token) { report.targets.push({ label, error: "token missing" }); continue; }
  try {
    report.targets.push(await reconTarget(label, url, token));
  } catch (error) {
    report.targets.push({ label, error: String(error?.message ?? error).slice(0, 300) });
  }
}
report.executedStatements = executedStatements;
report.statementKinds = [...new Set(executedStatements.map((s) => s.trimStart().split(/\s+/)[0].toUpperCase()))];

console.log("===TURSO_RECON_JSON_BEGIN===");
console.log(JSON.stringify(report, null, 2));
console.log("===TURSO_RECON_JSON_END===");
writeFileSync("turso-recon-report.json", JSON.stringify(report, null, 2));
const digest = digestMarkdown(report);
writeFileSync("turso-recon-digest.md", digest);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, digest);
