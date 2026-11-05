#!/usr/bin/env node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";

const RECORDS = "social-reactions";
const TENANTS = "social-reaction-tenants";
const MIGRATIONS = "social-reaction-migrations";

export function readStreamWeaverSocialReactionSnapshot(db) {
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new Error("Source SQLite integrity_check failed");
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const rows = tables.has("streamweaver_social_reactions")
    ? db.prepare("SELECT tenant_id,delivery_id,trigger,actor,target,animation_key,job_id,reaction,state,attempts,created_at FROM streamweaver_social_reactions ORDER BY tenant_id,rowid").all()
    : [];
  const reactions = rows.map((row) => ({
    tenantId: String(row.tenant_id),
    key: String(row.delivery_id),
    value: {
      tenantId: String(row.tenant_id), deliveryId: String(row.delivery_id), trigger: String(row.trigger),
      actor: String(row.actor), target: String(row.target), animationKey: String(row.animation_key),
      ...(row.job_id === null ? {} : { jobId: String(row.job_id) }),
      ...(row.reaction === null ? {} : { reaction: String(row.reaction) }),
      state: String(row.state), attempts: Number(row.attempts), createdAt: String(row.created_at),
    },
  }));
  const tenants = [...new Set(reactions.map((row) => row.tenantId))].sort();
  const snapshot = { reactions, tenants };
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { ...snapshot, counts: { reactions: reactions.length, tenants: tenants.length }, digest };
}

export async function importStreamWeaverSocialReactionSnapshot(store, snapshot, migrationId) {
  return store.transaction(async (tx) => {
    const prior = await tx.get(MIGRATIONS, "_index", migrationId);
    if (prior) {
      if (prior.digest !== snapshot.digest) throw new Error("Migration ID already exists with a different social-reaction source digest");
      return { imported: false, duplicate: true, counts: snapshot.counts, digest: snapshot.digest };
    }
    if ((await tx.list(TENANTS, "_index")).length) throw new Error("Turso social-reaction tenant index is not empty");
    if ((await tx.list(MIGRATIONS, "_index")).length) throw new Error("Turso social-reaction migration receipts are not empty");
    for (const tenantId of snapshot.tenants) {
      if ((await tx.list(RECORDS, tenantId)).length) throw new Error(`Turso destination is not empty for social reactions / ${tenantId}`);
    }
    for (const tenantId of snapshot.tenants) await tx.put(TENANTS, "_index", tenantId, { tenantId });
    for (const row of snapshot.reactions) await tx.put(RECORDS, row.tenantId, row.key, row.value);
    const verified = {};
    for (const tenantId of snapshot.tenants) {
      const expected = snapshot.reactions.filter((row) => row.tenantId === tenantId).length;
      const actual = (await tx.list(RECORDS, tenantId)).length;
      if (actual !== expected) throw new Error(`Turso import verification failed for social reactions / ${tenantId}: expected ${expected}, received ${actual}`);
      verified[tenantId] = actual;
    }
    await tx.put(MIGRATIONS, "_index", migrationId, { digest: snapshot.digest, counts: snapshot.counts, importedAt: new Date().toISOString() });
    return { imported: true, duplicate: false, verified, digest: snapshot.digest };
  });
}

function parseArgs(argv) {
  const result = { source: "", apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") result.source = argv[++i] ?? "";
    else if (argv[i] === "--apply") result.apply = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!result.source) throw new Error("Use --source /absolute/path/to/streamweaver.sqlite");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2)), source = resolve(args.source);
  const db = new DatabaseSync(source, { readOnly: true });
  let snapshot;
  try { snapshot = readStreamWeaverSocialReactionSnapshot(db); } finally { db.close(); }
  const report = { source, mode: args.apply ? "apply" : "dry-run", counts: snapshot.counts, digest: snapshot.digest };
  if (args.apply) {
    const url = process.env.STREAMWEAVER_TURSO_DATABASE_URL, authToken = process.env.STREAMWEAVER_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Apply requires STREAMWEAVER_TURSO_DATABASE_URL and STREAMWEAVER_TURSO_AUTH_TOKEN");
    const store = createAsyncJsonRecordStore({ service: "streamweaver", mode: "turso", url, authToken });
    try { await store.initialize(); report.result = await importStreamWeaverSocialReactionSnapshot(store, snapshot, `sqlite-social-reactions-v1:${snapshot.digest}`); } finally { await store.close(); }
  } else report.nextStep = "Review counts and digest; rerun with --apply only against the intended empty StreamWeaver Turso namespaces.";
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) main().catch((error) => { process.stderr.write(`StreamWeaver social-reaction migration failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
