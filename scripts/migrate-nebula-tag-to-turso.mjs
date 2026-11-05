#!/usr/bin/env node
/**
 * Imports Nebula Tag state, command dedupe receipts, and pending deliveries.
 * Dry-run is the default; the source SQLite database is always read-only.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AsyncNebulaTagRecordStore } from "../apps/nebula-arcade/dist/async-tag-record-store.js";

const exists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const parse = (value, label) => {
  try { return JSON.parse(String(value)); }
  catch { throw new Error(`Invalid JSON in source ${label}`); }
};

export function readLegacyTagSnapshots(db) {
  const stateTable = exists(db, "nebula_tag_state");
  const commandTable = exists(db, "nebula_tag_commands");
  const outboxTable = exists(db, "nebula_tag_outbox");
  if (!stateTable) {
    const commandCount = commandTable ? Number(db.prepare("SELECT COUNT(*) AS count FROM nebula_tag_commands").get().count) : 0;
    const outboxCount = outboxTable ? Number(db.prepare("SELECT COUNT(*) AS count FROM nebula_tag_outbox").get().count) : 0;
    if (commandCount || outboxCount) throw new Error("Tag commands/outbox exist without nebula_tag_state; manual reconciliation is required");
    return [];
  }
  const states = db.prepare("SELECT tenant_id,revision,body FROM nebula_tag_state ORDER BY tenant_id").all();
  const knownTenants = new Set(states.map((row) => String(row.tenant_id)));
  for (const table of ["nebula_tag_commands", "nebula_tag_outbox"]) {
    if (!exists(db, table)) continue;
    for (const row of db.prepare(`SELECT DISTINCT tenant_id FROM ${table}`).all()) {
      if (!knownTenants.has(String(row.tenant_id))) throw new Error(`Source ${table} contains records without a Tag state row for tenant ${row.tenant_id}`);
    }
  }
  return states.map((row) => {
    const tenantId = String(row.tenant_id);
    const state = parse(row.body, "nebula_tag_state.body");
    if (state.tenantId !== tenantId) throw new Error(`Tag state tenant mismatch for ${tenantId}`);
    const commands = commandTable
      ? db.prepare("SELECT command_id,occurred_at,result FROM nebula_tag_commands WHERE tenant_id=? ORDER BY occurred_at,command_id").all(tenantId).map((item) => ({
          commandId: String(item.command_id), occurredAt: String(item.occurred_at), result: parse(item.result, "nebula_tag_commands.result"),
        }))
      : [];
    const outbox = outboxTable
      ? db.prepare("SELECT command_id,created_at,attempts,last_error,result FROM nebula_tag_outbox WHERE tenant_id=? ORDER BY created_at,command_id").all(tenantId).map((item) => ({
          commandId: String(item.command_id), createdAt: String(item.created_at), attempts: Number(item.attempts),
          ...(item.last_error ? { lastError: String(item.last_error) } : {}), result: parse(item.result, "nebula_tag_outbox.result"),
        }))
      : [];
    return { tenantId, revision: Number(row.revision), state, commands, outbox };
  });
}

function digest(snapshots) {
  return createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
}

function parseArgs(argv) {
  const options = { source: "", apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.source = argv[++index] ?? "";
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.source) {
    process.stdout.write("Usage: node scripts/migrate-nebula-tag-to-turso.mjs --source PATH [--apply]\\nDry-run by default. Apply requires NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN.\\nImports Tag state, command dedupe receipts, and pending outbox rows for every tenant.\\n");
    return;
  }
  const source = new DatabaseSync(resolve(options.source), { readOnly: true });
  let snapshots;
  try {
    const check = source.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0].quick_check !== "ok") throw new Error("Source SQLite quick_check failed; refusing to import");
    snapshots = readLegacyTagSnapshots(source);
  } finally { source.close(); }
  for (const snapshot of snapshots) if (snapshot.outbox.length > 500) throw new Error(`Tenant ${snapshot.tenantId} has more than 500 pending Tag deliveries; drain the outbox before importing`);
  const sourceSha256 = digest(snapshots);
  const summary = snapshots.map((item) => ({ tenantId: item.tenantId, revision: item.revision, players: Object.keys(item.state.players ?? {}).length, commands: item.commands.length, outbox: item.outbox.length }));
  if (!options.apply) {
    process.stdout.write(JSON.stringify({ applied: false, sourceSha256, tenants: summary }, null, 2) + "\\n");
    return;
  }
  const url = process.env.NEBULA_ARCADE_TURSO_DATABASE_URL;
  const authToken = process.env.NEBULA_ARCADE_TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("Turso Tag import requires NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN");
  const store = new AsyncNebulaTagRecordStore({ mode: "turso", url, authToken });
  const results = [];
  try {
    await store.initialize();
    for (const snapshot of snapshots) {
      const result = await store.importSnapshot(snapshot, "sqlite-nebula-tag-v1");
      const restored = await store.getState(snapshot.tenantId);
      const pending = await store.listPendingDeliveries(snapshot.tenantId, 500);
      if (restored.revision !== snapshot.revision || JSON.stringify(restored.state) !== JSON.stringify(snapshot.state) || pending.length !== snapshot.outbox.length) {
        throw new Error(`Turso verification failed for tenant ${snapshot.tenantId}`);
      }
      results.push({ tenantId: snapshot.tenantId, ...result, verified: true });
    }
  } finally { await store.close(); }
  process.stdout.write(JSON.stringify({ applied: true, verified: true, sourceSha256, tenants: results }, null, 2) + "\\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`Nebula Tag import failed: ${error instanceof Error ? error.message : "unknown error"}\\n`); process.exitCode = 1; });
}
