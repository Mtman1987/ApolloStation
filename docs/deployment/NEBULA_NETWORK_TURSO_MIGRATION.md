# Nebula network-store Turso migration: caller inventory

Status: **not implemented; SQLite remains the production/default backend**. This inventory maps the dependency surface. It does not authorize importing player data or enabling a partial cutover.

## Durable domains owned by SqliteNebulaNetwork

- Identity-wide enrollment and per-game exclusions.
- Tenant-scoped player/channel blacklist.
- Per-tenant/channel/game settings.
- Tenant presence snapshots with a 120-second freshness bound.
- Shared media/job outbox, including announcements, support notifications, art jobs, and Bingo generation jobs.

Blacklist updates have cross-domain effects: Tag eligibility/current-It state, Tag channel opt-out, arcade membership, game-runtime memberships, and Quackverse tabletop seat claims. These writes must be coordinated with the selected Tag, game-runtime, and tabletop records in one transaction boundary. Independent best-effort writes are not parity.

## Verified runtime callers

| Caller | Current synchronous network operations | Required async migration |
|---|---|---|
| `provider-runtime.ts` | enrollment, presence reads/writes, announcement enqueue/pending/update, channel/player blacklist checks | Await readiness and all reads/writes; share durable namespace with media/control |
| `media-delivery.ts` | pending jobs, update job status/body, retry handling | Await pending/update; preserve idempotency and restart behavior |
| `control-surface.ts` | settings reads/writes, enqueue Bingo/art jobs, jobs lookup/cancel/update | Await settings/jobs; acknowledge moderator mutations only after durable commit |
| `nebula-tag-experience.ts` | blacklist checks, channel settings, opt-out blacklist transaction, support-ticket enqueue | Move channel settings/tickets/overlay feed and blacklist effects into async transaction boundary |
| `nebula-arcade-core-server.ts` | legacy Tag settings read during async Tag settings bootstrap | Keep only as explicit migration-time SQLite read or move into network importer; never use local SQLite as live source after cutover |
| `live-migration.ts` | enroll, blacklist, settings import, outbox status update | Read source-only; atomically write target records with digest/empty-destination checks |
| `nebula-runtime-host-base.ts` | widget settings reads; readiness reports network mode | Select/init/health-check async network store; full-Turso readiness returns 503 unless healthy |
| Chat Gateway `simulation-runtime.ts` | synthetic preview may instantiate SQLite dependencies | Keep isolated to synthetic fixtures; never pass production credentials or read production tenant records |

Additional direct dependency: `SqliteNebulaTagExperienceStore` owns support-ticket and overlay-message tables and internally creates `SqliteNebulaNetwork`. Migrating only `arcade-network.ts` leaves live support and OBS overlay persistence on SQLite.

## Required record families

1. `network-enrollment`: actor ID -> enrolled flag, excluded game IDs, updatedAt.
2. `network-blacklist`: kind + normalized subject -> reason, updatedAt.
3. `network-settings`: channel + game -> settings object.
4. `network-presence`: tenant -> live user IDs, channel map, observedAt.
5. `network-media-outbox`: job ID -> kind, body, status, updatedAt.
6. `tag-channel-settings`: channel -> overlay mode, opt-out, updatedAt.
7. `tag-support-tickets`: ticket ID -> complete ticket lifecycle record.
8. `tag-overlay-messages`: tenant/channel sequence -> code, text, createdAt.

The Quackverse/tabletop media outbox must not be split into independent queues. Define one durable ownership/transaction rule for pack/Bingo/art/support/announcement jobs, including jobs created by tabletop commands.

## Cutover requirements

- Keep SQLite as default; Turso is explicit opt-in and fails startup on missing credentials or failed initialization.
- Use the existing `nebula-arcade` service namespace and Node 2 Turso credentials. Preserve tenant isolation in every key and query.
- Define one transaction boundary for blacklist changes and their Tag/game-runtime/tabletop side effects. If a single record-store transaction cannot include every coupled domain, do not enable cutover; redesign the aggregate boundary first.
- Add parity tests for enrollment/exclusion, blacklist add/remove, channel opt-out, settings, stale/future presence, enqueue/pending/update/retry, support-ticket lifecycle, overlay sequence ordering, and concurrent updates.
- Add fault-injection tests proving no partial blacklist state after failure; test idempotent replay and restart.
- Add a dry-run-first importer: read-only SQLite source, integrity validation, per-tenant counts and deterministic SHA-256 digest, occupied-key refusal, atomic import, destination verification. Preserve source unchanged.
- Wire every caller above to await the async API, including shutdown and readiness.
- Extend `NEBULA_ARCADE_REQUIRE_FULL_TURSO=1` to require `networkStoreMode=turso` and healthy. Keep the current fail-closed gate until caller and importer tests pass.

## Explicitly not done

No async network adapter, runtime caller conversion, network importer, or live-data import is included in this inventory change. Do not set `NEBULA_ARCADE_NETWORK_STORE=turso` or enable the full-Turso gate on the strength of this document. No production database was accessed or modified.
