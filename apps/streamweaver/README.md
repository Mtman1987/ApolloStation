# StreamWeaver

**Workspace:** @spmt/streamweaver  
**Location:** apps/streamweaver  
**Runtime surfaces:** shared product library, web controls/server, Chat Gateway consumer/provider runtime, OverlayBay widgets, and durable execution workers.  
**Primary runtime host:** Chat Gateway worker on Hostless Node 2, with the StreamWeaver web surface hosted through the Apollo application gateway.

## 1. Product responsibility

StreamWeaver is the streaming automation and community interaction application. It owns tenant-configured personas, commands, rewards/currency, channel settings, provider-event actions, chat-driven experiences, overlays, speech/presentation, avatar/media generation, and installed automation flows.

StreamWeaver consumes normalized provider events from Chat Gateway and applies StreamWeaver-owned rules. It does not own canonical user identity or shared XP authority; it resolves known users through SPMT and uses SPMT contracts for shared facts and provider grants.

## 2. Runtime composition

| Module | Responsibility |
|---|---|
| src/index.ts | App manifest, catalog registration, public exports and shared event contracts |
| src/web-server.ts | Product web host, authenticated controls, app routes and browser modules |
| src/web-controls.ts | Settings/control APIs, command/persona/economy/flow configuration |
| src/provider-runtime.ts | Main provider-event runtime and StreamWeaver consumer composition |
| src/chat-gateway-consumer.ts | Consume normalized Chat Gateway messages and route persona replies |
| src/command-router.ts | Multi-tenant command dispatch, cooldowns, receipts and idempotency |
| src/donor-command-catalog.ts | Ported command catalog and aliases; the behavior is app-owned, not a donor service dependency |
| src/donor-command-runtime.ts and donor-command-services.ts | Ported command execution and product service adapters |
| src/donor-event-actions.ts | Provider event action contracts |
| src/donor-redeem-actions.ts | Reward/redeem action contracts |
| src/donor-social-actions.ts | Social interaction/BIC counter actions |
| src/donor-shoutout-actions.ts and shoutout-store.ts | Shoutout matching, media and audit state |
| src/economy.ts and economy-admin.ts | StreamWeaver tenant currency, balances, rates and admin operations |
| src/persona-settings.ts | Tenant/persona settings |
| src/overlay-runtime.ts and overlay-widgets.ts | Overlay catalog, widget manifests and safe event projections |
| src/runtime-settings.ts | Runtime settings and provider configuration |
| src/flow-packages.ts and flow-runtime.ts | Installed flow packages and flow consumer execution |
| src/flow-ai-builder.ts and flow-author-worker.ts | AI-assisted flow authoring and repair jobs |
| src/twitch-eventsub.ts and twitch-grants.ts | Twitch event subscription and scoped grant integration |
| src/tiktok-client.ts and tiktok-store.ts | TikTok Live integration and settings |
| src/avatar-studio.ts and avatar-geometry.ts | Browser avatar editor and geometry workflow |
| src/avatar-worker.ts | Durable GLB rigging/build job worker |
| src/image-generation.ts and image-worker.ts | Durable image generation jobs and providers |
| src/meshy-avatar-provider.ts and keenTools-avatar-provider.ts | External model/rigging provider adapters |
| src/web-client.ts and focused client modules | Browser controls for chat, media, personas, research, generation, assets and other app surfaces |

The package is large because it contains several product verticals. Keep those verticals modular; do not move their execution into the global SpaceMountain shell or duplicate them in Chat Gateway.

## 3. Provider and event flow

1. Chat Gateway receives and normalizes Twitch, Discord, Kick, YouTube or TikTok events.
2. The gateway delivers a tenant-bound normalized message to StreamWeaver's consumer.
3. StreamWeaver resolves a provider identity only when a matching SPMT link exists.
4. The command router applies aliases, permissions, cooldowns and idempotent delivery receipts.
5. Persona, reward, event-action, shoutout, social and automation-flow handlers apply app-owned rules.
6. Outbound messages and shared awards use approved SPMT/Chat Gateway contracts.
7. Overlay events are projected into allowlisted widget payloads; raw event payloads are not exported to the browser.

Provider credentials remain in SPMT. Workers receive short-lived grants for a specific tenant, provider account, capability and scope.

## 4. Product domains

### Commands and personas

The command catalog preserves ported community commands and aliases. The router must keep command ownership, permission levels, cooldowns, and tenant-specific enablement explicit. Persona settings and memory boundaries are app configuration, not global user identity.

### Rewards and currency

StreamWeaver owns its tenant currency/economy and stream-event award rules. Shared SPMT XP/rewards remain SPMT-owned. Do not conflate the two balances or create app-local copies of shared XP.

### Automation flows

Flow packages are normalized, validated and installed under tenant ownership. The flow runtime consumes only installed/approved packages. AI-assisted authoring produces a draft; it must not silently publish or execute arbitrary generated code. Test-room validation and explicit install/enable gates remain required.

### Overlays

Widget manifests are registered with SpaceMountain/OverlayBay. Browser snapshots are allowlisted projections, not raw event payloads. Audio-capable widgets declare their audio support; playback still requires actual browser/user acceptance and must not be forced muted by default.

### Speech and presentation

Text-to-speech uses the configured Stellar speech/provider path. A voice being configured is not proof it is audible. Verify actual browser playback, provider errors, autoplay behavior, and media routing.

### Avatar and image generation

Avatar Studio supports current-model upload/viewing, generic body choices, skin-suit/material controls, and commissioned GLB preview. Avatar rigging/build is a durable execution job. Meshy/KeenTools/image providers are external integrations and must be configured server-side. Large source models and reference images are assets, not automatically dead files; check route/worker usage before deleting or compressing them.

## 5. Data and persistence

StreamWeaver has multiple app-private stores for commands/receipts, economy, personas, shoutouts, flows, generation settings, TikTok configuration, avatar/media state and related workflows. Each store needs a clear tenant key, schema/migration, backup, restore and retention policy.

The Chat Gateway worker can configure a StreamWeaver database path and optional asynchronous generation-store/Turso settings. Do not assume all StreamWeaver SQLite stores have migrated merely because the async generation store or Turso HTTP client is configured.

SPMT owns cross-app identity, shared XP, provider credentials/grants, usage and platform jobs. StreamWeaver must not write those facts directly into its own SQLite file.

## 6. Configuration and secrets

Most provider/runtime settings are injected by the Chat Gateway/Hostless worker composition rather than by a standalone StreamWeaver process. See apps/chat-gateway/README.md for the Node 2 worker environment contract.

Relevant configuration families include:

- SPMT origin, worker credential, tenant/provider grants and execution target;
- StreamWeaver database and runtime settings;
- Twitch EventSub and bot grant configuration;
- TikTok Live account/channel configuration;
- image generation provider keys/model identifiers;
- Meshy/KeenTools credentials and job settings;
- Blender binary and avatar geometry script path;
- Restream control origin and scoped credential;
- speech/TTS provider settings.

Do not place any secret in browser configuration or a public overlay URL. Provider keys and media-generation credentials remain server-side. The current shared execution-target parser retains legacy Sprite/Fly values and may default to Sprite; Hostless must explicitly use the supported hosted target until the compatibility defaults are removed.

## 7. Build and local development

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/streamweaver

Standalone web entrypoint:

    npm run start:web --workspace @spmt/streamweaver

In production, the web surface and provider worker may be composed differently by the Hostless node launcher. Do not assume the standalone web start script is the complete provider runtime.

Relevant focused tests include command routing, economy/rewards, persona settings, provider event awards, flow package validation/runtime, overlay widget projections, avatar studio/rigging, image generation, and Chat Gateway consumer integration.

## 8. Security and reliability

- Every command/action is tenant-bound and attributable to its source provider/user.
- Resolve only known SPMT provider identities; passive chat must not create users.
- Enforce permission, cooldown, alias and idempotency rules before sending output.
- Keep shared XP and provider credentials in SPMT.
- Keep app-private currency, flow, persona and command state in StreamWeaver's stores.
- Use durable jobs and fenced leases for long-running avatar/image/flow work.
- Validate generated flow packages and require explicit installation/enablement.
- Bound uploads, media downloads, image dimensions, generated output, retries and job runtime.
- Redact provider tokens and private prompt/user content from logs and overlay snapshots.
- Prevent duplicate provider consumers and duplicate reward/output delivery after restart.

## 9. Performance guidance

- Keep Chat Gateway ingress fast; enqueue expensive image/avatar work as durable jobs.
- Lazy-load browser controls and Avatar Studio rather than shipping every editor into the base shell.
- Avoid repeated SQLite opens and unbounded per-tenant in-memory maps.
- Bound provider queues, command receipts, flow history, media caches and event snapshots.
- Reuse one normalized message pipeline instead of creating a separate socket per product feature.
- Serve appropriately sized avatar/media assets and cache immutable outputs.
- Measure provider event latency, queue depth, worker memory, media transfer size, database lock time and TTS start latency.

## 10. Acceptance checklist

- [ ] Node 2 Chat Gateway discovers and starts the StreamWeaver consumer for the intended tenant.
- [ ] Twitch/Discord provider messages reach the correct StreamWeaver tenant without duplicate delivery.
- [ ] Commands, aliases, cooldowns, permission rules and receipts work in live provider traffic.
- [ ] Rewards/currency and shared SPMT XP remain separate and correctly attributed.
- [ ] Persona settings and owner summon behavior survive restart/restore.
- [ ] Hosted Kokoro/TTS is audible in the actual browser/provider path.
- [ ] Overlay widgets render correct safe projections and audio is not silently forced muted.
- [ ] Avatar Studio uploads and previews GLB assets; rigging jobs complete through the configured worker.
- [ ] Image generation, flow authoring and installed flows use explicit scoped providers and job lifecycles.
- [ ] No donor app URL or retired Fly/Sprite runtime is required for the Apollo production path.
