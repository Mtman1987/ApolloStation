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

## Node 2 — live + games data plane (mandatory co-location)

| Process | Current entrypoint | Current state |
|---|---|---|
| Chat Gateway + embedded provider consumers | `apps/chat-gateway/dist/service-start.js` | Constructs StreamWeaver and Nebula provider runtimes in-process; owns Chat Gateway receipts and provider connection state. |
| StreamWeaver web/provider state | `apps/streamweaver/dist/web-server.js` + Chat Gateway provider runtime | Web and provider runtime use StreamWeaver-owned SQLite state; preserve the existing owner boundary. |
| Nebula live server/provider state | `apps/nebula-arcade/dist/nebula-arcade-live-server.js` + Chat Gateway provider runtime | Both open Nebula network/Mosaic/game stores at the configured Nebula SQLite path. They must be co-located with Chat Gateway's embedded Nebula runtime. |

**Do not split these processes across Hostless accounts.** `apps/chat-gateway/src/service.ts` directly constructs `StreamWeaverProviderRuntime` and `NebulaArcadeProviderRuntime`, registers their consumers in the chat delivery pipeline, and calls Nebula's check-in bonus method from StreamWeaver. A remote Nebula process cannot replace this in-process runtime without a real event-ingress/API extraction preserving tenant scope, event order, delivery IDs, idempotency, retries, and outbound callbacks.

## Node 3 — Discord/community delivery and auxiliary execution

| Process | Current entrypoint | Current state |
|---|---|---|
| Discord Stream Hub web | `apps/discord-stream-hub/dist/web-server.js` | DSH-owned SQLite stores and runtime config. |
| Discord Stream Hub worker | `apps/discord-stream-hub/dist/live-worker-start.js` | Validates worker environment; runs live, suite, calendar, and Nebula media loops. Any Nebula data access must use a remote authenticated API, not a shared SQLite path. |
| Restream receiver | `services/restream-control/src/server.js` + `services/restream-control/src/restream-control.js` (isolated port in PR #411); legacy receiver remains under HearMeOut until cutover | Private HTTPS API, dedicated bearer auth, sanitized status, Chromium/Xvfb image, persistent-profile marker and exclusive lock are implemented. Volume/TLS/profile provisioning and live Twitch rehearsal remain open. |

## Cross-cutting feature ownership (verified from current source)

- **OverlayBay** is implemented in SpaceMountain: editor/UI in `apps/spacemountain/src/overlay-bay-ui.ts`, scene model and persistence logic in `apps/spacemountain/src/overlay-scenes.ts`, and public/personal output delivery through the SpaceMountain web gateway. It is not a separate standalone app process. Its route and scene persistence must remain attached to the SpaceMountain ingress/data owner.
- **Restream / !golive** is initiated by the StreamWeaver provider runtime in `apps/streamweaver/src/provider-runtime.ts`. It calls a configured authenticated HTTPS `/restream/start` control origin and verifies Twitch live status before reporting success. The original browser automation remains under `apps/hearmeout/legacy-worker/src/restream-control.js`; an isolated port now exists under `services/restream-control/` with private HTTPS, dedicated auth, persistent profile mount checks, an exclusive lock and a standalone Chromium/Xvfb image. It is not yet a production-ready receiver: Oracle volume, TLS identity, profile seeding, resource fit, StreamWeaver private DNS wiring and live Twitch rehearsal remain unverified. Do not configure production StreamWeaver to point at it until those gates pass.
- **Lounge** spans multiple cooperating owners rather than one isolated process: StreamWeaver's Stella event/host runtime lives in `apps/streamweaver/src/provider-runtime.ts`; Discord Stream Hub owns Lounge host state in `apps/discord-stream-hub/src/lounge-host.ts` and the public overlay/host UI in its Lounge modules; the legacy HearMeOut worker still contains the older Lounge broadcast and Restream automation. Preserve the current event → Stella state → overlay/media chain when assigning services. A partial Lounge-only deployment would not preserve the 24/7 ecosystem behavior.
- **Discord Stream Hub** web and live worker are separate entrypoints (`web-server.ts` and `live-worker-start.ts`) and its worker uses an app-owned SQLite database. Keep its web/worker database access co-located under one owner until the storage contract is migrated; do not split concurrent SQLite writers across nodes.

These mappings refine the initial node assignment: Node 1 owns the SpaceMountain public ingress and OverlayBay HTTP surface as well as canonical authority routing; Node 2 owns Chat Gateway, StreamWeaver provider runtime (including the Go Live request path), and Nebula Arcade provider/live runtime plus its database; Node 3 owns Discord Stream Hub and its Lounge runtime/state. Nebula must not be placed on Node 3 while Chat Gateway still constructs its provider runtime in-process. The Restream browser-control receiver is now implemented as an isolated service component; its durable profile, private HTTPS wiring, resource fit and live acceptance remain open and block declaring the topology deployable. Actual service-to-service URLs, durable storage ownership, and worker authentication must be wired and tested before deployment.

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


## Mandatory co-location rule (2026-11-04)

The original draft placed Nebula on Node 3 and Chat Gateway on Node 2. That is invalid: Chat Gateway constructs Nebula and StreamWeaver provider runtimes inside `apps/chat-gateway/src/service.ts`. The Nebula provider runtime and `nebula-arcade-live-server.ts` both open the Nebula SQLite database. Until a remote provider-ingress boundary is implemented and tested, the entire Chat Gateway + StreamWeaver + Nebula runtime/data plane belongs on Node 2. Node 3 is reserved for DSH and independent auxiliary services. If DSH's Nebula-media worker requires direct Nebula DB access, it remains blocked from Node 3 until replaced with a scoped HTTPS API. This is source-derived, not proof of quota fit.
