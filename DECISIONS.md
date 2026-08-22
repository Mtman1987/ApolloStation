# Decision and Debate Ledger

Updated: 2026-08-22

Status values: `ACCEPT`, `REJECT`, `CHANGE`, or `OPEN`.

`ACCEPT` means the recommendation or accepted wording is authorized for the Green/Sprites rebuild. `CHANGE` means the original recommendation is replaced by the accepted wording recorded below. `OPEN` means implementation may not silently choose that policy; however, an open measurement-dependent decision does not block earlier phases that do not depend on it.

Owner approval on 2026-08-21 authorizes the foundation pack below for **Green only**. It does not authorize production cutover, DNS movement, production data writes by Green, or retirement of Blue.

## Foundation decision pack — approved 2026-08-21

The following wording governs implementation where it is more specific than the original recommendation:

- **D-01 / D-02:** SPMT is one logical shared-fact/control authority. Product apps never bypass versioned SPMT contracts to read or mutate canonical shared storage directly.
- **D-03:** Approve the **storage-authority boundary**, not a permanent database vendor. The first implementation may use the simplest economical single-writer store that satisfies integrity, performance, migration, backup, and failover gates. Storage can later move to PostgreSQL/object storage or another implementation without changing app-facing contracts.
- **D-04:** Isolated Green development may begin with minimum capacity. Production cutover requires redundant stateless SPMT/API and front-door capacity (or a measured equivalent with tested automatic recovery), while canonical storage maintains exactly one writable authority epoch plus the independent recovery authority.
- **D-05 / D-06:** SpaceMountain remains the always-available front door. Consolidate compatible low-risk code by runtime role/package, not merely by brand name, while preserving separate deploy/process/security/scaling boundaries where justified.
- **D-07 / D-10 / D-11 / D-12:** Use anchored coordinators plus bounded elastic workers. Start with a small durable queue/job store, leases, TTL, heartbeat, idempotency, drain, dead-letter behavior, and a reconciler. Pre-created stopped capacity may serve latency-sensitive work; overflow creation/destruction is allowed behind a scoped autoscaler. Thresholds remain runtime configuration derived from measurements.
- **D-13 through D-16:** One SPMT human identity and policy authority; scoped per-service identities; provider credentials remain provider credentials; standalone apps restore SPMT identity; legacy auth is instrumented then removed after a zero-use window; cross-app facts have one canonical authority and local data is explicitly classified.
- **D-16A:** Independent recovery authority remains mandatory.
- **D-16B:** Recovery placement is decided: use a dedicated recovery app (provisionally `spmt-vault`) in a different Fly zone/region and deployment boundary. Exact backup interval and retention are configuration decisions that must be set from an explicit RPO before authoritative tenant writes begin.
- **D-16C:** Keep an encrypted, versioned last-resort recovery copy outside the primary Fly app/organization failure boundary before production cutover. Provider choice is implementation detail.
- **D-17 / D-18:** Reconcile points/shared balances from verifiable events, identity mapping, award rules, migration provenance, and idempotency. Never sum or choose max automatically. Migrations are idempotent, verified, and retain read-only rollback copies.
- **D-19:** Shared media metadata belongs to SPMT; durable bytes use object storage or a clearly owned private store as appropriate. Apps get scoped/signed access and may keep replaceable caches.
- **D-25:** Use **ApolloStation as the Green implementation monorepo** unless later evidence proves a security or operational boundary requires a separate repository. The monorepo may still produce multiple independent Fly deployables/process groups.
- **D-26 through D-28:** Blue/Green is time-boxed and cost-visible. Cut over one bounded capability or tenant cohort at a time. Old compute stops only after observation and rollback gates; old data and source are retained for the approved rollback/source-retention windows before deletion.
- **D-29:** First-party apps must use every applicable public SDK, API, CLI, MCP, event, webhook, job, registry, and companion contract. A private first-party shortcut is evidence that the public developer platform is incomplete.
- **D-30:** Approved apps and modules are dynamically discovered from the canonical SPMT registry by every Apps surface. Approval, runtime health, compatibility, entitlement, and visibility remain separate states; an approved cold or degraded app does not silently disappear.
- **D-31:** **Athena is the user-facing bot persona**, not the name of the generic platform subsystem. The generic Green context, capability-catalog, and inference foundation is **Stellar Core**. Athena and future personas may use Stellar Core through normal scoped contracts. Former Green `athena` developer names remain deprecated transition aliases until instrumented zero-use evidence permits removal.
- **D-32:** **ChatTag is a temporary donor/product name.** Chat Tag remains the name of its original game, but the broader multi-game product must receive a distinct Games Hub name during its Green vertical. No capability is removed or renamed blindly before that inventory.

### Deliberately deferred decisions

These remain `OPEN` because deciding them without measurements would create policy around imaginary load:

- **D-08:** exact Xbox warm-worker/standby policy;
- **D-09:** stop versus suspend by workload;
- **D-20:** exact local-companion vs Fly CPU vs paid-provider routing priority;
- **D-21:** exact free-tier weighted allowance;
- **D-22:** exact Companion quota incentive;
- **D-23:** exact premium quota/priority promise;
- **D-24:** prompt/content retention policy beyond the current minimum-data principle.

They must be resolved before the phase that exposes the affected behavior to production tenants.

## Architecture debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-01 | One logical SPMT data plane | Accept. It ends competing shared facts and matches the working background/profile fan-out pattern. | It increases blast radius and demands stronger availability, versioning, and tenant isolation. | ACCEPT |
| D-02 | Direct database access from apps | Reject. All apps use versioned SPMT APIs/events so storage can change safely and policy stays centralized. | Direct reads can be faster and simpler for trusted first-party code. | ACCEPT |
| D-03 | Canonical storage implementation | Accept the storage-authority contract while keeping the database/file provider replaceable behind it. | A provider-specific design can optimize sooner and reduce abstraction work. | CHANGE |
| D-04 | SPMT minimum redundancy | Green may start small; production cutover requires redundant stateless API/front-door capacity or measured equivalent, one writable data authority epoch, and tested recovery promotion. | Minimum production redundancy costs more than a single always-on Machine. | CHANGE |
| D-05 | SpaceMountain deployment | Keep an always-available lightweight gateway/static shell, separated from wakeable app runtimes. | Another gateway adds routing complexity and a dependency in front of apps. | ACCEPT |
| D-06 | Lightweight app consolidation | Consolidate compatible low-risk modules into a few deployables/process groups, not one Machine per branded app. | Separate apps give clearer blast-radius, deploy, security, and scaling isolation. | ACCEPT |
| D-07 | Heavy workload isolation | Isolate Xbox and demonstrably heavy/untrusted jobs; pool ordinary LLM/persona inference by default. | Per-user isolation is easier to reason about and prevents noisy neighbors. | ACCEPT |
| D-08 | Xbox warm policy | Measure startup and session behavior before choosing N+standby policy. | A fixed warm policy is simpler to implement immediately. | OPEN |
| D-09 | Stop versus suspend | Benchmark both per workload; use suspend only when resume correctness and savings beat stop. | One universal lifecycle is operationally simpler. | OPEN |
| D-10 | Dynamic worker scaling | Use a bounded fast pool plus scoped overflow autoscaling; tune thresholds from queue/latency evidence. | Pre-created stopped Machines still have rootfs cost and fleet complexity. | ACCEPT |
| D-11 | Queue technology | Start with the smallest durable queue that meets lease/retry/idempotency needs; avoid a new platform until measured load requires it. | A dedicated queue provides stronger semantics and independent scaling immediately. | ACCEPT |
| D-12 | Event bus form | Begin with transactional outbox + consumers under SPMT, then graduate if throughput proves necessary. | A true broker avoids rebuilding event infrastructure later. | ACCEPT |

## Identity and data debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-13 | “Single auth” meaning | One identity provider and policy authority, with scoped per-service identities—not one shared secret. | Per-service credentials still feel like secret sprawl. | ACCEPT |
| D-14 | Standalone app behavior | Direct app URLs use SPMT login/session restore and degrade honestly when SPMT is unavailable. | Local emergency sessions could keep an app usable during SPMT outages. | ACCEPT |
| D-15 | Legacy auth compatibility | Instrument each legacy route, migrate callers, then delete after a zero-use window and rollback checkpoint. | Keeping compatibility at all prolongs risk and confusion. | ACCEPT |
| D-16 | Shared-fact boundary | Centralize cross-app facts. Allow small app-local volumes for private durable state, cache, temporary staging, and retry buffers with clear ownership and expiry. | Local durable state can quietly become a second authority unless contracts and reconciliation enforce the boundary. | ACCEPT |
| D-16A | Independent recovery authority | Require a separate recovery app with its own Machine, volume, deployment boundary, versioned recovery points, integrity verification, promotion fencing, and tested failback. | This adds storage, operational machinery, and periodic compute cost. | ACCEPT |
| D-16B | Recovery placement and schedule | Dedicated `spmt-vault` in a different zone/region is required; exact schedule/retention follows an explicit RPO before tenant writes. | Using SpaceMountain avoids another app and reduces operational surface. | CHANGE |
| D-16C | Last-resort immutable copy | Keep an encrypted, versioned recovery copy outside the primary Fly app/organization failure boundary. | Another storage provider/account adds credentials and cost. | ACCEPT |
| D-17 | Points reconciliation | Rebuild from verifiable events and migration provenance; quarantine ambiguity for owner resolution. Never sum or choose max automatically. | Manual review may be slow for many tenants and delay cutover. | ACCEPT |
| D-18 | Existing local databases | Freeze writes by domain during migration, import idempotently, verify counts/hashes/samples, retain read-only rollback copies. | Dual-read or dual-write can reduce downtime but greatly increases complexity. | ACCEPT |
| D-19 | Media ownership | Canonical shared metadata in SPMT; durable bytes in object/private storage according to ownership; scoped/signed access to apps. | Direct app-owned buckets reduce central coupling. | ACCEPT |

## AI and business debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-20 | Local-first order | Measure companion/Fly/provider quality, latency, availability, and cost before freezing routing priority. | Picking an order now simplifies implementation. | OPEN |
| D-21 | Free-tier allowance | Use weighted credits plus short abuse and longer plan windows; exact values require measured costs. | Credits are harder for users to understand than simple call counts. | OPEN |
| D-22 | Companion incentive | Local execution should increase effective capacity; exact hosted fallback effect requires measurement. | A fixed incentive is easier to market immediately. | OPEN |
| D-23 | Premium promise | High bounded quota and priority is preferred; exact promise requires measured economics. | “Unlimited” is easier to market. | OPEN |
| D-24 | Prompt retention | Keep minimum-data behavior by default; exact retained content and opt-in history policy needs a separate privacy/product decision. | Prompt history improves debugging and persona continuity. | OPEN |

## Delivery debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-25 | Repository layout | ApolloStation becomes the Green implementation monorepo; packages may deploy independently and can be split only when evidence justifies it. | Separate repositories provide harder organizational boundaries from day one. | CHANGE |
| D-26 | Parallel production window | Time-box blue/green operation with daily cost visibility and automatic expiry reviews. | A hard clock can force risky migration decisions. | ACCEPT |
| D-27 | Cutover unit | Migrate one bounded capability/tenant cohort at a time, not all apps at once. | Cross-app contracts may be easier to validate in a single coordinated switch. | ACCEPT |
| D-28 | Old-system retirement | Require backup, reconciliation, observation, and rollback gates before stopping old apps; delay data/source deletion longer. | Carrying old systems costs money and leaves confusing artifacts. | ACCEPT |
| D-29 | First-party developer-platform parity | First-party apps use the same scoped, documented contracts available to outside developers. | Private shortcuts can be faster for code owned by one team. | ACCEPT |
| D-30 | Dynamic app discovery | Every Apps surface consumes the canonical registry and reacts to approved registry revisions without source edits or redeployment. | Static menus are simpler and can hide partially ready apps. | ACCEPT |

## Product naming debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-31 | Athena versus generic AI/system infrastructure | Reserve Athena for the bot persona; name the shared context, capability, and inference subsystem Stellar Core. Preserve former Green `athena` contract names only as deprecated aliases during measured migration. | Reusing Athena everywhere creates one familiar name and requires fewer code changes. | ACCEPT |
| D-32 | ChatTag product name | Keep Chat Tag as the original game name, but select a broader Games Hub product name during its Green vertical after its full capability audit. | Keeping the existing product name avoids migration and recognition work. | ACCEPT |

## Change record template

For any future `CHANGE`, `REJECT`, or reopened decision append:

- Date:
- Owner position:
- Counterproposal:
- Evidence:
- Accepted wording:
- Consequences:
- Revisit trigger/date:
