# Decision and Debate Ledger

Status values: `ACCEPT`, `REJECT`, `CHANGE`, or `OPEN`.

Nothing marked `OPEN` is authorized for implementation. Facts such as “Firebase is gone” are recorded as constraints rather than manufactured debates.

## Architecture debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-01 | One logical SPMT data plane | Accept. It ends competing shared facts and matches the working background/profile fan-out pattern. | It increases blast radius and demands stronger availability, versioning, and tenant isolation. | OPEN |
| D-02 | Direct database access from apps | Reject. All apps use versioned SPMT APIs/events so storage can change safely and policy stays centralized. | Direct reads can be faster and simpler for trusted first-party code. | OPEN |
| D-03 | Canonical storage implementation | Owner position: one storage-authority app owns the large authoritative volume and serves all callers through SDK/API/CLI/MCP/WSS contracts. Compare this with managed/network PostgreSQL plus object storage before approval. | A single attached volume is simple and inexpensive, but it binds authority to one Machine and requires explicit backup, recovery, and any replication. | OPEN |
| D-04 | SPMT minimum redundancy | Prefer two API Machines and a replicated/managed data layer before tenant cutover. | A single always-on Machine is cheaper and the current tenant base may tolerate brief downtime. | OPEN |
| D-05 | SpaceMountain deployment | Keep an always-available lightweight gateway/static shell, separated from wakeable app runtimes. | Another gateway adds routing complexity and a dependency in front of apps. | OPEN |
| D-06 | Lightweight app consolidation | Consolidate compatible low-risk modules into a few deployables, not one Machine per branded app. | Separate apps give clearer blast-radius, deploy, security, and scaling isolation. | OPEN |
| D-07 | Heavy workload isolation | Isolate Xbox and demonstrably heavy/untrusted jobs; pool ordinary LLM persona inference. | Per-user isolation is easier to reason about and prevents noisy neighbors. | OPEN |
| D-08 | Xbox warm policy | While N sessions are active, run N leased workers plus one ready standby; at zero, keep reserve stopped/suspended. | A continuously running standby has more predictable latency; no standby is cheaper. | OPEN |
| D-09 | Stop versus suspend | Benchmark both per workload; use suspend only when resume correctness and savings beat stop. | One universal lifecycle is operationally simpler. | OPEN |
| D-10 | Dynamic worker scaling | Pre-create a bounded fast pool for latency-sensitive work; create/destroy overflow via a scoped autoscaler. | Pre-created stopped Machines still have rootfs cost and fleet complexity. | OPEN |
| D-11 | Queue technology | Start with the smallest durable queue that meets lease/retry/idempotency needs; avoid a new platform until measured load requires it. | A dedicated queue provides stronger semantics and independent scaling immediately. | OPEN |
| D-12 | Event bus form | Begin with transactional outbox + consumers under SPMT, then graduate if throughput proves necessary. | A true broker avoids rebuilding event infrastructure later. | OPEN |

## Identity and data debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-13 | “Single auth” meaning | One identity provider and policy authority, with scoped per-service identities—not one shared secret. | Per-service credentials still feel like secret sprawl. | OPEN |
| D-14 | Standalone app behavior | Direct app URLs use SPMT login/session restore and degrade honestly when SPMT is unavailable. | Local emergency sessions could keep an app usable during SPMT outages. | OPEN |
| D-15 | Legacy auth compatibility | Instrument each legacy route, migrate callers, then delete after a zero-use window and rollback checkpoint. | Keeping compatibility at all prolongs risk and confusion. | OPEN |
| D-16 | Shared-fact boundary | Centralize cross-app facts. Allow small app-local volumes for private durable state, cache, temporary staging, and retry buffers with clear ownership and expiry. | Local durable state can quietly become a second authority unless contracts and reconciliation enforce the boundary. | OPEN |
| D-16A | Independent recovery authority | Require a separate recovery app with its own Machine, volume, deployment boundary, versioned recovery points, integrity verification, promotion fencing, and tested failback. It normally runs stopped or at minimum cost and boots on schedule to update and verify the backup. | This adds storage, operational machinery, and periodic compute cost, but the shared authority is too important to remain a single-volume failure domain. | ACCEPT |
| D-16B | Recovery placement and schedule | Prefer a dedicated `spmt-vault` app in a different zone/region rather than storing the recovery volume inside SpaceMountain. Set interval and retention from an explicit acceptable-data-loss target. | Using SpaceMountain avoids another app, while very frequent recovery updates reduce data loss but increase cost and exposure. | OPEN |
| D-16C | Last-resort immutable copy | Keep an encrypted, versioned recovery copy outside the primary Fly app/organization failure boundary. | Another storage provider/account adds credentials and cost, but a second app in the same Fly organization does not cover every catastrophic or account-level failure. | OPEN |
| D-17 | Points reconciliation | Rebuild from verifiable events and migration provenance; quarantine ambiguity for owner resolution. Never sum or choose max automatically. | Manual review may be slow for many tenants and delay cutover. | OPEN |
| D-18 | Existing local databases | Freeze writes by domain during migration, import idempotently, verify counts/hashes/samples, retain read-only rollback copies. | Dual-read or dual-write can reduce downtime but greatly increases complexity. | OPEN |
| D-19 | Media ownership | Canonical metadata in SPMT; bytes in object storage; apps receive signed access. | Direct app-owned buckets reduce central coupling. | OPEN |

## AI and business debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-20 | Local-first order | Companion first when authorized, Fly CPU second for suitable jobs, paid API for quality/overflow/failure. | Provider consistency may be more valuable than lowest marginal cost. | OPEN |
| D-21 | Free-tier allowance | Use weighted credits plus short abuse and longer plan windows. | Credits are harder for users to understand than simple call counts. | OPEN |
| D-22 | Companion incentive | Local execution raises effective capacity but does not grant unlimited hosted fallback. | Users may expect installing the companion to raise hosted limits too. | OPEN |
| D-23 | Premium promise | High bounded quota and priority, never unlimited. | “Unlimited” is easier to market. | OPEN |
| D-24 | Prompt retention | Do not retain private prompts by default; retain metering and failure metadata. | Prompt history greatly improves debugging and persona continuity. | OPEN |

## Delivery debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-25 | Repository layout | One new blueprint repo now; new implementation repos or a monorepo are decided only after module/deployable boundaries are approved. | Choosing the code layout now can accelerate scaffolding. | OPEN |
| D-26 | Parallel production window | Time-box blue/green operation with daily cost visibility and automatic expiry reviews. | A hard clock can force risky migration decisions. | OPEN |
| D-27 | Cutover unit | Migrate one bounded capability/tenant cohort at a time, not all apps at once. | Cross-app contracts may be easier to validate in a single coordinated switch. | OPEN |
| D-28 | Old-system retirement | Require backup, reconciliation, observation, and rollback gates before stopping old apps; delay repo deletion longer. | Carrying old systems costs money and leaves confusing artifacts. | OPEN |
| D-29 | First-party developer-platform parity | Require owner-operated apps to use every applicable documented SDK, CLI, MCP, API, event, webhook, job, and companion contract. Each app becomes an executable reference implementation; private shortcuts require a narrow documented exception. | Public-contract discipline adds SDK and documentation work to every feature and can be slower than direct internal coupling. | ACCEPT |
| D-30 | Registry-driven shared Apps surfaces | Require SpaceMountain, SPMT/Shipyard, Companion, embedded launchers, and every app-owned Apps page to discover approved apps/modules dynamically from the canonical registry. Registry events refresh immediately and revision polling repairs missed events; runtime health changes status rather than silently removing an approved listing. | Hardcoded catalogs are simpler, remain usable when discovery fails, and give each product complete editorial control over its layout. | ACCEPT |

## Debate record template

For each decision, append:

- Owner position:
- Counterproposal:
- Evidence:
- Accepted wording:
- Consequences:
- Revisit trigger/date:
