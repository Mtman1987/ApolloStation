# ApolloStation current state

Updated: 2026-11-19  
Repository: Mtman1987/ApolloStation  
Purpose: concise, evidence-labelled operating snapshot. This file supersedes older status summaries; dated handoffs in the quarantine archive are historical records only.

## 1. Product and repository

ApolloStation is the SPMT Ecosystem implementation monorepo. It contains shared platform packages, SPMT authority/service code, the SpaceMountain shell, first-party applications, supporting workers/services, migration and operations tools, and tests.

The root npm workspace includes packages/* and apps/*. The source tree also contains the isolated Restream control service under services/.

### Product applications

- SpaceMountain — public ecosystem shell, workspace, app catalog and launch host.
- SPMT Service — identity/session, shared authority, registry, grants and platform APIs.
- Commlink — ecosystem communication surface over shared SPMT messaging/history and Chat Gateway.
- Companion — local device/OBS execution and pairing surface.
- Discord Stream Hub — Discord community, moderation, publishing and live worker workflows.
- HearMeOut — synchronized watch/media rooms and voice/RTC workflows.
- Mission Control — owner/operator diagnostics, logs, approvals and bounded operations; the Apollo terminal belongs in the Apollo operator surface, not a Rotator donor.
- MountainView — companion/device-facing product surface.
- Nebula Arcade — games, Chat Tag, Quackverse and game/overlay runtime.
- Stellar Core — persona-neutral AI execution; Stella is the default public community assistant.
- StreamWeaver — streaming automation, chat commands, personas, rewards and provider workflows.
- Chat Gateway — provider-neutral live connection and message normalization service.

See the application and package indexes in the root README and docs index. Individual READMEs are being added and verified in the repository hygiene work.

## 2. Runtime and deployment

The active Hostless topology is two nodes:

- **Node 1:** SPMT authority and SpaceMountain shell/workspace, with the locally composed web and supporting app surfaces configured by the release workflow.
- **Node 2:** Chat Gateway with the co-located StreamWeaver and Nebula provider-runtime chain.

Node 3 is not an active deployment target. Its dedicated app-creation workflow, bootstrap script, and npm command have been removed on the cleanup branch. The Hostless release workflow still has a historical three-node filename, but its current deployment matrix contains Node 1 and Node 2. Do not rename it without updating all dispatchers, tests, path filters, and references.

Fly.io, Sprites, and the donor Rotator are not Apollo production dependencies. Do not add new runtime requirements for them. The Rotator donor is retired; operator terminal and controls are intended to live inside Apollo.

### Deployment evidence boundary

The repository's Hostless release workflow contains validation and node deployment stages. A passing typecheck or offline test is not a deployment. A successful workflow dispatch is not a successful deployment. A Node 1 result does not certify Node 2.

The latest working context for this cleanup reports unresolved Node 1 shell/sign-in behavior and a failed Node 2 deployment attempt. A full green two-node production release and end-to-end owner acceptance have not been established by this document. Check the latest Actions run, exact commit SHA, deployment logs, and live browser result before making a stronger claim.

## 3. Owner sign-in and shell

The current owner recovery path uses the SPMT bridge JSON flow. The anonymous session endpoint intentionally rejects unauthenticated requests; the browser must visibly present the SPMT bridge recovery gate rather than leave the user with a blank shell.

The sign-in recovery change is on PR #526, branch fix/node1-auth-gate-fallback-2026-11-19. Its typecheck, full test suite, and offline parity checks passed in the latest reported PR validation. It has not been treated as a production fix until merged, deployed, and verified in a real browser.

Automatic SPMT PKCE sign-in remains distinct from bridge JSON recovery. Do not weaken the sign-in gate to hide an app-frame or session propagation defect.

## 4. Persistence and data ownership

- SPMT is the canonical authority for cross-app/shared facts.
- Product apps may own bounded private durable state where it is genuinely product-specific.
- Caches, staging, scratch, and retry/outbox records must be explicitly classified and must not silently become authorities for shared facts.
- The configured remote Turso database is part of the current persistence direction. Do not assume a local /tmp SQLite path is durable across Hostless restarts.
- Every authoritative dataset needs an owner, schema/migration policy, backup, integrity check, restore proof, retention policy, and a single-writer/reconciliation plan.
- Never copy secrets into source, documentation, diagnostics, or chat.

The owner XP import to shared Turso was verified against the export counts in the November 19 handoff. That proves the named import tables/counts only; it does not prove every app database or every product dataset has completed migration.

## 5. Product capability status

Code presence and offline tests do not equal live-provider acceptance. Treat the following as work areas, not blanket production certifications.

| Product | Implemented foundation | Acceptance still required |
|---|---|---|
| SpaceMountain | Shell, workspace, app catalog, app frames, shared UI and integrated gateway | Owner sign-in, blank-screen recovery, real app launch/session propagation, mobile browser smoke |
| SPMT Service | Identity/session, authority, app registry, grants, shared facts and provider authorization | Live owner acceptance, durable recovery/restore and cross-node service identity proof |
| Chat Gateway | Provider-neutral connections, normalization, dedupe, cursor/reconnect and consumer delivery | Real provider OAuth/connections, reconnect and tenant-isolation acceptance |
| StreamWeaver | Commands, personas, rewards, provider consumer and worker composition | Live Twitch/Discord workflows, Kokoro/TTS audibility, persistence/restart and owner acceptance |
| Nebula Arcade | Game hub, Tag, Quackverse, game actions/widgets and provider integration foundation | Live provider/channel discovery, game/reward behavior, restart/restore and tenant acceptance |
| Discord Stream Hub | Web surface, worker, publishing/outbox and community workflow foundation | Effective runtime configuration, guest/media lifecycle, Discord/Twitch delivery and restart/restore |
| HearMeOut | Rooms, membership, playback/queue, media jobs and voice/RTC contracts | Real media decoding/playback, synchronized controls, late join/reconnect, Discord audio and durable restore |
| Stellar Core | Shared persona-neutral AI execution and speech integration foundations | Hosted provider configuration, real response/TTS acceptance, usage and failure/fallback behavior |
| Companion / MountainView | Pairing, device identity and bounded local execution contracts | Actual device/OBS installation and local hardware acceptance |
| Mission Control | Owner-scoped operational evidence, logs and bounded controls foundation | Apollo-native terminal integration, live log retrieval and owner operation acceptance |

## 6. AI and speech

There is no local Qwen model provisioned for Apollo. Do not launch or wait for Qwen. Stella uses the existing configured hosted OpenAI integration when its credential is available. AI availability must not block the rest of Apollo.

Kokoro and other speech providers are separate from text AI. A configured voice is not accepted until audible output is verified in the actual browser/provider path. No paid voice should be silently selected.

## 7. Validation commands

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Additional audits:

    npm run release:audit
    npm run cutover:audit
    npm run persistence:audit
    npm run nebula:check

Record the exact commit, command, exit status, and artifact/log location. Label evidence accurately:

- build/typecheck — compile correctness;
- unit/offline tests — deterministic local behavior;
- structural audits — configuration and source inventory;
- workflow success — automation completed, inspect job details;
- deployment success — exact app/node revision deployed;
- live acceptance — owner/browser/provider behavior verified.

## 8. Current stop conditions

Do not expand the production cohort while any of these remain unexplained:

- owner cannot sign in or reaches a blank shell;
- Node 1 and Node 2 are not both deployed from the intended commit;
- duplicate provider consumers or duplicate output;
- tenant crossover or identity collision;
- shared-fact data drift or competing writable authorities;
- lost or unrecoverable durable state;
- provider credential exposure;
- a required live workflow is represented only by fixtures/offline tests;
- rollback is not defined for the capability being moved;
- runaway cost or unbounded resource use.

## 9. Documentation maintenance

This is the single current status summary. Do not add another dated handoff for every small issue. Put durable architecture and developer instructions in their canonical guides; put short-lived execution evidence in the relevant PR/Actions artifacts. Archive superseded reports in mt-delete-me-archive with a manifest, and update this file only when verified state changes.


## 10. Residual donor and infrastructure references

The following source references remain and are not safe to delete as if they were unused. They are active compatibility paths or release links that need a proper Apollo-owned replacement:

- HearMeOut still defines HEARMEOUT_DONOR_DEFAULT_ORIGIN as the old hearmeout-main Fly origin. The Lounge bridge uses it. Replace the bridge with an Apollo-owned internal HearMeOut route and explicit Hostless origin before removing the fallback.
- Nebula Mosaic generation still defaults STREAMWEAVER_URL to the old StreamWeaver Fly origin. Replace it with the Apollo-owned StreamWeaver generation service and explicit configuration before removing the fallback.
- SpaceMountain Web's Companion and MountainView download routes still point to historical installer/APK assets in StreamWeaver and Rotator donor releases. Move the signed artifacts and release workflow into Apollo-owned storage before changing the URLs.
- Stellar Core and other worker paths still accept legacy sprite/fly execution-target values; some startup defaults still choose sprite. Hostless must explicitly select the supported hosted target until the shared enum/default migration is completed.
- HearMeOut's legacy-worker adapter is still imported by the current web host for voice bridge/persona audio. It is a bounded migration dependency, not dead code. Remove it only after the bridge and persona audio worker are native to Apollo and bidirectional audio acceptance passes.
- The unused CompanionFlySnapshotV1 type was removed after repository-wide reference search found no consumers.

These items are recorded in the owning app READMEs and architecture/release guides. No new production dependency on Fly, Sprites, or the retired Rotator donor is approved.
