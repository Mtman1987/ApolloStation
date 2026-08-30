# ApolloStation

ApolloStation is the implementation monorepo for the SPMT Ecosystem Core and the SpaceMountain application platform.

## Status

The project is no longer a speculative rebuild blueprint. The shared platform, application contracts, product ports, test suite, Review/Release Sprite workflow, and migration tooling are implemented in this repository. Blue production remains authoritative until each production cohort passes its migration and rollback gates.

On 2026-08-30 the architecture documentation was reset around what the system actually became. Earlier debate ledgers, proposed topologies, milestone wiring notes, and phase plans remain available in Git history and donor evidence, but they no longer govern implementation.

Current evidence:

- the complete offline acceptance battery passed 571/571 tests;
- the main offline checklist completed 69/69 requirements;
- the current runtime code tree was promoted to the protected Release Sprite;
- the ecosystem-core Stage 1 rehearsal passed health, registry, identity persistence, workspace persistence, supervised restart, and recovery-to-ready checks with outbound integrations disabled;
- no production tenant, DNS route, provider connection, or Blue authority has been moved by those tests.

## Product model

- **SPMT** is the identity, policy, shared-data, developer, entitlement, usage, and authorization authority.
- **SpaceMountain** is the public front door, shell, workspace, and app host.
- **Stellar Core** is the persona-neutral AI execution system; Stella is the default SPMT Community Assistant.
- **Chat Gateway** is the provider-neutral live-chat connection layer.
- **Mission Control** is the owner/operator surface for runtime evidence and bounded operations.
- **Commlink, Discord Stream Hub, StreamWeaver, HearMeOut, MountainView, Companion, Nebula Arcade, Stellar Core, and Mission Control** are registered applications rather than hardcoded exceptions.
- First-party applications use the same catalog, launch, scope, SDK/API/event/job, AppFrame, and lifecycle contracts available to approved third-party applications. SpaceMountain ownership changes publisher trust and granted scopes, not launch plumbing.

## Read this documentation in this order

1. `ARCHITECTURE.md` — the current architecture and the decisions that survived implementation.
2. `CURRENT_STATE.md` — evidence-backed implementation and rehearsal status.
3. `PRODUCTION_PATH.md` — the practical path from the current state to Blue retirement.
4. `APP_CONTRACTS.md` — mandatory rules for first- and third-party apps, workers, data, URLs, lifecycle, and surfaces.
5. `docs/PRODUCT_UI.md` — detailed visual/surface behavior.
6. `docs/SPRITES_SANDBOX_HANDOFF.md` — Review/Release Sprite mechanics.
7. `docs/MAIN_OFFLINE_TEST_CHECKLIST.md` — the offline acceptance procedure/evidence.

`docs/architecture/` contains implementation notes for individual verticals. `docs/donor-audits/` and `evidence/raw/` are migration/history evidence, not governing architecture.

## Permanent public names

`spmt.live` remains the SPMT platform/core identity. `spacemountain.live` remains the public ecosystem front door. SpaceMountain-owned apps use stable owned launch names such as:

- `commlink.spacemountain.live`
- `companion.spacemountain.live`
- `discordstreamhub.spacemountain.live`
- `hearmeout.spacemountain.live`
- `missioncontrol.spacemountain.live`
- `mountainview.spacemountain.live`
- `nebula.spacemountain.live`
- `stellar.spacemountain.live`
- `streamweaver.spacemountain.live`

Those names are permanent product addresses. The infrastructure behind them may move. A hostname never grants app trust by itself.

## Governing rules

1. One shared fact has one canonical authority.
2. App-private durable state is allowed when it is genuinely product-private; it is not a competing answer to an SPMT shared fact.
3. First-party apps dogfood the public developer platform instead of using private shortcuts.
4. Stable owned URLs identify our products; hosting-provider URLs are implementation details.
5. Deployment boundaries follow workload behavior, security, failure, and scaling needs rather than brand names.
6. Blue remains available until the corresponding Green capability/app passes live proof and rollback.
7. No two runtimes may simultaneously own writable/responding authority for the same tenant/provider/channel.
8. Provider credentials, infrastructure credentials, and app trust are scope/identity decisions, never URL decisions.
9. Recovery outcomes are mandatory; a particular recovery product name or hosting vendor is not.
10. If implementation evidence disproves this architecture, change this architecture explicitly rather than preserving an obsolete plan for consistency.
