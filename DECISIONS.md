# Decision and Debate Ledger

Updated: 2026-08-24

Status values: `ACCEPT`, `REJECT`, `CHANGE`, or `OPEN`.

`ACCEPT` means the recommendation or accepted wording is authorized for the Green/Sprites rebuild. `CHANGE` means the original recommendation is replaced by the accepted wording recorded below. `OPEN` means implementation may not silently choose that policy; however, an open measurement-dependent decision does not block earlier phases that do not depend on it.

Owner approvals on 2026-08-21 and 2026-08-22 authorize the governing pack below for **Green only**. They do not authorize production cutover, DNS movement, production data writes by Green, or retirement of Blue.

## Foundation and continuation decision pack — approved 2026-08-21, amended 2026-08-22

The following wording governs implementation where it is more specific than the original recommendation:

- **D-01 / D-02:** SPMT is one logical shared-fact/control authority. Product apps never bypass versioned SPMT contracts to read or mutate canonical shared storage directly.
- **D-03:** Approve the **storage-authority boundary**, not a permanent database vendor. The first implementation may use the simplest economical single-writer store that satisfies integrity, performance, migration, backup, and failover gates. Storage can later move to PostgreSQL/object storage or another implementation without changing app-facing contracts.
- **D-04:** Isolated Green development may begin with minimum capacity. Production cutover requires redundant stateless SPMT/API and front-door capacity (or a measured equivalent with tested automatic recovery), while canonical storage maintains exactly one writable authority epoch plus the independent recovery authority.
- **D-05 / D-06:** SpaceMountain remains the always-available front door. Consolidate compatible low-risk code by runtime role/package, not merely by brand name, while preserving separate deploy/process/security/scaling boundaries where justified.
- **D-07 / D-10 / D-11 / D-12:** Use anchored coordinators plus bounded elastic workers. Start with a small durable queue/job store, leases, TTL, heartbeat, idempotency, drain, dead-letter behavior, and a reconciler. Pre-created stopped capacity may serve latency-sensitive work; overflow creation/destruction is allowed behind a scoped autoscaler. Thresholds remain runtime configuration derived from measurements.
- **D-08:** Keep Cloud Xbox as an opt-in, per-user-isolated workload. Begin with zero always-running warm Machines, start sessions on demand, stop after 15 idle minutes, and apply a default two-hour active-session cap. Add pre-created stopped capacity or a warm standby only when measurements prove the latency benefit justifies its cost and operational risk.
- **D-09:** Stop workloads by default. Suspend only a workload whose measured resume path preserves state and credentials correctly, cannot duplicate consumers, materially improves latency, and costs less than stopping.
- **D-13 through D-16:** One SPMT human identity and policy authority; scoped per-service identities; provider credentials remain provider credentials; standalone apps restore SPMT identity; legacy auth is instrumented then removed after a zero-use window; cross-app facts have one canonical authority and local data is explicitly classified.
- **D-16A:** Independent recovery authority remains mandatory.
- **D-16B:** Recovery placement and targets are decided: use a dedicated recovery app (provisionally `spmt-vault`) in a different Fly zone/region and deployment boundary. Target a 15-minute primary RPO, a 60-minute normal RTO, and a four-hour provider-boundary disaster RTO. Replicate recovery points every 15 minutes; retain daily verified full backups for 30 days, weekly backups for 12 weeks, monthly encrypted external backups for 12 months, and rehearse restore/failover quarterly.
- **D-16C:** Keep an encrypted, versioned last-resort recovery copy outside the primary Fly app/organization failure boundary before production cutover. Provider choice is implementation detail.
- **D-17 / D-18:** Reconcile points/shared balances from verifiable events, identity mapping, award rules, migration provenance, and idempotency. Never sum or choose max automatically. Migrations are idempotent, verified, and retain read-only rollback copies.
- **D-19:** Shared media metadata belongs to SPMT; durable bytes use object storage or a clearly owned private store as appropriate. Apps get scoped/signed access and may keep replaceable caches.
- **D-20:** The platform selects providers and routing for Free users. Companion-connected and Premium users receive additional eligible providers/models and more granular routing controls; Premium entitlements govern hosted choices, while Companion exposes approved local choices. Health, safety, capability, and availability policy may override a selection with a visible fallback reason. Apps use the public routing contract and cannot bypass plan/tenant policy.
- **D-21 through D-23:** Use measured weighted credits with a short abuse window and a monthly plan allowance. Local Companion work consumes zero or minimal hosted credits; Fly/provider work consumes cost-weighted credits. Premium provides priority and a high bounded allowance. Do not market an unqualified unlimited tier. Exact credit quantities remain measured runtime/business configuration.
- **D-24:** Separate operational retention from intentional memory. Raw prompts/responses default to seven-day retention; content-minimized job/audit metadata defaults to 30 days; explicitly curated Community Assistant or configured-persona memory persists until the user edits or deletes it. Keep private and public memory separate, require explicit scopes, provide export/deletion/“do not remember” controls, and never retain provider secrets in conversation history.
- **D-25:** Use **ApolloStation as the Green implementation monorepo** unless later evidence proves a security or operational boundary requires a separate repository. The monorepo may still produce multiple independent Fly deployables/process groups.
- **D-26 through D-28:** Blue/Green is time-boxed and cost-visible. Cut over in this order: synthetic tenants, the owner plus a dedicated test tenant, two or three trusted tenants, approximately ten percent of active tenants, then the remaining tenants. Migrate capabilities in the order identity/provider links, settings/registry, Commlink/live chat, XP/shared profiles, overlays/workspace, then individual apps. Observe infrastructure capabilities for at least 72 hours and real-user cohorts for seven days. Any tenant breach, duplicate award/action, unexplained data mismatch, or failed rollback stops and reverses the cohort. Old compute stops only after observation and rollback gates; old data and source remain for the approved retention windows.
- **D-29:** First-party apps must use every applicable public SDK, API, CLI, MCP, event, webhook, job, registry, and companion contract. A private first-party shortcut is evidence that the public developer platform is incomplete.
- **D-30:** Approved apps and modules are dynamically discovered from the canonical SPMT registry by every Apps surface. Approval, runtime health, compatibility, entitlement, and visibility remain separate states; an approved cold or degraded app does not silently disappear.
- **D-31:** **Stellar Core is the shared ecosystem AI system; Stella is the default SPMT Community Assistant; StreamWeaver owns tenant/user-configurable bot personas.** Athena is the owner’s configured StreamWeaver persona, not a universal bot name, public fallback, or generic subsystem. Another user may configure Bob, Bill, or another persona with their own permitted name, behavior, voice, memory, and capabilities. Stella is available to authorized SPMT users and apps whether or not they use StreamWeaver; a StreamWeaver tenant may deliberately use Stella as its community bot or select a configured persona. `spmt.community-assistant` remains the stable technical role while `Stella` is its public display name. Stella and configured StreamWeaver personas send identity-scoped work through Stellar Core’s normal public contracts; identities do not receive dedicated infrastructure merely because they have different names. Former generic Green `athena` developer names remain deprecated transition aliases until instrumented zero-use evidence permits removal.
- **D-32:** **Chat Tag remains the original game; the broader multi-game product is Nebula Arcade.** Quackverse, Bingo, Arena, Chat Tag, and future games remain bounded modules using shared game/developer contracts rather than one giant runtime. No capability is removed blindly during the rename or migration.
- **D-33:** Preserve live chat behind a provider-neutral Chat Gateway contract. SPMT owns identity, grants, and shared Commlink history; the gateway owns provider connections, normalization, cursors, and reconnects; StreamWeaver consumes normalized chat for tenant-configured personas and commands; SpaceMountain and developers use the public SDK/API/events. The first physical implementation may be colocated, but no app owns an irreplaceable private chat contract.
- **D-34:** Build SPMT as a focused Account, Developer, and Operator portal rather than a second SpaceMountain shell. SpaceMountain remains the ecosystem front door.
- **D-35:** SPMT owns canonical forum threads, replies, and permissions. DSH provides the Discord bridge; SpaceMountain presents a combined source-labeled view through public contracts.
- **D-36:** Remove the ecosystem block-style Builder product and its nonfunctional page/QR/flow claims. Developers build workflows and interfaces inside their own registered apps using the public SDK, API, CLI, MCP, events, webhooks, and jobs. A future independently submitted builder app may use those contracts, but Green does not ship or preserve the fake first-party Builder surface.
- **D-37:** Preserve the Shop surface but begin with a verified external storefront. Checkout/payment authority remains with the provider; SPMT accepts only authenticated, idempotent provider events for entitlements or digital purchases. Native checkout waits for demonstrated demand and a fully verified integration.
- **D-38:** Preserve Arena with immediate match-local scoring, including kill feedback, while settling canonical rewards once per verified match. Completion, wins, achievements, and capped milestones may award idempotent SPMT XP, badges, or cosmetics; per-kill canonical XP is not used. Arena score and ecosystem XP remain visibly distinct.
- **D-39:** Preserve web, image, text, camera, screen, and Xbox overlay sources with capability-specific execution. Text/images may render in approved clients; user HTTPS web sources run in sandboxed frames with credential/private-network protections and developer-declared domains; camera/screen capture remains local to the browser or Companion with per-session permission and visible indicators unless the user explicitly starts a remote stream/recording feature; Xbox frames use the isolated Xbox service. Every source retains independent visibility, interaction, opacity, layering, and revocation controls.
- **D-40:** Stellar Core first ships a real provider-neutral AI foundation: provider/model adapters, capability discovery, text inference, durable jobs, provider health, D-20 routing/entitlements, usage accounting, scoped context/memory, structured tool results, and truthful retry/fallback. Stellar Core never speaks publicly as Athena, Stella, or any other presentation persona. Stella, the default Community Assistant, proves general SPMT/app AI interaction without requiring a SpaceMountain or StreamWeaver session; StreamWeaver proves tenant-configured personas, with Athena restricted to the owner’s configuration. Stella invocation must be available to authorized first- and third-party apps through equivalent public SDK, HTTP API, CLI, MCP, event/job, and Commlink contracts with the same tenant, user, scope, retention, and audit enforcement. The first persona vertical covers conversation, scoped memory, streaming commands, and voice; coding/research follows; automations/crew delegation follows after approvals and rollback are proven. All use the same public Stellar Core contracts.
- **D-41:** Support XP earning, spending, and bounded user transfers through the append-only ledger with idempotency, provenance, limits, and abuse monitoring. Signed catalog identifiers govern purchases and creator rewards. Do not launch wagering/gambling in the base platform.
- **D-42:** Launch the developer marketplace as a reviewed beta after first-party conformance and one external canary. Require automated manifest/scope/security validation, manual publishing review and high-risk-scope review, signed immutable versions, test-tenant proof, and immediate suspension/revocation. Expand public submission only after the lifecycle is proven.
- **D-43:** Evolve the Mtman Machine Rotator into the private ecosystem fleet reconciler. It preserves controlled periodic restarts for always-on Machines, maintains a live inventory of observed Fly state, reconciles approved per-workload runtime policy against health, traffic, queues, sessions, leases, capacity, quotas, and cost, and safely starts, drains, stops, replaces, or scales eligible Machines as demand grows and shrinks. SPMT remains authoritative for app approval, declared capabilities, identity, scopes, and desired policy; the Rotator owns operational observation, lifecycle decisions, Fly actions, and their audit evidence, then reports truthful runtime health/capacity back to SPMT. Apps never receive Fly credentials or unrestricted fleet authority. Owner/operator actions and app/developer self-service use separate least-privilege scopes. Every action is bounded, idempotent, leader-fenced, cost-limited, rollback-aware, and recorded with its signals, reason, actor, target, result, and correlation ID.
- **D-44:** Name the complete shared foundation **SPMT Ecosystem Core**. Keep SPMT as the identity/data/policy/developer authority, SpaceMountain as the front door/workspace, Stellar Core as the persona-neutral AI subsystem, and the Mtman Machine Rotator as the private operations/fleet controller. `ApolloStation` remains the implementation repository/codename. Product apps sit above the core and consume its public developer contracts; the ecosystem name does not create a private first-party integration path.
- **D-45:** Commlink, the Stellar Core/Stella surface, and Mission Control are registered first-party applications rather than hardcoded SpaceMountain pages. SpaceMountain retains Home, Shipyard, Workspace, and account navigation, then renders every installed/authorized app—including these first-party apps—from the canonical SPMT registry. Mission Control remains owner/operator scoped; Coder and Rotator are workers behind it, while Stellar Core remains the persona-neutral AI service behind Stella. The sidebar's app region scrolls independently with a theme-colored scrollbar revealed only during interaction.

### Deliberately deferred decisions

There are no remaining open governing decisions in this pack. Measurement-derived configuration values may still be tuned only within the accepted boundaries and release gates.

### Design observation — app-initiated integration

The preferred topology is caller-initiated: apps and users call public SPMT/Stellar Core contracts or publish explicitly scoped events, while the platform does not proactively crawl or ingest application content merely because an app is registered. This is guidance, not a hard prohibition. Explicit subscriptions, imports, synchronization, diagnostics, memory writes, and provider feeds remain allowed when a documented contract, scope, consent/tenant policy, retention rule, and audit trail justify them.

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
| D-08 | Xbox warm policy | Keep opt-in per-user isolation; start with zero warm Machines, start on demand, stop after 15 idle minutes, cap active sessions at two hours by default, and add stopped/warm capacity only from measured need. | A warm standby would reduce first-session latency. | ACCEPT |
| D-09 | Stop versus suspend | Stop by default; suspend only when workload-specific tests prove correct, duplicate-safe, materially faster, and cheaper resume. | One universal lifecycle or suspend-first policy is simpler. | ACCEPT |
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
| D-16B | Recovery placement, RPO/RTO, and retention | Dedicated `spmt-vault` in a different zone/region; 15-minute primary RPO, 60-minute normal RTO, four-hour provider-boundary RTO, 15-minute recovery points, 30 daily, 12 weekly, and 12 monthly encrypted external backups, plus quarterly drills. | The targets and retention increase storage and operational cost before production load is known. | CHANGE |
| D-16C | Last-resort immutable copy | Keep an encrypted, versioned recovery copy outside the primary Fly app/organization failure boundary. | Another storage provider/account adds credentials and cost. | ACCEPT |
| D-17 | Points reconciliation | Rebuild from verifiable events and migration provenance; quarantine ambiguity for owner resolution. Never sum or choose max automatically. | Manual review may be slow for many tenants and delay cutover. | ACCEPT |
| D-18 | Existing local databases | Freeze writes by domain during migration, import idempotently, verify counts/hashes/samples, retain read-only rollback copies. | Dual-read or dual-write can reduce downtime but greatly increases complexity. | ACCEPT |
| D-19 | Media ownership | Canonical shared metadata in SPMT; durable bytes in object/private storage according to ownership; scoped/signed access to apps. | Direct app-owned buckets reduce central coupling. | ACCEPT |

## AI and business debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-20 | AI provider selection and routing entitlements | The platform selects Free-user providers/routes; Companion and Premium unlock additional eligible providers/models and granular controls, subject to plan, tenant, health, safety, capability, and availability policy with visible fallback reasons. | One universal automatic route is simpler to operate and explain. | ACCEPT |
| D-21 | Free-tier allowance | Weighted credits with a short abuse window and monthly plan allowance; exact quantities follow measured costs. | Credits are harder for users to understand than simple call counts. | ACCEPT |
| D-22 | Companion incentive | Local Companion work consumes zero or minimal hosted credits; hosted fallback consumes measured weighted credits. | A fixed incentive is easier to explain and market. | ACCEPT |
| D-23 | Premium promise | Offer priority plus a high bounded allowance; do not market unqualified unlimited use. Exact quantities follow measured economics. | “Unlimited” is easier to market. | ACCEPT |
| D-24 | Prompt and memory retention | Raw prompts/responses default to seven days, content-minimized job/audit metadata to 30 days, and explicit curated memory until user edit/deletion, with private/public separation, scopes, export, and deletion controls. | Longer automatic history improves debugging and persona continuity. | ACCEPT |

## Delivery debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-25 | Repository layout | ApolloStation becomes the Green implementation monorepo; packages may deploy independently and can be split only when evidence justifies it. | Separate repositories provide harder organizational boundaries from day one. | CHANGE |
| D-26 | Parallel production window | Time-box blue/green operation with daily cost visibility and automatic expiry reviews. | A hard clock can force risky migration decisions. | ACCEPT |
| D-27 | Cutover unit and order | Synthetic tenants → owner/test tenant → two or three trusted tenants → about ten percent → remaining tenants; identity/providers → settings/registry → Commlink/chat → XP/profiles → overlays/workspace → apps; minimum 72-hour infrastructure and seven-day user-cohort observation. | A coordinated all-at-once cutover is faster and avoids prolonged dual operation. | ACCEPT |
| D-28 | Old-system retirement | Require backup, reconciliation, observation, and rollback gates before stopping old apps; delay data/source deletion longer. | Carrying old systems costs money and leaves confusing artifacts. | ACCEPT |
| D-29 | First-party developer-platform parity | First-party apps use the same scoped, documented contracts available to outside developers. | Private shortcuts can be faster for code owned by one team. | ACCEPT |
| D-30 | Dynamic app discovery | Every Apps surface consumes the canonical registry and reacts to approved registry revisions without source edits or redeployment. | Static menus are simpler and can hide partially ready apps. | ACCEPT |
| D-45 | Foundational application surfaces | Register Commlink, Stellar Core, and Mission Control as first-party apps; discover their names, descriptions, launch targets, installation, and visibility through SPMT instead of hardcoding SpaceMountain navigation. | Keeping them as SpaceMountain pages requires less routing and packaging. | ACCEPT |
| D-46 | Shared functional execution foundation | Use one metered `ExecutionJobV1` lifecycle with idempotent creation, fenced worker leases, bounded retries/dead letters, progress, and separate physical versus billing targets. Use it for asynchronous app work unless a documented specialized protocol is necessary. | App-specific queues are initially faster to implement and may match each workload more closely. | ACCEPT |
| D-47 | Account versus app Settings | Account owns personal profile, plan, billing, and usage. Each app owns its versioned normal/advanced Settings and private storage, including encrypted write-only secrets and revision-safe migrations. | A single ecosystem Settings page would give users one place for every toggle. | ACCEPT |
| D-48 | Provider credential delivery | SPMT remains provider credential authority and issues only short-lived app/capability/scope-bounded grants to installed services. Human sessions, jobs, logs, events, and URLs never carry provider credentials. | Letting each app store provider refresh tokens reduces broker dependency. | ACCEPT |
| D-49 | Capability-level cutover | Keep a machine-readable capability wiring manifest with explicit `green-only`, `shadow`, `green-primary-with-fallback`, or `disabled` routing and evidence-backed wiring states. No hidden dual writes. | App-level cutover flags are simpler and require less inventory detail. | ACCEPT |

## Product naming debates

| ID | Decision | Recommendation and defense | Strongest counterargument | Status |
|---|---|---|---|---|
| D-31 | Stellar Core, Stella, and configurable StreamWeaver personas | Stellar Core is persona-neutral shared AI; Stella is the app-neutral default Community Assistant exposed as `spmt.community-assistant`; StreamWeaver owns configurable tenant/user personas; Athena is owner-only. | One universal Athena persona is simpler to brand and support. | ACCEPT |
| D-32 | Chat Tag and Games Hub product name | Keep Chat Tag as the original game; name the broader modular product Nebula Arcade. | Keeping ChatTag as the suite name avoids migration and recognition work. | ACCEPT |
| D-44 | Shared-foundation name | Name the full shared foundation SPMT Ecosystem Core; retain Stellar Core for AI and ApolloStation for the repository/codename. Apps integrate through the same public developer contracts. | Calling the entire foundation Stellar Core would use one stronger brand, but would blur AI ownership with identity, UI, and fleet control. | ACCEPT |

## Product and ecosystem decisions

| ID | Decision | Accepted recommendation or open question | Strongest counterargument | Status |
|---|---|---|---|---|
| D-33 | Live-chat ownership | Provider-neutral Chat Gateway contract; SPMT owns identity/grants/shared history, the gateway owns provider connectivity/normalization, StreamWeaver consumes it for tenant-configured personas/commands, and all apps/developers use public contracts. | A StreamWeaver-only implementation has fewer initial service boundaries. | ACCEPT |
| D-34 | SPMT visible product | Focused Account, Developer, and Operator portal; SpaceMountain remains the main front door. | A complete secondary SPMT shell could remain usable during SpaceMountain failures. | ACCEPT |
| D-35 | Forum authority and Discord bridge | SPMT owns canonical threads/replies/permissions; DSH bridges Discord; SpaceMountain renders a combined source-labeled view. | Letting Discord remain canonical is operationally simpler for a Discord-first community. | ACCEPT |
| D-36 | Ecosystem Builder product | Remove the nonfunctional block-style Builder and page/QR/flow claims; developers create integrations and interfaces in their own registered apps using the public developer platform. | A first-party low-code Builder could make integrations accessible to non-developers. | ACCEPT |
| D-37 | Shop delivery | Begin with a verified external storefront; preserve the Shop surface and consume authenticated/idempotent provider events. | Native checkout offers a more seamless branded experience. | ACCEPT |
| D-38 | Arena rewards | Immediate match-local score; one verified capped settlement per match may award completion/win/milestone XP, badges, or cosmetics; no per-kill canonical XP. | Per-kill canonical XP is simple and immediately rewarding. | ACCEPT |
| D-39 | Overlay source permissions | Capability-specific execution: protected sandboxed HTTPS web sources, approved-client text/images, local permissioned camera/screen capture by default, isolated Xbox frames, and independent controls/revocation for every source. | A uniform cloud source system is simpler for creators. | ACCEPT |
| D-40 | Stellar Core foundation and first persona consumers | Ship real provider-neutral Stellar Core AI first; prove it through app-neutral Stella and configurable StreamWeaver personas; expose Stella equivalently through SDK/API/CLI/MCP/events/jobs/Commlink; then add coding/research and approved automation/crew delegation. Stellar Core never adopts a public persona. | Building every AI/persona surface together may feel more coherent. | ACCEPT |
| D-41 | XP economy operations | Support earning, spending, and bounded transfers with ledger controls; signed catalog rewards; no base-platform wagering/gambling. | Wagering and unrestricted transfers could increase game engagement. | ACCEPT |
| D-42 | Developer marketplace launch | Reviewed beta after first-party conformance and one external canary; automated validation, manual review, signed versions, test-tenant proof, and immediate revoke/suspend. | Open self-service publishing would grow the catalog faster. | ACCEPT |
| D-43 | Rotator fleet-control role | Replace the restart-only job with a private, policy-bounded fleet reconciler while preserving safe rolling restarts for always-on Machines. It observes demand and health, moderates capacity/cost, controls Fly lifecycle, and reports runtime truth to SPMT without taking over registry or product authority. | A simpler Fly-native autoscaler and periodic restart job would require less custom operational code. | ACCEPT |

## Change record — 2026-08-22 continuation pack

- **Owner position:** Accept recommendations 1, 2, 3, 5, 6, 10, 11, 12, 14, 15, 16, 17, and 18 from the product/infrastructure decision review. Hold recommendations 4, 7, 8, 9, and 13 for further discussion.
- **Accepted or amended IDs:** D-08, D-09, D-16B, D-21, D-22, D-23, D-24, D-27, D-32, D-33, D-34, D-35, D-37, D-41, and D-42.
- **Open at that checkpoint:** D-20, D-36, D-38, D-39, and D-40.
- **Consequences:** Green implementation may proceed on all accepted capabilities and neutral foundations. It may build test harnesses and provider-neutral contracts around the five open areas, but may not choose their product/runtime policy or expose the undecided behavior to production.
- **Publication at that checkpoint:** Hold the combined decision-pack publication until the five open decisions are resolved and the final accepted wording is reviewed as one coherent set.

## Change record — 2026-08-22 held-decision follow-up

- **Owner position:** Remove the nonfunctional ecosystem Builder; accept the recommended Arena reward model and overlay-source policy; make Free-user provider/routing selection platform-controlled while Companion and Premium unlock more providers and granular selection; clarify that Athena is the owner’s configurable StreamWeaver persona, while Stellar Core is the shared AI system and other users may choose other persona names.
- **Accepted or amended IDs:** D-20, D-31, D-33, D-36, D-38, and D-39.
- **Still open at that checkpoint:** D-40 only.
- **Consequences:** Developer integrations replace the first-party block Builder; Arena settles capped canonical rewards per match; overlay capture follows source-specific security; provider choice is entitlement-aware; StreamWeaver personas are user-configurable and execute through shared Stellar Core contracts.
- **Publication:** Continue holding publication until D-40 is resolved, then validate and publish the full approved pack together.

## Change record — 2026-08-22 Stellar Core/persona resolution

- **Owner position:** Accept D-40 with a strict presentation boundary: Athena is only the owner’s configured StreamWeaver persona; other StreamWeaver users configure their own personas; Stella is the default SPMT Community Assistant and remains available outside StreamWeaver; Stellar Core is persona-neutral shared AI infrastructure and never emits public messages as a presentation persona.
- **Accepted or amended IDs:** D-31 and D-40.
- **Still open:** none.
- **Integration observation:** Prefer apps/users initiating scoped calls or events into SPMT/Stellar Core instead of the platform proactively ingesting registered-app content. Keep this as nonbinding guidance so explicit authorized feeds, imports, synchronization, diagnostics, and memory remain possible.
- **Consequences:** Public AI identity is chosen by the caller/presentation layer; the same Stellar Core contracts serve Stella, StreamWeaver personas, and approved developer apps without globalizing any tenant’s persona or tying AI access to one app session. Stella must be callable through the public developer surfaces and may be selected as StreamWeaver’s community bot or Commlink AI.
- **Publication:** Validate the entire amended pack for stale global-Athena, Builder, StreamWeaver-chat-ownership, and open-decision language; then commit and publish it to the existing Green branch.

## Change record — 2026-08-22 Rotator fleet-role expansion

- **Owner position:** Keep controlled restart maintenance for always-on Machines, and expand the Rotator into the private ecosystem maintainer, logger, monitor and runtime moderator that safely grows and shrinks app capacity with traffic and workload demand.
- **Accepted ID:** D-43.
- **Boundary:** SPMT remains authoritative for approved apps, capabilities, identities, scopes and desired runtime policy. The Rotator observes and operates Fly runtime state, enforces approved bounds, and reports health/capacity evidence back through SPMT. SpaceMountain presents that truth; apps do not receive Fly credentials.
- **Consequences:** The Green Rotator requires an elected/fenced reconciliation loop, per-workload policies, controlled rolling restart, demand-aware scaling, graceful drain, duplicate-consumer protection, cost/quota circuits, redacted decision/action evidence, and separate owner versus app/developer scopes before it may receive production mutation authority.
- **Publication:** Record and test the contract on the existing Green branch; do not connect it to production Fly credentials or start a Rotator service during the Sprite foundation phase.

## Change record — 2026-08-22 ecosystem-core naming

- **Owner position:** Save the merged shared system as the ecosystem/core foundation that the remaining apps use through its tools.
- **Accepted ID:** D-44.
- **Name:** SPMT Ecosystem Core.
- **Boundary:** Stellar Core remains the AI subsystem; SPMT, SpaceMountain, and the Mtman Machine Rotator retain their already accepted distinct roles. ApolloStation remains the repository/codename.
- **Consequences:** Downstream apps consume the documented SDK, HTTP API, CLI, MCP, event, webhook, and job surfaces. The new umbrella name grants no hidden first-party shortcut or additional authority.

## Change record — 2026-08-28 Stellar chat implementation

- **Owner position:** Approve the first functionality-parity chunk using Qwen as the automatic route, plan-aware Companion eligibility, personal Account usage, and the existing shared job/machine foundation.
- **Implemented decisions:** D-20, D-22, D-31, D-40, D-46, D-47, and D-49. D-24 remains a production gate until retention and user controls are enforced.
- **Routing:** Free users remain platform-routed to hosted Qwen. Paid users see the Companion route only when Companion is installed and ready. An ineligible explicit Companion request receives a visible hosted fallback reason.
- **Boundary:** All Stella work enters `ExecutionJobV1`; the browser-to-Qwen bypass is removed. Provider/model controls stay owner-only and Stellar Core does not speak as Athena or another tenant persona.
- **Production gate:** Keep the capability in shadow until retention/export/deletion enforcement, live capacity/failure evidence, production credentials, and explicit route promotion are approved.

## Change record template

For any future `CHANGE`, `REJECT`, or reopened decision append:

- Date:
- Owner position:
- Counterproposal:
- Evidence:
- Accepted wording:
- Consequences:
- Revisit trigger/date:
