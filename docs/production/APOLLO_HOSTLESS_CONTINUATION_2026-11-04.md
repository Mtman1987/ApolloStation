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
