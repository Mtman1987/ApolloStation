# Current State

Updated: 2026-08-30

This file records what is implemented and what has actually been proven. It does not restate the architecture or historical debate.

## Repository and release state

- ApolloStation is the implementation monorepo for the current Green system.
- `main` is the active release line.
- Current `main` is `c21f42d922cf552c3aade2c9d2f059122a2907fd`; that commit has the same source tree as the tested catalog-portability commit and exists only to trigger release promotion.
- The protected Release Sprite promotion completed successfully for that exact SHA.
- Review and Release Sprite deployment paths remain private and checkpointed.

## Offline acceptance

The authoritative offline battery passed:

- 571 tests passed;
- 0 failed;
- 0 skipped;
- external networking was blocked by the offline guard;
- focused identity/security, shell/UI, Chat Gateway, StreamWeaver, Nebula Arcade, Discord Stream Hub, HearMeOut, fleet/monetization, and cutover-contract groups all passed;
- the supervised local sandbox started the complete ten-app catalog, persisted a disposable user/workspace, restarted, and returned the same identity, catalog, and durable state;
- the completed offline checklist contains 69/69 checked requirements with no requirement removed.

## Release Sprite Stage 1 rehearsal

The first protected production-rehearsal stage passed on the Release Sprite with providers/outbound integrations disabled.

Proven:

- exact deployed build identity;
- SPMT liveness/readiness;
- canonical ten-app registry;
- disposable identity creation;
- workspace mutation;
- supervised service restart;
- identity persistence across restart;
- tenant persistence across restart;
- workspace persistence across restart;
- registry persistence across restart;
- recovery to healthy service after restart;
- a pre-rehearsal Sprite checkpoint.

Not attempted:

- production tenant migration;
- provider traffic;
- DNS movement;
- Blue shutdown;
- production data authority transfer.

## Application platform

The catalog registration refactor is implemented. First-party and third-party apps now preserve a complete publisher-supplied HTTPS launch URL through the same catalog contract. SpaceMountain ownership changes publisher policy/scopes, not URL plumbing.

Permanent first-party subdomain names have been reserved under `spacemountain.live`, but DNS targets have not been moved to Green production infrastructure yet.

## Shared platform implementation

Implemented foundations include:

- SPMT identity/session/service authorization;
- provider-link authority and unlink/revocation behavior;
- app registry/install/grant contracts;
- workspace/theme/background/dock authority;
- canonical XP/shared reward contracts;
- shared jobs with leases, fencing, retries, dead letters, cancellation and metering;
- provider credential authority and short-lived grant broker;
- app settings and bounded app-private SQLite foundation;
- Commlink mail/live-history contracts;
- overlay widget registration and opaque output grants;
- runtime/operations evidence contracts;
- CLI and MCP adapters over the same scoped operations;
- Account usage/plan/profile separation from app Settings;
- Stellar Core hosted Qwen job path and Companion eligibility/fallback contract;
- AppFrame/EmbedBridge and shared surface/layout contracts.

## Product status

### Chat Gateway

Implemented provider-neutral message, connection supervision, dedupe, cursor/reconnect, consumer delivery and SPMT provider-grant behavior. Green currently exercises it without production provider connections. Controlled concurrent live-provider proof remains.

### StreamWeaver

Donor-backed commands, economy, persona settings, owner summon behavior, memory boundaries, Chat Gateway consumption and durable provider reply handling are implemented and tested offline. Live provider cohorts and donor data reconciliation remain. It is intentionally one of the last broad migrations because duplicate output has high blast radius.

### Nebula Arcade

Twenty-game hub, Tag runtime, Quackverse and other retained game functionality, command collision routing, overlays, gameplay showcase/GIF contracts, banners, XP/events and provider-consumer plumbing are implemented/tested. Live provider/presence/OBS and production data reconciliation remain. It is intentionally late in rollout because it has many tenants and active output paths.

### Discord Stream Hub

Live monitoring, spotlight rotation, Discord publishing/outbox behavior, community/points-related paths and supervised worker composition are implemented/tested with provider traffic disabled. Live provider/config reconciliation remains.

### HearMeOut

Room/media durable authority, membership/invitations/presence, playback/queue behavior, LiveKit grant core, media worker/job path and voice-bridge contracts are implemented/tested. Live LiveKit/Discord/provider transport and migration of actual Blue durable state remain.

Current Blue donor reality discovered during preflight:

- `hearmeout-main` is a Fly app with a 3 GB `/data` volume;
- `hmo-dj-worker` is a separate Fly app with a 10 GB `/data` volume;
- both old configs contain `*.fly.dev` URLs;
- those old volumes are migration sources to classify, not automatically the new architecture.

No Blue HearMeOut stop/restart/deploy mutation was performed by the aborted preflight branch.

### MountainView and Companion

Public device identity/pairing/revoke/job contracts and bounded local execution path are implemented/tested. Real hardware/OBS/installer and production Xbox/device proof remain.

### Stellar Core / Stella

Hosted Qwen job execution, worker readiness, usage accounting, retention/export/delete behavior and Companion fallback eligibility are implemented in Green. Provider/model placement remains policy/configuration rather than a permanent topology guarantee.

### Mission Control / Rotator

Runtime policies, fleet decision contracts, operations logs, coder handoff and deterministic lifecycle logic are implemented/tested. Production infrastructure mutation remains disabled until explicitly enabled after live inventory and rehearsal.

## Data model as implemented

The old statement “one database” is not accurate enough.

Current rule:

- SPMT owns cross-app/shared facts;
- each app may own bounded private durable datasets;
- caches/staging/outboxes/scratch are explicitly non-canonical;
- workers do not become authorities merely because they have disk;
- no app may silently fall back to a private competing store for a shared SPMT fact.

The shared SQLite/app-foundation utilities standardize correctness but do not imply one physical database file for all products.

## Production information still required

Before broad cutover, capture and classify current Blue/live reality for each cohort:

- running compute/processes and actual health;
- volumes and dataset contents/owners;
- database schema/version/counts where authoritative;
- provider connections and credential ownership;
- public routes/callbacks/OBS links;
- actual load/concurrency and cost;
- rollback action and time;
- data migration/reconciliation proof.

Do not copy stale donor documentation into production decisions when live evidence is available.

## Current stop conditions

Do not expand a production cohort when any of these are unexplained:

- tenant crossover;
- duplicate bot/game/community output;
- duplicate awards/actions;
- shared-fact data drift;
- identity collision;
- lost/unrecoverable durable state;
- provider credential leakage;
- an app writing a shared fact outside SPMT authority;
- an untested rollback for the capability being moved;
- runaway cost or scaling;
- a public permanent URL reverting to an infrastructure-provider identity.
