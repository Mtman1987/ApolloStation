# Mtman Machine Rotator Fleet Contract

Status: **accepted Green architecture; no production authority is granted by this document**

The Mtman Machine Rotator is the private operations and fleet-control component of the core ecosystem. Its job is no longer limited to restarting Machines. It continuously reconciles what approved workloads are allowed to run with what Fly is actually running, then records and reports every operational decision.

## 1. Ownership boundary

| Concern | Authority |
|---|---|
| App approval, manifest, declared capabilities, tenant policy, scopes and entitlements | SPMT |
| Portable desired runtime policy and approved limits | SPMT |
| Current Fly apps, Machines, regions, process groups and observed Machine state | Rotator |
| Lifecycle decisions and Fly start/stop/restart/create/destroy actions | Rotator |
| Runtime health, capacity, demand, action history and operational cost evidence | Rotator, reported to SPMT |
| User-facing app visibility and lifecycle presentation | SpaceMountain using SPMT contracts |
| Product behavior and private product state | The owning app |

An approved app stays discoverable when it is cold, starting, degraded, or unavailable. The Rotator updates runtime truth; it does not approve, suspend, revoke, hide, entitle, or hard-code apps.

## 2. Reconciliation loop

For every enrolled workload, the Rotator:

1. reads the approved registry revision and `RuntimePolicyV1` through scoped SPMT contracts;
2. observes Fly Machine state plus declared health, traffic, queue, session, lease and capacity signals;
3. calculates desired capacity inside the approved minimum, maximum, region, resource and cost limits;
4. applies cooldowns, tenant fairness, concurrency limits, provider limits and circuit breakers;
5. chooses no action, start, create, drain, stop, restart, replace or destroy;
6. acquires a fenced action lease and performs the idempotent Fly operation;
7. verifies the result rather than equating an accepted Fly request with readiness; and
8. records the decision and publishes runtime health/capacity back to SPMT.

Only one elected reconciler may mutate a given workload generation. A second Rotator process may observe or stand by, but it cannot duplicate actions without the current fencing epoch.

## 3. Workload classes

| Class | Default lifecycle |
|---|---|
| Core always-on | Maintain approved minimum healthy capacity; replace failures and perform controlled rolling restarts without dropping the minimum healthy count |
| Elastic HTTP/API | Start from cold or increase bounded capacity from request concurrency/latency; drain and stop after the approved idle window |
| Queue worker | Scale from queue depth, oldest-job age, throughput and active leases; never stop a worker holding uncheckpointed work |
| Bot/provider socket | Use a unique consumer lease, heartbeat and connection activity; prevent two Machines from speaking or consuming as the same identity |
| Room/session worker | Allocate to an explicit room/user/session lease with TTL, maximum duration, heartbeat and cleanup |
| Heavy or untrusted job | Create an isolated, resource/time-bounded worker and destroy or return it to an approved stopped pool after verified cleanup |

### Always-on restart policy

Periodic restart remains a supported maintenance behavior for always-on Machines. It is no longer a blind fleet-wide timer. Each workload declares its interval or maintenance window, minimum healthy capacity, maximum concurrent restarts, readiness gate, drain timeout and rollback rule. The Rotator replaces or restarts one safe unit at a time and stops the rollout when readiness, duplicate-consumer or error thresholds fail.

## 4. Demand and moderation signals

Eligible signals include:

- request rate, active requests, latency and error rate;
- queue depth, oldest-job age, completion rate and retry/dead-letter pressure;
- active rooms, users, streams, sockets, sessions and leases;
- worker capacity, resource saturation and dependency health;
- declared capability demand and cold-start target;
- tenant quota, provider quota, regional limits and estimated cost; and
- explicit owner or approved app requests.

“Moderation” here means resource admission and fleet governance. It includes quotas, concurrency, cost ceilings, cooldowns, fairness, runaway detection, duplicate-consumer prevention and emergency circuit breaking. It does not make the Rotator the owner of chat moderation, app business rules, content policy or canonical product data.

## 5. Access model

- The owner/operator may inspect the whole fleet and perform approved privileged actions.
- An app service identity may publish its own health/demand, hold its own leases, read its own runtime status and request only actions allowed by its runtime policy.
- A developer may inspect and exercise only their approved app/test-tenant operations through documented SDK, HTTP API, CLI and MCP contracts.
- No app or developer receives Fly organization credentials, another app's Machine identifiers, unrestricted scale limits or cross-app logs.
- Production deploy, destructive replacement, policy expansion, emergency override and autonomous code repair require distinct high-risk scopes and the configured approval policy.

The Rotator may power operator tools and the coder, but it does not silently merge code, deploy production, change DNS, rotate secrets or grant itself broader policy.

## 6. Operational evidence

Every reconciliation produces a redacted `FleetDecisionV1` record containing:

- environment, workload, deployment generation and correlation ID;
- observed and desired capacity;
- normalized health/demand signals and their freshness;
- policy revision, limits, cooldowns and budget state;
- decision, reason and actor/service identity;
- Fly app/process/region and targeted Machine IDs;
- action lease/fencing epoch and idempotency key;
- accepted, completed and verified timestamps;
- final state, retries, rollback or circuit-breaker result; and
- estimated and measured cost where available.

Logs never contain provider credentials, Fly tokens, user access tokens, private prompts or unrestricted application content. SPMT receives the bounded runtime projection and audit references, not a second uncontrolled copy of raw Fly logs.

## 7. Failure and safety rules

- Stale or contradictory signals cannot trigger unbounded scale-up.
- Missing demand data defaults to the workload's declared safe policy, not an invented zero or unlimited value.
- Scale-down requires drain plus proof that no active lease or unique consumer will be abandoned.
- Core minimums, maximum fleet cost and per-workload maximums are hard bounds.
- SPMT, SpaceMountain and the active Rotator authority cannot all be scaled to zero by normal reconciliation.
- Sandbox defaults to dry-run and cannot target production app names or credentials.
- A global kill switch and workload circuit breaker stop new mutations while preserving observation and audit.
- Runtime failure changes health to degraded/unavailable; it never removes an approved app from discovery.

## 8. Required proof before production control

- deterministic desired-capacity tests for every workload class;
- leader-election and stale-fencing tests with two Rotator instances;
- controlled always-on rolling restart without capacity loss;
- burst scale-up and cooldown-controlled scale-down;
- drain/checkpoint proof with active jobs;
- bot/socket duplicate-consumer and loop prevention;
- abandoned lease repair and orphan cleanup;
- cost/quota ceiling and noisy-tenant fairness tests;
- stale metric, Fly API failure, partial action and retry/idempotency tests;
- read-only app/developer self-service scope tests and cross-app denial tests;
- complete redacted action/audit evidence; and
- emergency stop, rollback and manual recovery rehearsal.

Until these gates pass in the isolated Green/Sprite environment, the Rotator has no production Fly mutation authority.

## 9. First operations-console vertical

The first Green implementation proves the ownership and handoff path without connecting Fly or an AI model:

1. an authenticated app publishes a bounded structured record for itself;
2. an authenticated Rotator identity with `operations:logs:any` may publish a record about an enrolled app;
3. SPMT redacts known credential shapes before persistence and exposes only the tenant/app-scoped projection;
4. SpaceMountain Mission Control consolidates the records visible to the signed-in owner/developer;
5. selecting a record prepares an idempotent coder job containing only the chosen evidence snapshot and prompt; and
6. without a Rotator coder worker the job remains `draft` with an explicit unavailable reason. With a connected worker the same contract moves it to `queued` and records the runtime job ID.

Creating a coder job requires both `operations:logs:read` and `operations:coder:invoke`; invoke permission alone cannot reveal an evidence record. The worker's accept operation is idempotent by SPMT coder-job ID. If an advertised worker temporarily refuses the handoff, SPMT retains one draft, returns `503 unavailable`, and accepts a safe retry with the same idempotency key.

Equivalent developer/operator surfaces are:

| Surface | Operations evidence | Coder handoff |
|---|---|---|
| SDK | `publishOperationsLog`, `listOperationsLogs` | `getCoderDescriptor`, `createCoderJob`, `listCoderJobs` |
| HTTP | `POST/GET /v1/operations/logs` | `GET /v1/operations/coder`, `POST/GET /v1/operations/coder/jobs` |
| CLI | `ops log-publish`, `ops logs` | `ops coder-show`, `ops coder-draft`, `ops coder-jobs` |
| MCP | `spmt.operations.logs.publish/list` | `spmt.operations.coder.get`, `spmt.operations.coder.jobs.create/list` |

SpaceMountain uses these normal contracts. Its broader view comes from the owner's tenant and maintenance scopes, not a private first-party endpoint. Normal signed-in users do not receive operations scopes automatically. The isolated Green sandbox grants its newly created test account the three non-maintenance owner scopes only because that account is the sole owner of its sandbox tenant; production requires an explicit owner/developer grant. A service without an `:any` maintenance grant can read, publish, and invoke only for its own registered app, and cannot attach another app's evidence to a coder job. The browser proxy intentionally does not expose app-log publication, so a signed-in human cannot impersonate an application reporter.
