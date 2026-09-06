# Production Path

Updated: 2026-08-30

This is the current migration and rollout plan. It replaces the original phase-number-heavy operations plan. The goal is to move from a fully tested Green codebase to production without either freezing ourselves behind obsolete assumptions or skipping safety evidence that still matters.

## Principles

1. Move by **risk and dependency**, not by brand order or old batch numbers.
2. Blue remains available until the moved capability/app has a proven rollback.
3. One writable/responding authority exists for a tenant/provider/channel at a time.
4. Shared facts migrate to SPMT authority; app-private facts migrate to the owning app authority; caches/temp data are rebuilt.
5. Permanent owned URLs stay stable while hosting can move underneath them.
6. A low-risk canary does not wait for unrelated high-risk work, but it cannot skip recovery/data/provider prerequisites it actually depends on.
7. Production infrastructure policy is measured and replaceable; no vendor is architecture by itself.

## Where we are now

Completed:

- current donor/live functionality has been ported into ApolloStation to the accepted offline-parity level;
- 571/571 offline tests pass;
- the completed offline checklist is 69/69;
- first-party app launch registration now uses the same catalog contract as third-party apps;
- permanent `*.spacemountain.live` app names are reserved;
- current `main` is promoted to the protected Release Sprite;
- ecosystem-core rehearsal Stage 1 passed with outbound/provider access disabled.

We are now at **production inventory and controlled live integration preparation**.

## Step 1 — refresh production inventory

Before moving any app, capture the live reality that matters to that app and the shared services it uses.

For each Blue app/process record:

- provider/hosting app name and region;
- machine/process count and resources;
- persistent volumes and attachment;
- actual dataset names, approximate sizes and owner classification;
- public URLs/callbacks/browser sources;
- current provider/socket relationships;
- current health/readiness route;
- deployment/restart/stop commands;
- rollback method;
- current cost where available.

This inventory is read-only. It does not copy volumes or change credentials.

## Step 2 — classify data instead of cloning old volumes

For every Blue dataset classify each item into one of these destinations:

| Classification | Destination |
|---|---|
| SPMT shared fact | canonical SPMT authority via migration/reconciliation |
| app-private durable authority | bounded owning-app store |
| durable media bytes | object/media store or explicitly owned durable storage |
| cache | rebuild or rewarm |
| staging/temp | discard |
| outbox/retry that still matters | reconcile/complete or migrate with idempotency |
| historical evidence only | read-only archive/retention copy |

Do not migrate an old volume merely because it exists.

For HearMeOut specifically, inventory `hearmeout-main` and `hmo-dj-worker` volumes before deciding what survives. Room/member/playback private authority is not the same thing as HLS/music cache or temporary worker files.

## Step 3 — choose and prove current production storage/recovery shape

Do not blindly recreate the provisional `spmt-vault` topology from the original blueprint.

For every authoritative store that will receive production writes, prove:

- exactly who owns writes;
- independent recovery point(s);
- integrity verification;
- isolated restore;
- writer fencing or equivalent split-brain prevention;
- rollback/failback appropriate to that storage technology;
- retention and off-provider/off-account copy for critical shared authority.

If the simplest safe implementation is a dedicated recovery deployable, use it. If a managed/network store plus verified backups is safer and simpler, use that. The requirement is recoverability, not loyalty to an old diagram.

## Step 4 — establish permanent public routing

The reserved product addresses are the stable public identities:

- `commlink.spacemountain.live`
- `companion.spacemountain.live`
- `discordstreamhub.spacemountain.live`
- `hearmeout.spacemountain.live`
- `missioncontrol.spacemountain.live`
- `mountainview.spacemountain.live`
- `nebula.spacemountain.live`
- `stellar.spacemountain.live`
- `streamweaver.spacemountain.live`

Before moving traffic:

1. choose the production front door/ingress that can terminate these domains;
2. attach custom domains/certificates there;
3. route each hostname to its current Green target;
4. set Apollo catalog launch URLs to the owned names;
5. update OAuth/browser-source/external callback configuration deliberately;
6. keep DNS TTL low during migration;
7. verify every route before switching Blue authority.

The target behind a hostname may be Sprite, Fly, another provider, or a gateway to a wakeable worker. The public address does not change when the implementation moves.

## Step 5 — controlled provider rehearsal

Provider/live integration proof is done before tenant cutover where possible.

Use scoped test/owner tenants and prove:

- correct credential grant and refresh behavior;
- two-tenant isolation;
- reconnect/cursor resume;
- dedupe/replay protection;
- revoked credentials become reauthorization-required rather than infinite retry;
- no provider credential is persisted in jobs/logs/URLs;
- output is fenced so test proof cannot speak for unrelated tenants.

For chat/output systems, observation/shadow mode is preferred before speaking.

## Step 6 — rollout order

The current preferred order is based on blast radius, not the original implementation batch order.

### A. Ecosystem core — already started

Stage 1 passed on Release Sprite with outbound disabled.

Next core work:

- live production inventory;
- current storage/recovery decision and proof;
- permanent public ingress/routing;
- provider-grant live rehearsal where needed;
- Mission Control/Rotator observation against live infrastructure before mutation authority.

### B. HearMeOut — first real app canary

Why first: fewer tenants are simultaneously active, outages are more visible/contained, and accidental output does not broadcast into hundreds of channels the way bot/game systems can.

Required before Green becomes authoritative:

- classify Blue main/worker volumes;
- migrate only real private authority/durable media;
- connect LiveKit/Discord/provider grants to a controlled room/account;
- prove room/media state persistence and worker scaling;
- prove Blue restart/rollback path;
- move the permanent `hearmeout.spacemountain.live` route;
- observe;
- stop Blue compute only after proof, retaining rollback data.

### C. Discord Stream Hub

Begin read/observe/shadow where practical. Compare Green decisions to Blue before broad Discord publishing. Then enable one controlled output path, verify no duplicate embed/shoutout/spotlight actions across restart, and expand.

### D. Remaining lower-blast-radius services

Move bounded components such as MountainView/Companion/cloud helpers and operational pieces when their specific hardware/provider gates are satisfied. Do not bundle unrelated workloads merely to finish a “phase.”

### E. Nebula Arcade — late

Nebula has many tenants and active chat/game output. It requires strict single-authority fencing.

Progression:

```text
listen/shadow
-> owner/test tenant output
-> second tenant
-> restart/reconnect/replay proof
-> small tenant cohort
-> broader cohorts
```

Verify no duplicate commands, rotations, replies, XP, game events or overlay output.

### F. StreamWeaver — last broad migration

StreamWeaver has the highest spam/automation blast radius because it can answer, execute commands, route personas, manage local currency, trigger shoutouts/actions and respond across many tenants.

Progression:

```text
listen only
-> owner-only commands on one tenant
-> normal chat on one tenant
-> second tenant
-> restart/reconnect test
-> small cohort
-> broader cohorts
```

Blue and Green must never both respond for the same tenant/channel during an ownership switch.

## Step 7 — workload scaling proof

Scaling is proven per workload, not per app brand.

Examples:

- provider sockets: unique-consumer lease and reconnect fencing;
- queue/media workers: queue depth, leases, drain, retry and idle stop;
- room/session workers: explicit session lease/TTL/cleanup;
- AI pools: queue/capacity/latency/cost bounds;
- Xbox: isolated session lifecycle;
- Companion: local worker lease and device ownership.

The operations controller remains dry-run/observe until its adapter and rollback for a workload are proven. Then enable production mutation one workload at a time, within configured minimum/maximum/cost bounds.

## Step 8 — cohort and observation rules

After an app/capability canary passes:

1. owner/test tenant;
2. second distinct tenant;
3. small trusted cohort;
4. broader percentage cohort where applicable;
5. remaining tenants.

The observation window should match actual activity. A fixed seven-day wait is not automatically useful for every low-volume capability, while a high-volume bot may reveal duplicate behavior in minutes. Require enough real activity to test the failure modes that matter.

## Step 9 — rollback

Every cutover has two rollback dimensions:

### Route/runtime rollback

Can traffic/output return to Blue quickly without two active speakers/writers?

### Data rollback/reconciliation

Can writes accepted while Green was primary be preserved/replayed/reconciled without overwriting newer truth?

If either answer is unknown, the cohort is not ready to move.

## Step 10 — Blue retirement

Only after the corresponding observation and rollback gates:

- stop old compute first;
- keep old volumes/databases read-only for the approved retention window;
- keep source history in GitHub/archive long enough to investigate migration defects;
- remove old OAuth/callback/provider registrations only after zero-use proof;
- delete old resources after recovery/rollback retention is no longer needed.

## Immediate next actions from 2026-08-30

1. Finish a read-only live infrastructure/data inventory, beginning with HearMeOut and the shared SPMT/SpaceMountain authorities it depends on.
2. Decide the **current** canonical SPMT storage/recovery production implementation from actual data size/load and provider capabilities.
3. Decide the always-available production ingress/custom-domain layer for the reserved app hostnames.
4. Rehearse provider credentials/connections with owner/test tenants under output fencing.
5. Run HearMeOut as the first controlled app canary.
6. Continue with DSH, lower-risk services, Nebula Arcade, then StreamWeaver.

No step above authorizes broad Blue shutdown or DNS movement until its prerequisites are explicitly proven.
