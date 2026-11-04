# SQLite persistence compatibility audit

Date: 2026-11-04
Scope: source-level audit of the Hostless/external-database port. No database was opened, copied, migrated, or modified.

## Finding

ApolloStation is not currently database-driver agnostic. Its durable stores are implemented directly against Node's synchronous `node:sqlite` `DatabaseSync` API. A remote database URL cannot be substituted for the existing `*_DATABASE_PATH` values. The common Turso Cloud/libSQL Node driver (`@libsql/client`) is asynchronous and returns a different result/transaction API. Moving the existing stores to it requires a deliberate repository/driver refactor and tests; changing environment variables alone would break the app.

This matters because the code depends on synchronous `.prepare().get()/all()/run()`, `.exec()`, synchronous nested transaction helpers, SQLite pragmas, and in several stores `BEGIN IMMEDIATE`, WAL, foreign keys, STRICT tables, JSON1, and SQLite-specific integrity/backup operations.

## Confirmed critical persistence owners

| Owner / domain | Source implementation | Important behavior to preserve |
|---|---|---|
| SPMT authority/auth/control/usage | `packages/authority-sqlite/src/index.ts` → `SqliteAuthorityStore` | Single authoritative user/provider-link/tenant/session/service-identity/entitlement/usage/event/outbox store; nested transaction-depth behavior; `BEGIN IMMEDIATE`; WAL, FULL sync, FK enforcement; epoch probe and quick-check. Highest migration risk. |
| SPMT platform data / jobs / Commlink | `packages/platform-data-sqlite/src/index.ts` → `SqlitePlatformDataStore` | Profiles, credentials, OAuth codes, conversations/messages, device and execution state; synchronous transaction contract and SQLite JSON1 usage. |
| Provider grants / encrypted credentials | `packages/provider-grants-core/src/credential-authority.ts` | Encrypted provider credential state; preserve key separation, atomic updates and access boundaries. |
| Chat Gateway delivery and connections | `apps/chat-gateway/src/index.ts`, `apps/chat-gateway/src/connection-supervisor.ts` | Delivery receipts, connection cursors, lease ownership, retries/backoff, idempotency; synchronous writes inside live provider callbacks. |
| Nebula / Chat Tag | `apps/nebula-arcade/src/arcade-network.ts`, `game-runtime-store.ts`, `game-inputs.ts`, `tabletop-runtime.ts`, `nebula-tag-experience.ts`, `nebula-tag-runtime.ts`, `game-actions.ts`, `mosaic-runtime.ts`, `discord-dashboard.ts` | Player enrollment/eligibility, points/cards/game state, action receipts, Mosaic jobs, input sequence, presence and outboxes. Several state transitions use immediate transactions; corrupted game state intentionally throws instead of silently resetting. |
| StreamWeaver | `apps/streamweaver/src/ride-store.ts`, `tiktok-store.ts`, `social-reaction-store.ts`, `research-mode.ts`, plus other `DatabaseSync` stores | Economy/reward attempts, unique request signatures, front-seat history, TikTok outbox, reactions, persona/research state and other tenant settings. |
| Discord Stream Hub / Lounge | `apps/discord-stream-hub/src/lounge-state.ts`, `lounge-host.ts`, `applications.ts`, `nebula-media-worker.ts`, plus other `DatabaseSync` stores | Lounge 24/7 state, Discord application decisions, media bytes, render leases and job state; avoid duplicate delivery or losing active media. |
| Companion / HearMeOut / recovery | e.g. `apps/companion/src/device-relay.ts`, `apps/hearmeout/src/watch-state.ts`, `packages/authority-sqlite/src/recovery.ts` | Device state, room/watch state, backup/restore operations and any lower-priority app-owned durable records. |

This is a confirmed critical-path inventory, not yet a complete count of every `DatabaseSync` construction. A full automated source scan and runtime-path map remains a release gate.

## Turso decision refinement

Do not conflate these products:

1. **Turso Cloud / libSQL hosted databases** are the relevant remote SQLite-compatible option for this codebase. The official JavaScript client is `@libsql/client`, whose API is asynchronous and differs from `DatabaseSync`. It supports remote Turso and embedded replicas. An embedded replica can preserve fast local reads, but its sync consistency, write authority and crash/restart behavior must be designed explicitly.
2. **The newer Turso Database engine** has its own JavaScript API and compatibility differences. Its published manual currently lists limitations such as no multi-process access, no savepoints, no triggers, no views and no vacuum. Do not select it for critical ApolloStation stores without proving the schema and query suite against the exact engine/version.
3. The fact that both use SQLite-compatible SQL does not mean either is a binary-compatible replacement for Node's built-in SQLite API.

Official references:
- Turso Cloud free allowance and quotas: https://turso.tech/pricing
- libSQL TypeScript client and remote/embedded-replica support: https://github.com/tursodatabase/libsql-client-ts
- Turso Database manual and limitations: https://github.com/tursodatabase/turso/blob/main/docs/manual.md
- Turso Database JS API: https://github.com/tursodatabase/turso/blob/main/docs/javascript-api-reference.md

## Migration sequence (safe order)

1. Complete the automated source inventory: all `DatabaseSync` constructors, path env vars, migration functions, backup utilities, direct SQL consumers, and stores created per request/process.
2. Define a persistence contract that matches the actual synchronous/transaction semantics. Do not convert every method to async in one sweep; map call graphs first, especially synchronous provider event handlers and domain transaction callbacks.
3. Select a low-risk, non-authoritative store for a driver spike. Implement local SQLite and remote libSQL implementations behind the same domain interface. Keep SQLite as the default until parity tests pass.
4. Run existing domain tests against both drivers, plus explicit tests for `BEGIN IMMEDIATE`/rollback, nested transaction semantics, unique constraints, JSON1, STRICT schema, blob values, integer/boolean mapping, busy/retry behavior, connection interruption, outbox recovery, duplicate delivery, and restart.
5. Do not use embedded replicas as writable multi-node shared files. If used, designate a single writer and prove sync lag/refresh and recovery behavior. Never mount one SQLite file on multiple Hostless accounts.
6. Only after the adapter is proven, migrate one service-owned database at a time. Keep each service's database credentials separate; no shared all-powerful token across services.
7. Preserve independent encrypted export/restore copies. Turso Free currently lists one-day PITR, but that is not a substitute for independent backups and a tested restore.
8. Move SPMT authority, provider credentials, Chat Gateway receipts, Nebula balances/cards, StreamWeaver economy, and DSH/Lounge state only after the highest-risk transaction and recovery suites pass.

## First prototype recommendation

The first spike should **not** use SPMT authority, provider credentials, Chat Gateway receipts, Nebula points/cards, or Lounge state. Select a small, isolated store after the automated inventory identifies one with no synchronous callback dependency. If every candidate still relies on DatabaseSync, build the adapter proof on a test-only store/schema first.

## No-go conditions

- A migration requires dropping or recreating a database to fit a provider.
- A free tier sleeps, pauses, or throttles a service in a way that threatens required 24/7 behavior.
- Critical state has no independent export and tested restore.
- A remote write can be acknowledged before durable commit, or retries can double-award points/cards/rewards.
- An app uses a second service's database credentials or reaches into its database directly.
- A provider's compatibility or limits are inferred from the phrase "SQLite-compatible" without running ApolloStation's own tests.

This audit changes no production settings and creates no external database resources.
