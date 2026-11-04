#!/usr/bin/env node
/**
 * Non-destructive SQLite -> Turso Cloud importer.
 *
 * This is a data-transfer adapter, not a synchronous DatabaseSync replacement.
 * It reads a closed/stable SQLite source and writes to an EMPTY Turso database.
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BATCH_SIZE = 40;

export function encodeHranaValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SQLite source contains a non-finite number");
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array) return { type: "blob", base64: Buffer.from(value).toString("base64") };
  throw new Error(`Unsupported SQLite value type: ${typeof value}`);
}

function decodeHranaValue(value) {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") return Number(value.value);
  if (value.type === "float") return value.value;
  if (value.type === "text") return value.value;
  if (value.type === "blob") return Buffer.from(value.base64, "base64");
  throw new Error(`Unsupported Turso result type: ${value.type}`);
}

export function normalizeTursoUrl(value) {
  const url = new URL(value.startsWith("libsql://") ? value.replace(/^libsql:/, "https:") : value);
  if (url.protocol !== "https:") throw new Error("Turso database URL must use libsql:// or https://");
  url.pathname = "/v2/pipeline";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export class TursoHttpAdapter {
  constructor({ url, authToken, fetchImpl = fetch }) {
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
    this.endpoint = normalizeTursoUrl(url);
    this.authToken = authToken;
    this.fetchImpl = fetchImpl;
  }

  async pipeline(statements) {
    if (!statements.length) return [];
    const requests = statements.map(({ sql, args = [], wantRows = false }) => ({
      type: "execute",
      stmt: { sql, args: args.map(encodeHranaValue), want_rows: wantRows },
    }));
    requests.push({ type: "close" });
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ baton: null, requests }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Turso HTTP ${response.status}: ${detail}`);
    }
    const payload = await response.json();
    const results = payload.results ?? [];
    const statementResults = results.slice(0, statements.length);
    const failed = statementResults.find((item) => item.type !== "ok");
    if (failed) throw new Error(`Turso SQL error: ${failed.error?.message ?? "unknown error"}`);
    return statementResults.map((item) => {
      const result = item.response?.result;
      return {
        rows: (result?.rows ?? []).map((row) => row.map(decodeHranaValue)),
        affectedRows: Number(result?.affected_row_count ?? 0),
      };
    });
  }

  async execute(sql, args = [], wantRows = false) {
    return (await this.pipeline([{ sql, args, wantRows }]))[0];
  }
}

function quoteIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

function getSourceInventory(db) {
  const objects = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name
  `).all();
  const tables = objects.filter((item) => item.type === "table");
  const unsupported = tables.filter((item) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(item.sql));
  if (unsupported.length) throw new Error("Virtual tables need a dedicated export path: " + unsupported.map((item) => item.name).join(", "));
  const tableInfo = new Map();
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(table.name)})`).all();
    if (columns.some((column) => Number(column.hidden) === 1)) {
      throw new Error(`Table ${table.name} contains hidden virtual-table columns and cannot be copied generically`);
    }
    tableInfo.set(table.name, columns.filter((column) => Number(column.hidden) === 0).map((column) => column.name));
  }
  return { objects, tables, tableInfo };
}

export async function migrateSqliteFile({ sourcePath, adapter, apply = false, onProgress = () => {} }) {
  if (!sourcePath) throw new Error("A source SQLite path is required");
  const db = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || integrity[0].quick_check !== "ok") {
      throw new Error("Source SQLite quick_check failed; refusing to migrate");
    }
    const { objects, tables, tableInfo } = getSourceInventory(db);
    const hasSequence = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get());
    const sequenceQuery = hasSequence ? db.prepare("SELECT name, seq FROM sqlite_sequence") : undefined;
    sequenceQuery?.setReadBigInts(true);
    const sequences = sequenceQuery ? sequenceQuery.all() : [];
    const sourceUserVersion = Number(db.prepare("PRAGMA user_version").get().user_version);
    const destination = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' LIMIT 1",
      [],
      true,
    );
    if (destination.rows.length) throw new Error("Turso destination is not empty; refusing to overwrite existing data");

    const counts = new Map();
    for (const table of tables) {
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).get().count);
      counts.set(table.name, count);
    }
    const report = { tables: tables.length, rows: [...counts.values()].reduce((sum, count) => sum + count, 0), perTable: Object.fromEntries(counts) };
    onProgress({ phase: "inventory", ...report });
    if (!apply) return { ...report, applied: false };

    for (const table of tables) {
      await adapter.execute(table.sql);
      onProgress({ phase: "schema", table: table.name });
    }

    for (const table of tables) {
      const columns = tableInfo.get(table.name);
      if (!columns.length) continue;
      const columnSql = columns.map(quoteIdentifier).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const select = db.prepare(`SELECT ${columnSql} FROM ${quoteIdentifier(table.name)}`);
      select.setReadBigInts(true);
      let pending = [];
      for (const row of select.iterate()) {
        pending.push({
          sql: `INSERT INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES (${placeholders})`,
          args: columns.map((column) => row[column]),
        });
        if (pending.length >= BATCH_SIZE) {
          await adapter.pipeline(pending);
          pending = [];
        }
      }
      if (pending.length) await adapter.pipeline(pending);
      onProgress({ phase: "rows", table: table.name, expected: counts.get(table.name) });
    }

    // Preserve AUTOINCREMENT high-water marks, including values above the current max row id.
    for (const sequence of sequences) {
      const updated = await adapter.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", [sequence.seq, sequence.name]);
      if (updated.affectedRows === 0) await adapter.execute("INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)", [sequence.name, sequence.seq]);
    }
    await adapter.execute(`PRAGMA user_version = ${sourceUserVersion}`);

    // Recreate indexes, views and triggers only after all base rows have been loaded.
    const secondary = objects.filter((item) => item.type !== "table");
    for (const object of secondary) {
      await adapter.execute(object.sql);
      onProgress({ phase: object.type, name: object.name });
    }

    for (const [table, expected] of counts) {
      const actual = await adapter.execute(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`, [], true);
      const count = Number(actual.rows[0]?.[0] ?? -1);
      if (count !== expected) throw new Error(`Verification failed for ${table}: source=${expected}, destination=${count}`);
    }
    const fk = await adapter.execute("PRAGMA foreign_key_check", [], true);
    if (fk.rows.length) throw new Error(`Destination foreign_key_check failed with ${fk.rows.length} violation(s)`);
    return { ...report, applied: true, verified: true };
  } finally {
    db.close();
  }
}

function parseArgs(args) {
  const result = { apply: false, sourcePath: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--source") result.sourcePath = args[++index] ?? "";
    else if (arg === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.sourcePath) {
    process.stdout.write("Usage: node scripts/migrate-sqlite-to-turso.mjs --source ./path/to/source.sqlite [--apply]\n\nWithout --apply, performs a read-only inventory and validates that the Turso destination is empty. With --apply, copies schema and rows, then verifies row counts and foreign keys. The source is never modified.\n");
    return;
  }
  const adapter = new TursoHttpAdapter({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });
  const result = await migrateSqliteFile({
    sourcePath: options.sourcePath,
    adapter,
    apply: options.apply,
    onProgress: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write("Turso migration failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
