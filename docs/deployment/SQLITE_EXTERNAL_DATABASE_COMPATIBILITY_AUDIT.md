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


## Expanded source-search inventory (2026-11-04)

A repository-wide GitHub code search for `DatabaseSync` returned at least 100 matching source files (the search request was capped at 100 results). This is a lower bound, not a complete count. The returned paths are listed below so the migration work can be tracked against concrete source files. Some files contain multiple stores; others use the API for read-only validation or recovery rather than a live application store. Each still needs classification by database path and lifecycle.

### scripts/nebula-release-check.mjs
- `scripts/nebula-release-check.mjs`

### apps/hearmeout
- `apps/hearmeout/src/watch-state.ts`
- `apps/hearmeout/src/persona-room.ts`
- `apps/hearmeout/src/room-assistant-jobs.ts`
- `apps/hearmeout/src/persistent-migration.ts`
- `apps/hearmeout/src/room-persona-speech.ts`
- `apps/hearmeout/src/voice-bridge.ts`
- `apps/hearmeout/src/broadcast-program.ts`
- `apps/hearmeout/src/web-server-v2.ts`
- `apps/hearmeout/src/room-media-core.ts`
- `apps/hearmeout/src/web-server-v3.ts`

### apps/streamweaver
- `apps/streamweaver/src/ride-store.ts`
- `apps/streamweaver/src/tiktok-store.ts`
- `apps/streamweaver/src/research-mode.ts`
- `apps/streamweaver/src/runtime-settings.ts`
- `apps/streamweaver/src/bot-action-replies.ts`
- `apps/streamweaver/src/generation-settings.ts`
- `apps/streamweaver/src/social-reaction-store.ts`
- `apps/streamweaver/src/bic-store.ts`
- `apps/streamweaver/src/shoutout-store.ts`
- `apps/streamweaver/src/twitch-eventsub.ts`
- `apps/streamweaver/src/bot-relay.ts`
- `apps/streamweaver/src/pokemon-store.ts`
- `apps/streamweaver/src/translation-runtime.ts`
- `apps/streamweaver/src/stella-lounge-host.ts`
- `apps/streamweaver/src/command-router.ts`
- `apps/streamweaver/src/economy.ts`
- `apps/streamweaver/src/secure-choice.ts`
- `apps/streamweaver/src/community-store.ts`
- `apps/streamweaver/src/flow-packages.ts`
- `apps/streamweaver/src/chat-gateway-consumer.ts`

### apps/nebula-arcade
- `apps/nebula-arcade/src/game-inputs.ts`
- `apps/nebula-arcade/src/overlay-scenes.ts`
- `apps/nebula-arcade/src/game-runtime-store.ts`
- `apps/nebula-arcade/src/mosaic-store.ts`
- `apps/nebula-arcade/src/quackverse-art-store.ts`
- `apps/nebula-arcade/src/arcade-activity.ts`
- `apps/nebula-arcade/src/legacy-nebula-migration.ts`
- `apps/nebula-arcade/src/game-actions.ts`
- `apps/nebula-arcade/src/game-mixes.ts`
- `apps/nebula-arcade/src/arcade-network.ts`
- `apps/nebula-arcade/src/nebula-tag-runtime.ts`
- `apps/nebula-arcade/src/discord-dashboard.ts`
- `apps/nebula-arcade/src/live-migration.ts`
- `apps/nebula-arcade/src/nebula-tag-experience.ts`
- `apps/nebula-arcade/src/tabletop-runtime.ts`

### scripts/inspect-hearmeout-blue-db.mjs
- `scripts/inspect-hearmeout-blue-db.mjs`

### packages/authority-sqlite
- `packages/authority-sqlite/src/recovery.ts`
- `packages/authority-sqlite/src/index.ts`

### apps/discord-stream-hub
- `apps/discord-stream-hub/src/lounge-host.ts`
- `apps/discord-stream-hub/src/lounge-state.ts`
- `apps/discord-stream-hub/src/mtfixit-intake.ts`
- `apps/discord-stream-hub/src/channel-cleanup.ts`
- `apps/discord-stream-hub/src/raid-pile-relay.ts`
- `apps/discord-stream-hub/src/raid-train.ts`
- `apps/discord-stream-hub/src/banner-generation.ts`
- `apps/discord-stream-hub/src/clip-gif-library.ts`
- `apps/discord-stream-hub/src/shoutout-generation.ts`
- `apps/discord-stream-hub/src/signal-control.ts`
- `apps/discord-stream-hub/src/member-activity.ts`
- `apps/discord-stream-hub/src/signal-seeker.ts`
- `apps/discord-stream-hub/src/voidwalker-reward-worker.ts`
- `apps/discord-stream-hub/src/lounge-overlay.ts`
- `apps/discord-stream-hub/src/nebula-gameplay.ts`
- `apps/discord-stream-hub/src/lounge-avatar.ts`
- `apps/discord-stream-hub/src/card-pack-render.ts`
- `apps/discord-stream-hub/src/member-directory.ts`
- `apps/discord-stream-hub/src/raid-pile.ts`
- `apps/discord-stream-hub/src/guest-shoutouts.ts`
- `apps/discord-stream-hub/src/applications.ts`
- `apps/discord-stream-hub/src/calendar.ts`
- `apps/discord-stream-hub/src/live-monitor.ts`
- `apps/discord-stream-hub/src/proposal-controls.ts`
- `apps/discord-stream-hub/src/nebula-media-worker.ts`
- `apps/discord-stream-hub/src/forum-forwarding.ts`
- `apps/discord-stream-hub/src/discord-live-publisher.ts`

### apps/companion
- `apps/companion/src/workflow-store-sqlite.ts`
- `apps/companion/src/device-relay.ts`

### apps/stellar-core
- `apps/stellar-core/src/public-memory.ts`
- `apps/stellar-core/src/assistant-store.ts`

### packages/commlink-core
- `packages/commlink-core/src/social-stream.ts`
- `packages/commlink-core/src/forum-forwarding.ts`
- `packages/commlink-core/src/index.ts`
- `packages/commlink-core/src/forum.ts`
- `packages/commlink-core/src/operator.ts`

### scripts/build-hearmeout-blue-migration-bundle.mjs
- `scripts/build-hearmeout-blue-migration-bundle.mjs`

### scripts/sprites
- `scripts/sprites/retire-hearmeout-deployment-sample.mjs`
- `scripts/sprites/install-hearmeout-cutover.mjs`

### apps/mountainview
- `apps/mountainview/src/device-runtime.ts`

### apps/spmt-service
- `apps/spmt-service/src/public-persona-api.ts`
- `apps/spmt-service/src/youtube-oauth-api.ts`
- `apps/spmt-service/src/twitch-bot-api.ts`

### packages/app-foundation
- `packages/app-foundation/src/index.ts`

### apps/chat-gateway
- `apps/chat-gateway/src/index.ts`
- `apps/chat-gateway/src/connection-supervisor.ts`
- `apps/chat-gateway/src/simulation-runtime.ts`

### packages/platform-data-sqlite
- `packages/platform-data-sqlite/src/media-assets.ts`
- `packages/platform-data-sqlite/src/index.ts`

### packages/account-recovery-core
- `packages/account-recovery-core/src/index.ts`

### packages/provider-grants-core
- `packages/provider-grants-core/src/credential-authority.ts`

**Important correction to the earlier summary:** this inventory proves the persistence surface is broader than the priority apps alone. It includes Commlink, MountainView, Stellar Core, Companion, HearMeOut, and Discord Stream Hub subsystems. Do not migrate only the obvious top-level database while leaving auxiliary processes pointing at old local paths; the runtime service inventory and per-app database ownership map must be reconciled before cutover.



## First StreamWeaver async persistence pilot (2026-11-05)

The isolated `streamweaver_social_reactions` queue has an async record-store implementation in PR #428. Production selection is explicit via `STREAMWEAVER_SOCIAL_REACTIONS_STORE=turso` and uses the StreamWeaver database credentials; simulation runtimes are deliberately forced to local SQLite. The donor-action executor and reconciliation worker now await queue operations, preserving delivery-ID idempotency, pending/waiting states, attempts, retry behavior, recent-reaction history and tenant isolation. Chat Gateway and simulation shutdown paths await the provider's async store close when selected.

The pilot includes `npm run db:migrate:streamweaver-social-reactions:turso -- --source <sqlite-path>`, dry-run by default with read-only SQLite integrity check, deterministic digest, empty-destination guard, transactional import and verification. The StreamWeaver parity workflow builds and tests the async store and importer. No Turso credentials or production records have been used. This is a low-risk queue pilot only; StreamWeaver ride/economy, TikTok, secure-choice, relay, flow, translation, runtime settings, persona and other SQLite stores remain unmigrated. The StreamWeaver service is not database-complete or Hostless-ready.



### StreamWeaver Bic counters (2026-11-05)

The tenant-isolated Bic counter now has an async record-store adapter in PR #428. Runtime selection is explicit with `STREAMWEAVER_BIC_STORE=turso`, sharing the StreamWeaver Turso database credentials. Simulation mode is forced to SQLite. The adapter stores each tenant's counter, victim counts, blacklist and idempotency receipts as one transactional aggregate record, so concurrent increments and replay protection are atomic. The existing command and voice Bic runtime awaits the store operation before emitting counter and overlay events.

A dry-run-first importer is available as `npm run db:migrate:streamweaver-bic:turso -- --source <sqlite-path>`. It opens the source read-only, checks SQLite integrity, captures counters/victims/blacklist/operation receipts, computes a deterministic digest, and supports an atomic import into an empty tenant namespace. Tests cover concurrent updates, idempotency, blacklist protection, legacy merge and migration preservation. No live Turso credentials or production data have been used. This is a second isolated persistence pilot, not a full StreamWeaver cutover; the other app stores remain SQLite.



## StreamWeaver bot-action reply receipts pilot (2026-11-05)

The durable delayed-reply receipt queue (`streamweaver_bot_action_replies`) now has an async record-store implementation in the StreamWeaver pilot branch. Production selection is explicit with `STREAMWEAVER_BOT_ACTION_REPLIES_STORE=turso`, sharing only the StreamWeaver Turso credentials; simulations stay on SQLite. The chat consumer awaits receipt reads, first-write-wins remember, and acknowledgement before returning. The provider awaits receipt-store initialization and shutdown, and its reconciliation worker awaits the async completion flush. Existing safeguards remain: request/tenant identity lock, persisted first response, delayed completion separate from acknowledgement, retry backoff, job ownership validation, and stable egress idempotency keys.

The dry-run-first importer is `npm run db:migrate:streamweaver-bot-action-replies:turso -- --source <sqlite-path>`. It reads SQLite read-only, verifies integrity, hashes a deterministic snapshot, refuses occupied target namespaces, imports receipts and tenant indexes in one record-store transaction, and verifies per-tenant counts. No production credentials or records were used. This remains a second narrow pilot; StreamWeaver's other SQLite domains are still outstanding.


## Discord Stream Hub MtFixIt intake pilot (2026-11-05)

The DSH MtFixIt report receipt table (`dsh_mtfixit_reports`) has an async record-store implementation in PR #434. Production selection is explicit via `DSH_MTFIXIT_STORE=turso`, using the Node 3 DSH database credentials `DSH_TURSO_DATABASE_URL` and `DSH_TURSO_AUTH_TOKEN`; default remains SQLite. The live worker awaits store initialization before handling `!mtfixit` and awaits store close during shutdown. Existing operations-log and coder-job idempotency keys remain stable; report receipts preserve job ID, reporter, redacted description, owner-notified flag, reply-sent flag and creation time. This adapter only creates an evidence-backed coder job and notification; it does not approve, merge or deploy changes.

The dry-run-first importer is `npm run db:migrate:dsh-mtfixit:turso -- --source <sqlite-path>`. It opens the source read-only, checks SQLite integrity, computes a deterministic digest, refuses a populated destination using a tenant index plus per-tenant checks, imports all tenant/event receipts in one transaction, and verifies counts. Focused tests cover restart-safe duplicate handling, credential redaction, importer idempotency and occupied tenant partitions outside the source snapshot. No production credentials or reports were used. This is one narrow DSH slice, not completion of Node 3 persistence; Discord Stream Hub's other stores and Lounge persistence remain outstanding.



## Discord Stream Hub Raid Pile persistence pilot (2026-11-05)

The DSH Raid Pile membership, pile balancing, target selection, viewer presence, handoff and voluntary raid event history now have an async record-store adapter in a separate pilot branch. Production selection is explicit via `DSH_RAID_PILE_STORE=turso`, using the Node 3 DSH Turso credentials; SQLite remains the default. The adapter serializes the full related table set as one tenant aggregate inside a single async record-store transaction, then runs the existing SQLite domain logic against a temporary scratch database. This retains the existing foreign keys, rebalance transactions, event-key idempotency, target rotation and strike policy without persisting scratch state locally.

The dry-run-first importer is `npm run db:migrate:dsh-raid-pile:turso -- --source <sqlite-path>`. It opens SQLite read-only, checks integrity and all five source tables, computes a deterministic digest, refuses occupied indexed namespaces, imports per-tenant aggregates transactionally and verifies table counts. Tests cover concurrent joins, target rotation, voluntary raid idempotency, restart persistence and importer safety. No production credentials or member data were used. This is one DSH persistence slice; Raid Pile relay, other DSH stores and remaining Lounge persistence are still outstanding.
