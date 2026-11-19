# ApolloStation architecture

Updated: 2026-11-19  
Scope: the architecture implemented in this monorepo and the intended two-node Hostless runtime. For current deployment evidence, see CURRENT_STATE.md. This document describes boundaries and responsibilities; it is not a claim that every product integration has passed live acceptance.

## 1. Architecture in one view

ApolloStation is the implementation monorepo for the SPMT Ecosystem. It combines one shared platform authority, a public SpaceMountain shell, first-party product applications, supporting workers, shared packages, and operator/developer interfaces.

The primary rule is: **shared facts have one authority; product-specific behavior and data stay with the product that owns them.**

Logical request flow:

    Browser / companion / approved tool
                 |
          SpaceMountain shell
                 |
        SPMT SDK and contracts
                 |
          SPMT Service
          /     |      \
   authority  jobs/events  provider grants
      |          |             |
 shared facts  workers      providers
      |
 first-party applications and their private stores

Applications may communicate through documented SPMT APIs, SDK methods, events, jobs, provider grants, and registered app routes. They must not reach into another application's database or private filesystem.

## 2. Platform layers

### SPMT authority

SPMT Service is the trusted platform boundary for:

- user identity, sessions, tenant membership, and account recovery;
- app registration, catalog, install state, scopes, and grants;
- shared workspace/profile/theme facts and shared XP/reward facts;
- provider links, OAuth state, encrypted credential authority, and short-lived provider grants;
- shared jobs, leases, retries, events, outbox delivery, and audit evidence;
- usage, entitlements, plan policy, and metering;
- shared Commlink messaging/notifications and platform operations APIs.

SPMT owns cross-app facts. It does not own every app's private product database.

### SpaceMountain

SpaceMountain is the public ecosystem entry point and authenticated application host. It provides the shell, navigation, workspace, app catalog, launch/frames, universal appearance settings, and OverlayBay.

SpaceMountain Web is the integrated HTTP host and same-origin gateway. The shared SpaceMountain package owns reusable shell and workspace behavior. Do not duplicate shell UI or identity/session logic inside every product app.

### Product applications

- Commlink — personal and community communications, mail/history, notifications, and live chat presentation.
- Companion — paired local device and OBS execution with explicit local permissions.
- Discord Stream Hub — Discord community features, publishing, spotlight and supervised worker workflows.
- HearMeOut — synchronized media/watch rooms, playback, voice and media jobs.
- Mission Control — owner/operator evidence and workload/usage projections; Apollo-native terminal integration is a separate implementation requirement.
- MountainView — companion/device-facing experience.
- Nebula Arcade — games, Chat Tag, Quackverse, game widgets, art and provider events.
- Stellar Core — persona-neutral AI execution, memory/privacy and speech; Stella is the default community assistant persona.
- StreamWeaver — streaming automation, chat commands, personas, rewards, avatar/media tools and provider workflows.

### Supporting services

- Chat Gateway — provider-neutral Twitch, Discord, Kick, YouTube and TikTok ingestion/connection supervision, normalization, deduplication, reconnect/cursor handling and delivery to registered consumers.
- Restream control service — isolated browser-control receiver for approved Restream workflows; it is not a general-purpose remote browser or shell.

### Shared packages

Shared packages provide versioned contracts, auth, authority, account recovery, data adapters, execution jobs, outbox, provider grants, runtime health, monetization, platform operations, SDK, UI, CLI and MCP.

A shared capability should have one owning package. Apps consume the package through its public export rather than copying implementation.

## 3. Identity, trust and app lifecycle

1. The user signs in through the supported SPMT identity/session path.
2. SpaceMountain obtains the authenticated session and tenant context.
3. The app catalog provides a registered launch URL and app metadata.
4. SPMT grants only the scopes/capabilities required for the caller, tenant, and action.
5. The app calls SPMT through the SDK or a documented API boundary.
6. Background work is accepted as a durable job/event and executed by a supervised worker.
7. Results and operational evidence are returned through the owning contract.

App registration is not authorization by itself. A launch URL is not a credential. An iframe is not a security boundary. Worker credentials are service identities and must be unique, scoped, and server-side.

The signed-out shell must visibly present the SPMT bridge recovery gate. A 401/403 from an anonymous session check is expected; a blank page is not an acceptable recovery experience. Never bypass the gate to hide a session propagation defect.

## 4. Runtime topology

The active target is Hostless Node 1 and Node 2.

| Node | Primary responsibilities |
|---|---|
| Node 1 | SPMT authority and SpaceMountain integrated web host/workspace |
| Node 2 | Chat Gateway plus the co-located StreamWeaver and Nebula provider-runtime chain |

Node 3 is retired from the active topology. Its dedicated app-creation workflow, bootstrap script, and npm command were removed during repository hygiene. Workloads formerly assigned to Node 3 must be placed on Node 1 or Node 2 with explicit capacity and isolation.

Fly.io, Sprites, and the donor Rotator application are not Apollo production dependencies. The codebase still contains legacy execution-target identifiers and some donor-origin defaults; these are known cleanup/migration debt, not permission to deploy or call those retired services. They must be removed or replaced in coordinated, tested changes.

The Hostless release workflow retains a historical three-node filename because dispatchers, tests, and path filters reference it. Its current deployment matrix is Node 1 and Node 2. Do not rename it until every reference is updated in one change.

## 5. Persistence and ownership

### Shared authority

SPMT owns identities, tenant/membership/role facts, app registry and grants, shared workspace/profile settings, shared XP/rewards, provider-link/grant state, platform jobs/events, usage/entitlements, and shared communications.

### App-private state

Each product may own bounded private durable records: for example game state, watch rooms, provider channel configuration, app-specific queues, avatar records, or community settings. The product's owning service and schema are responsible for migration, backup, retention and restore.

### Caches and derived state

Caches, staging files, media transcodes, search projections, retry/outbox queues, and scratch data must be explicitly classified. They must not silently become canonical authorities for shared facts.

### Database reality

Several domain stores still use synchronous Node SQLite adapters. The repository also contains asynchronous record-store/Turso HTTP components and migration tooling. A Turso database existing or a migration script passing does not prove every production store uses it.

The actual service runtime adapter and effective database path must be verified. A local /tmp SQLite path is ephemeral and is not durable production storage. Do not silently fall back to it when remote persistence is required.

Before changing a durable store: identify its owner, schema, writer set, migration, backup, integrity, restore, retention, and rollback. Do not dual-write shared facts without an explicit reconciliation contract.

## 6. Jobs, events and provider integrations

Long-running or externally visible work should use durable jobs/outbox/event contracts rather than unbounded in-request execution.

- Jobs require an owning app, capability, tenant, idempotency key, execution target, lease, fencing, heartbeat, bounded retry and terminal result.
- Provider credentials remain in SPMT. Workers receive short-lived scoped grants, not refresh tokens or copied secrets.
- Provider connection supervisors own reconnect, backoff, cursor, lease and reauthorization state.
- Consumers must be unique/fenced so restart or scale-out cannot create duplicate bots, awards, messages, or scheduled actions.
- Live provider acceptance is separate from mocked tests and offline suite results.

The Chat Gateway is a shared ingress/connection layer, not the owner of each app's business rules. It normalizes events and delivers them to registered consumers; StreamWeaver, Nebula Arcade, Discord Stream Hub, HearMeOut, and Commlink retain their product logic.

## 7. Operator experience and terminal

Mission Control is Apollo's owner/operator product surface. Its current package exports a manifest and pure workload/monetization projections; it does not yet provide a full terminal UI or server.

The terminal must be Apollo-owned and use the same SPMT identity, scopes, workspace, logs, diagnostics, and audit contracts as other operator controls. OverlayBay can host it as a frame/panel using the existing move, resize, stack, lock, hide, mute, duplicate, close, reopen, and save behavior.

A terminal panel must not imply unrestricted shell access. The backend must define allowlisted commands/actions, owner authorization, explicit confirmation for writes, idempotency, audit events, output redaction, byte/time limits, cancellation, and rollback. No host filesystem traversal, environment dumps, secret retrieval, arbitrary process execution, or separate Rotator control plane.

## 8. Security boundaries

- Validate tenant, actor, caller app, scope, capability, and correlation context at every service boundary.
- Use SPMT sessions for people and distinct service identities for workers.
- Keep provider secrets and infrastructure credentials server-side.
- Apply same-origin/CSRF protections to browser state changes.
- Keep iframe framing policy explicit; never rely on frames as authorization.
- Bound request bodies, proxy responses, logs, pagination, caches, retries, and worker concurrency.
- Redact credentials before logs, artifacts, diagnostics, model context, or UI.
- Do not allow arbitrary proxy destinations or arbitrary URL/file selection.
- Keep app-private data isolated and shared facts canonical.
- Mutating infrastructure actions require explicit owner approval, audit and rollback evidence.

## 9. Performance principles

The monorepo should remain modular without loading every app's full runtime into every request.

- Keep SpaceMountain Web a thin composition/gateway layer.
- Lazy-load app-specific browser code when opened; do not bundle every product UI into the global shell.
- Share SDK, contracts, UI and domain logic instead of duplicating them.
- Keep synchronous database/file work off request hot paths where practical.
- Avoid redundant polling, repeated initialization, duplicate refresh loops and unbounded in-memory maps.
- Bound media dimensions, upload sizes, output sizes and concurrency.
- Serve compressed/appropriately sized media and cache immutable static assets.
- Retain only assets that are referenced by product routes or documented source workflows.
- Measure cold start, memory, bundle size, request latency, database query count and provider reconnect churn before optimizing.

## 10. Validation and release evidence

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Focused audits:

    npm run release:audit
    npm run cutover:audit
    npm run persistence:audit
    npm run nebula:check

Evidence levels must be reported separately:

- compile: build/typecheck passed;
- offline regression: deterministic local tests passed;
- structural audit: config/source inventory passed;
- workflow: named Actions jobs completed;
- deployment: exact revision is running on each intended node;
- live acceptance: owner browser journey and real provider/media behavior verified.

A passing PR workflow does not deploy production. A Node 1 deployment does not certify Node 2. No release is complete without exact commit identity, node health, logs, persistence/restart proof, and rollback evidence.

## 11. Known migration and cleanup debt

The following are intentionally visible rather than hidden by a misleading "complete" label:

- Node 1 shell/sign-in recovery and owner browser acceptance.
- Node 2 deployment and worker/provider connection acceptance.
- Full runtime proof that durable SPMT/app stores use the intended remote persistence backend rather than ephemeral local paths.
- Replacement of residual Fly donor origins in HearMeOut and Nebula/Quackverse generation paths.
- Removal or migration of legacy Sprite/Fly execution-target defaults and stale capability-wiring entries.
- Real Twitch/Discord/Kick/YouTube provider workflows, voice/media playback and restart/restore acceptance.
- Apollo-native terminal backend and OverlayBay frame integration.
- Detailed per-app and per-tool README coverage.

These are tracked in the current state and app-specific acceptance documents. Do not add duplicate dated handoffs for every small defect.

## 12. Change rules

1. Identify the owning layer before changing behavior.
2. Prefer one shared implementation behind a versioned contract.
3. Preserve app-private data ownership and app identity.
4. Add tests at the boundary that owns the behavior.
5. Keep production secrets and data out of source and diagnostics.
6. Confirm runtime/workflow references before removing scripts, files, assets, or dependencies.
7. Update the owning README and index in the same change.
8. Verify behavior with the narrow test, full validation, and actual runtime evidence appropriate to the change.
