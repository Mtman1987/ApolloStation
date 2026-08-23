# Current State

Status: evidence-backed working baseline, requiring live verification before migration.

## What is working conceptually

- SPMT is already described as the canonical identity and platform contract owner.
- SpaceMountain is already described as the user-facing command bridge and suite shell.
- Workspace/background configuration is already capable of flowing through SPMT and appearing across apps. This is the strongest existing proof for a single-authority data model.
- Current documentation defines an SPMT OAuth authorization-code flow, canonical immutable user IDs, app-bound service authorization, events, workspace profiles, and an idempotent XP endpoint.

## What is broken or contradictory

### Shared facts have multiple answers

The same person can see materially different point balances in SpaceMountain, ChatTag, and Discord Stream Hub. Existing production notes also record a DSH account whose 1,971 events totaled 31,977 while a cached leaderboard held 13,601. This is not a display bug; it is evidence of competing authorities, incomplete migration, stale projections, or incorrect identity linking.

No new balance should be selected by summing or taking the maximum. The event sources, identity mapping, timestamps, award rules, migrations, and idempotency keys must be reconciled first.

### Authentication is half centralized

The intended model is one SPMT identity, but `auth-migrations.json` still lists active legacy platform keys, reused provider tokens, internal shared-key headers, compatibility sessions, and a blocked tenant-authorization redesign. A single human login does not mean one universal secret. The system still needs a small set of narrowly scoped machine identities and real third-party provider credentials.

### Storage is fragmented

The production inventory describes SPMT SQLite, SpaceMountain SQLite, DSH SQLite and media, StreamWeaver JSON/media, ChatTag state, HearMeOut state, and multiple Fly Volumes. That makes cross-app facts expensive to reconcile and makes scaling stateful processes difficult.

### Documentation contains incompatible eras

- 290 core document-like files were found across the two repositories under the review filter; 294 files were preserved when supporting documentation JSON was included.
- SpaceMountain has 66 mirrored documentation paths and 13 mirrored specification paths between source and public trees.
- At least 17 files are named as plans, roadmaps, TODOs, or checklists.
- Three active ecosystem documents still mention Firebase or Firestore. One says never to reintroduce Firebase; another still treats it as a possible authority or migration source.
- The production roadmap mixes verified observations, completed work, open work, historical incidents, product plans, and release evidence in one very large document.

## Constraints already settled

These are facts or owner requirements, not debate prompts:

- Firebase was removed roughly a year ago and must not appear in the new runtime, migration plan, compatibility plan, or canonical documentation.
- Fly.io GPU capacity is unavailable to this ecosystem; the Fly design is CPU-only.
- Old repositories and Fly apps stay live during the rebuild.
- Old repositories, apps, volumes, and duplicate files are removed only after verified cutover and rollback retention.
- SpaceMountain and SPMT are rebuilt first; inference/workers/bots follow; product apps follow the stable base.
- The parallel period has a cost clock even though the account has machine-count headroom.
- The new shared storage authority requires an independent recovery app with its own Machine and volume, scheduled verified backups, controlled promotion, and tested failback.

## Facts still requiring live capture

Before implementation, record these without exposing secret values or tenant content:

- all 13 current Fly apps, Machines, process groups, sizes, regions, checks, autostop settings, and monthly cost by resource;
- all volumes, attachments, sizes, snapshots, and actual data owners;
- live database engines, schemas, row counts, migration versions, and backup/restore evidence;
- current public routes, health behavior, cold-start time, p50/p95 latency, and error rate;
- all auth mechanisms by caller, callee, scope, and last observed use;
- all point producers, ledgers, cached projections, and displayed totals;
- all provider API calls and measured monthly cost;
- all workloads requiring persistent connections, high CPU, isolation, or local companion capability.

Until that capture exists, statements copied from old production documents are hypotheses, not live truth.

## Green production-app parity checkpoint

ApolloStation branch `feat/production-app-parity` now contains the first donor-backed product implementation slice. The original Chat Tag core was audited against `Mtman1987/chat-tag` commit `8170c51` and implemented inside the bounded Nebula Arcade module.

The implemented slice covers persistent tenant game state, join/leave, the current-it/free-for-all transition, local game scoring, immunity, sleep/wake, earned passes, moderator controls, command replay protection, restart snapshots, tenant-scoped SPMT events and XP awards, and Discord Stream Hub event consumption. It does not copy donor authentication, shared-secret, direct-call, Firebase, or shared-volume architecture.

The repository currently includes the two-player, two-tenant, restart, replay, immunity, pass, moderator, SPMT contract, and DSH projection cases plus the first audited SPMT identity-parity slice: active provider links can be listed and unlinked through the same human-only API/SDK/CLI/MCP contract, revocations remain durable across restart, and service identities cannot manage a person's linked accounts. SpaceMountain Settings now consumes that same public contract without browser-owned tokens or a private proxy authority. Chat Tag provider ingress, timers, overlay rendering, crowns, live state migration, the remaining SpaceMountain pages, and the remaining SPMT capability families remain explicit child slices; Blue production remains authoritative.

The complete production donor baseline was refreshed on 2026-08-23 in `docs/donor-audits/PRODUCTION_REPO_BASELINES_2026-08-23.md`. Six flagship product manifests are present, but manifests are scaffolding rather than ported apps. Only the original Chat Tag core slice currently has donor-backed implementation parity; the rest of every product and worker remains active rebuild work.

The SpaceMountain deep audit is captured in `docs/donor-audits/SPACEMOUNTAIN_DEEP_AUDIT_2026-08-23.md`. It identifies the retained front-door journeys, 29-route primary server surface, legacy routes, local duplicate users/points/preferences, private DSH/HearMeOut/Chat Tag calls, source-patch debt, and the proof required before the donor can retire.
