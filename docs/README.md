# ApolloStation documentation

This directory contains maintained architecture, product, contract, development, and operating references. The root README is the SPMT Ecosystem entry point. Historical donor snapshots, dated parity reports, retired deployment plans, and issue-specific handoffs are preserved in the repository quarantine archive.

## Start here

- [Development and operator tooling](development/README.md) — canonical commands, audit families, migrations, and release tooling.
- [Current state](CURRENT_STATE.md) — verified implementation, active topology, deployment evidence, and remaining migration gaps.
- [Architecture](ARCHITECTURE.md) — platform layers, ownership boundaries, runtime topology, persistence, security and performance.
- [Production path](PRODUCTION_PATH.md) — release gates, recovery, provider acceptance and rollback.
- [Application contracts](APP_CONTRACTS.md) and [shared surface/developer contract](SURFACE_AND_DEVELOPER_CONTRACT.md).

## Application guides

- [SpaceMountain Web](../apps/spacemountain-web/README.md) — shell host, sign-in, integrated gateway and browser runtime.
- [SpaceMountain](../apps/spacemountain/README.md) — shell state, workspace, app frames, OverlayBay and universal appearance.
- [SPMT Service](../apps/spmt-service/README.md) — identity, shared authority, app catalog, grants, jobs and provider integrations.
- [Commlink](../apps/commlink/README.md) — canonical desks, mail, notifications, live chat and shared messaging contracts.
- [Companion](../apps/companion/README.md) — paired local device, OBS, media, workflows, diagnostics and updates.
- [Discord Stream Hub](../apps/discord-stream-hub/README.md) — Discord community, publishing, calendar, moderation, points and media workers.
- [HearMeOut](../apps/hearmeout/README.md) — watch rooms, playback, IPTV/HLS, Discord Activity, RTC, voice and media workers.
- [Mission Control](../apps/mission-control/README.md) — owner/operator projections and Apollo-native terminal integration requirements.
- [MountainView](../apps/mountainview/README.md) — mobile/wearable pairing, voice routing, QR/camera events and Companion commands.
- [Nebula Arcade](../apps/nebula-arcade/README.md) — games, Tag, Bingo, Quackverse, Mosaic, overlays and provider runtime.
- [Reference App](../apps/reference-app/README.md) — non-production example of SPMT settings, embed bridge, widgets and job contracts.
- [Stellar Core](../apps/stellar-core/README.md) — AI job execution, hosted provider chain, private context, research, speech and privacy.
- [StreamWeaver](../apps/streamweaver/README.md) — commands, personas, rewards, overlays, flows, speech, avatars and media workers.
- [Restream Control Service](../services/restream-control/README.md) — private browser-control receiver; Node 2 integration remains pending.

## Platform and product references

- [Account onboarding and password setup](ACCOUNT_ONBOARDING_CONTRACT.md)
- [Ecosystem user guide](ECOSYSTEM_USER_GUIDE.md)
- [Monetization foundation](MONETIZATION_FOUNDATION_V1.md)
- [Nebula Arcade canonical ownership](NEBULA_ARCADE_OWNERSHIP.md)
- [Nebula Arcade game widgets](NEBULA_GAME_WIDGETS.md)
- [Nebula OverlayBay game-mix contract](NEBULA_OVERLAY_BAY_GAME_MIX.md)
- [SpaceMountain product UI](PRODUCT_UI.md)
- [Stellar Chat vertical](STELLAR_CHAT_VERTICAL.md)
- [StreamWeaver avatar studio integration](STREAMWEAVER-AVATAR-STUDIO-INTEGRATION.md)
- [StreamWeaver flow and overlay ownership](STREAMWEAVER_FLOW_AND_OVERLAY_OWNERSHIP.md)
- [HearMeOut broadcast controls](hearmeout-broadcast-controls.md)
- [Avatar Studio animation import](avatar-studio-animation-import.md)
- [RTC fallback policy](rtc-fallback.md)
- [Self-healing coder policy](SELF_HEALING_CODER_POLICY.md)

## Implementation architecture

- [Apollo operator capabilities and terminal integration](architecture/APOLLO_OPERATOR_CAPABILITIES.md)
- [Chat Gateway and Commlink transport](architecture/CHAT_GATEWAY_COMMLINK_TRANSPORT.md)
- [Commlink mail compatibility](architecture/COMMLINK_MAIL_COMPATIBILITY.md)
- [Discord Stream Hub supervised live runtime](architecture/DISCORD_STREAM_HUB_LIVE_RUNTIME.md)
- [HearMeOut supervised runtime](architecture/HEARMEOUT_SUPERVISED_RUNTIME.md)
- [Live cutover rehearsal](architecture/LIVE_CUTOVER_REHEARSAL.md)
- [MountainView and Companion device gateway](architecture/MOUNTAINVIEW_COMPANION_DEVICE_GATEWAY.md)
- [Nebula Arcade supervised provider runtime](architecture/NEBULA_ARCADE_PROVIDER_RUNTIME.md)
- [Nebula Arcade chat commands](architecture/NEBULA_CHAT_COMMANDS.md)
- [Nebula Arcade settings and shared rules](architecture/NEBULA_GAME_SETTINGS_AUDIT.md)
- [Provider credential authority](architecture/PROVIDER_CREDENTIAL_AUTHORITY.md)
- [Shadow live read](architecture/SHADOW_LIVE_READ.md)
- [Storage and recovery boundaries](architecture/STORAGE_AND_RECOVERY_BOUNDARIES.md)
- [StreamWeaver ecosystem integration](architecture/STREAMWEAVER_ECOSYSTEM_INTEGRATION.md)
- [StreamWeaver supervised provider runtime](architecture/STREAMWEAVER_PROVIDER_RUNTIME.md)
- [StreamWeaver/Stellar reply loop](architecture/STREAMWEAVER_STELLAR_REPLY_LOOP.md)
- [Workspace and application surfaces](architecture/WORKSPACE_SURFACES.md)

## Persistence and deployment

- [Async record-store runtime factory](deployment/ASYNC_RECORD_STORE_RUNTIME_FACTORY.md)
- [Nebula network/Turso migration](deployment/NEBULA_NETWORK_TURSO_MIGRATION.md)
- [SQLite external-database compatibility audit](deployment/SQLITE_EXTERNAL_DATABASE_COMPATIBILITY_AUDIT.md)
- [Turso live runtime smoke test](deployment/TURSO_LIVE_RUNTIME_SMOKE_TEST.md)
- [Turso migration notes](deployment/TURSO_MIGRATION.md)
- [Production and release index](production/README.md)
- [Stella AI provider chain](production/AI_PROVIDER_CHAIN.md)
- [StreamWeaver local Kokoro TTS snapshot](production/STREAMWEAVER_LOCAL_KOKORO_TTS_2026-11-04.md)

## Development tools and testing

- [Development tooling index](development/README.md)
- [Persistence audits and migrations](development/persistence-and-migrations.md)
- [Donor parity and source audits](development/parity-audits.md)
- [Repository scripts index](../scripts/README.md)
- [Hostless runtime tooling](../scripts/hostless/README.md)
- [Parity audit engine](donor-parity/APOLLO_PARITY_ENGINE.md)
- [REA reconstruction workflow](donor-parity/REA_RECONSTRUCTION_WORKFLOW.md)
- [Main offline test checklist](MAIN_OFFLINE_TEST_CHECKLIST.md)

## Historical archive

The [quarantine manifest](../mt-delete-me-archive/MANIFEST.md) indexes the preserved donor evidence, dated audits, retired deployment plans and superseded issue reports. These records are retained for export to the SPMT storage repository; they are not current operating instructions.
