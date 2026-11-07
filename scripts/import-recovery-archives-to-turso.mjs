#!/usr/bin/env node
/**
 * Encrypts private recovery ZIPs in memory and stores them as independently
 * authenticated chunks in the shared Turso database. Dry-run is the default.
 * No plaintext archive bytes or credentials are written to the workspace or logs.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";

const CHUNK_BYTES = 256 * 1024;
const TABLE = "apollo_recovery_archive_chunks_v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function keyBytes(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("SPMT_PROVIDER_CREDENTIAL_KEY is required");
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32) throw new Error("SPMT_PROVIDER_CREDENTIAL_KEY must decode to exactly 32 bytes");
  return key;
}
function parseArgs(argv) {
  const files = [];
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") files.push(resolve(argv[++i] ?? ""));
    else if (argv[i] === "--apply") apply = true;
    else throw new Error("Usage: node scripts/import-recovery-archives-to-turso.mjs --file FILE.zip [--file FILE.zip] [--apply]");
  }
  if (!files.length) throw new Error("At least one --file is required");
  return { files, apply };
}
function encryptChunk(key, archiveName, archiveHash, index, bytes) {
  const nonce = randomBytes(12);
  const aad = Buffer.from(`${archiveName}\0${archiveHash}\0${index}`);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const archives = [];
  for (const file of options.files) {
    const info = await stat(file);
    if (!info.isFile() || info.size < 1) throw new Error("Recovery archive is missing or empty");
    if (!basename(file).toLowerCase().endsWith(".zip")) throw new Error("Only ZIP recovery bundles are accepted");
    const bytes = await readFile(file);
    const archiveHash = sha256(bytes);
    archives.push({ file, name: basename(file), bytes, archiveHash, chunks: Math.ceil(bytes.length / CHUNK_BYTES) });
  }
  const summary = archives.map(({ name, bytes, archiveHash, chunks }) => ({ name, bytes: bytes.length, sha256: archiveHash, chunks }));
  if (!options.apply) {
    process.stdout.write(JSON.stringify({ mode: "dry-run", archives: summary, encryptedAtRest: true }) + "\n");
    return;
  }
  const key = keyBytes(process.env.SPMT_PROVIDER_CREDENTIAL_KEY);
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
  const db = new TursoHttpAdapter({ url, authToken });
  await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    archive_name TEXT NOT NULL,
    archive_sha256 TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    archive_bytes INTEGER NOT NULL,
    nonce_b64 TEXT NOT NULL,
    ciphertext_b64 TEXT NOT NULL,
    auth_tag_b64 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (archive_name, archive_sha256, chunk_index)
  ) STRICT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}_hash ON ${TABLE}(archive_sha256)`);
  let inserted = 0, alreadyPresent = 0;
  for (const archive of archives) {
    const existing = await db.execute(
      `SELECT COUNT(*) AS count FROM ${TABLE} WHERE archive_name=? AND archive_sha256=?`,
      [archive.name, archive.archiveHash], true
    );
    if (Number(existing.rows[0]?.[0] ?? 0) === archive.chunks) {
      alreadyPresent += 1;
      continue;
    }
    const createdAt = new Date().toISOString();
    for (let start = 0; start < archive.chunks; start += 8) {
      const statements = [];
      for (let index = start; index < Math.min(start + 8, archive.chunks); index += 1) {
        const chunk = archive.bytes.subarray(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, archive.bytes.length));
        const sealed = encryptChunk(key, archive.name, archive.archiveHash, index, chunk);
        statements.push({
          sql: `INSERT INTO ${TABLE}(archive_name,archive_sha256,chunk_index,chunk_count,archive_bytes,nonce_b64,ciphertext_b64,auth_tag_b64,created_at)
            VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(archive_name,archive_sha256,chunk_index) DO NOTHING`,
          args: [archive.name, archive.archiveHash, index, archive.chunks, archive.bytes.length, sealed.nonce, sealed.ciphertext, sealed.authTag, createdAt],
        });
      }
      await db.pipeline(statements);
      inserted += statements.length;
    }
  }
  const verified = [];
  for (const archive of archives) {
    const result = await db.execute(
      `SELECT COUNT(*) AS count, MIN(chunk_index) AS first_chunk, MAX(chunk_index) AS last_chunk
       FROM ${TABLE} WHERE archive_name=? AND archive_sha256=?`,
      [archive.name, archive.archiveHash], true
    );
    const row = result.rows[0] ?? [];
    const count = Number(row[0] ?? 0);
    if (count !== archive.chunks || Number(row[1]) !== 0 || Number(row[2]) !== archive.chunks - 1) {
      throw new Error("Turso read-back verification failed for an archive");
    }
    verified.push({ name: archive.name, chunks: count, sha256: archive.archiveHash, verified: true });
  }
  process.stdout.write(JSON.stringify({ mode: "applied", insertedChunks: inserted, alreadyPresentArchives: alreadyPresent, verified }) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write("Encrypted recovery archive import failed: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
