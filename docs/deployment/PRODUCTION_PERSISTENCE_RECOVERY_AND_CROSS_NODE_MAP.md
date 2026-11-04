# Production Persistence, Recovery, and Cross-Node Execution Map

Status: source-derived implementation map for `hostless-three-node-port`. This is not a live production inventory. No production hosts, filesystems, databases, secrets, or user records were queried or changed.

## Evidence rules

- A path shown below is an environment-variable contract or a sandbox fixture path, not a claim about the current production filesystem.
- The actual production path for every database remains **unverified** until the running service configuration is inspected read-only.
- A database is classified by its data semantics, not by the filename. A single SQLite file can contain both authoritative and recoverable records; preserve the whole file unless a reviewed export/import contract proves otherwise.
- No database may be reinitialized, truncated, copied while live without a SQLite-consistent method, or moved to ephemeral app storage.
- "Recoverable" means a rebuild is possible only from a separately verified source of truth. It does not mean safe to delete today.

## App database ownership and data classification

| Owner / process | Configured path contract found in source | Data in scope | Classification | Multi-node rule |
|---|---|---|---|---|
| SPMT authority | `DATABASE_PATH` | accounts, tenant/workspace records, roles and membership, sessions/refresh tokens, apps/installs/entitlements, jobs, usage/billing ledger, provider credential authority, platform data, media metadata, events, audit, outbox, account recovery, Commlink/assistant state | **Authoritative** | One canonical writer only. Keep the entire authority DB under Node 1 ownership. No concurrent remote SQLite writers. |
| Chat Gateway | `CHAT_GATEWAY_DATABASE_PATH`; provider-connection store is separately composed and its production path must be traced | chat/provider receipts, connection configuration/state, replay/idempotency records | **Authoritative** for delivery receipts and connection state; some derived caches may be **recoverable** after proving provider replay semantics | Keep worker and any web/API owner using this DB co-located. Do not share a SQLite file over a network filesystem. |
| StreamWeaver provider runtime | `STREAMWEAVER_DATABASE_PATH`; web surface also accepts `STREAMWEAVER_DATABASE_PATH` | community/ride state, shoutouts, Pokémon, persona/runtime settings, summons, command state, economy, relay, flow packages, research, Bic, reactions, translation, secure choices, bot-action replies, Twitch EventSub, Stella/Lounge host state | **Authoritative** for user, tenant, game/economy, command, event receipt, and host state. Generated caches/media derivatives may be **recoverable/disposable** only when independently reproducible | Treat the app DB as one unit. Confirm whether web and worker open the same file; if so, keep them on one node/owner until a transactional API replaces shared-file access. |
| Nebula Arcade / Chat Tag | `NEBULA_ARCADE_DATABASE_PATH`; provider runtime also receives `databasePath`; standalone live server opens local network/Mosaic stores | player/tag state, points/experience, check-ins, tabletop, game inputs/actions, activity, network state, Mosaic projects/assets metadata, media metadata, Discord dashboard state | **Authoritative** for player identities, points, check-ins, collections/cards/trades, game progress, tenant config, and Mosaic project metadata. Derived rankings/cache can be **recoverable** only from authoritative events | Keep full DB with the Node 3 Nebula owner. Do not split live server and provider runtime across hosts while both can write. |
| Discord Stream Hub / Lounge | `DSH_DATABASE_PATH` plus `DSH_RUNTIME_CONFIG_PATH` | member snapshots, poll receipts, delivery/outbox state, Discord message IDs, tenant settings, live monitor, raid state, applications, calendar, forum forwarding, Lounge host/broadcast/avatar state, media/gameplay/workflow state | **Authoritative** for receipts, message IDs, pending actions, tenant settings, applications, Lounge host state and user-created content. Provider snapshots may be **recoverable** from Discord only after verified replay/backfill. Media transcodes/cache are **disposable** only if source media and metadata are retained | DSH web and live worker currently share app DB ownership. Keep them co-located; never attach the same SQLite file to different nodes. |
| SpaceMountain / OverlayBay | Overlay scene persistence is SQLite-backed; exact runtime path and environment variable must be traced from production composition | OverlayBay scenes, source/layout configuration, ownership and published output metadata | **Authoritative** for user-authored scenes/configuration; render/cache artifacts may be **recoverable** | Keep scene store with SpaceMountain/Node 1 ingress owner unless a service API replaces direct store access. |
| HearMeOut | `HEARMEOUT_ROOM_DATABASE_PATH`, `HEARMEOUT_BROADCAST_CACHE_PATH` and other app-specific paths | rooms, voice bridge, persona room state, watch queue, broadcast program, room assistant jobs, media preparation/cache | Room, identity, consent, queue, and user settings are **authoritative**; generated media/transcodes are potentially **recoverable/disposable** after validating original media and job receipts | Lower migration priority. Do not let cache classification spill over to room/user state. |
| MountainView | web server requires a `databasePath`; production env name/path needs tracing | device runtime, paired device state and commands | **Authoritative** for pairings and command receipts; telemetry snapshots may be **recoverable** | Keep with its owning service or migrate through an API. |
| Companion | configured database path needs tracing | device relay and workflow store | **Authoritative** for pairing, workflow and delivery state | Keep with owner until remote API exists. |
| Commlink | configured paths need tracing; modules can be composed into SPMT or app databases | forum, operator, social stream, provider events | **Authoritative** for receipts, user configuration and moderation state; provider-derived projections may be **recoverable** | Preserve current composition; do not split shared files. |
| Stellar Core | configured paths need tracing | public memory, assistant/private assistant state | **Authoritative** for user-private memory and preferences; public derived projections may be **recoverable** | Preserve privacy/tenant boundaries and existing owner. |

## Exact production path inventory still required

The repository reveals the variable names above, but does not reveal the values currently set in live service environments. For each running process, collect a read-only, redacted runtime inventory containing:

1. service/release identity, process/worker role, build SHA and node;
2. configured database environment-variable **name** and resolved absolute path (do not print credentials or connection strings);
3. file existence, file size, SQLite version, journal mode, schema/user_version, attached databases, and read-only `PRAGMA integrity_check`;
4. database owner/process list and whether more than one process can write it;
5. media/cache roots, persistent mount identity, free space and retention policy;
6. latest successful backup generation, timestamp, size, checksum, and restore-test receipt.

Do not send raw database contents, token values, OAuth credentials, browser profiles, or personal data to logs/chat. A path alone is not proof of persistence: verify the backing mount and restart survival.

## Backup, restore, and rollback acceptance protocol

No production backup/restore drill is marked complete by this document. The following must be implemented and executed against isolated copies before any migration:

### Backup
- Stop new writes for the database owner, or use SQLite's supported online backup mechanism. Never copy a live main DB file with ordinary filesystem copy while WAL/journal writes may be in flight.
- Capture the database, required WAL state via the supported backup mechanism, schema/version metadata, app config version (secrets excluded), and referenced durable media/object inventory.
- Write to a new immutable generation; fsync file and containing directory; compute SHA-256; then atomically publish a manifest. Never overwrite the last known-good generation.
- Run `PRAGMA integrity_check` on the backup copy and verify expected schema/version.
- Encrypt backup at rest and restrict access to the service owner. Do not store secrets in the manifest.

### Restore drill
- Restore into a new isolated path, never over the source.
- Run integrity and schema checks, start the matching app version against the restored copy in outbound-disabled/read-only mode, and verify owner-specific invariants: SPMT identities/roles/sessions; Chat Gateway receipts; StreamWeaver tenant settings, game/economy and Stella state; Nebula players/points/check-ins/cards/trades/Mosaic; DSH message receipts/pending actions/Lounge; OverlayBay scenes.
- Compare deterministic record counts and keyed digests for selected critical tables before and after restore. Do not expose record contents.
- Exercise retry/idempotency paths and confirm no duplicate Discord/Twitch/provider side effects.
- Record restore duration, data-loss window, operator, source generation, target build SHA, checks, and result.

### Rollback drill
- Keep old owner online but stop writes before cutover.
- Use a write fence/maintenance mode so old and new nodes cannot both mutate the same logical dataset.
- If cutover fails, route traffic back to the old owner and resume writes there only after the new owner is fenced off.
- If any writes occurred on the new owner, reconcile them explicitly before reopening old writes; never blindly restore an old backup over newer writes.
- Verify DNS/proxy rollback, worker queue ownership, idempotency receipts, and provider webhook replay.
- Rollback is not proven until this has been exercised with synthetic data in a staging environment.

## Cross-node HTTPS and service identity map

Existing contracts found in source:
- StreamWeaver's Go Live flow calls `POST /restream/start` with `Authorization: Bearer <STREAMWEAVER_RESTREAM_CONTROL_CREDENTIAL>`, manual redirect handling, then verifies the live state.
- The first cross-node origin portability slice now accepts credential-free HTTPS origins (with standard platform TLS verification) or loopback HTTP in Chat Gateway, Discord Stream Hub live worker, HearMeOut execution/web workers, and Stellar Core worker. Non-loopback HTTP and origin userinfo/path/query/fragment are rejected. Chat Gateway has a focused regression test for HTTPS acceptance and remote-HTTP/credential rejection.
- This does not complete cross-node wiring: the SpaceMountain gateway and every other client/worker origin validator still need a complete call-site audit; service-to-service authentication, redirect policy, tenant scope, and end-to-end three-node tests remain release gates.
- Existing worker identities are created/validated by SPMT using distinct service credentials (Chat Gateway, StreamWeaver, DSH, Nebula, HearMeOut, Stellar). Preserve distinct identities and tenant scopes; do not reuse one shared "node token".
- The Restream control receiver already exists as Express routes in `apps/hearmeout/legacy-worker/src/server.js` and browser automation in `apps/hearmeout/legacy-worker/src/restream-control.js`. It is **not** an absent feature; it is an unported deployment component. It depends on Puppeteer/Chromium, Xvfb, a persistent authenticated browser profile, and the legacy worker's `authorizeWorker` middleware. Its current default profile can fall back to OS temp storage, which is not acceptable for a durable authenticated session. The worker also has a legacy Fly-specific profile default. Do not enable it on Hostless or remove the old receiver until a dedicated receiver is ported and tested.

### Required cross-node changes
- Replace production loopback-only SPMT origin validation with a shared validator: sandbox permits loopback HTTP only; production requires HTTPS origins with no userinfo/path/query/fragment. Preserve certificate verification and reject redirects to a different origin for credential-bearing calls.
- Apply this consistently to Chat Gateway, StreamWeaver, DSH, Nebula, HearMeOut, Stellar, and SpaceMountain. Add tests for HTTPS acceptance, non-loopback HTTP rejection, malformed origins, and sandbox loopback-only behavior.
- Keep service credentials server-side. Enforce distinct service identity, least-privilege scopes, tenant allowlists, request timeouts, bounded retries, idempotency keys, and no credential forwarding across redirects.
- Add end-to-end tests with three independently bound local HTTPS test servers (or TLS fixtures) that exercise session validation, service-to-service calls, proxy cookies, event delivery, retry/idempotency, and service unavailability.
- No browser-facing endpoint may receive a worker credential.

## Restream receiver port acceptance

The receiver should become an explicit StreamWeaver/Restream-control service module with:
- the existing exact Restream host allowlist and visible-button classification safeguards;
- authenticated status/start/reset routes, using a dedicated 32+ character service credential distinct from SPMT, DSH and StreamWeaver worker credentials;
- strict origin and request authentication; constant-time credential comparison; request body/hold-time bounds; no credential or browser profile details in logs/responses;
- one active Puppeteer browser controller, single-flight start/reset operations, bounded startup/shutdown and browser-health checks;
- Chromium/Xvfb dependencies verified in the target runtime image;
- a durable private browser profile on a persistent storage service (not ephemeral app disk or shared SQLite volume), with backup/encryption/access controls and a documented re-authentication recovery process;
- status verification before/after start, explicit login-required/ambiguous states, and no false "live" acknowledgement;
- integration tests for unauthenticated denial, authorized status, login-required, ambiguous buttons, exact start selection, duplicate requests, browser crash/restart, profile persistence, and no navigation outside Restream;
- a safe cutover plan that keeps the existing receiver available until the new receiver passes all acceptance tests.

## Current gate status

- [x] Source-level data ownership map started.
- [x] Key app DB environment-variable contracts recorded.
- [x] Source classification of critical vs derived/cache data recorded.
- [ ] Read-only live path/mount inventory for every production process.
- [ ] Backup tooling with SQLite-consistent snapshot, checksums and immutable generations.
- [ ] Restore drill against copies for every authoritative app DB.
- [ ] Rollback drill with write fencing and synthetic cutover.
- [ ] Complete production HTTPS SPMT origin support across all remaining clients and proxy entrypoints (first worker slice implemented; CI pending).
- [ ] Three-node service identity and end-to-end network tests.
- [ ] Restream receiver port, durable profile, target-runtime browser proof and integration tests.
- [ ] Hostless resource/storage/cost policy verified before provisioning.

No production data has been moved, altered, restored, or deleted. No Hostless resource has been created. No Fly.io action has been taken.
