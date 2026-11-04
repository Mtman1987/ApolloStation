# Turso persistence and migration

ApolloStation will use the user's Turso account as its persistent database destination. There are three distinct deliverables. All three are required before declaring the hostless release persistence-ready.

## Part 1 — Recovered-data migration adapter

The migration adapter transfers existing recovered application data into Turso without changing the source archives.

Current implementation:
- `packages/turso-http/` provides a reusable async Hrana HTTP client for Turso Cloud, including interactive transaction streams that retain a single baton across sequential requests and roll back on callback/statement failures. The SQLite importer uses this shared client.
- SQLite sources are opened read-only and checked with `PRAGMA quick_check`.
- The destination must be empty; the importer refuses to overwrite an existing database.
- Schema, rows, BLOBs, 64-bit integers, AUTOINCREMENT high-water marks, and `user_version` are copied and verified.
- The importer is dry-run by default. `--apply` is an explicit write operation.
- Credentials are read only from secure environment variables. Never commit or paste tokens into source, issues, logs, or chat.

This SQLite importer is not sufficient for every recovered source. Chat Tag/Nebula is JSON state and needs a format-aware importer. StreamWeaver is a tenant-scoped JSON tree and must be staged/imported per tenant without flattening. Discord Stream Hub's SQLite database and Firestore export must remain separate until authority and overlap are reconciled.

Migration order remains:
1. Chat Tag/Nebula and StreamWeaver.
2. Discord Stream Hub.
3. OverlayBay/SpaceMountain and Lounge.
4. HearMeOut last.

The legacy Chat Tag snapshot is shared/global. Do not split it by last-seen stream/channel. Resolve its ownership and Apollo tenant mapping explicitly before applying tenant-scoped records. StreamWeaver tenant directories must remain separate.

## Part 2 — Apollo runtime persistence adapter

This is the production read/write layer Apollo uses after release. It is separate from the one-time importer.

Apollo currently has synchronous `DatabaseSync` call sites and nested synchronous transaction patterns. A remote Turso connection is asynchronous; changing a database URL or swapping a connection object is not a valid integration.

Required work:
- Define an asynchronous persistence contract for reads, writes, transactions, and health checks.
- Implement and test a local SQLite backend and a Turso backend against the same contract.
- Migrate domain stores and their callers service-by-service; do not block the event loop or hide asynchronous calls behind synchronous-looking wrappers.
- Preserve transaction boundaries, uniqueness constraints, concurrency behavior, and existing domain invariants.
- Add idempotency and retry handling for operations that may be retried over a network.
- Keep migrations/versioning explicit and test schema upgrades.
- Add parity tests that run the same store contract suite against both backends.
- Add health/readiness checks that distinguish a reachable database from a fully usable persistence layer.
- Keep local development/test support while making Turso the configured production backend.

No production service should be switched to Turso until its store and callers have been migrated and its parity tests pass. Track this work in ApolloStation issue #414.

## Part 3 — Hostless deployment connection and release verification

The hostless Apollo deployment must connect to the same Turso database/account for ongoing application data. The deployment platform is responsible for injecting secrets; the application must never contain credentials.

Required deployment configuration:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Set these in the hostless site's protected environment/secret settings, not in committed files, client-side bundles, build logs, or public configuration. The server runtime alone may access the token.

Release verification:
1. Confirm the hostless server runtime has both settings without printing their values.
2. Run a non-destructive connectivity/readiness check.
3. Confirm Apollo can read known migrated records with the expected tenant scope.
4. Create a clearly identified test record through Apollo's normal application path.
5. Read it back through a fresh request/process and verify it persisted in Turso.
6. Verify tenant isolation and transaction behavior.
7. Restart/redeploy the hostless app and verify the record still exists.
8. Check logs for connection errors, retry storms, leaked secrets, and fallback-to-local behavior.
9. Only then enable Turso-backed writes for the migrated production features.

A successful one-time import does not prove the hostless runtime can save new data. A successful connection check does not prove tenant-safe reads/writes. Both must be tested.

## Safety gates

- Preserve original recovery ZIPs and nested source archives unchanged.
- Keep source hashes, import manifests, record counts, and verification receipts.
- Never overwrite a non-empty destination. Use a separate database or explicit namespace for each independent dataset where required.
- Do not import ambiguous ownership data into live tenant stores.
- Do not put credentials in GitHub source, workflow output, issue text, or chat.
- Do not change or deploy anything through Fly.io.
- Do not claim migration or runtime cutover complete until destination verification and hostless read/write/restart checks pass.

## Current status

| Part | Status |
|---|---|
| 1. SQLite migration adapter | Implemented on PR #413; focused adapter CI is being revalidated after extracting the shared client. Live Turso transfer not run. |
| 1. Chat Tag JSON + StreamWeaver tenant import | Redacted, tenant-preserving raw staging utility implemented; source-to-domain reconciliation and live import remain outstanding. |
| 2. Apollo async runtime persistence contract | Shared async Turso client plus a tenant-scoped JSON record-store prototype with local SQLite parity are implemented; production domain-store/caller migrations remain outstanding. |
| 3. Hostless Turso connection and release verification | Not configured or tested yet. |

The current work is preparation and safe tooling. No Turso destination has been written and no production runtime has been switched.


## First async runtime store slice

`packages/turso-http/` is the reusable asynchronous Turso client. Interactive transactions keep one Hrana stream baton and execute sequentially; statement/callback failures trigger rollback attempts. Ambiguous network failures are surfaced and are never automatically replayed.

`packages/async-json-store/` adds the first small async repository contract:
- Tenant-scoped keys are isolated by namespace, tenant ID and record key.
- The same async API has a local SQLite reference backend and a Turso backend.
- Reads, upserts, deletes, ordered listing, health checks and transaction callbacks are covered by shared contract tests.
- SQLite transactions are serialized locally; Turso transactions use the adapter's interactive transaction stream.

This is a low-risk persistence prototype, **not yet wired into SPMT authority, Nebula gameplay, StreamWeaver, Chat Gateway or Discord Stream Hub**. It proves the async store boundary and transaction primitive; it does not make existing synchronous `DatabaseSync` stores remote-compatible. The next step is to select and migrate one real low-risk domain store, then proceed service-by-service with caller and tenant-isolation tests.

## Recovered Chat Tag and StreamWeaver JSON staging

The separate JSON staging utility is `scripts/stage-recovered-json-to-turso.mjs`, exposed as `npm run db:stage-recovered-json:turso`.

It accepts already-extracted source roots:
- Chat Tag root: directory containing the recovered `data/app-state.json`.
- StreamWeaver root: directory containing the recovered `data/runtime/...` tree.

Example dry-run:
```sh
node scripts/stage-recovered-json-to-turso.mjs \
  --chat-tag-root /path/to/chat-tag-extracted \
  --streamweaver-root /path/to/streamweaver-extracted
```

With secure server-side environment variables present, `--apply` stages documents in the dedicated `apollo_recovered_json_stage_v1` table. It is not an Apollo domain import:
- Chat Tag records use the single `legacy-global` scope.
- StreamWeaver records under `data/runtime/tenants/<tenant>/...` retain that tenant key; `data/tenants/<tenant>/...` is also recognized.
- Other StreamWeaver JSON is staged under `__global__`.
- Token/secret/credential path segments are excluded; sensitive JSON keys are redacted before payload staging.
- Source and redacted-payload SHA-256 hashes are stored separately.
- The raw-stage row also stores a detected top-level schema/version marker (when present) and shallow record counts for top-level arrays/object maps.
- After inserts, the importer reads back every requested source/tenant/path and verifies both hashes plus schema/count metadata before returning `verified: true`.
- Re-running identical input is idempotent. A changed source at an existing source/path key is rejected, never overwritten.
- The raw stage preserves source documents for later mapping; it does not create players, points, tenant accounts, or live StreamWeaver domain rows.

The importer currently reads an extracted directory tree, not ZIP/TAR archives directly. Extract to a separate working directory; keep the original recovery ZIPs and nested archives unchanged. Review the dry-run counts and redaction report before applying. Tenant identity reconciliation and domain conversion remain separate gates.
