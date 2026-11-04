#!/usr/bin/env node
/**
 * Stage recovered Nebula legacy and StreamWeaver JSON into a dedicated Turso
 * raw-source table. This deliberately does not write Apollo domain tables.
 *
 * Expected extracted roots:
 *   --legacy-nebula-root <directory containing legacy Nebula app-state.json>
 *   --streamweaver-root <directory containing data/runtime/...>
 *
 * Dry-run is the default. --apply is resumable: identical source/path/hash
 * records are accepted, conflicting records are rejected, never overwritten.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep, join } from "node:path";
import { pathToFileURL } from "node:url";
import { TursoHttpAdapter } from "./migrate-sqlite-to-turso.mjs";

const TABLE = "apollo_recovered_json_stage_v1";
const BATCH_SIZE = 20;
const SENSITIVE_KEY = /(?:^|_)(?:access_?tokens?|refresh_?tokens?|id_?tokens?|tokens?|api_?keys?|client_?secrets?|secrets?|passwords?|authorization|webhooks?|private_?keys?|credentials?)(?:_|$)/i;
const SENSITIVE_PATH = /(^|\/)(?:tokens?|secrets?|credentials?|webhooks?|vault)(?:\/|\.|$)/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function recordMetadata(value) {
  if (Array.isArray(value)) return { schemaVersion: null, recordCounts: { $root: value.length } };
  if (!value || typeof value !== "object") return { schemaVersion: null, recordCounts: {} };
  const version = value.schemaVersion ?? value.version ?? null;
  const recordCounts = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) recordCounts[key] = child.length;
    else if (child && typeof child === "object") recordCounts[key] = Object.keys(child).length;
  }
  return { schemaVersion: version === null ? null : String(version), recordCounts };
}

function isSensitiveKey(key) {
  const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_KEY.test(normalized);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[REDACTED]" : redact(child);
  }
  return output;
}

async function walkJson(root) {
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        const path = relative(root, absolute).split(sep).join("/");
        if (!SENSITIVE_PATH.test(path)) found.push({ absolute, path });
      }
    }
  }
  await visit(root);
  return found;
}

function tenantFor(source, path) {
  const parts = path.split("/");
  if (source === "nebula-legacy-global") return "legacy-global";
  const runtimeTenant = parts.findIndex((part, index) => part === "tenants" && parts[index - 1] === "runtime");
  if (runtimeTenant >= 0 && parts[runtimeTenant + 1]) return parts[runtimeTenant + 1];
  const appTenant = parts.findIndex((part, index) => part === "tenants" && parts[index - 1] === "data");
  if (appTenant >= 0 && parts[appTenant + 1]) return parts[appTenant + 1];
  return "__global__";
}

async function collect(source, root) {
  const files = await walkJson(root);
  const records = [];
  for (const file of files) {
    const raw = await readFile(file.absolute);
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new Error(`Invalid JSON in ${source}/${file.path}; refusing partial staging`);
    }
    const payload = JSON.stringify(redact(parsed));
    const metadata = recordMetadata(parsed);
    records.push({
      source,
      tenant: tenantFor(source, file.path),
      path: file.path,
      sourceHash: sha256(raw),
      payloadHash: sha256(payload),
      schemaVersion: metadata.schemaVersion,
      recordCounts: metadata.recordCounts,
      payload,
    });
  }
  return records;
}

export async function buildRecoveredJsonManifest({ legacyNebulaRoot, streamWeaverRoot }) {
  const records = [];
  if (legacyNebulaRoot) records.push(...await collect("nebula-legacy-global", resolve(legacyNebulaRoot)));
  if (streamWeaverRoot) records.push(...await collect("streamweaver", resolve(streamWeaverRoot)));
  if (!records.length) throw new Error("Provide at least one extracted source root");
  const keys = new Set();
  for (const record of records) {
    const key = `${record.source}\0${record.tenant}\0${record.path}`;
    if (keys.has(key)) throw new Error(`Duplicate source path in manifest: ${record.source}/${record.path}`);
    keys.add(key);
  }
  return records;
}

export async function stageRecoveredJson({ records, adapter, apply = false, onProgress = () => {} }) {
  const bySource = {};
  for (const record of records) bySource[record.source] = (bySource[record.source] ?? 0) + 1;
  const tenants = [...new Set(records.filter((r) => r.source === "streamweaver").map((r) => r.tenant))].sort();
  const summary = {
    files: records.length,
    bySource,
    streamWeaverTenants: tenants.length,
    redactedRecords: records.filter((r) => r.payload.includes("[REDACTED]")).length,
    schemaVersionedFiles: records.filter((r) => r.schemaVersion !== null && r.schemaVersion !== undefined).length,
  };
  if (!apply) return { ...summary, applied: false };

  await adapter.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    source TEXT NOT NULL,
    tenant_key TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    source_schema_version TEXT,
    record_counts_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    staged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source, tenant_key, source_path)
  ) STRICT`);

  const existingResult = await adapter.execute(
    `SELECT source, tenant_key, source_path, source_sha256, payload_sha256, source_schema_version, record_counts_json FROM ${TABLE}`,
    [], true,
  );
  const existing = new Map(existingResult.rows.map((row) => [
    `${row[0]}\\0${row[1]}\\0${row[2]}`,
    { sourceHash: row[3], payloadHash: row[4], schemaVersion: row[5], recordCountsJson: row[6] },
  ]));
  const pending = [];
  for (const record of records) {
    const key = `${record.source}\\0${record.tenant}\\0${record.path}`;
    const prior = existing.get(key);
    const schemaVersion = record.schemaVersion ?? null;
    const recordCountsJson = JSON.stringify(record.recordCounts ?? {});
    if (prior) {
      if (prior.sourceHash !== record.sourceHash || prior.payloadHash !== record.payloadHash ||
          prior.schemaVersion !== schemaVersion || prior.recordCountsJson !== recordCountsJson) {
        throw new Error(`Conflicting staged source already exists: ${record.source}/${record.path}; refusing overwrite`);
      }
      continue;
    }
    pending.push({ ...record, schemaVersion, recordCountsJson });
  }
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    await insertBatch(adapter, pending.slice(offset, offset + BATCH_SIZE));
    onProgress({ phase: "stage", staged: Math.min(offset + BATCH_SIZE, pending.length), total: pending.length });
  }
  const destinationCounts = {};
  for (const source of Object.keys(bySource)) {
    const verification = await adapter.execute(
      `SELECT tenant_key, source_path, source_sha256, payload_sha256, source_schema_version, record_counts_json FROM ${TABLE} WHERE source=?`,
      [source], true,
    );
    const verifiedRows = new Map(verification.rows.map((row) => [
      `${row[0]}\\0${row[1]}`,
      { sourceHash: row[2], payloadHash: row[3], schemaVersion: row[4], recordCountsJson: row[5] },
    ]));
    for (const record of records.filter((item) => item.source === source)) {
      const stored = verifiedRows.get(`${record.tenant}\\0${record.path}`);
      const schemaVersion = record.schemaVersion ?? null;
      const recordCountsJson = JSON.stringify(record.recordCounts ?? {});
      if (!stored || stored.sourceHash !== record.sourceHash || stored.payloadHash !== record.payloadHash ||
          stored.schemaVersion !== schemaVersion || stored.recordCountsJson !== recordCountsJson) {
        throw new Error(`Destination verification failed for ${source}/${record.path}`);
      }
    }
    destinationCounts[source] = verification.rows.length;
  }
  return { ...summary, applied: true, verified: true, destinationCounts };
}

async function insertBatch(adapter, records) {
  const statements = records.map((record) => ({
    sql: `INSERT INTO ${TABLE}(source,tenant_key,source_path,source_sha256,payload_sha256,source_schema_version,record_counts_json,payload_json)
          VALUES(?,?,?,?,?,?,?,?)`,
    args: [record.source, record.tenant, record.path, record.sourceHash, record.payloadHash, record.schemaVersion ?? null, record.recordCountsJson ?? JSON.stringify(record.recordCounts ?? {}), record.payload],
  }));
  await adapter.pipeline(statements);
}

function parseArgs(argv) {
  const options = { apply: false, legacyNebulaRoot: "", streamWeaverRoot: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--legacy-nebula-root" || arg === "--chat-tag-root") options.legacyNebulaRoot = argv[++i] ?? "";
    else if (arg === "--streamweaver-root") options.streamWeaverRoot = argv[++i] ?? "";
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.legacyNebulaRoot && !options.streamWeaverRoot)) {
    process.stdout.write("Usage: node scripts/stage-recovered-json-to-turso.mjs [--chat-tag-root DIR] (alias: --legacy-nebula-root) [--streamweaver-root DIR] [--apply]\nDry-run by default. Stages redacted JSON source documents in a dedicated raw table; it does not normalize or assign records to Apollo domain tables.\n");
    return;
  }
  const records = await buildRecoveredJsonManifest(options);
  const adapter = options.apply ? new TursoHttpAdapter({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  }) : undefined;
  const result = await stageRecoveredJson({
    records, adapter, apply: options.apply,
    onProgress: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write("Recovered JSON staging failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
