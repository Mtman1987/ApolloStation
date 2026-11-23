# Apollo Two-Node Resource Pool & Local Preview Plan

Status: Proposed architecture and acceptance plan. Do not deploy or change live Hostless nodes from this document alone.

## Owner intent

- Node 1 and Node 2 together host the complete Apollo app portfolio.
- Keep all existing live Node 1/Node 2 deployments intact until the full replacement build is locally previewed and accepted.
- Node 1 currently has limited capacity; replacement must be an intentional complete-stack cutover, not piecemeal app additions.
- Use every permitted free-tier resource efficiently, but never exceed provider limits, hide usage, or sacrifice reliability/data integrity.
- Build, validate, preview, and measure locally (or in an isolated, non-production preview) before production deployment.
- When two nodes have headroom, cross-node workload placement should be possible; overflow must be controlled and reversible.

## 1. Local preview: no phone install, no production deployment

Prefer a browser-accessible preview on a development workstation, using the existing monorepo scripts and standard desktop browser. The user should be able to open a URL and inspect the integrated Apollo UI without installing an app on their phone.

Inventory existing preview tools before creating a new system:
- scripts/hostless/run-private-preview.mjs
- scripts/hostless/deploy-private-preview.mjs
- package scripts and build targets
- browser/e2e and screenshot tooling

The current private preview runner starts isolated SPMT + SpaceMountain processes and uses sandbox fixtures with outbound mode disabled. It is **not yet proven to preview the entire two-node app portfolio**. Extend it only after tracing existing launchers, service dependencies, ports, runtime config, and app data boundaries.

Preview acceptance:
1. Node 1 and Node 2 compositions can both be launched locally with clear ports.
2. Fixtures/test databases only; no production user data.
3. No outbound actions, live bots, OAuth writes, webhooks, or production integrations unless explicitly mocked or safely disabled.
4. Browser navigation provides a desktop-width and mobile-width view.
5. Both node compositions and their shared routing are visible, with a resource/placement dashboard.
6. Capture screenshots and publish a downloadable build/test artifact for review when a workflow is used.
7. Preview can be stopped with one command and leaves no background processes or persistent changes.
8. Acceptance evidence is recorded before production cutover.

Do not call a Hostless deploy workflow a local preview. A hosted private preview may be a fallback, but it must use a separate app/project, password gate, no production volume, and fixture data only.

## 2. Full portfolio inventory and node mapping

Before deployment, produce an authoritative inventory for every app/service:
- user-facing entrypoint, internal service and worker
- current repo/path and build/start command
- ports and health checks
- CPU/memory footprint (idle and representative peak)
- persistent data path, DB owner, backup/export/import method
- storage footprint and growth estimates
- required secrets/integrations
- dependencies and traffic direction
- node affinity constraints and reason

Proposed initial placements (validate against measured dependencies):
- Node 1: SPMT authority, SpaceMountain, OverlayBay, core shell/control-plane services, and apps that need authority-local integration.
- Node 2: Chat Gateway, StreamWeaver, Discord Stream Hub, Nebula Arcade and other chat/media workers.
- HearMeOut/media worker: assign only after measuring storage and memory; avoid storing large media on a scarce node if external/object storage or a user-controlled source can be used.

## 3. Two-node shared capacity / overflow placement

Treat the nodes as a logical pool for eligible stateless workloads, not as one magically shared filesystem or process.

Implement a placement scheduler/dispatcher with:
- Node capacity snapshots: available memory, CPU/worker slots, disk quota, and app-specific limits.
- Workload classes: stateless, cache/temporary, persistent/stateful, latency-sensitive, singleton/authority, and bot connection singleton.
- Placement policy: prefer configured home node; if capacity thresholds are reached, move/dispatch eligible tasks to the other node if it has headroom.
- Node 1 overflow may route to Node 2; Node 2 overflow may route to Node 1.
- Admission checks and hysteresis to prevent rapid oscillation between nodes.
- Reservations and maximum concurrency per workload; avoid accepting work when both nodes are saturated.
- Graceful degradation/backpressure: queue or reject with a clear retry signal rather than crash or overcommit.
- Health-aware routing: exclude unhealthy nodes; reintroduce only after a stability window.
- Workload-specific routing and sticky placement when session/state locality is required.
- Capacity calculations must include service baseline, cron/dispatcher, shared dependencies, and safety reserve.

## 4. Non-negotiable safety/data constraints

- Never move authoritative SQLite files or live DB writers across nodes as an overflow mechanism.
- Persistent/stateful services remain pinned unless a separately designed replication/ownership mechanism exists.
- Do not duplicate Discord/Twitch bot sessions or singleton workers without explicit sharding/lease ownership.
- Shared state and job queues must use the established remote durable backend (Turso where appropriate), with tenant and permission boundaries preserved.
- Temporary files/cache can be overflowed only if they are disposable and cleanup/TTL are implemented.
- Do not treat free-tier storage from different accounts as a combined filesystem. Cross-node capacity is logical scheduling, not shared disks.
- Keep owner, tenant, and user authorization checks at the API boundary, not only in the router.
- Do not rotate credentials or provider keys to evade rate limits or free-tier restrictions. Resource pooling must stay within provider terms and explicit quota limits.
- Ensure a single owner for migrations and DB writes, backups before any cutover, and rollback tested.

## 5. Resource efficiency / capacity envelope

Build a measured capacity dashboard rather than assuming quotas:
- Hostless account/project/app limits, actual CPU and memory usage, storage allocations and current consumption.
- Per-app runtime and build image size, idle memory, peak memory, CPU, request concurrency, and temporary disk.
- Build artifact sizes and dependency duplication.
- SQLite/Turso usage, indexes, WAL size and cleanup/retention.
- Cache and media retention policy.
- Node capacity safety reserve; keep emergency headroom and do not target 100% utilization.
- Identify heavy services and options to consolidate shared libraries, separate workers, use lazy loading, and scale concurrency safely.

## 6. Deployment/cutover gates

Production cutover is a separate, explicit operation after review:
1. Inventory complete; every app/service has an owner and destination.
2. Both local node compositions build and run.
3. Local integration tests and browser acceptance pass.
4. Resource measurements fit both node budgets with safety reserve.
5. Backups/export and restore validation completed.
6. Persistent paths and Turso ownership verified; no unintended migrations.
7. Bot singleton/lease rules verified.
8. Node 1/2 deployment plans and secrets are audited.
9. Deploy Node 1 then verify; deploy Node 2 then verify (or only use parallel rollout if dependencies and workflow explicitly prove it safe).
10. Confirm commit, health, UI, routes, data, and integrations after each.
11. Rollback path and previous deployment identifiers recorded.

**No live deployment is authorized by this plan.** The user wants a full two-node replacement only after the complete portfolio is locally proven and approved.

## 7. Work sequence

1. Finish current migration/porting work.
2. Inventory the full app/service portfolio and existing local preview tools.
3. Build complete Node 1 and Node 2 local compositions, with fixture data and integration stubs.
4. Create a browser-accessible local preview (desktop, not phone installation); add preview screenshots/artifact workflow if needed.
5. Add cross-node capacity measurement and eligible-workload overflow routing.
6. Run load/chaos tests: node unavailable, saturation, queue full, restart, stale capacity, sticky sessions, and DB ownership.
7. Review/accept the preview.
8. Backup, cutover, verify, and roll back if any gate fails.

## 8. Initial acceptance checklist

- [ ] Complete app portfolio present (no missing app or worker).
- [ ] Node 1/2 start locally using documented commands.
- [ ] Local preview accessible from a desktop browser.
- [ ] No production data or credentials in preview.
- [ ] Every service has health/readiness checks.
- [ ] Capacity dashboard reflects measured, not guessed, values.
- [ ] Eligible stateless work can overflow bidirectionally.
- [ ] Stateful/singleton work remains pinned or lease-controlled.
- [ ] Node loss and saturation are tested.
- [ ] Build and test artifact/screenshots available for review.
- [ ] Production cutover not performed before explicit approval.
