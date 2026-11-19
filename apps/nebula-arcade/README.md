# Nebula Arcade

**Workspace:** @spmt/nebula-arcade  
**Location:** apps/nebula-arcade  
**Runtime entrypoint:** src/nebula-arcade-live-server.ts → dist/nebula-arcade-live-server.js  
**Role:** multi-game community hub, Chat Tag, Bingo, Quackverse, gameplay widgets, game overlays and provider-event runtime.

## 1. Product responsibility

Nebula Arcade owns community game behavior and app-private game state. It contains the twenty-game hub, Tag runtime, Bingo modes, Quackverse collections/trades/battles/packs/art canon, channel game settings, gameplay showcase and reusable overlay/game widgets.

Nebula uses SPMT for identity, shared XP/rewards, app registration, jobs, provider grants and shared events. It owns its private game state, game settings, player/channel participation and app-specific art/collection records. It must not create a second identity or XP authority.

## 2. Runtime structure

| Module | Responsibility |
|---|---|
| src/index.ts | App manifest, catalog registration and public exports |
| src/nebula-arcade-live-server.ts | Production HTTP host, SPMT service auth, browser session and public app routes |
| src/nebula-runtime-host-base.ts | Shared runtime host composition |
| src/provider-runtime.ts | Provider configuration, Chat Gateway consumer and game runtime composition |
| src/game-hub.ts | Canonical game catalog, command parsing and game routing |
| src/game-runtime.ts and game-runtime-store.ts | Player, channel, participation and game runtime state |
| src/nebula-tag.ts | Tag game rules and command state machine |
| src/nebula-tag-runtime.ts | Tag persistence, command delivery and legacy state migration |
| src/nebula-tag-gateway.ts | Tag provider/command ingress integration |
| src/nebula-tag-experience.ts | Tag experience and player-facing experience rules |
| src/bingo-game.ts and shared-bingo.ts | Bingo game modes and shared bingo behavior |
| src/tabletop-runtime.ts | Tabletop game domain behavior |
| src/async-tabletop-runtime.ts | Async record-store wrapper for transactional tabletop state |
| src/game-actions.ts and game-inputs.ts | Typed game actions and input validation |
| src/game-settings.ts | Tenant/channel game configuration |
| src/game-widgets.ts and gameplay-showcase.ts | Game widgets and showcase manifest/rendering |
| src/overlay-scenes.ts and game-mixes.ts | Saved game overlay scenes and multi-game mixes |
| src/quackverse-state.ts, trades.ts, packs.ts, battle.ts | Quackverse game state, trading, packs and battles |
| src/quackverse-visual-canon.ts and quackverse-presentation.ts | Canonical art/presentation rules |
| src/quackverse-art-job.ts | Durable handoff of art enhancement/rendering to Discord Stream Hub |
| src/mosaic-core.ts, mosaic-runtime.ts, mosaic-generation.ts | Mosaic board model, runtime and generation workflow |
| src/mosaic-library.ts, mosaic-store.ts and mosaic-record-store.ts | Mosaic library and persistence |
| src/discord-dashboard.ts | Signed/allowlisted Discord dashboard projection |
| src/media-delivery.ts | Media publication and Discord dashboard delivery |

## 3. Provider and game flow

1. Chat Gateway receives provider events and delivers normalized, tenant-bound messages.
2. Nebula provider runtime resolves the tenant/channel and applies channel/game settings.
3. Commands are routed to the game owner and validated against the game state.
4. Player/game state and pending delivery records are persisted.
5. Shared XP/rewards and events are sent through SPMT contracts.
6. Media/art/overlay results are published through approved job and output contracts.
7. Provider output is delivered through the Chat Gateway or the owning app's authorized sender.

The gateway is not the owner of Nebula game rules. Nebula is not the owner of provider OAuth refresh credentials. Keep these boundaries explicit.

## 4. Data ownership and persistence

- SPMT owns canonical identity, tenant membership, shared XP/rewards, provider grants and platform jobs.
- Nebula owns app-private game state, player/game participation, channel settings, Tag/Bingo state, Quackverse records/trades/packs, Mosaic boards and game-specific outbox state.
- Discord Stream Hub owns Quackverse art enhancement/animation and final media publication where the art job contract assigns it.
- Caches and temporary scratch databases are disposable only when their authoritative record-store source is durable.

The code supports SQLite-backed stores and asynchronous record-store adapters for selected domains. The async tabletop runtime uses a short-lived scratch SQLite database only as a compatibility execution engine; durable reads/writes are made through the configured record-store transaction. This does not prove every Nebula domain has moved to Turso.

The live host recognizes NEBULA_ARCADE_MOSAIC_STORE, NEBULA_ARCADE_REQUIRE_TURSO, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. The provider runtime recognizes NEBULA_ARCADE_TABLETOP_STORE, NEBULA_ARCADE_TAG_STORE, NEBULA_ARCADE_GAME_RUNTIME_STORE and corresponding NEBULA_ARCADE_*_TURSO_DATABASE_URL / AUTH_TOKEN settings. Confirm the effective mode and health for each domain; do not infer from a single env variable.

## 5. Mosaic and Quackverse art

Mosaic generation creates collaborative pixel-art boards with fixed palette, board geometry and split work areas. Image generation is a provider-backed workflow; the generated source is validated, transformed and stored through the owning media path.

Quackverse art uses a canonical subject/style model. Nebula provides the art canon and job request; Discord Stream Hub owns enhancement/animation and publication through the DSH execution capability. Do not duplicate the rendering worker inside Nebula.

**Known migration debt:** mosaic-generation.ts currently defaults STREAMWEAVER_URL to the old StreamWeaver Fly donor origin. This is an active code path, not dead code. Replace it with an Apollo-owned internal service/origin and explicit configuration before claiming the Mosaic path is donor-independent. Do not simply delete the URL fallback until the generation API is migrated and tested.

## 6. Configuration

Exact Hostless node mapping is maintained in scripts/hostless/start-node.mjs and the canonical release workflow. Important runtime settings include:

- NEBULA_ARCADE_DATABASE_PATH and NEBULA_ARCADE_TENANT_ID;
- NEBULA_ARCADE_PUBLIC_ORIGIN and NEBULA_GAMEPLAY_PUBLIC_ORIGIN;
- NEBULA_ARCADE_RUNTIME_CONFIG_PATH and NEBULA_ARCADE_WEBHOOK_NAME;
- NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED and NEBULA_ARCADE_WORKER_CREDENTIAL;
- NEBULA_ARCADE_AVATAR_URL;
- NEBULA_ARCADE_TABLETOP_STORE, NEBULA_ARCADE_TAG_STORE, NEBULA_ARCADE_GAME_RUNTIME_STORE;
- NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN;
- NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL and NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN;
- MOSAIC_STREAMWEAVER_SERVICE_TOKEN, MOSAIC_STREAMWEAVER_TENANT_ID and STREAMWEAVER_URL;
- MOSAIC_IMAGE_PROVIDER, MOSAIC_IMAGE_FALLBACK_PROVIDERS and MOSAIC_IMAGE_DOWNLOAD_HOSTS;
- MOSAIC_REQUEST_XP_COST.

Secrets remain server-side. Do not put worker credentials, Turso tokens, or provider keys into the browser or public config.

## 7. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline
    npm run nebula:check

Package-local build:

    npm run build --workspace @spmt/nebula-arcade

The root TypeScript build includes Nebula and its shared package dependencies. Use focused tests for Tag, Bingo, Quackverse, Mosaic, provider runtime, overlay scenes, media delivery, and persistence adapters before running the full suite.

## 8. Security and reliability

- Every game action is tenant/channel-bound and validated against the current game state.
- Provider events are deduplicated and delivery is idempotent.
- Shared XP/rewards go through SPMT; do not write them directly to Nebula stores.
- Use scoped service credentials and provider grants.
- Keep media URLs HTTPS-only and validate allowed hosts before fetching.
- Signed Discord dashboard payloads and overlay projections must be bounded and redacted.
- Keep large image/media generation in durable jobs with leases, retries and output limits.
- Preserve game-state recovery and pending-delivery reconciliation across restart.
- Prevent duplicate command/reward output from concurrent workers.

## 9. Performance guidance

- Keep command parsing and state transitions small and deterministic.
- Use async record stores for domains that need remote durable transactions; avoid blocking the provider ingress loop on large media work.
- Bound per-tenant/channel state, histories, pending deliveries, caches and generated image dimensions.
- Use sharp only in the media-processing path; do not bundle it into browser code.
- Avoid repeated full-game snapshots on every chat message.
- Keep showcase GIFs and game art referenced by the UI, and optimize only after verifying route usage and visual fidelity.
- Measure message-to-action latency, database lock time, provider queue depth, art-job duration and image transfer size.

## 10. Acceptance checklist

- [ ] Node 2 worker discovers Nebula tenant/channel configuration.
- [ ] Chat Tag commands, rules, schedules and rewards work in live provider traffic.
- [ ] Bingo modes and game widget actions work in the actual app/overlay.
- [ ] Quackverse packs, trades, battles and art canon are tenant-correct.
- [ ] Mosaic generation uses an Apollo-owned configured provider path, not a donor Fly default.
- [ ] Shared XP/rewards are reconciled through SPMT.
- [ ] Game state and pending deliveries survive restart/restore.
- [ ] Discord Stream Hub receives Quackverse art jobs and publishes media once.
- [ ] No duplicate game command/reward output occurs during reconnect or worker restart.
