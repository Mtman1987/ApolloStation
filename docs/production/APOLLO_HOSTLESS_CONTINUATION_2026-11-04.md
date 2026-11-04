# ApolloStation Hostless continuation — 2026-11-04

Fetch current main first. Source reviewed for this increment starts at **521cc7b**; this is not a deployed revision.

## Hosting direction and existing work

The owner requested **three Hostless accounts operating as one ecosystem**. Main already contains the portability foundation at ad3d62f and the isolated Restream receiver at 521cc7b. Do not recreate those changes or use the old media snapshot as current architecture.

Read these source-derived plans before any runtime work:
- [Three-node topology](../deployment/HOSTLESS_THREE_NODE_PORT_PLAN.md)
- [Runtime and ownership inventory](../deployment/HOSTLESS_RUNTIME_SERVICE_INVENTORY.md)
- [External database strategy](../deployment/EXTERNAL_DATABASE_STRATEGY.md)
- [SQLite compatibility audit](../deployment/SQLITE_EXTERNAL_DATABASE_COMPATIBILITY_AUDIT.md)
- [Restream port](../hostless/RESTREAM_NODE3_PORT.md)

Keep the existing safe partition: **Node 1** canonical SPMT authority + SpaceMountain/OverlayBay; **Node 2** Chat Gateway + embedded StreamWeaver/Nebula provider runtimes and their co-located web/database owners; **Node 3** DSH web/worker and DSH-owned Lounge state. Do not split Nebula away from Chat Gateway's in-process consumer chain or share SQLite files across accounts. Each app retains its own identity and data ownership; Node 1 remains the canonical identity/role authority.

## Current increment — persistence inventory correctness

`scripts/audit-sqlite-usage.mjs` previously counted all matching tracked working-tree source together, including archived donor evidence, tests and its own search strings, while labeling the result with HEAD. That can misstate both the production migration surface and commit provenance.

The audit now:
- Scans the exact committed HEAD tree, not modified or untracked files; records `source: git-commit`.
- Labels each file runtime, test, evidence or tooling; supplies separate `scopeTotals`.
- Supports `--runtime-only --json` while preserving default all-tracked output and existing schemaVersion/totals/files fields.
- Includes `apps/`, `packages/` and isolated `services/` code as runtime candidates; nested tests/fixtures and archived evidence are excluded from the runtime selection.
- Fails closed on Git errors, malformed provenance, unknown options and invocation from a subdirectory. Never opens a database or contacts a provider.

Run from repository root after committing:

```sh
npm run persistence:audit -- --runtime-only --json
```

These remain **source-reference counts**, not database counts, runtime reachability or a complete SQL/transaction inventory. Follow each constructor and production composition before selecting a migration unit. Additive scope totals describe the entire scanned commit even when runtime-only output is requested.

Five diagnostic tests cover classification, runtime filtering and legacy field compatibility, invalid provenance, committed-versus-dirty/untracked CLI behavior, subdirectory/option rejection and non-Git failure. They are added for post-merge diagnostics; no local build, typecheck or tests were run. Source and syntax checks are not passing-test evidence.

## Historical media Oracle status resolved

Downloaded report artifact **13268722598** for [41713920282](https://github.com/Mtman1987/ApolloStation/actions/runs/41713920282). Exact tested SHA **ebcf46627b4ace6f04cd1a6e2e63c1826ce5985c**: **1,468 passed, zero failed/cancelled/skipped**, all four shards COMPLETE. The seven media-scope tests were added in that revision. This replaces the older pending status, not later main diagnostics or provider acceptance.

## Current deployment blockers — do not hide them

1. Synchronous Node `DatabaseSync` stores still need a tested persistence boundary and durable external database route; an HTTPS proxy is not a database migration. Start with a test-only or genuinely low-risk store, not canonical authority, balances/cards or delivery receipts.
2. Hostless free allowance and multi-account eligibility must be confirmed for the real accounts. Measure workload and reserve headroom; no automatic paid resource creation or claiming quota fit from three health pages.
3. The Restream receiver's current **Oracle** recipe requires an encrypted block volume, mounted private-CA TLS identity, Docker private network and provisional **1 CPU / 2 GiB** limits. This exceeds an entire Hostless free account's **0.5 CPU / 1 GiB** pool and is **not** a ready Hostless deployment recipe. Preserve its private-profile/lock/auth guarantees; do not silently strip durability, enable public plaintext or reduce caps and claim acceptance. Browser runtime/profile durability and supported HTTPS transport need a separate measured port.
4. Actual Hostless account labels, endpoints, service credentials, authenticated cross-node grants, external DBs, backups/restore and coordinated rollback remain unprovisioned by this increment.
5. DSH Nebula integration must use a tenant-scoped service contract instead of remote SQLite ownership. Verify its actual production composition before adding an API.

Official Hostless docs inspected on 2026-11-04:
- https://docs.hostless.cloud/app/hostlessfile — config uses plain numeric CPU/MB, root monorepo context, explicit one-replica caps; configuration sync can reconcile workers/cron jobs. Do not add an active root manifest before storage/capacity/transport gates pass.
- https://docs.hostless.cloud/app/configurations — persistent volumes are separately paid; only mounted files persist and review apps do not inherit parent storage. Root filesystem is read-only with scratch mounts.
- https://hostless.cloud/ — free allowance is shared per account; object storage is enabled-preview and paid creation is not fully covered by the pool.

Oracle Terraform and Compose remain preserved alternative-hosting artifacts, not authorization to provision Oracle or evidence of Hostless acceptance. No donor execution, production credential access, data migration, DNS, Hostless resource creation, live broadcast or deployment occurred in this increment.

## Next bounded work

1. Inspect this increment's post-merge diagnostics at the actual merged SHA; fix causes without weakening tests or PR test gating.
2. Generate the committed runtime-only inventory, reconcile per-app owner/DB-path mappings and select the smallest low-risk external-store adapter proof. Keep local SQLite fixtures as the reference; prove transactions, retry/idempotency, export/restore before migration.
3. Add role-specific packaging only after durable storage is proven. Preserve Node 2 co-location and Node 1 canonical authority; synthetic cross-node acceptance must cover login, roles, chat/event delivery, game state, Discord output, overlays and restart recovery.
4. Configure secrets only through authorized provider secret settings; do not solicit or commit credentials in chat. Cutover and paid infrastructure still require explicit approval.


## Persistence migration continuation — 2026-11-04 late update

This section supersedes any earlier pending status for the Turso adapter and Nebula Mosaic pilot. It does not claim a production cutover.

### Merged main milestones

- **PR #413** merged at `65088535353bf47a7ad47503629fa7f6a6d5ea76`: shared async Turso/libSQL HTTP client, generic async JSON record-store contract with local SQLite reference backend, SQLite transfer utility, and Chat Tag/StreamWeaver raw JSON staging utility.
- **PR #417** merged at `805b63f850049047f6b14c4cc24d8ece2f5e99c7`: Nebula Mosaic-only async Turso runtime integration. It does not migrate Nebula Tag/player/economy/game state or any other app's synchronous SQLite stores.
- **PR #419** merged at `8cea5f90e91fbcf1f4b34f65881875d94dfaad01`: fixes sensitive-field redaction for plural/camelCase token and webhook containers; accepts the documented `--chat-tag-root` flag; and makes default staging dry-run work without Turso credentials or network access. Its full offline-network regression workflow passed.

### Recovered archive evidence

- Immutable source ZIPs and nested application archives were read into separate working copies; original archives remain unchanged.
- Chat Tag source: 16 valid JSON documents, zero parse failures, four documents containing redacted fields; all remain one `legacy-global` staging scope.
- StreamWeaver source: 5,731 candidate JSON documents after sensitive-path exclusions, zero parse failures, 251 documents containing redacted fields, 58 staging scopes (57 runtime tenant IDs plus `__global__`).
- StreamWeaver has five same-broadcaster-name directory pairs whose overlapping files differ; keep those directory IDs separate.
- The Chat Tag `users` map provides 13 exact legacy Twitch-ID matches to StreamWeaver tenant-directory IDs, and all 13 agree on configured Twitch broadcaster username. This is only a partial legacy crosswalk; it is not canonical SPMT tenant ownership.
- See [the full reconciliation audit](../deployment/RECOVERED_DATA_RECONCILIATION_AUDIT.md) and issue #415.

### Current external database and Hostless placement

- The verified Turso database is `apollo-persistence-spike` in `aws-us-east-1`; it was empty at last verification. No recovered JSON or SQLite data has been imported.
- The owner has created three Hostless accounts and connected them to GitHub. Preserve the agreed logical roles: Account 1 Core (SPMT authority / SpaceMountain / OverlayBay), Account 2 Live + Games (Chat Gateway + StreamWeaver + Nebula co-located), Account 3 Discord/community (DSH + DSH-owned Lounge state).
- The Turso adapter and Mosaic pilot are code-ready for a protected-secret connectivity test, not a claim that the three Hostless nodes are deployable. The only Nebula store currently selectable for Turso is Mosaic; all Tag/player/game/economy and other domain stores remain on existing SQLite implementations.
- Do not change Fly.io, provision paid Hostless resources, move production traffic, or import ambiguous data.

### Next actions in order

1. Complete CI for PR #418 (the sanitized source audit / crosswalk report) and merge it once green.
2. Run the credential-free JSON staging dry-run against the separate extracted roots. Expected counts are 16 Chat Tag and 5,731 StreamWeaver candidate documents; no Turso connection is created during dry-run.
3. Configure only protected server-side Node 2 Turso variables for the Mosaic pilot: `NEBULA_ARCADE_MOSAIC_STORE=turso`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN`. Run `APOLLO_TURSO_LIVE_TEST=1 npm run db:test:turso:live` in the protected Hostless runtime. The live test uses synthetic records only and must prove fresh-client read-back and rollback before any staging apply.
4. If the live smoke test passes, stage recovered JSON only into `apollo_recovered_json_stage_v1` with `--apply`; do not convert records into domain tables until the SPMT tenant crosswalk, non-empty destination check, and restore/rollback plan are approved.
5. Continue the async migration service-by-service, next prioritizing Nebula Tag/player/game state and StreamWeaver. Migrate callers with the store; never swap a `DatabaseSync` path for a Turso URL.
6. Only after all DB-owning services have durable storage and cross-node restart/restore tests pass should Hostless role-specific entrypoints and production cutover be considered.

The three Hostless accounts are deployment nodes, not three Turso databases. The current Turso endpoint is one shared staging/pilot database; service-prefixed namespaces reduce key collisions but do not replace per-service authorization, tenant checks, or a future least-privilege database split.
