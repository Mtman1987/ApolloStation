#!/usr/bin/env node
/** Read-only-by-default migration of Nebula game runtime snapshots to Turso. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AsyncNebulaGameRuntimeStore } from "../apps/nebula-arcade/dist/async-game-runtime-store.js";
import { normalizeNebulaGameRuntimeState } from "../apps/nebula-arcade/dist/game-runtime.js";

const parse = (value) => {
  try { return JSON.parse(String(value)); }
  catch { throw new Error("Invalid JSON in nebula_game_runtime.body"); }
};

export function readNebulaGameRuntimeSnapshots(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nebula_game_runtime'").get();
  if (!table) return [];
  return db.prepare("SELECT tenant_id,runtime_key,body,updated_at FROM nebula_game_runtime ORDER BY tenant_id,runtime_key").all().map((row) => ({
    tenantId: String(row.tenant_id),
    runtimeKey: String(row.runtime_key),
    updatedAt: String(row.updated_at),
    state: normalizeNebulaGameRuntimeState(parse(row.body)),
  }));
}

function args(argv) {
  const value = { source: "", apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") value.source = argv[++i] ?? "";
    else if (argv[i] === "--apply") value.apply = true;
    else if (argv[i] === "--help") return { ...value, help: true };
    else throw new Error("Unknown argument: " + argv[i]);
  }
  return value;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.help || !options.source) {
    process.stdout.write("Usage: node scripts/migrate-nebula-game-runtime-to-turso.mjs --source PATH [--apply]\\nDry-run by default. Apply requires NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN.\\n");
    return;
  }
  const source = new DatabaseSync(resolve(options.source), { readOnly: true });
  let snapshots;
  try {
    const check = source.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0].quick_check !== "ok") throw new Error("Source SQLite quick_check failed");
    snapshots = readNebulaGameRuntimeSnapshots(source);
  } finally { source.close(); }
  const digest = createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
  const summary = snapshots.map((item) => ({ tenantId: item.tenantId, runtimeKey: item.runtimeKey, players: Object.keys(item.state.players).length, ledgerEntries: item.state.ledger.length }));
  if (!options.apply) {
    process.stdout.write(JSON.stringify({ applied: false, sourceSha256: digest, snapshots: summary }, null, 2) + "\\n");
    return;
  }
  const url = process.env.NEBULA_ARCADE_TURSO_DATABASE_URL;
  const authToken = process.env.NEBULA_ARCADE_TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("Turso import requires NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN");
  const store = new AsyncNebulaGameRuntimeStore({ mode: "turso", url, authToken });
  const results = [];
  try {
    await store.initialize();
    for (const snapshot of snapshots) {
      const result = await store.importState(snapshot.tenantId, snapshot.state, "sqlite-nebula-game-runtime-v1", snapshot.runtimeKey, snapshot.updatedAt);
      const restored = await store.get(snapshot.tenantId, snapshot.runtimeKey);
      if (JSON.stringify(restored) !== JSON.stringify(snapshot.state)) throw new Error("Turso verification failed for tenant " + snapshot.tenantId + " runtime " + snapshot.runtimeKey);
      results.push({ tenantId: snapshot.tenantId, runtimeKey: snapshot.runtimeKey, ...result, verified: true });
    }
  } finally { await store.close(); }
  process.stdout.write(JSON.stringify({ applied: true, verified: true, sourceSha256: digest, snapshots: results }, null, 2) + "\\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write("Nebula game runtime import failed: " + (error instanceof Error ? error.message : "unknown error") + "\\n"); process.exitCode = 1; });
}
