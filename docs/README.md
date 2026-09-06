# ApolloStation documentation

All architecture, contracts, development notes, audit evidence and production runbooks live here. The root README is the repository entry point. Runtime code, tests, configuration, build tools and required third-party notices remain with their implementation.

## Start here

1. [Production cleanup and validation](production/READINESS_CLEANUP_2026-09-06.md)
2. [Architecture](ARCHITECTURE.md)
3. [Application contracts](APP_CONTRACTS.md) and [shared surface/developer contract](SURFACE_AND_DEVELOPER_CONTRACT.md)
4. [Production path](PRODUCTION_PATH.md)
5. [Offline acceptance procedure](MAIN_OFFLINE_TEST_CHECKLIST.md)

Dated documents describe the evidence available at that time; their historical test counts and parity claims are not current launch certification. The production cleanup report states the latest repository verification and remaining cutover limits.

## Reference index

### Platform and product guides

- [SPMT Account Onboarding and Password Setup Contract](ACCOUNT_ONBOARDING_CONTRACT.md)
- [App Contracts](APP_CONTRACTS.md)
- [Current ApolloStation Architecture](ARCHITECTURE.md)
- [Current State](CURRENT_STATE.md)
- [Discord Stream Hub: live functionality and Apollo parity review](DSH_LIVE_PARITY_REVIEW_2026-09-05.md)
- [External Runtime Reference Audit and CPU AI Trial Plan](EXTERNAL_RUNTIME_REFERENCE_AUDIT_2026-08-24.md)
- [ApolloStation main offline test checklist](MAIN_OFFLINE_TEST_CHECKLIST.md)
- [Monetization foundation v1](MONETIZATION_FOUNDATION_V1.md)
- [Nebula Arcade canonical ownership](NEBULA_ARCADE_OWNERSHIP.md)
- [Nebula Arcade game widgets](NEBULA_GAME_WIDGETS.md)
- [Nebula Arcade Overlay Bay Game Mix Contract](NEBULA_OVERLAY_BAY_GAME_MIX.md)
- [Nebula release build — 5 September 2026](NEBULA_RELEASE.md)
- [Donor → Green Parity Ledger](PARITY_LEDGER.md)
- [Production Path](PRODUCTION_PATH.md)
- [Production Recovery Baseline — 2026-08-30](PRODUCTION_RECOVERY_BASELINE_2026-08-30.md)
- [SpaceMountain product UI](PRODUCT_UI.md)
- [ApolloStation staged Sprite handoff](SPRITES_SANDBOX_HANDOFF.md)
- [Stellar Chat Vertical](STELLAR_CHAT_VERTICAL.md)
- [StreamWeaver flow and overlay ownership](STREAMWEAVER_FLOW_AND_OVERLAY_OWNERSHIP.md)
- [StreamWeaver live parity review — 2026-09-05](STREAMWEAVER_LIVE_PARITY_REVIEW_2026-09-05.md)
- [StreamWeaver parity implementation](STREAMWEAVER_PARITY_IMPLEMENTATION.md)
- [Shared Surface and Developer Platform Contract](SURFACE_AND_DEVELOPER_CONTRACT.md)
- [Room audio fallback](rtc-fallback.md)

### Implementation architecture

- [Chat Gateway and Commlink transport](architecture/CHAT_GATEWAY_COMMLINK_TRANSPORT.md)
- [Commlink Mail Compatibility](architecture/COMMLINK_MAIL_COMPATIBILITY.md)
- [Discord Stream Hub supervised live runtime](architecture/DISCORD_STREAM_HUB_LIVE_RUNTIME.md)
- [HearMeOut supervised runtime](architecture/HEARMEOUT_SUPERVISED_RUNTIME.md)
- [Live-slice comparison and cutover rehearsal](architecture/LIVE_CUTOVER_REHEARSAL.md)
- [MountainView and Companion device gateway](architecture/MOUNTAINVIEW_COMPANION_DEVICE_GATEWAY.md)
- [Nebula Arcade supervised provider runtime](architecture/NEBULA_ARCADE_PROVIDER_RUNTIME.md)
- [Nebula Arcade chat commands](architecture/NEBULA_CHAT_COMMANDS.md)
- [Nebula Arcade settings and shared rules](architecture/NEBULA_GAME_SETTINGS_AUDIT.md)
- [Provider credential authority](architecture/PROVIDER_CREDENTIAL_AUTHORITY.md)
- [Live read with Simulation Rooms](architecture/SHADOW_LIVE_READ.md)
- [Storage and Recovery Boundaries](architecture/STORAGE_AND_RECOVERY_BOUNDARIES.md)
- [StreamWeaver supervised provider runtime](architecture/STREAMWEAVER_PROVIDER_RUNTIME.md)
- [StreamWeaver → Stellar reply loop](architecture/STREAMWEAVER_STELLAR_REPLY_LOOP.md)
- [Application and workspace surfaces](architecture/WORKSPACE_SURFACES.md)

### Operations

- [Production Storage Inventory — 2026-08-30](operations/PRODUCTION_STORAGE_INVENTORY_2026-08-30.md)

### Production

- [Production readiness cleanup](production/READINESS_CLEANUP_2026-09-06.md)
- [HearMeOut live inventory](production/HEARMEOUT_LIVE_INVENTORY.md)
- [HearMeOut provider canary evidence — 2026-08-30](production/HEARMEOUT_PROVIDER_CANARY_2026-08-30.md)
- [SPMT live inventory](production/SPMT_LIVE_INVENTORY.md)

### Donor and parity audits

- [Original Chat Tag donor audit](donor-audits/CHAT_TAG_ORIGINAL_GAME_8170c51.md)
- [Final live-donor catch-up](donor-audits/FINAL_LIVE_DONOR_CATCHUP_2026-08-29.md)
- [Live-source catch-up and local-mirror retirement](donor-audits/LIVE_SOURCE_CATCHUP_2026-08-30.md)
- [Live-source catch-up](donor-audits/LIVE_SOURCE_CATCHUP_2026-09-03.md)
- [Production repository baselines](donor-audits/PRODUCTION_REPO_BASELINES_2026-08-23.md)
- [SPMT donor deep audit](donor-audits/SPMT_DEEP_AUDIT_2026-08-23.md)

## Historical source material

[Captured source manifest](archive/evidence/MANIFEST.md) indexes the original documentation/specification snapshots. They are retained under this documentation archive, outside application and package source. Source/public mirrors stay intact as dated evidence; current implementation decisions use the live-source audit and current code.

[Branch preservation inventory](production/branch-consolidation-2026-09-06.json) records the reviewed heads and the main commit preserving each branch's work.
