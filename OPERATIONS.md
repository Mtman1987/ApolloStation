# Rebuild and Cutover Operations

Updated: 2026-08-22

## Safety model

This is a parallel blue/green rebuild. “Blue” is current production. “Green” is the ApolloStation/Sprites rebuild. Green receives no authoritative tenant writes until its contracts, storage, restore, isolation, and reconciliation gates pass.

No old repository, app, Machine, volume, database, secret, or DNS route is deleted merely because Green deploys successfully.

`SURFACE_AND_DEVELOPER_CONTRACT.md` is a required Green contract. Workspace/embed behavior, shell layout/header safety, overlay ownership, and first-party developer-platform dogfooding are architecture gates rather than post-build UI cleanup.

## Cost clock

Before creating the first Green Fly resource:

1. capture the current seven- and thirty-day Fly cost baseline;
2. assign every Green resource an owner, purpose, expected hourly/monthly maximum, and expiry date;
3. set a total parallel-run budget and warning threshold;
4. review actual versus budget daily while both systems run;
5. stop unused Green workers automatically;
6. require an explicit extension when a temporary resource reaches expiry.

Machine-count headroom is not a spending budget. Volumes, root filesystems, bandwidth, managed data, and external APIs can still accrue cost while compute is stopped.

## Commit and PR batch plan

The rebuild should move in large enough slices to avoid dozens of tiny patches, but no PR may combine unrelated product owners just to reduce PR count. A batch can contain multiple commits when reviewability improves, while the PR remains one coherent contract/product milestone.

| Batch | Scope | May be bulked together | Exit condition |
|---|---|---|---|
| 1 | Foundation contract | accepted decisions, parity ledger, monorepo/package boundaries, shared naming, surface/developer contract | no hidden architecture choice blocks scaffolding |
| 2 | Green scaffold | workspace tooling, shared types/SDK, `SurfaceModeV1`, `AppFrameV1`, `EmbedBridgeV1`, shared layout/safe-inset tokens, semantic layer scale, overlay widget manifest types, developer conformance harness, config classification, logging/correlation, health/readiness, test harness, Fly templates | every package can build/test with common contracts; one shared embed path and header-safe layout tests exist before product UIs are added |
| 3 | SPMT authority + recovery | identity, tenants, sessions, scoped services, canonical storage boundary, audit, idempotency, outbox/events, `spmt-vault` foundation | authority + isolated restore/promotion fixture passes |
| 4 | SpaceMountain + first shared facts | front door, session restore, app registry, canonical AppFrame host, workspace/theme, canonical XP, Commlink shell, Overlay editor shell, honest cold/degraded UI | test tenant signs in once, changes shared state once, sees it everywhere; shell surfaces pass header/inset tests |
| 5 | Mtman Machine Rotator + elastic worker framework | durable jobs, leases, heartbeat, retries, dead letters, elected/fenced fleet reconciler, controlled always-on restart, worker SDK, runtime projections, redacted action logs, and bounded demand/cost scaling | rolling-restart, scale/failure/drain/abandoned-lease/idempotency/duplicate-consumer/cost-bound tests pass |
| 6 | Chat Gateway + StreamWeaver/Stella vertical | provider-neutral Twitch/Discord connections and normalized feed; app-neutral Stella invocation; tenant-configured StreamWeaver personas (Athena only for the owner); TTS, commands, overlays, workers, and flagship SDK/API/CLI/MCP/event/job/feed integration | Stella works from standalone, Commlink, StreamWeaver, and developer clients without app-session dependency; concurrent-tenant and burst-load tests pass without duplicate replies |
| 7 | Discord Stream Hub vertical | community/live/shoutout/calendar/moderation, XP producer/view, clip worker, flagship events/overlay-manifest integration | DSH product + worker + surface/developer contract suite passes |
| 8A | HearMeOut vertical | rooms, LiveKit, Activity auth, DJ/music/watch/media, OBS output, DJ/media worker, flagship realtime/device/overlay integration | media/voice truth-path and multi-user tests plus surface/developer conformance pass |
| 8B | Nebula Arcade vertical (historical donor repository: ChatTag) | Nebula Arcade tag game, Quackverse/Bingo/Arena/catalog modules, durable actions, overlays, XP, provider-ingress worker, and flagship game/event/overlay integration | per-game + two-player + bot reconnect tests plus surface/developer conformance pass |
| 8C | MountainView vertical | phone/Bluetooth/camera/voice/media bridge, paired-device flows, mobile surfaces, and Companion relay integration | real-device or faithful hardware-fixture, pairing/revoke, reconnect, background/wake, and surface tests pass |
| 8D | Companion vertical | desktop and Android relay, OBS control, universal overlay/popouts, local media/FFmpeg, local AI capability, pairing, and signed update boundaries | desktop/mobile/device/OBS/restart/local-compute suites pass |
| 8E | Operations and support vertical | Rotator fleet reconciliation, Athena Coder/`!mtfixit` intake, GitHub operator controls, recovery app, and app lifecycle self-service | dry-run, approval, audit, rollback, recovery, lease, scale, and cost-bound tests pass |
| 9 | Full-suite parity hardening | donor compatibility, migrations, full deep audit, load/fault tests, recovery rehearsal, cross-app surface matrix, developer platform conformance, and complete standalone/embedded app matrix | every retained capability works and every app satisfies `APP_CONTRACTS.md`; no scaffold is counted as parity |
| 10 | Integrated Sprite/Fly sandbox | deploy the complete Green suite together behind isolated sandbox routes and data; exercise real Machine lifecycle and cost policy while Blue remains untouched | suite-level user journeys, state reconciliation, worker scaling, recovery, latency, cost, and rollback tests pass after tuning |
| 11 | Cutover preparation | shadow compare, cohort tooling, final migration, observation, rollback, and selective route/DNS plan | every Blue retirement gate in `PARITY_LEDGER.md` passes and owner explicitly approves cutover |

Do not bury a failing vertical inside the next batch. Fix or explicitly defer it before proceeding.

## Batch 2 non-negotiable scaffold outputs

Batch 2 is not complete until the monorepo contains working, tested shared primitives for:

1. `SurfaceModeV1` (`shell`, `standalone`, `overlay`, `popout`);
2. one `AppFrameV1` host and one cross-origin-capable `EmbedBridgeV1` protocol;
3. dynamic shell/header/safe-area measurement and shared layout tokens;
4. a semantic layer/z-index token scale used by shared UI primitives;
5. shared portal roots/components for dialogs, drawers, menus/popovers, toasts, and floating controls that automatically honor shell usable bounds;
6. `OverlayWidgetManifestV1` and a clear split between editor/preview surfaces and controls-free outputs;
7. a versioned SPMT SDK covering the first shared contracts, with raw HTTP schemas generated from the same source where practical;
8. developer conformance fixtures showing SDK/API/events/WebSocket use plus CLI/MCP adapters over the same scoped operations;
9. automated visual/layout geometry tests at multiple viewport sizes and simulated header heights, including a wrapped/tall header;
10. a reference/sample app that uses the exact same AppFrame, SDK, scopes, theme, messaging/event, overlay-manifest, and lifecycle contracts that third-party developers receive.

No flagship product should implement its own workspace or shared-header workaround before these primitives exist.

## Build order

### Phase 0 — decision lock and evidence

- foundation decision pack is approved in `DECISIONS.md`;
- shared surface/developer contract is approved in `SURFACE_AND_DEVELOPER_CONTRACT.md`;
- implement only the accepted decisions in `DECISIONS.md`; tune measured configuration values only inside their approved boundaries;
- capture live Fly, auth, data, route, cost, and error inventories;
- complete the donor deep-audit queue in `PARITY_LEDGER.md` as each product becomes active work;
- produce a signed-off domain ownership table;
- define objective budgets and rollback windows.

Exit: no material architecture question for Phase 1 is hidden inside an implementation ticket.

### Phase 1 — SpaceMountain shell and SPMT foundation

- build the always-available gateway/static shell;
- build canonical identity, tenant, authorization, app registry, and audit contracts;
- provision the chosen canonical database/object storage behind the storage-authority boundary and independent recovery authority with restore proof;
- build the canonical AppFrame/EmbedBridge and header-safe shell contract before embedding product UIs;
- build workspace/theme fan-out as the first end-to-end shared-fact proof;
- build canonical points ledger and reconciliation tools without choosing disputed balances automatically;
- add health, metrics, cost attribution, idempotency, and migration tooling.

Exit: a test tenant can sign in once, open the shell or a standalone app, change a background once, see it everywhere, and receive one idempotent point award everywhere. The primary storage authority can also be fenced, the recovery authority promoted, new writes accepted once, and the repaired primary rebuilt and restored without split brain. Sidebars, drawers, dialogs, menus/popovers, toast stacks, docks, and editor controls remain reachable at normal, mobile, safe-area, and wrapped-header sizes.

### Phase 2 — inference, workers, and bots

- implement D-08/D-09's accepted stop/suspend boundaries and use Xbox measurements only to tune permitted capacity;
- implement D-20 through D-24 before exposing production AI quota/provider/privacy behavior;
- build the durable job/lease contract and reconciler;
- build the inference router and weighted quota ledger with policy remaining configurable until approved;
- connect a companion capability path through the public device/job contracts;
- add CPU-local model/TTS/STT workers only after benchmark evidence;
- add paid API fallback and circuit breakers;
- prove the approved Xbox active/standby behavior;
- migrate persistent bots/provider sockets onto explicit heartbeat lifecycle.

Exit: failure, scale-up, scale-down, abandoned lease, quota, and fallback tests pass with measured cost and latency.

### Phase 3 — apps on the base

Recommended first Nebula Arcade vertical slice: preserve the donor-proven tagging mechanics as the internal `tag` game without creating a separate app, service, route, worker, or product identity. Attach it to canonical identity, points, themes, cards, and events through `nebula-arcade`. Add other games as separately bounded modules only after the core regression suite stays green.

The operational batch order may put Chat Gateway/StreamWeaver before Nebula Arcade because it exercises the shared worker/queue model and is a high-concurrency dependency. Whichever vertical runs first must complete `APP_CONTRACTS.md`, `SURFACE_AND_DEVELOPER_CONTRACT.md`, and its `PARITY_LEDGER.md` rows before the next product is considered cutover-ready.

Each first-party app is also a flagship developer example. Prefer the same public SDK/API/event/WebSocket contracts an external app would use. Use CLI/MCP where they naturally fit developer/operator/AI workflows; do not force them into runtime call paths just to claim coverage.

Then migrate apps one at a time based on tenant value, breakage, and dependency risk. Each app completes the contracts before the next cutover.

This phase ends only after StreamWeaver, Discord Stream Hub, HearMeOut, Nebula Arcade including every retained game, MountainView, Companion, Rotator/operations, their bots, and their workers are usable replacements for their current deployed donors. Registering each package in Apollo is necessary but does not satisfy this phase.

### Phase 3.5 — complete-suite Sprite/Fly sandbox

- deploy all Green apps, bots, workers, storage authorities, recovery services, and lifecycle controls together under isolated sandbox names and routes;
- use sandbox identities and copied/reconciled fixtures rather than authoritative Blue writes;
- test the same user journeys through SpaceMountain, direct standalone app URLs, overlays, bots, device relays, SDK/API/CLI/MCP clients, and cross-app events;
- tune Machine sizes, autostop/autostart, warm pools, queue thresholds, caches, latency, and cost using measured behavior;
- keep broken experiments inside the sandbox and fold only tested corrections back into the canonical Apollo code;
- do not select features for omission merely because a scaffold failed to include them; omissions require parity evidence and explicit approval.

Early local or inert Sprite previews may prove shell and contract behavior, but they are not the integrated Fly sandbox and cannot satisfy this phase.

### Phase 4 — cutover and retirement

- shadow-read and compare where safe;
- migrate a small tenant cohort;
- observe errors, latency, costs, data parity, layout regressions, and developer-contract violations;
- expand cohorts only when gates stay green;
- move DNS/routes with immediate rollback available;
- freeze old writes, take final backups, reconcile, and retain read-only rollback;
- stop old Fly compute before deleting anything;
- delete old apps/volumes only after the approved retention window;
- archive or delete old repositories only after the longer source-retention decision.

## Required gates

| Gate | Must be true |
|---|---|
| Architecture | Required decisions and shared surface/developer contracts accepted and versioned |
| Parity | Every discovered donor capability classified and all required Green replacements proven |
| Surface | One AppFrame/EmbedBridge path; header/safe-area geometry tests pass across page, sidebar, portal, popup, dock, editor, standalone, overlay, and popout surfaces |
| Developer platform | Flagship apps use documented SDK/API/event/WebSocket contracts where appropriate; CLI/MCP enforce the same scopes; reference integrations and conformance fixtures pass |
| Restore | Scheduled backup, integrity verification, isolated restore, promotion, failover writes, rebuild, and failback completed and timed |
| Identity | One user maps consistently across every tested app/provider |
| Authorization | Allowed/denied scope matrix and two-tenant isolation pass |
| Data | Counts, hashes, samples, and disputed-record report reviewed |
| Points | Same balance and provenance on every surface |
| Lifecycle | Cold start, warm start, drain, crash, and abandoned lease pass |
| Reliability | Dependency failures degrade honestly; no fake success/local DB fallback |
| Load | Burst/concurrency tests stay within queue, latency, duplicate-effect, and resource budgets |
| Cost | Green stays within approved budget and per-tenant job costs are visible |
| Rollback | Route and data rollback rehearsed, not merely documented |
| Observation | Agreed window passes without severity-one regression or unexplained drift |

## Stop conditions

Pause expansion immediately for unexplained data loss/drift, identity collision, tenant crossover, double awards, duplicate bot replies, unrecoverable writes, secrets in output, cost runaway, hidden/unreachable interactive UI under shell chrome, an app-specific replacement for the canonical workspace/embed path, a first-party private cross-app shortcut with no public contract, or a rollback that has not been proven.

## Recovery runbook contract

### Normal backup cycle

1. Start the recovery Machine on schedule.
2. Authenticate with a backup-only identity that cannot perform ordinary tenant mutations.
3. Create a consistent snapshot and copy the committed journal since the prior recovery point.
4. Write into a new versioned recovery location.
5. Verify cryptographic checksum, storage/database integrity, schema compatibility, counts, and a sampled restore.
6. Publish backup age and verification evidence.
7. Enforce retention only after a newer verified recovery point exists.
8. Stop or downsize the recovery Machine.

### Availability failure

1. Confirm primary failure and declare the incident.
2. Fence the primary with an authority lease/epoch so it cannot resume as a writer.
3. Start and verify the recovery authority.
4. Promote exactly one recovery point to writable authority.
5. Route SPMT data contracts through the promoted endpoint.
6. Journal every failover-period mutation.
7. Repair or recreate the former primary from the new authority.
8. Verify parity and perform a deliberate failback or retain the promoted side as primary.

### Suspected security breach

Do not use automatic merge or failback. Revoke credentials, preserve forensic evidence, freeze writes, select a known-good recovery point, rotate keys, patch the breach, replay only verified events, reconcile tenant data, and require explicit owner approval before reopening mutations.

### Required alarms

- backup older than the approved recovery-point objective;
- failed integrity or sampled-restore check;
- two writable authority epochs;
- recovery volume unexpectedly attached or running;
- unexplained change in snapshot size, tenant counts, or schema;
- backup credentials used outside the scheduled window;
- failed promotion, routing change, rebuild, or failback rehearsal.
