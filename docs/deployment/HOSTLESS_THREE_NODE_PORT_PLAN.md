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
- No PostgreSQL authority adapter has yet been verified. Do not point a SQLite-backed service at a PostgreSQL URL or assume a database swap is a configuration-only change.

## Target topology

### Node 1 — Core authority and public gateway
Owns the single writable SPMT authority, identity/roles, app registry, core APIs, and the primary public ingress. Only one instance may write the authoritative state. The canonical data store must be durable and restorable without a paid volume.

### Node 2 — Streaming and media services
Runs the independently deployable Chat Gateway, StreamWeaver, Discord Stream Hub, and their required workers. These services call Node 1 through authenticated HTTPS APIs; no process assumes Node 1 is reachable at localhost. Media caches and generated segments are ephemeral and bounded; user-owned or authoritative data is not silently discarded.

### Node 3 — Games and community services
Runs Nebula Arcade / Chat Tag and community-facing services such as Lounge integrations. It calls the canonical authority and streaming APIs through authenticated HTTPS contracts. It must not create a second writable copy of SPMT authority.

OverlayBay and Restream must be mapped to their actual existing Apollo modules and dependencies during the service inventory before they are assigned or declared complete. HearMeOut remains lower migration priority and must not displace the first three priorities.

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
- Added a regression test proving that a non-loopback cleartext HTTP service origin is rejected. Existing overlay proxy tests continue to cover local loopback behavior.

The source and test changes are committed to this branch. CI status has not yet been returned for the latest commit, so this slice is not marked tested or production-ready. Keep the existing Sprite launcher unchanged so local regression workflows remain available. Do not introduce a Hostless deployment file that automatically provisions multiple resources until the resource plan and exact Hostless schema are validated.

## Known blockers / decisions

- Multiple-account eligibility for one owner is not explicitly resolved by the retrieved public docs; keep this as a policy risk, not an assumption of guaranteed extra capacity.
- The free database allowance is only 512 MiB per account and shares CPU/RAM with apps. The current SQLite authority cannot be assumed to work with managed PostgreSQL without an adapter.
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
