# SQLite to Turso migration

ApolloStation's existing runtime stores use Node's synchronous `DatabaseSync` API. This importer is a deliberately separate, one-way data-transfer adapter; it does **not** pretend that a remote asynchronous Turso connection can replace `DatabaseSync` at runtime.

## Requirements

- Node.js with built-in `node:sqlite` support (the same runtime ApolloStation uses).
- A Turso Cloud database created in advance.
- A database auth token stored only in the shell environment or deployment secret manager. Never commit it or paste it into chat.

## Configure the destination

Set these variables in the shell that runs the migration:

```bash
export TURSO_DATABASE_URL='libsql://YOUR-DATABASE-YOUR-ORG.turso.io'
export TURSO_AUTH_TOKEN='(set this securely; do not commit it)'
```

## Inventory first (read-only)

```bash
node scripts/migrate-sqlite-to-turso.mjs --source /absolute/path/to/source.sqlite
```

This checks the source with `PRAGMA quick_check`, inventories its tables/row counts, and confirms the destination is empty. It does not write to either database.

## Copy and verify

Stop the service that owns the source database first so the source cannot change during the copy. Keep an independent file backup. Then:

```bash
node scripts/migrate-sqlite-to-turso.mjs --source /absolute/path/to/source.sqlite --apply
```

The importer refuses a non-empty destination, never deletes or changes the source, copies table definitions and rows (including BLOB values and 64-bit integers), preserves `AUTOINCREMENT` sequence high-water marks and `user_version`, recreates indexes/views/triggers after data load, and verifies every table's row count plus `PRAGMA foreign_key_check`. It stops on the first SQL or verification error. Use one empty Turso database per independently owned SQLite file.

## Runtime integration status

This importer transfers data; it is not the production runtime adapter. Apollo's current domain stores call synchronous methods and use nested synchronous transactions. Turso's remote API is asynchronous. Do not point existing `*_DATABASE_PATH` settings at a Turso URL or switch production services to remote storage until those store contracts have been refactored and tested. The next runtime phase is an async persistence interface with local SQLite and Turso implementations, migrated service-by-service behind feature flags.
