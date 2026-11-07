#!/usr/bin/env node
/**
 * Imports a pre-redacted, hash-verified JSONL.gz recovery manifest into the
 * dedicated raw-source staging table. This never writes Apollo domain tables.
 * Dry-run is the default; --apply is idempotent and rejects conflicting rows.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TursoHttpAdapter } from "./migrate-sqlite-to-turso.mjs";
import { stageRecoveredJson } from "./stage-recovered-json-to-turso.mjs";

export const EXPECTED_RECOVERY_COUNTS = Object.freeze({
  "nebula-legacy-global": 16,
  streamweaver: 5732,
});

const SENSITIVE_KEY = /(?:^|_)(?:access_?tokens?|refresh_?tokens?|id_?tokens?|tokens?|api_?keys?|client_?secrets?|secrets?|passwords?|authorization|webhooks?|private_?keys?|credentials?)(?:_|$)/i;
const SENSITIVE_PATH = /(^|\/)(?:tokens?|secrets?|credentials?|webhooks?|vault)(?:\/|\.|$)/i;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function isSensitiveKey(key) {
  const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_KEY.test(normalized);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = isSensitiveKey(key) ? "[REDACTED]" : redact(child);
  return output;
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

export function validateRecoveredJsonManifestRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest record must be an object");
  const { source, tenant, path, sourceHash, payloadHash, schemaVersion, recordCounts, payload } = value;
  if (!Object.hasOwn(EXPECTED_RECOVERY_COUNTS, source)) throw new Error("Manifest contains an unsupported source");
  if (typeof tenant !== "string" || !tenant || typeof path !== "string" || !path || path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..") || !path.toLowerCase().endsWith(".json") ||
      SENSITIVE_PATH.test(path)) throw new Error("Manifest contains an unsafe source path");
  if (tenant !== tenantFor(source, path)) throw new Error("Manifest tenant scope does not match its source path");
  if (!/^[a-f0-9]{64}$/i.test(sourceHash) || !/^[a-f0-9]{64}$/i.test(payloadHash)) throw new Error("Manifest source or payload hash is invalid");
  if (schemaVersion !== null && typeof schemaVersion !== "string") throw new Error("Manifest schemaVersion must be a string or null");
  if (!recordCounts || typeof recordCounts !== "object" || Array.isArray(recordCounts)) throw new Error("Manifest recordCounts must be an object");
  if (typeof payload !== "string") throw new Error("Manifest payload must be a serialized JSON string");
  let parsed;
  try { parsed = JSON.parse(payload); } catch { throw new Error("Manifest payload is not valid JSON"); }
  if (sha256(payload) !== payloadHash) throw new Error("Manifest payload hash mismatch");
  if (JSON.stringify(redact(parsed)) !== payload) throw new Error("Manifest payload contains unredacted sensitive fields or non-canonical JSON");
  const metadata = recordMetadata(parsed);
  if (metadata.schemaVersion !== schemaVersion || JSON.stringify(metadata.recordCounts) !== JSON.stringify(recordCounts)) {
    throw new Error("Manifest metadata does not match its payload");
  }
  return { source, tenant, path, sourceHash, payloadHash, schemaVersion, recordCounts, payload };
}

export async function readRecoveredJsonManifest(manifestPath, options = {}) {
  const expected = options.expectedBySource ?? EXPECTED_RECOVERY_COUNTS;
  const records = [];
  const keys = new Set();
  const bySource = {};
  const stream = createReadStream(resolve(manifestPath)).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); } catch { throw new Error("Manifest contains an invalid JSONL line"); }
    const record = validateRecoveredJsonManifestRecord(value);
    const key = record.source + "\0" + record.tenant + "\0" + record.path;
    if (keys.has(key)) throw new Error("Manifest contains a duplicate source path");
    keys.add(key);
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    records.push(record);
  }
  for (const [source, count] of Object.entries(expected)) {
    if (bySource[source] !== count) throw new Error("Manifest source count mismatch for " + source);
  }
  if (Object.keys(bySource).length !== Object.keys(expected).length) throw new Error("Manifest contains unexpected source groups");
  const payloadBytes = records.reduce((sum, record) => sum + Buffer.byteLength(record.payload), 0);
  return { records, bySource, payloadBytes, tenants: new Set(records.filter((r) => r.source === "streamweaver").map((r) => r.tenant)).size };
}

function parseArgs(argv) {
  const options = { manifest: "", apply: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") options.manifest = argv[++i] ?? "";
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.manifest) {
    process.stdout.write("Usage: node scripts/import-recovered-json-manifest-to-turso.mjs --manifest FILE.jsonl.gz [--apply]\nDry-run is the default. --apply stages exactly 5,748 pre-redacted source documents into the raw recovery table; no Apollo domain tables are changed.\n");
    return;
  }
  const manifest = await readRecoveredJsonManifest(options.manifest);
  const summary = {
    files: manifest.records.length,
    bySource: manifest.bySource,
    streamWeaverTenants: manifest.tenants,
    payloadBytes: manifest.payloadBytes,
    verifiedPayloadHashes: true,
  };
  if (!options.apply) {
    process.stdout.write(JSON.stringify({ ...summary, applied: false }, null, 2) + "\n");
    return;
  }
  const url = process.env.TURSO_DATABASE_URL ?? "";
  const authToken = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!url.trim() || !authToken.trim()) throw new Error("Apply requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN");
  const adapter = new TursoHttpAdapter({ url, authToken });
  const result = await stageRecoveredJson({
    records: manifest.records,
    adapter,
    apply: true,
    onProgress: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
  });
  process.stdout.write(JSON.stringify({ ...summary, ...result, applied: true }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write("Recovered JSON manifest import failed: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
