# Rebuild and Cutover Operations

## Safety model

This is a parallel blue/green rebuild. “Blue” is current production. “Green” is the new system. Green receives no authoritative tenant writes until its contracts, storage, restore, isolation, and reconciliation gates pass.

No old repository, app, Machine, volume, database, secret, or DNS route is deleted merely because green deploys successfully.

## Cost clock

Before creating the first green Fly resource:

1. capture the current seven- and thirty-day Fly cost baseline;
2. assign every green resource an owner, purpose, expected hourly/monthly maximum, and expiry date;
3. set a total parallel-run budget and warning threshold;
4. review actual versus budget daily while both systems run;
5. stop unused green workers automatically;
6. require an explicit extension when a temporary resource reaches expiry.

Machine-count headroom is not a spending budget. Volumes, root filesystems, bandwidth, managed data, and external APIs can still accrue cost while compute is stopped.

## Build order

### Phase 0 — debate and evidence

- approve or change every open decision;
- capture live Fly, auth, data, route, cost, and error inventories;
- produce a signed-off domain ownership table;
- define objective budgets and rollback windows.

Exit: no material architecture question is hidden inside an implementation ticket.

### Phase 1 — SpaceMountain shell and SPMT foundation

- build the always-available gateway/static shell;
- build canonical identity, tenant, authorization, app registry, and audit contracts;
- build registry discovery across SDK, API, CLI, MCP, and registry-change events; include revision/ETag caching, parent/module queries, visibility policy, compatibility, entitlements, and truthful runtime-health status;
- publish the versioned SDK/API schemas, CLI, MCP server, webhook/event contracts, test-tenant flow, and executable contract-test harness before first-party apps depend on them;
- provision the chosen canonical database/object storage and independent recovery authority with restore proof;
- build workspace/theme fan-out as the first end-to-end shared-fact proof;
- build canonical points ledger and reconciliation tools without choosing disputed balances automatically;
- add health, metrics, cost attribution, idempotency, and migration tooling.

Exit: a test tenant can sign in once, open the shell or a standalone app, change a background once, see it everywhere, and receive one idempotent point award everywhere using the published SDK/API contracts. Approving a fixture app makes it appear on every applicable Apps surface without a source change; changing its health updates every visible status; suspending it applies the approved catalog policy. The same flows pass through the CLI or MCP where operator control applies, an external sample app passes the contract harness, and the primary storage authority can be fenced, the recovery authority promoted, new writes accepted once, and the repaired primary rebuilt and restored without split brain.

### Phase 2 — inference, workers, and bots

- build the durable job/lease contract and reconciler;
- build the inference router and weighted quota ledger;
- connect the companion through the published capability protocol and SDK contracts;
- add CPU-local model/TTS/STT workers only after benchmark evidence;
- add paid API fallback and circuit breakers;
- prove Xbox N-active-plus-one-ready behavior;
- migrate persistent bots/provider sockets onto explicit heartbeat lifecycle.

Exit: failure, scale-up, scale-down, abandoned lease, quota, and fallback tests pass with measured cost and latency.

### Phase 3 — apps on the base

Recommended first vertical slice: rebuild ChatTag's proven core game without bundling every other game into it. Attach it to canonical identity, points, themes, cards, and events exclusively through the developer platform. Publish ChatTag as the first complete sample application with a manifest, OAuth/scopes, SDK calls, event/webhook handling, test-tenant instructions, and executable contract tests. Add other games as separately bounded modules only after the core regression suite stays green.

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
| Architecture | Decisions accepted and contracts versioned |
| Restore | Scheduled backup, integrity verification, isolated restore, promotion, failover writes, rebuild, and failback completed and timed |
| Identity | One user maps consistently across every tested app/provider |
| Authorization | Allowed/denied scope matrix and two-tenant isolation pass |
| Developer parity | First-party UI and worker flows use documented public contracts; SDK, raw API, CLI/MCP, events/webhooks, examples, and external-client contract tests agree |
| Registry discovery | Approval, update, health change, entitlement, suspension, and nested-module fixtures propagate consistently to every shared Apps surface without a surface-specific code edit |
| Data | Counts, hashes, samples, and disputed-record report reviewed |
| Points | Same balance and provenance on every surface |
| Lifecycle | Cold start, warm start, drain, crash, and abandoned lease pass |
| Reliability | Dependency failures degrade honestly; no fake success/local DB fallback |
| Cost | Green stays within approved budget and per-tenant job costs are visible |
| Rollback | Route and data rollback rehearsed, not merely documented |
| Observation | Agreed window passes without severity-one regression or unexplained drift |

## Stop conditions

Pause expansion immediately for unexplained data loss/drift, identity collision, tenant crossover, double awards, unrecoverable writes, secrets in output, cost runaway, or a rollback that has not been proven.

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
