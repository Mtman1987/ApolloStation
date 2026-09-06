# Current ApolloStation Architecture

Updated: 2026-08-30

This document replaces the original proposal-era blueprint and decision ledger as the governing architecture. It describes the system ApolloStation became after implementation, donor-parity work, application consolidation, Sprites adoption, functional wiring, live-runtime design, cost failures, and production rehearsal.

## 1. What survived from the original plan

The original project got several principles right and they remain non-negotiable:

- one SPMT human identity and policy authority;
- one canonical authority for every shared fact;
- no direct cross-app database shortcuts;
- scoped service identities instead of universal internal keys;
- provider credentials remain provider credentials and are brokered only to authorized services;
- idempotent jobs/events, replay protection, fenced leases, durable retry/outbox behavior, and honest degraded states;
- product runtimes can be stopped or scaled when their workload permits it;
- expensive/high-risk work is isolated when necessary rather than giving every brand a dedicated always-on server;
- old production stays available until replacement and rollback are proven;
- first-party apps should prove the same public platform third-party apps receive.

Those principles produced useful architecture. We keep them.

## 2. What changed materially

### ApolloStation became the implementation, not just the blueprint

The repository started as documentation-first design work. It became the actual monorepo containing shared contracts, SPMT authority, SpaceMountain, apps, workers, CLI/MCP, migration tools, tests, sandbox/release tooling, and production-rehearsal code. Repository layout is therefore settled: one source monorepo may produce many runtime boundaries.

### Sprites became an important release/runtime tool

The original plan was Fly-centric. During implementation, Review and Release Sprites became the safest place to install and exercise the complete codebase, run Qwen, checkpoint releases, verify exact SHAs, and rehearse the shared platform without contacting production providers.

Sprites are not declared the universal production substrate. They are a current execution option. Fly remains useful for workloads that need Fly Machines lifecycle/autoscaling, direct custom-domain support, persistent provider sockets, or independently scaled worker pools. Companion remains the execution target for local device/OBS/media/AI work. Future hosting providers may replace any of these without changing product contracts.

### Brand boundaries and runtime boundaries diverged

A branded app is a product/permission/state owner, not necessarily one machine, one service, one database, or one deployment. Compatible low-risk modules may run together. Persistent sockets, media jobs, room sessions, Xbox sessions, AI workers, and other special workloads may get separate process or machine boundaries.

Scaling policy therefore attaches to **workloads**, not logos.

### “One database” became “one shared-fact authority plus bounded app-private authorities”

SPMT owns ecosystem facts shared across products. Apps may own genuinely private durable state.

Examples:

- SPMT: users, tenants, provider links, app registry/installs, scopes, plans, usage, XP/shared rewards, workspace/theme, shared overlay metadata/grants, shared Commlink account data, provider credential authority, common job/event/audit facts.
- HearMeOut: room membership, room/session playback state, invitations, product-private presence and queue state.
- Nebula Arcade: game-round/session state, game-private inventory/progress where no other product is authoritative.
- StreamWeaver: tenant persona configuration, product-local currency, command/runtime state, private conversation memory according to retention settings.
- workers: cache, scratch, staging and bounded outbox/retry state only as required.

Every local dataset must be classified as `private-authority`, `cache`, `staging`, `outbox`, or scratch/temporary. A local copy of a shared fact never becomes canonical merely because it is durable.

### First-party versus third-party app plumbing was removed

SpaceMountain-owned apps now use the same catalog registration and launch contract as external apps. A publisher supplies a complete HTTPS `launchUrl`. The registry does not reconstruct it from a special SpaceMountain host convention.

Publisher identity, review status and scopes determine trust. Hostname does not.

### Permanent owned domains replaced infrastructure URLs as product identity

Public first-party product URLs live on domains SpaceMountain controls. Infrastructure addresses such as `*.fly.dev` and `*.sprites.app` are deployment details. External developers may use any safe approved HTTPS origin they control.

DNS/custom-domain routing is deliberately separate from app authorization.

### Cutover became risk-ordered rather than phase-number-ordered

The original operations plan used large sequential phases and a mandatory “complete integrated Fly sandbox” before any real app canary. That was useful while the system was imaginary, but it is now too rigid.

The current rule is evidence-based progression:

1. shared platform/core proof;
2. infrastructure/storage/recovery proof required by the specific capability being moved;
3. shadow/read-only/live-provider rehearsal where possible;
4. the lowest-blast-radius real canary;
5. rollback proof;
6. progressively riskier apps and cohorts.

A capability does not wait for unrelated hardware work, but it also cannot bypass a dependency it genuinely needs.

## 3. Logical platform

```text
Users / Developers
        |
        +--> spacemountain.live  (public shell / workspace / app host)
        |
        +--> permanent app URLs  (*.spacemountain.live)
        |
        +--> spmt.live            (account / developer / platform authority)
                         |
                         v
                  SPMT contracts
       identity / auth / registry / scopes
       shared facts / jobs / events / usage
       provider grants / audit / runtime truth
                         |
          +--------------+---------------+
          |              |               |
       Product        Shared          Operator
       private        services        control
       state          & workers       plane
          |              |               |
     HearMeOut       Chat Gateway     Mission Control
     Nebula          Stellar Core     Rotator
     StreamWeaver    shared jobs      recovery tooling
     DSH, etc.       provider I/O
```

The important boundary is contractual ownership, not physical co-location.

## 4. Runtime placement

Runtime placement is configuration backed by measurement.

### Sprites are appropriate for

- Review/Release environments;
- complete-codebase integration and supervised processes;
- CPU-local Qwen or similar bounded workloads when measured cost/performance is favorable;
- workloads where checkpoint/release semantics are useful;
- controlled sandbox execution.

### Fly/Machines are appropriate for

- independently scalable workers;
- provider sockets/bots requiring explicit unique-consumer lifecycle;
- room/session workers;
- burst media jobs;
- workloads where start/create/drain/stop/destroy policy matters;
- always-available ingress/API components when Fly is the selected provider;
- recovery/storage boundaries when that design is selected.

### Companion is appropriate for

- local OBS/device actions;
- local FFmpeg/media processing;
- approved local AI;
- private/local hardware interaction.

No app is entitled to infrastructure credentials. Apps report health/demand and request work through public scoped contracts. The private operations controller applies provider-specific actions.

## 5. Storage rules

### Shared facts

SPMT is the only supported authority boundary for shared ecosystem facts. The physical backing store is replaceable. SQLite, PostgreSQL, object storage, a network store, or another provider may be chosen behind the contract as requirements change.

### App-private state

A product may keep a small bounded durable store when the data is genuinely private to that product and durability simplifies correctness. This store has an owner, migrations, integrity checks, backup/restore policy, size ceiling and retention policy.

### Media

Metadata ownership follows the product/shared-fact rule. Large durable media bytes should not live indefinitely on worker scratch disks. Use object/media storage or another explicitly owned durable location. Worker caches are replaceable.

### Recovery

Recovery is an **outcome requirement**, not a mandatory product topology.

Before authoritative production data moves, we require:

- independent recovery points outside the active writer failure boundary;
- integrity/checksum/schema/count verification;
- restore into an isolated target;
- a documented and rehearsed writer-fencing/promotion process where the store requires it;
- rollback/failback appropriate to the chosen storage technology;
- an additional protected copy outside a single provider/account failure boundary for critical shared authority.

The old provisional name `spmt-vault`, fixed Fly placement, and exact backup implementation are not architectural requirements. If the selected storage technology provides a safer/simpler equivalent, use it. What cannot be removed is tested recoverability.

## 6. Application platform and trust

Every app uses one platform model:

```text
publisher -> manifest/catalog registration -> review/approval -> install -> grants/scopes -> launch -> runtime
```

SpaceMountain apps go through that model too.

Trust derives from:

- authenticated publisher identity;
- review/approval status;
- installed version;
- tenant/user authorization;
- granted scopes;
- runtime/service identity;
- high-risk approval rules.

Trust does **not** derive from:

- being hosted on `spacemountain.live`;
- being in the monorepo;
- being written by a first-party developer;
- sharing infrastructure with SPMT.

## 7. URL and domain architecture

Permanent first-party names currently reserved:

- `commlink.spacemountain.live`
- `companion.spacemountain.live`
- `discordstreamhub.spacemountain.live`
- `hearmeout.spacemountain.live`
- `missioncontrol.spacemountain.live`
- `mountainview.spacemountain.live`
- `nebula.spacemountain.live`
- `stellar.spacemountain.live`
- `streamweaver.spacemountain.live`

`spmt.live` remains the platform/core identity and `spacemountain.live` remains the public ecosystem front door.

The DNS target behind any name can change without changing the app registration or user-visible URL. OAuth callbacks, OBS sources and durable external links should prefer owned product names once production routing is established.

Third-party apps may use arbitrary safe HTTPS URLs. Their hosting choice is not our portability problem.

## 8. Product-specific runtime principles

### Chat Gateway

Owns provider connections, normalization, cursors/reconnect and provider-neutral egress. StreamWeaver and Nebula consume it rather than opening duplicate sockets for the same authority where the shared gateway applies.

### StreamWeaver

Owns tenant command/persona behavior and private settings/state. Because it can actively speak and execute across many tenants, it has the highest duplicate-output risk. Its migration must prove single output authority, replay safety and cohort isolation before broad enablement.

### Nebula Arcade

Owns the Games Hub and all games as bounded modules under one product. It may maintain game-private durable state. Provider outputs/commands require the same single-authority and dedupe rules as StreamWeaver. It is a high-blast-radius late migration.

### Discord Stream Hub

Owns community/live/spotlight/moderation product behavior. It should use SPMT for shared identity/XP and provider grants. Its live Discord publisher requires durable idempotency but has a lower immediate blast radius than StreamWeaver/Nebula in normal low-activity windows.

### HearMeOut

Owns room/media private state. Media and room workers should scale independently of the durable product authority. Existing Blue volumes are migration sources to classify, not shapes to copy wholesale.

### Stellar Core

Owns persona-neutral AI execution/routing/jobs. Stella and tenant personas are presentations above it. Hosted versus Companion routing is policy/entitlement driven and measured; no provider is permanently encoded as architecture.

### MountainView and Companion

SPMT owns public device identity/authorization. Companion owns local execution; MountainView owns its product workflows. Hardware/local jobs must not turn cloud workers into device authorities.

## 9. Operations

The Rotator/Mission Control model remains useful but should be provider-neutral at the contract level. Today it can operate Fly workloads; future adapters can control other providers without changing app APIs.

Every lifecycle action needs:

- bounded desired policy;
- fresh health/demand evidence;
- fencing/idempotency;
- drain/lease safety;
- cost ceilings;
- audit evidence;
- rollback/circuit breaking.

A provider accepting a start/scale action is not readiness. Readiness must be verified by the workload.

## 10. What is intentionally no longer governing

The following ideas are retained only as history unless re-adopted with current evidence:

- Fly as the mandatory home for the entire ecosystem;
- one named `spmt-vault` Fly app as the only valid recovery design;
- a specific pre-created Machine topology before measurements;
- one giant integrated infrastructure rehearsal that blocks unrelated low-risk canaries;
- one deployment per branded app;
- one physical database containing every product-private record;
- private launch plumbing for first-party apps;
- infrastructure-provider hostnames as durable public app URLs;
- frozen donor copies as ongoing parity sources after current live/GitHub evidence is available.

## 11. Change rule

Architecture documents are not sacred. Code is not automatically truth either. When production evidence, cost, provider capabilities or product behavior changes materially, compare the current implementation and the current requirement, make the decision explicitly, update this document, then change code/runtime. Do not preserve an obsolete topology merely because it once had a decision number.
