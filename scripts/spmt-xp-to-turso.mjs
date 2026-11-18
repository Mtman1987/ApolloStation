#!/usr/bin/env node
// Imports the SPMT export file into Turso under spmt_* table names.
// Idempotent: each run clears the spmt_* tables it owns, then reloads and verifies counts.
// Usage: node scripts/spmt-xp-to-turso.mjs --source /tmp/spmt-xp-export.db [--apply]
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";

const TABLES = ["xp_ledger", "users", "workspace_profiles", "user_settings", "app_state_records"];
const BATCH = 500;
const q = (name) => '"' + String(name).replaceAll('"', '""') + '"';

const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1];
const apply = args.includes("--apply");
if (!source) throw new Error("--source is required");

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
const adapter = new TursoHttpAdapter({ url, authToken: token });

const db = new DatabaseSync(resolve(source), { readOnly: true });
const check = db.prepare("PRAGMA quick_check").get();
if (Object.values(check)[0] !== "ok") throw new Error("Source quick_check failed; refusing to import");

const report = {};
for (const table of TABLES) {
  const cols = db.prepare(`PRAGMA table_info(${q(table)})`).all().map((c) => c.name);
  if (!cols.length) { report[table] = "missing in export"; continue; }
  const target = `spmt_${table}`;
  const count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(table)}`).get().n);
  report[table] = { target, sourceRows: count };
  if (!apply) continue;

  await adapter.execute(`CREATE TABLE IF NOT EXISTS ${q(target)} (${cols.map(q).join(", ")})`);
  await adapter.execute(`DELETE FROM ${q(target)}`);
  const colSql = cols.map(q).join(", ");
  const ph = "(" + cols.map(() => "?").join(",") + ")";
  const rows = db.prepare(`SELECT ${colSql} FROM ${q(table)}`).all();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const statements = chunk.map((row) => ({ sql: `INSERT INTO ${q(target)} (${colSql}) VALUES ${ph}`, args: cols.map((c) => row[c]) }));
    await adapter.pipeline(statements);
  }
  const remote = await adapter.execute(`SELECT COUNT(*) AS n FROM ${q(target)}`, [], true);
  const remoteCount = Number(remote.rows[0][0]);
  report[table].tursoRows = remoteCount;
  if (remoteCount !== count) throw new Error(`${table}: Turso has ${remoteCount}, source has ${count}`);
}
db.close();
console.log(JSON.stringify({ applied: apply, tables: report }, null, 2));
