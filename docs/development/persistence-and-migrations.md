# Persistence audits and migration tools

This guide covers the repository's SQLite inventory, Turso/libSQL transfer utilities, recovered archive imports, and app-scoped migrations. These tools are operational utilities, not normal application startup code.

## 1. Persistence audit

Run:

    npm run persistence:audit

The audit scans the tracked Git commit and classifies SQLite references as runtime, test, evidence or tooling. It reports DatabaseSync, node:sqlite and database-path references with file/line provenance.

Important limits:

- It is a source-code inventory, not a live database census.
- It does not prove which adapter a deployed service is using.
- It does not prove data is durable across Hostless restart.
- The quarantine archive is classified as evidence, not runtime.
- Use the exact gitHead in the report when comparing before/after counts.

A decrease in file count is not automatically an improvement; a runtime reference may have moved into another package or a new adapter.

## 2. Generic SQLite-to-Turso importer

Script: scripts/migrate-sqlite-to-turso.mjs

The importer is a non-destructive data-transfer adapter. It reads a closed/stable SQLite source read-only and writes to an empty Turso database. It is not a synchronous DatabaseSync replacement and does not automatically rewire an app's runtime adapter.

Environment names:

- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN

The module exports migrateSqliteFile({ sourcePath, adapter, apply, onProgress }). Dry-run is the default when apply is false. It performs SQLite quick_check, inventories schema objects, rejects unsupported virtual tables/hidden columns, and uses bounded batches.

Do not run against a live writer. The source must be closed or snapshotted consistently and the destination must be empty. Preserve schema, index, trigger, sequence and row-count evidence.

## 3. SPMT owner-data import

Script: scripts/spmt-xp-to-turso.mjs

This tool imports the named SPMT export tables:

- xp_ledger
- users
- workspace_profiles
- user_settings
- app_state_records

It writes to corresponding spmt_* tables. Dry-run is the default; --apply enables writes. The script clears the spmt_* tables it owns before reloading, so --apply is destructive to those target tables.

Example shape:

    node scripts/spmt-xp-to-turso.mjs --source /path/to/export.db
    node scripts/spmt-xp-to-turso.mjs --source /path/to/export.db --apply

Environment names: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.

Before apply, verify the target database and table ownership, confirm the export source, record SHA256 and quick_check, compare expected row counts, and ensure no other writer owns the target tables. After apply, query target counts and reconcile against the export. Never paste tokens or raw export data into chat/logs.

## 4. Recovery archive import

Script: scripts/import-recovery-archives-to-turso.mjs

This tool reads ZIP recovery bundles, encrypts their bytes in memory using AES-256-GCM, and writes authenticated chunks to the configured Turso database. Dry-run is the default; --apply enables storage writes.

Environment names:

- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- SPMT_PROVIDER_CREDENTIAL_KEY (must decode to exactly 32 bytes)

Only ZIP bundles are accepted. The script records archive hash/chunk metadata and does not write plaintext archive bytes to the workspace or logs. Keep the original backup until encrypted target verification and restore are complete.

## 5. App-specific migrations

App-scoped migration scripts include:

- Nebula Tag state/command/outbox migration;
- Nebula game runtime, tabletop, action/activity and game-mix migrations;
- StreamWeaver BIC, generation, ride, social reaction and bot-action reply migrations;
- Discord Stream Hub Lounge, MT Fix It and raid-pile migrations;
- recovered JSON staging/import helpers.

These scripts have app-specific schema and adapter assumptions. Read the exact script before invocation; do not infer that all support the same flags, source paths, destination names or idempotency behavior.

Some importers depend on compiled app/package output. Build the repository first and run the focused migration tests before attempting a real source database.

## 6. Required migration procedure

1. **Name the owner:** identify the app/service that owns the data and the shared/app-private boundary.
2. **Identify the exact source:** path, database identity, schema version, tenant scope, last writer and current row counts.
3. **Freeze or snapshot:** stop writers or create a consistent verified snapshot.
4. **Backup:** create a separate backup and verify its SHA256 and SQLite quick_check.
5. **Inspect destination:** confirm account, database URL origin/region, emptiness or exact target-table ownership.
6. **Dry-run:** run the tool without --apply; inspect counts, schema and unsupported records.
7. **Review plan:** confirm the exact target tables/keys that will be created, cleared, or overwritten.
8. **Apply with approval:** use only the approved source/destination and scoped token.
9. **Reconcile:** compare counts, primary keys, hashes, schema, dedupe receipts and pending outbox/jobs.
10. **Restore test:** restore into an isolated destination and run the app's integrity checks.
11. **Restart test:** verify the deployed runtime reads/writes the intended adapter and survives restart.
12. **Cut over:** stop/fence the old writer, switch authority once, and retain rollback evidence.
13. **Retain backup:** do not delete the source/backup until the owner confirms recovery and reconciliation.

## 7. Runtime persistence caveat

The SPMT Service package currently declares SQLite-backed authority/platform-data adapters. The Hostless Node 1 launcher supplies DATABASE_PATH with a /tmp fallback when no explicit value is present. Turso migration utilities and an existing Turso database do not prove the production service is using a durable remote adapter.

Before calling persistence complete, verify the actual deployed adapter, effective path, remote URL, credentials, write/read path, restart behavior, backup and isolated restore. A /tmp database is ephemeral and must not be used as a silent production fallback.

## 8. Release gates

The following commands are useful preflight checks:

    npm run build
    npm run typecheck
    npm test
    npm run test:offline
    npm run persistence:audit
    npm run cutover:audit
    npm run release:audit

These are not interchangeable. Build/tests prove code behavior; audits prove source/config structure; only a verified deployed runtime and restore exercise prove operational persistence.

## 9. Stop conditions

Do not apply a migration if:

- the owner/source/destination is ambiguous;
- the source is still being written;
- the target is not empty when the tool requires empty;
- the tool clears tables that contain unexported data;
- counts/checksums do not reconcile;
- unsupported virtual tables or records are present;
- no verified backup/restore path exists;
- the runtime adapter is not wired to the intended target;
- two writers could update the same shared facts;
- credentials would be exposed in command arguments or logs.
