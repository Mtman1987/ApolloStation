# Rebuild and Cutover Operations

Updated: 2026-08-21

## Safety model

This is a parallel blue/green rebuild. “Blue” is current production. “Green” is the ApolloStation/Sprites rebuild. Green receives no authoritative tenant writes until its contracts, storage, restore, isolation, and reconciliation gates pass.

No old repository, app, Machine, volume, database, secret, or DNS route is deleted merely because Green deploys successfully.

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
| 1 | Foundation contract | accepted decisions, parity ledger, monorepo/package boundaries, shared naming | no hidden architecture choice blocks scaffolding |
| 2 | Green scaffold | workspace tooling, shared types/SDK, config classification, logging/correlation, health/readiness, test harness, Fly templates | every package can build/test with common contracts |
| 3 | SPMT authority + recovery | identity, tenants, sessions, scoped services, canonical storage boundary, audit, idempotency, outbox/events, `spmt-vault` foundation | authority + isolated restore/promotion fixture passes |
| 4 | SpaceMountain + first shared facts | front door, session restore, app registry, workspace/theme, canonical XP, honest cold/degraded UI | test tenant signs in once, changes shared state once, sees it everywhere |
| 5 | Jobs + elastic worker framework | durable jobs, leases, heartbeat, retries, dead letters, reconciler, worker SDK, bounded scaling controls | scale/failure/abandoned-lease/idempotency tests pass |
| 6 | StreamWeaver vertical | Twitch/Discord ingestion, bot dispatch, Athena runtime, TTS, commands, overlays, shared chat, StreamWeaver worker | concurrent-tenant and burst-load matrix passes without duplicate replies |
| 7 | Discord Stream Hub vertical | community/live/shoutout/calendar/moderation, XP producer/view, clip worker | DSH product + worker contract suite passes |
| 8A | HearMeOut vertical | rooms, LiveKit, Activity auth, DJ/music/watch/media, OBS output, DJ/media worker | media/voice truth-path and multi-user tests pass |
| 8B | ChatTag/Games vertical | ChatTag core, Quackverse/Bingo/catalog modules, durable actions, overlays, XP, bot worker | per-game + two-player + bot reconnect tests pass |
| 9 | Parity/cutover hardening | donor compatibility, migrations, shadow compare, full deep audit, load/fault tests, recovery rehearsal, cohort cutover tooling | every Blue retirement gate in `PARITY_LEDGER.md` passes |

Do not bury a failing vertical inside the next batch. Fix or explicitly defer it before proceeding.

## Build order

### Phase 0 — decision lock and evidence

- foundation decision pack is approved in `DECISIONS.md`;
- resolve the remaining open decision only when its implementation phase requires it;
- capture live Fly, auth, data, route, cost, and error inventories;
- complete the donor deep-audit queue in `PARITY_LEDGER.md` as each product becomes active work;
- produce a signed-off domain ownership table;
- define objective budgets and rollback windows.

Exit: no material architecture question for Phase 1 is hidden inside an implementation ticket.

### Phase 1 — SpaceMountain shell and SPMT foundation

- build the always-available gateway/static shell;
- build canonical identity, tenant, authorization, app registry, and audit contracts;
- provision the chosen canonical database/object storage behind the storage-authority boundary and independent recovery authority with restore proof;
- build workspace/theme fan-out as the first end-to-end shared-fact proof;
- build canonical points ledger and reconciliation tools without choosing disputed balances automatically;
- add health, metrics, cost attribution, idempotency, and migration tooling.

Exit: a test tenant can sign in once, open the shell or a standalone app, change a background once, see it everywhere, and receive one idempotent point award everywhere. The primary storage authority can also be fenced, the recovery authority promoted, new writes accepted once, and the repaired primary rebuilt and restored without split brain.

### Phase 2 — inference, workers, and bots

- resolve D-08/D-09 when Xbox lifecycle measurements exist;
- resolve D-20 through D-24 before exposing production AI quota/provider/privacy behavior;
- build the durable job/lease contract and reconciler;
- build the inference router and weighted quota ledger with policy remaining configurable until approved;
- connect a companion capability path;
- add CPU-local model/TTS/STT workers only after benchmark evidence;
- add paid API fallback and circuit breakers;
- prove the approved Xbox active/standby behavior;
- migrate persistent bots/provider sockets onto explicit heartbeat lifecycle.

Exit: failure, scale-up, scale-down, abandoned lease, quota, and fallback tests pass with measured cost and latency.

### Phase 3 — apps on the base

Recommended first vertical slice: rebuild ChatTag's proven core game without bundling every other game into it. Attach it to canonical identity, points, themes, cards, and events. Add other games as separately bounded modules only after the core regression suite stays green.

The operational batch order may put StreamWeaver before ChatTag because StreamWeaver exercises the shared worker/queue model and is a high-concurrency dependency. Whichever vertical runs first must complete `APP_CONTRACTS.md` and its `PARITY_LEDGER.md` rows before the next product is considered cutover-ready.

Then migrate apps one at a time based on tenant value, breakage, and dependency risk. Each app completes `APP_CONTRACTS.md` before the next cutover.

### Phase 4 — cutover and retirement

- shadow-read and compare where safe;
- migrate a small tenant cohort;
- observe errors, latency, costs, and data parity;
- expand cohorts only when gates stay green;
- move DNS/routes with immediate rollback available;
- freeze old writes, take final backups, reconcile, and retain read-only rollback;
- stop old Fly compute before deleting anything;
- delete old apps/volumes only after the approved retention window;
- archive or delete old repositories only after the longer source-retention decision.

## Required gates

| Gate | Must be true |
|---|---|
| Architecture | Required decisions accepted and contracts versioned |
| Parity | Every discovered donor capability classified and all required Green replacements proven |
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

Pause expansion immediately for unexplained data loss/drift, identity collision, tenant crossover, double awards, duplicate bot replies, unrecoverable writes, secrets in output, cost runaway, or a rollback that has not been proven.

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
