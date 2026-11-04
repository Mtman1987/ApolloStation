#!/usr/bin/env node
/**
 * Import only nebula_game_mixes from a stable SQLite source into a Turso DB.
 * This is safe alongside existing Mosaic tables: it never requires an empty DB.
 * Dry-run is the default. --apply writes only when the target table is empty.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";

const TABLE = "nebula_game_mixes";
const COLUMNS = ["tenant_id", "mix_id", "name", "mode", "rotation_seconds", "active_game_id", "layers", "created_at", "updated_at", "activity_box"];
const CREATE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  tenant_id TEXT NOT NULL,
  mix_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  rotation_seconds INTEGER NOT NULL,
  active_game_id TEXT,
  layers TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activity_box INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, mix_id)
)`;
const INSERT_SQL = `INSERT INTO ${TABLE}(${COLUMNS.join(",")}) VALUES(?,?,?,?,?,?,?,?,?,?)`;

function normalizeRow(row) {
  return [
    String(row[0]), String(row[1]), String(row[2]), String(row[3]),
    Number(row[4]), row[5] === null || row[5] === undefined ? null : String(row[5]),
    String(row[6]), String(row[7]), String(row[8]), Number(row[9] ?? 0),
  ];
}

function digest(rows) {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(normalizeRow(row)) + "\n");
  return hash.digest("hex");
}

function sourceRows(db) {
  const info = db.prepare(`PRAGMA table_info("${TABLE}")`).all();
  if (!info.length) throw new Error("Source SQLite database does not contain nebula_game_mixes");
  const columns = new Set(info.map((column) => String(column.name)));
  const required = COLUMNS.filter((column) => column !== "activity_box");
  for (const column of required) if (!columns.has(column)) throw new Error(`Source nebula_game_mixes is missing required column: ${column}`);
  const activity = columns.has("activity_box") ? "activity_box" : "0 AS activity_box";
  const rows = db.prepare(`SELECT tenant_id,mix_id,name,mode,rotation_seconds,active_game_id,layers,created_at,updated_at,${activity} FROM ${TABLE} ORDER BY tenant_id,mix_id`).all();
  return rows.map((row) => normalizeRow(COLUMNS.map((column) => row[column])));
}

async function inspectDestination(adapter) {
  const exists = await adapter.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [TABLE], true);
  if (!exists.rows.length) return { exists: false, count: 0, columns: [] };
  const info = await adapter.execute(`PRAGMA table_info(${TABLE})`, [], true);
  const columns = info.rows.map((row) => ({ name: String(row[1]), notNull: Number(row[3]), primaryKey: Number(row[5]) }));
  const names = new Set(columns.map((column) => column.name));
  for (const column of COLUMNS.filter((item) => item !== "activity_box")) {
    if (!names.has(column)) throw new Error(`Turso nebula_game_mixes schema is incompatible; missing ${column}`);
  }
  const pk = columns.filter((column) => column.primaryKey > 0).sort((a, b) => a.primaryKey - b.primaryKey).map((column) => column.name);
  if (pk.join(",") !== "tenant_id,mix_id") throw new Error("Turso nebula_game_mixes primary key is incompatible");
  const countResult = await adapter.execute(`SELECT COUNT(*) AS count FROM ${TABLE}`, [], true);
  return { exists: true, count: Number(countResult.rows[0]?.[0] ?? -1), columns };
}

export async function migrateNebulaGameMixTable({ sourcePath, adapter, apply = false }) {
  if (!sourcePath) throw new Error("A source SQLite path is required");
  if (apply && !adapter) throw new Error("A Turso adapter is required when --apply is used");
  const db = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || integrity[0].quick_check !== "ok") throw new Error("Source SQLite quick_check failed; refusing to migrate");
    const rows = sourceRows(db);
    const sourceCount = rows.length;
    const sourceHash = digest(rows);
    const destination = adapter ? await inspectDestination(adapter) : { exists: false, count: 0, columns: [] };
    if (destination.count > 0) throw new Error(`Turso nebula_game_mixes already contains ${destination.count} row(s); refusing to overwrite or merge`);
    const report = { table: TABLE, sourceCount, sourceSha256: sourceHash, destinationTableExists: destination.exists, destinationCount: destination.count, applied: false };
    if (!apply) return report;

    if (!destination.exists) await adapter.execute(CREATE_SQL);
    else if (!destination.columns.some((column) => column.name === "activity_box")) {
      await adapter.execute(`ALTER TABLE ${TABLE} ADD COLUMN activity_box INTEGER NOT NULL DEFAULT 0`);
    }

    if (rows.length) {
      await adapter.transaction(async (tx) => {
        for (let offset = 0; offset < rows.length; offset += 40) {
          for (const row of rows.slice(offset, offset + 40)) await tx.execute(INSERT_SQL, row);
        }
      });
    }

    const verification = await adapter.execute(`SELECT ${COLUMNS.join(",")} FROM ${TABLE} ORDER BY tenant_id,mix_id`, [], true);
    const destinationRows = verification.rows.map(normalizeRow);
    const destinationHash = digest(destinationRows);
    if (destinationRows.length !== sourceCount || destinationHash !== sourceHash) {
      throw new Error(`Turso verification failed: source rows/hash ${sourceCount}/${sourceHash}, destination ${destinationRows.length}/${destinationHash}`);
    }
    return { ...report, applied: true, verified: true, destinationCount: destinationRows.length, destinationSha256: destinationHash };
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const options = { sourcePath: "", apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.sourcePath = argv[++index] ?? "";
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.sourcePath) {
    process.stdout.write("Usage: node scripts/migrate-nebula-game-mixes-to-turso.mjs --source PATH [--apply]\\nDry-run by default. Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN only with --apply. Imports only nebula_game_mixes and refuses a non-empty target table.\\n");
    return;
  }
  const adapter = options.apply ? new TursoHttpAdapter({ url: process.env.NEBULA_ARCADE_TURSO_DATABASE_URL ?? "", authToken: process.env.NEBULA_ARCADE_TURSO_AUTH_TOKEN ?? "" }) : undefined;
  const result = await migrateNebulaGameMixTable({ sourcePath: options.sourcePath, adapter, apply: options.apply });
  process.stdout.write(JSON.stringify(result, null, 2) + "\\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`Nebula Game Mix import failed: ${error instanceof Error ? error.message : "unknown error"}\\n`); process.exitCode = 1; });
}
