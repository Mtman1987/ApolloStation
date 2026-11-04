# Hostless Three-Node Portability Plan

Status: portability implementation in progress on `hostless-three-node-port`; no production deployment, Hostless resources, production data writes, or Fly.io operations performed.

## Non-negotiable goals

- Preserve ApolloStation as one GitHub monorepo and keep `main` as the source of truth.
- Preserve existing app behavior, player identity, permissions, provider contracts, and inter-service workflows.
- Do not use Fly.io or require a paid Hostless resource.
- Do not deploy until all three nodes pass an end-to-end integration and recovery test.
- Keep production credentials out of Git, build output, logs, and screenshots.

## Hostless constraints verified from current official documentation

- The current shared-allowance policy is per Hostless account: 0.5 vCPU, 1 GiB RAM, and 512 MiB database storage shared across apps, workers, cron jobs, and databases owned by that account.
- Apps/workers and databases consume the same CPU and memory pool. Database storage is a separate allowance.
- Usage above the allowance is billable. A spend limit blocks new over-entitlement capacity but is not a hard invoice ceiling for resources already running.
- Apps can use a monorepo build context; the repository root must be the build context when a service imports sibling workspace packages.
- Runtime web processes must listen on the injected `PORT` and bind to `0.0.0.0`.
- Hostless managed databases include PostgreSQL, MongoDB, and Redis. Persistent volumes are separately priced; do not create one for this zero-cost plan.
- A free static site is not a substitute for a persistent backend or worker.

Official references:
- https://docs.hostless.cloud/plans/limits
- https://docs.hostless.cloud/app/configurations
- https://docs.hostless.cloud/app/hostlessfile
- https://docs.hostless.cloud/app/envvars
- https://hostless.cloud/products/databases

The three-account capacity is conditional on each account independently receiving its own allowance under Hostless policy. The published docs describe an allowance per account but do not explicitly settle whether one person may use multiple accounts to obtain multiple allowances. Do not represent the aggregate as guaranteed until the account policy is confirmed. No account identity should be obscured.

## Resource snapshot from the owner-provided dashboard

Each account's new-app wizard showed the same remaining capacity after a default resource reservation:
- 0.4 vCPU
- 768 MiB RAM
- 0.5 GB storage
- estimated monthly cost $0.00

The documented account-wide pool is 0.5 vCPU / 1 GiB RAM / 512 MiB database storage. The wizard's remaining figures appear consistent with a 0.1 vCPU / 256 MiB app reservation. Confirm the reservation is only a draft and not a running resource before allocating anything else.

## Current codebase findings

- ApolloStation is an npm-workspaces monorepo with `packages/*` and `apps/*`.
- The root build compiles shared packages and the principal apps, including SPMT, SpaceMountain web, Chat Gateway, Nebula Arcade, Discord Stream Hub, StreamWeaver, HearMeOut, MountainView, and Companion.
- The current supervised runtime is `scripts/sprites/run-supervised-sandbox.mjs`. It starts many child processes in one host and wires them through loopback origins.
- That launcher has Sprite-specific URL validation and execution assumptions, sets some internal services to `127.0.0.1`, and includes a HearMeOut execution target default of Fly. It is not a Hostless entrypoint.
- SPMT currently uses the SQLite authority adapter and a local `DATABASE_PATH`. The storage/recovery policy explicitly requires a single writable authority and SQLite-consistent backup/restore.
- No PostgreSQL authority adapter has yet been verified. The current authority/auth/control/usage store contracts are synchronous, and the SQLite adapter performs synchronous transactions (`BEGIN IMMEDIATE`) around synchronous reads and writes. A network PostgreSQL driver is asynchronous, so this is not a drop-in SQL-dialect conversion: a real migration requires an async contract refactor through the authority/auth/control call graph, plus explicit transaction, idempotency, locking, and retry semantics. Do not point a SQLite-backed service at a PostgreSQL URL or assume a database swap is a configuration-only change.

## Target topology

### Node 1 — Core authority and public gateway
Owns the single writable SPMT authority, identity/roles, app registry, core APIs, and the primary public ingress. Only one instance may write the authoritative state. The canonical data store must be durable and restorable without a paid volume.

### Node 2 — Live event and gameplay data plane (co-location boundary)
Runs Chat Gateway, StreamWeaver provider runtime/web, and Nebula Arcade provider runtime together with the Nebula live server until their database ownership is deliberately refactored. `apps/chat-gateway/src/service.ts` constructs both `StreamWeaverProviderRuntime` and `NebulaArcadeProviderRuntime`, pushes their consumers into the Chat Gateway, and calls Nebula check-in bonus logic from StreamWeaver. The Nebula provider runtime and `nebula-arcade-live-server.ts` both open `NEBULA_ARCADE_DATABASE_PATH`. These processes must remain on the same node/filesystem for their respective SQLite owners. Chat Gateway, StreamWeaver, and Nebula retain distinct SPMT service identities and separate database files.

### Node 3 — Discord/community delivery and auxiliary execution
Runs Discord Stream Hub web/worker with its DSH-owned database, plus independently deployable auxiliary services (including the Restream control receiver only after its durable browser-profile requirements are met). It connects to Node 1 authority and Node 2 event/game APIs through authenticated HTTPS contracts. It must not open or share Node 2 SQLite files. DSH Nebula-media integration must call the Nebula service contract, not become a second local Nebula database writer.

This is the safe first partition, not proof that quota is sufficient. If DSH's current integration requires local Nebula database access, that dependency must be replaced by an authenticated API before Node 3 can run it. Do not split the Nebula provider runtime away from Chat Gateway as a shortcut.

OverlayBay and Restream must be mapped to their actual existing Apollo modules and dependencies during the service inventory before they are assigned or declared complete. HearMeOut remains lower migration priority and must not displace the first three priorities.

## Three-account deployment shape (the intended upload target)

The three Hostless accounts are treated as three independently deployed nodes of one application. Account numbers below are labels only; assign the actual account login to each role in the Hostless dashboard. Do not create resources until the account owner confirms the multi-account policy and each account's free allowance.

| Hostless account role | Primary responsibility | Services hosted together | Data owner |
|---|---|---|---|
| Account 1 — Core | Identity, roles, canonical authority, public routing | SPMT authority/API, SpaceMountain ingress and OverlayBay scene API | SPMT authority DB; OverlayBay scene DB |
| Account 2 — Live + Games data plane | Provider chat, StreamWeaver and Nebula gameplay | Chat Gateway worker, StreamWeaver web/provider runtime, Nebula provider runtime and Nebula live server | Chat Gateway DB + provider-connection DB; StreamWeaver DB; Nebula DB |
| Account 3 — Discord/community delivery | Discord workflows and auxiliary execution | Discord Stream Hub web/worker, DSH-owned Lounge state, Restream receiver only after durable-profile port | DSH DB/runtime config; separately owned Restream profile storage |

This is a logical ownership map, not proof that the current Hostless free CPU/RAM quota can run all assigned processes. Build and runtime measurements must decide whether the assignments fit. If not, reduce idle process duplication or move a whole DB-owning app to another role; never split one SQLite database between accounts.

### How the three parts become one ecosystem

- **One identity:** Account 1 is the only canonical SPMT authority. Accounts 2 and 3 authenticate as distinct service identities and request user/tenant authorization from it; they do not create local shadow accounts or roles.
- **One public front door:** SpaceMountain on Account 1 routes browser traffic to the correct public HTTPS origins. Browser cookies remain scoped to the public domain design; worker credentials stay server-side.
- **Live + game path:** Chat Gateway, StreamWeaver and Nebula runtimes share the Node 2 process boundary where required, but retain distinct SPMT identities and SQLite databases. Normalized provider events flow through the existing in-process consumer chain, preserving order and delivery/idempotency behavior. Nebula's live HTTP server is co-located with the Nebula DB owner.
- **Discord/Lounge path:** DSH on Account 3 owns Discord receipts, outbox, tenant configuration and Lounge runtime state. Cross-node Nebula media/game operations must use authenticated APIs; no DSH process may open the Nebula SQLite file.
- **Overlay path:** OverlayBay scene authoring stays with Account 1; it receives authenticated event/data inputs from the other nodes and publishes through SpaceMountain.
- **Restream path:** StreamWeaver's Go Live command calls a separately authenticated Restream control receiver. That receiver still needs a durable private browser profile and a verified runtime; it is not considered deployed merely because the caller exists.

### Cross-account contract variables

Use explicit HTTPS origins in production, never localhost for cross-account traffic. Exact variable names must be wired and validated by the relevant runtime before deployment:
- Account 2/3 -> Account 1: `SPMT_ORIGIN`; SPMT's configured public origin is `SPMT_PUBLIC_URL`.
- Account 2 -> Account 1: SPMT/SpaceMountain HTTPS origins and distinct Chat Gateway, StreamWeaver and Nebula service credentials.
- Account 3 -> Account 1/2: SPMT and Node 2 Nebula/StreamWeaver HTTPS service origins plus DSH's own credential and tenant grants.
- Browser -> Account 1: SpaceMountain public origin; browser navigation must not expose worker credentials.
- Account 2 -> Restream receiver: `STREAMWEAVER_RESTREAM_CONTROL_ORIGIN` and `STREAMWEAVER_RESTREAM_CONTROL_CREDENTIAL`, with a separate receiver credential and strict redirect handling.

A cross-account smoke test must prove the full chain, not just three green health pages: sign in once; resolve the same tenant and role on all nodes; send a test chat event; observe it in StreamWeaver and Nebula; trigger a synthetic game action; verify its Discord/Commlink output; load and update an OverlayBay scene; restart each node and verify the same durable state and idempotency receipts. Run this first with synthetic tenants and outbound side effects disabled.

## Required portability work

1. **Service inventory:** enumerate every runnable server/worker, its package dependencies, environment variables, ports, health endpoints, database files, outbound providers, and current localhost assumptions.
2. **Role-specific entrypoints:** add explicit Node 1/2/3 start commands that build from repository root but start only the services assigned to that node. Do not fork or duplicate business logic.
3. **Network contracts:** replace cross-node loopback URLs with required HTTPS origin variables. Validate origins at startup. Add authenticated service-to-service requests using existing credential mechanisms or a reviewed signed-token contract; never expose worker credentials to browsers.
4. **Authority and storage:** preserve one-writer semantics. First determine whether the existing authority can use a supported remote database adapter. If not, design and test a PostgreSQL adapter against the existing authority interfaces before proposing migration. Include schema migration, transaction semantics, locking/concurrency, backup, restore, and rollback tests. Do not silently move SQLite files to ephemeral app disk.
5. **Hostless configuration:** add role-specific Hostless configuration with repository-root build context, explicit build/start commands, `PORT`/health checks, one replica, and deliberately small resource requests. No paid volume or above-free entitlement setting.
6. **Secrets:** document exact environment-variable names per node; configure values only in Hostless secret settings. Do not commit real secrets or copy production secrets into test fixtures.
7. **End-to-end tests:** prove login/roles, canonical app catalog, Chat Tag gameplay/state, StreamWeaver control path, Discord Stream Hub workflows, overlays, service-to-service auth, process restart, and database restore across all three nodes.
8. **Cost gate:** before creating each resource, verify configured CPU/RAM/storage remains within the relevant account's free pool and the estimated bill remains $0.00. Stop rather than accept any paid capacity.
9. **Cutover gate:** no production traffic or user data moves until owner-approved backup/restore and rollback drills pass.

## First implementation slice

- Documented the initial service inventory and three-node topology on this branch.
- Updated the SpaceMountain integrated ingress proxy so configured remote service origins can use HTTPS with normal certificate verification. Plain HTTP remains accepted only for loopback development targets. Origins containing credentials, paths, queries, or fragments are rejected.
- Removed hop-by-hop request and response headers at the proxy boundary. Existing local loopback routing remains supported for current single-host regression runs.
- Added regression tests proving that non-loopback cleartext HTTP is rejected at startup and that HTTPS origins are accepted for outbound proxying. Existing overlay proxy tests continue to cover local loopback behavior.
- Enabled the existing offline monorepo validation workflow on pull requests that touch the ingress, its tests, or build configuration. No CI result has been returned yet.

The source and test changes are committed to `hostless-three-node-port`. On commit `ec8386a812856b29f05ae2ce27fb8d0978910128`, the Nebula Arcade parity workflow, ApolloStation pull-request validation (including build and offline-network regression suite), and StreamWeaver parity workflow all completed successfully. The StreamWeaver focused regression step reported 80 passed / 0 failed; its separate full-manual regression step was skipped by workflow conditions and is not claimed as run. These are code/CI results only, not production acceptance. Keep the existing Sprite launcher unchanged so local regression workflows remain available. Do not introduce a Hostless deployment file that automatically provisions multiple resources until the resource plan and exact Hostless schema are validated.

## Known blockers / decisions

- Multiple-account eligibility for one owner is not explicitly resolved by the retrieved public docs; keep this as a policy risk, not an assumption of guaranteed extra capacity.
- The free database allowance is only 512 MiB per account and shares CPU/RAM with apps. The current synchronous SQLite authority contracts cannot be assumed to work with managed PostgreSQL; migration requires an async API refactor, not merely a new adapter.
- Hostless persistent volumes are separately charged. This plan therefore requires a proven managed-database route for authoritative state or another verified zero-cost durable storage option.
- Three small resource pools are not automatically enough for all services. Measure actual build/runtime memory and CPU, then schedule/partition workloads accordingly.
- Hostless builds are not charged according to its current docs, but runtime and database usage above entitlement is billed.

## Acceptance criteria

- [ ] No Fly.io dependencies in the Hostless runtime path.
- [ ] No production writes or user data migration during development.
- [ ] All three roles can be built independently from the same monorepo commit.
- [ ] Cross-node calls use HTTPS and authenticated service identities.
- [ ] Only Node 1 can write canonical SPMT authority state.
- [ ] Database backup, restore, and rollback are tested.
- [ ] Core, StreamWeaver, Nebula/Chat Tag, and Discord Stream Hub end-to-end flows pass.
- [ ] All deployed resources stay inside verified free entitlements and show $0.00.
- [ ] No functionality is removed merely to fit the hosting platform.


## Critical co-location correction (2026-11-04)

The earlier draft's Account 2 / Account 3 split was invalid and is superseded by the topology above. Static source inspection of `apps/chat-gateway/src/service.ts` proves that the Chat Gateway process directly constructs `StreamWeaverProviderRuntime` and `NebulaArcadeProviderRuntime`, attaches their consumers, and wires StreamWeaver's Nebula check-in bonus callback to the in-process Nebula runtime. `apps/nebula-arcade/src/nebula-arcade-live-server.ts` independently opens Nebula network and Mosaic stores at the same configured database path. A split that puts Chat Gateway on one account and Nebula on another severs this in-process contract and/or creates multiple SQLite writers. The safe initial placement co-locates Chat Gateway + StreamWeaver + Nebula provider runtime/web/database owners on Account 2; Account 3 owns DSH and its own state. A future extraction of Nebula event ingress is a separate architecture project requiring authenticated tenant-scoped ingress, durable idempotency, event ordering, retry/outbox semantics, and cross-node end-to-end tests. No partial HTTP endpoint or proxy-only change is sufficient.
