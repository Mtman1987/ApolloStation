#!/usr/bin/env node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";

const TABLETOP = "tabletop-state";
const RECEIPTS = "tabletop-command-receipts";
const TRADES = "quackverse-trade-receipts";
const OUTBOX = "tabletop-media-outbox";
const MIGRATIONS = "tabletop-migrations";

function pairKey(first, second) { return [String(first), String(second)].map(encodeURIComponent).join(":"); }

export function readNebulaTabletopSnapshot(db, tenantId) {
  if (!tenantId || tenantId.trim() !== tenantId) throw new Error("A tenant ID is required");
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new Error("Source SQLite integrity_check failed");
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const read = (table, sql) => tables.has(table) ? db.prepare(sql).all(tenantId) : [];
  const tabletop = read("nebula_tabletop", "SELECT channel_id,game_id,body FROM nebula_tabletop WHERE tenant_id=? ORDER BY channel_id,game_id").map((row) => ({
    key: pairKey(row.channel_id, row.game_id), value: JSON.parse(String(row.body)),
  }));
  const commandReceipts = read("nebula_tabletop_receipts", "SELECT input_id,result FROM nebula_tabletop_receipts WHERE tenant_id=? ORDER BY input_id").map((row) => ({
    key: String(row.input_id), value: { result: String(row.result) },
  }));
  const tradeReceipts = read("nebula_quackverse_trade_receipts", "SELECT actor_id,request_id,result FROM nebula_quackverse_trade_receipts WHERE tenant_id=? ORDER BY actor_id,request_id").map((row) => ({
    key: pairKey(row.actor_id, row.request_id), value: { result: JSON.parse(String(row.result)) },
  }));
  const mediaOutbox = read("nebula_media_outbox", "SELECT id,kind,body,status,updated_at FROM nebula_media_outbox WHERE tenant_id=? ORDER BY id").map((row) => ({
    key: String(row.id), value: { kind: String(row.kind), body: JSON.parse(String(row.body)), status: String(row.status), updatedAt: String(row.updated_at) },
  }));
  const runtimeRows = read("nebula_game_runtime", "SELECT body,updated_at FROM nebula_game_runtime WHERE tenant_id=? AND runtime_key='default'");
  if (runtimeRows.length > 1) throw new Error("Source contains more than one default game-runtime row");
  const gameRuntime = runtimeRows[0] ? { state: JSON.parse(String(runtimeRows[0].body)), updatedAt: String(runtimeRows[0].updated_at) } : undefined;
  const snapshot = { tenantId, tabletop, commandReceipts, tradeReceipts, mediaOutbox, gameRuntime };
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return {
    ...snapshot,
    counts: { tabletop: tabletop.length, commandReceipts: commandReceipts.length, tradeReceipts: tradeReceipts.length, mediaOutbox: mediaOutbox.length, gameRuntime: gameRuntime ? 1 : 0 },
    digest,
  };
}

export async function importNebulaTabletopSnapshot(store, snapshot, migrationId) {
  if (!migrationId || migrationId.trim() !== migrationId || migrationId.length > 180) throw new Error("A valid migration ID is required");
  const tenant = snapshot.tenantId;
  const groups = [[TABLETOP, snapshot.tabletop], [RECEIPTS, snapshot.commandReceipts], [TRADES, snapshot.tradeReceipts], [OUTBOX, snapshot.mediaOutbox]];
  return store.transaction(async (tx) => {
    const prior = await tx.get(MIGRATIONS, tenant, migrationId);
    if (prior) { if (prior.digest !== snapshot.digest) throw new Error("Migration ID already exists with a different tabletop source digest"); return { imported: false, duplicate: true, counts: snapshot.counts, digest: snapshot.digest }; }
    for (const [namespace] of groups) {
      const existing = await tx.list(namespace, tenant);
      if (existing.length) throw new Error(`Turso destination is not empty for ${namespace} / ${tenant}`);
    }
    if ((await tx.list(MIGRATIONS, tenant)).length) throw new Error(`Turso destination already has tabletop migration receipts for ${tenant}`);
    const currentRuntime = await tx.get("game-runtime", tenant, "default");
    if (snapshot.gameRuntime) {
      if (currentRuntime) {
        const currentState = currentRuntime.state ?? currentRuntime;
        if (JSON.stringify(currentState) !== JSON.stringify(snapshot.gameRuntime.state)) throw new Error("Existing Turso game-runtime state differs from the tabletop source snapshot");
      } else {
        await tx.put("game-runtime", tenant, "default", snapshot.gameRuntime);
      }
    }
    for (const [namespace, rows] of groups) for (const row of rows) await tx.put(namespace, tenant, row.key, row.value);
    const verified = {};
    for (const [namespace, rows] of groups) {
      const actual = (await tx.list(namespace, tenant)).length;
      if (actual !== rows.length) throw new Error(`Turso import verification failed for ${namespace} / ${tenant}: expected ${rows.length}, received ${actual}`);
      verified[namespace] = actual;
    }
    const importedAt = new Date().toISOString();
    await tx.put(MIGRATIONS, tenant, migrationId, { importedAt, digest: snapshot.digest, counts: snapshot.counts });
    return { imported: true, duplicate: false, verified, gameRuntime: snapshot.gameRuntime ? (currentRuntime ? "already-matched" : "imported") : "absent", digest: snapshot.digest };
  });
}

function parseArgs(argv) {
  const result = { source: "", tenant: "", apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") result.source = argv[++i] ?? "";
    else if (argv[i] === "--tenant") result.tenant = argv[++i] ?? "";
    else if (argv[i] === "--apply") result.apply = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!result.source || !result.tenant) throw new Error("Use --source /absolute/path/to/nebula.sqlite --tenant <tenant-id>");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2)), source = resolve(args.source);
  const db = new DatabaseSync(source, { readOnly: true });
  let snapshot;
  try { snapshot = readNebulaTabletopSnapshot(db, args.tenant); } finally { db.close(); }
  const report = { source, tenant: args.tenant, mode: args.apply ? "apply" : "dry-run", counts: snapshot.counts, digest: snapshot.digest };
  if (args.apply) {
    const url = process.env.NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL;
    const authToken = process.env.NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Apply requires NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL and NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN");
    const store = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "turso", url, authToken });
    try { await store.initialize(); report.result = await importNebulaTabletopSnapshot(store, snapshot, `sqlite-nebula-tabletop-v1:${snapshot.digest}`); } finally { await store.close(); }
  } else report.nextStep = "Review counts and digest; rerun with --apply only against the intended empty Nebula Turso namespaces.";
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) main().catch((error) => { process.stderr.write(`Nebula tabletop migration failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
