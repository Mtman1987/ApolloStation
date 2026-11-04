# Hostless Runtime Service Inventory

Status: initial static inventory from ApolloStation `main`; confirm against runtime tests before deployment. This file records observed entrypoints and persistence assumptions, not a complete deployment manifest.

## Shared monorepo

- Root npm workspaces: `packages/*`, `apps/*`.
- Root build compiles the shared contracts, SDK, runtime, authority/auth/control/data packages and the principal apps.
- Hostless must build with repository root as build context because apps consume sibling workspace packages.
- The existing Sprite supervisor is a development/sandbox cohort launcher, not a production Hostless process manager.

## Node 1 — canonical authority and gateway

| Process | Current entrypoint | Current state |
|---|---|---|
| SPMT authority/API/output gateway | `apps/spmt-service/dist/provider-identity-start.js` | Requires `DATABASE_PATH`, 32-byte webhook key, and optional provider/service credentials. Uses SQLite authority adapter. |
| SpaceMountain integrated web gateway | `apps/spacemountain-web/dist/integrated-server.js` | Requires SPMT origin; the Hostless portability branch now validates configured origins at startup and supports remote HTTPS targets while retaining loopback HTTP for local development. |

Important: SPMT's service process can bind to `0.0.0.0` via `SPMT_HOST`, but its authority store is SQLite. The existing storage policy requires a single writable authority. A Hostless deploy without a durable database path is not safe.

## Node 2 — streaming and media

| Process | Current entrypoint | Current state |
|---|---|---|
| Chat Gateway | `apps/chat-gateway/dist/service-start.js` | Worker/service config includes a local SQLite database path and SPMT origin. |
| StreamWeaver web | `apps/streamweaver/dist/web-server.js` | Reads `SPMT_ORIGIN`, `PORT`, `HOST`, optional `STREAMWEAVER_DATABASE_PATH` and worker credential. |
| Discord Stream Hub web | `apps/discord-stream-hub/dist/web-server.js` | App-owned SQLite stores and runtime config; separate live worker entrypoint. |
| Discord Stream Hub worker | `apps/discord-stream-hub/dist/live-worker-start.js` | Validates worker environment, runs live, suite, calendar, and Nebula media loops. |

The supervisor currently passes local SPMT and local app URLs. Those must become explicit remote HTTPS origins with service authentication. App-owned state must be classified individually; it cannot be left on ephemeral filesystem if it is authoritative.

## Node 3 — games and community

| Process | Current entrypoint | Current state |
|---|---|---|
| Nebula Arcade live server | `apps/nebula-arcade/dist/nebula-arcade-live-server.js` | Uses SPMT session/service-token APIs, but local SQLite network and Mosaic stores; requires tenant/channel, public origin, and service credential. |
| Lounge / OverlayBay / Restream | To be mapped from actual package and runtime entrypoints | Do not claim parity or assign workloads until exact code and state ownership are inventoried. |

## Additional app-owned SQLite state discovered

A repository-wide source search found a broad set of SQLite-backed modules. This is a source-path inventory, not proof that every module owns a separate database file; several may share a configured SQLite path, and some entries are maintenance/migration utilities. Trace each constructor to its production composition and actual path before changing storage.

| Domain | SQLite-backed modules observed |
|---|---|
| Chat Gateway | `apps/chat-gateway/src/index.ts` |
| StreamWeaver | `bot-relay.ts`, `bic-store.ts`, `ride-store.ts`, `tiktok-store.ts`, `research-mode.ts`, `pokemon-store.ts`, `command-router.ts`, `shoutout-store.ts`, `twitch-eventsub.ts`, `runtime-settings.ts`, `stella-lounge-host.ts`, `bot-action-replies.ts`, `generation-settings.ts`, `translation-runtime.ts`, `secure-choice.ts` (all under `apps/streamweaver/src/`) |
| Discord Stream Hub / Lounge | `live-monitor.ts`, `lounge-state.ts`, `lounge-host.ts`, `raid-pile.ts`, `raid-train.ts`, `applications.ts`, `lounge-avatar.ts`, `signal-seeker.ts`, `signal-control.ts` (under `apps/discord-stream-hub/src/`) |
| Nebula Arcade | `game-mixes.ts`, `game-inputs.ts`, `game-actions.ts`, `mosaic-store.ts`, `overlay-scenes.ts`, `arcade-network.ts`, `live-migration.ts`, `arcade-activity.ts`, `discord-dashboard.ts`, `game-runtime-store.ts`, `nebula-tag-runtime.ts` (under `apps/nebula-arcade/src/`) |
| HearMeOut | `watch-state.ts`, `voice-bridge.ts`, `persona-room.ts`, `broadcast-program.ts`, `room-assistant-jobs.ts`, `room-persona-speech.ts`, `persistent-migration.ts` (under `apps/hearmeout/src/`) |
| Companion | `device-relay.ts`, `workflow-store-sqlite.ts` (under `apps/companion/src/`) |
| Commlink | `packages/commlink-core/src/index.ts`, `forum.ts`, `operator.ts`, `social-stream.ts` |
| MountainView | `apps/mountainview/src/device-runtime.ts` |
| Stellar Core | `apps/stellar-core/src/public-memory.ts`, `assistant-store.ts` |
| SPMT provider/runtime modules | `apps/spmt-service/src/twitch-bot-api.ts`, `youtube-oauth-api.ts`, `public-persona-api.ts` |
| Shared authority | `packages/authority-sqlite/src/index.ts`, `recovery.ts` |

This search found stateful modules in nearly every major ecosystem area, not just the canonical SPMT authority. Each needs an owner, data classification (authoritative, reconstructible cache, event history, or ephemeral), actual configured path, durability requirement, backup/restore plan, and cross-node access strategy. Do not move, reset, or silently reinitialize any of these files during portability work.

## Database-path composition confirmed

The source composition shows that several stores are grouped into one SQLite file per app runtime, rather than one file per store:

- **StreamWeaver provider runtime:** its provider runtime constructs the community/ride, shoutout, Pokémon, persona settings, summons, command state, economy, relay, flow packages, runtime settings, research, Bic, social reaction, translation, secure-choice, bot-action-reply, Twitch EventSub, and Stella Lounge-host stores using the same `options.databasePath`. Its web server separately accepts optional `STREAMWEAVER_DATABASE_PATH` for the secure-choice web surface. Confirm whether the web process and worker receive the same durable file or use a deliberately shared API before splitting them.
- **Nebula provider runtime:** network, tabletop, input feed, activity, tag, experience, game runtime, action history, Mosaic, media, and optional Discord dashboard stores are composed around the same `options.databasePath`. The standalone live server also opens network/Mosaic state at its configured `NEBULA_ARCADE_DATABASE_PATH`. These are not safe to place on unrelated ephemeral node disks.
- **Discord Stream Hub worker:** member activity, tenant settings, member directory, live monitor, raid pile, Discord message receipts, MtFixIt intake, signal seekers, forum forwarding, cleanup, clip/GIF, role-banner, calendar, and application stores are composed from the same `options.databasePath`. The web process uses `DSH_DATABASE_PATH` for its media, gameplay, application, and workflow stores.
- **Lounge overlay:** broadcast, Lounge context, Stella host, and avatar state are composed from one supplied SQLite path.
- **Chat Gateway:** `SqliteChatGatewayStore` and `SqliteProviderConnectionStore` are separate stores; the service composition receives the database path for its message store and a separately configured connection store. Verify exact production path wiring before assuming a single file.

This gives us a safer migration unit: preserve each app's existing database file as a complete unit first, rather than splitting tables by module. It does **not** yet prove cross-process concurrent access is safe on Hostless storage. If web and worker processes must both mutate the same SQLite file on different machines, a local volume is not a distributed database; keep them co-located behind one owner or migrate their store APIs to a network database with transaction-safe semantics.

## Cross-node incompatibilities confirmed

1. The Sprite supervisor assumes one host and wires most services through loopback origins.
2. The SpaceMountain integrated gateway's cross-node proxy gap has a first implementation on `hostless-three-node-port`: remote HTTPS origins are accepted with standard TLS certificate verification; non-loopback HTTP and malformed origins fail startup. Regression tests were added, but have not yet run in CI.
3. SPMT authority and multiple app-owned stores use SQLite. Hostless temporary app disk is not a durable store; persistent volumes are separately priced.
4. Nebula's live server currently opens local SQLite stores directly, so it is not stateless simply because player identity comes from SPMT.
5. HearMeOut execution worker defaults to `fly` unless explicitly configured; it is not part of the first deployment slice and must never silently target Fly during Hostless work.

## Implementation order

1. Keep the existing local/Sprite supervisor intact.
2. Add a Hostless role entrypoint for the canonical authority only after a durable zero-cost data strategy is proven.
3. Complete CI verification of the SpaceMountain HTTPS proxy change, including TLS forwarding, browser auth/cookies, redirects, and health checks.
4. Add explicit Node 2 and Node 3 process entrypoints with no implicit localhost defaults.
5. Replace or externally centralize each app-owned SQLite store before moving that app to an ephemeral Hostless app filesystem.
6. Run all cross-node tests and restore drills before a deployment or traffic cutover.
