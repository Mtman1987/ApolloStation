# ApolloStation Parity Continuation Handoff

**Prepared:** 2026-10-25
**Repository:** `Mtman1987/ApolloStation`
**Purpose:** Continue the cross-app parity and production-readiness work without losing context when this agent reaches its usage limit.

## Executive decision

Do **not** move production DNS, create an Oracle production cutover, or retire any donor-related behavior yet. ApolloStation has substantial ported code and tests, but the repository evidence does not prove full live-app parity.

The label `appCodeParity: complete` in `docs/donor-audits/app-code-parity.v1.json` means the approved code-porting/evidence program is represented in Apollo. It does **not** mean every donor capability is verified in production-equivalent conditions. The historical audits explicitly record missing and partial capabilities.

The current production rollout manifest correctly keeps traffic on Blue and marks all cutover gates pending.

## Current repository and PR state

The authoritative checkout used for this handoff was a clean `main` checkout at:

```text
dd33bef Run safe branch cleanup after every main update
```

Open focused PRs:

- PR #247: [HearMeOut radio song-family parity](https://github.com/Mtman1987/ApolloStation/pull/247)
  - Branch: `fix/hearmeout-radio-family-parity-20261025`
  - Commits include the radio parity implementation and a CI timeout increase from 30 to 45 minutes.
  - Focused build/offline check: passed.
  - Full `test` check: was running when this handoff was captured; do not merge until it finishes with `SUCCESS`.
  - This closes one narrow radio gap; it does not establish full HearMeOut parity.

- PR #248: [Nebula canonical identity cleanup](https://github.com/Mtman1987/ApolloStation/pull/248)
  - Branch: `fix/nebula-canonical-identity-20261025`
  - Changes one stale source comment from the obsolete Chat-Tag identity to Nebula Arcade.
  - Focused Nebula check: passed.
  - Full `test` check: was running when this handoff was captured; do not merge until it finishes with `SUCCESS`.
  - This removes a structural audit error; it does not add product functionality.

The current GitHub state can be refreshed with:

```bash
gh pr view 247 --repo Mtman1987/ApolloStation --json state,mergeable,statusCheckRollup,url
gh pr view 248 --repo Mtman1987/ApolloStation --json state,mergeable,statusCheckRollup,url
gh pr checks 247 --repo Mtman1987/ApolloStation
gh pr checks 248 --repo Mtman1987/ApolloStation
```

## Verified audit state

From `main` before PR #248 is merged:

```text
npm run release:audit
Apollo production rollout: VALID
Public preview: BLOCKED; production traffic moved: no
Next app canary: hearmeout
Blocked: publicIngress, isolatedPreviewStorage, abuseAndCostBounds

npm run cutover:audit
Live-slice cutover rehearsal: BLOCKED (dry-run)
Live sources: 7
Structural errors on main: 1 (stale Nebula identity; fixed by PR #248)
Blockers: runtime inventory, data reconciliation, external integration rehearsal,
backup/restart/rollback proof, owner acceptance, and the three public-preview gates
```

After PR #248 merges, rerun both audits. The expected structural-error count is zero, but the operational blockers remain.

## Source-of-truth files

Read these before changing code or declaring parity:

- `config/live-source-slices.v1.json` — pinned donor repositories and comparison commits.
- `config/production-rollout.v1.json` — rollout cohorts, authorities, and gate states.
- `docs/donor-audits/app-code-parity.v1.json` — high-level evidence index; do not treat its `complete` label as live acceptance.
- `docs/donor-audits/SPMT_DEEP_AUDIT_2026-08-23.md` — shared SPMT capability audit.
- `docs/donor-audits/STREAMWEAVER_LIVE_AUDIT_2026-09-06.md` — StreamWeaver absent/partial capability audit.
- `docs/donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md` — approved HMO/DSH parity work packages P01–P33.
- `docs/donor-audits/LIVE_SOURCE_CATCHUP_2026-09-03.md` — ownership and live-acceptance boundaries.
- `docs/production/SPMT_LIVE_INVENTORY.md` — permanent domain and production inventory context.
- `docs/production/APOLLO_CUTOVER_CONTINUATION_2026-09-12.md` — authority and DNS constraints.

## Capability status by area

### 1. SPMT / ecosystem core — high risk, not cutover-ready

`SPMT_DEEP_AUDIT_2026-08-23.md` says Apollo Green is a foundation, not a complete SPMT port. The audit compares about 190 unique donor route shapes with about 60 Apollo route shapes. Named gaps include:

- presence and live-community leases, reconnect, stale cleanup, and multi-app aggregation;
- complete overlay workspace/scenes/storage/render grants and migration;
- Cloud Xbox controller/session worker pool;
- Companion pairing, command relay, offline retry, and device proof;
- Forums/Discord create/edit/delete/reply/forward bridge;
- complete static shell, download, embed, redirect, and compatibility behavior.

**Next action:** audit shared identity, grants, storage, provider connections, and route families first. Do not build duplicate app-local authorities.

### 2. HearMeOut — one narrow fix landed, broad parity remains open

PR #247 covers radio song-family cooldown behavior. The feature review still identifies work in:

- room lifecycle and membership;
- capture/share-screen and RTC/provider path;
- real provider search and YouTube resolution;
- favorites and recent media;
- auto-radio lifecycle and durable state;
- Watch catalog, ambiguity selection, and episode progression;
- media preparation, HLS/probe/audio-track/download/upload, and bounded cache;
- Discord Activity and Discord/Twitch controls;
- personas, wake settings, and local Companion input;
- Commlink room context and Overlay Bay widgets.

**Next action:** after PR #247 passes, make a P01–P14 checklist and implement in this order: room/media foundation, provider search/resolution, media workers, Discord controls, persona/wake paths, then widgets.

### 3. StreamWeaver — explicitly not a functionality-preserving swap

The audit records **18 absent capability groups and 21 partial/unwired groups**. Major examples:

- server speech transcription and TTS consumer lifecycle;
- public persona speech and private assistant history/settings/memory;
- private image gallery and Discord carousel;
- generation studio, LoRA controls, prompt enhancement, and provider fallback;
- Social Stream ingestion and shared-chat operator desk;
- Twitch redeems, non-chat event automations, welcome/walk-on shoutouts;
- translation and watch-time command execution;
- Pokémon collection, packs, trades, gyms, seasons, and overlays;
- special bot-account administration;
- complete state export/import and restore of histories, balances, packs, trades, media, and provider settings.

**Next action:** classify every SW item as `implement`, `intentionally retire`, or `not actually live`. Do not infer parity from type definitions or generic helpers.

### 4. Discord Stream Hub — many approved integration packages remain

The feature review lists P15–P32 for settings, application decisions, temporary guests, generated media delivery, Signal, reward-role delivery, Raid Pile, Raid Train, partner schedules, points/leaderboards, moderation cleanup, Commlink forwarding, linking panels, member projections, participation aggregates, and shared connection eligibility.

**Next action:** implement the shared settings/decision primitives first, then media/reward/raid workflows, then Commlink/account-linking/member projections. Every workflow needs replay/idempotency tests.

### 5. Nebula Arcade — code and focused tests exist; identity cleanup pending merge

The live-source manifest marks the pinned donor comparison as ported and lists focused evidence. PR #248 corrects the stale repository identity marker that caused the structural audit failure.

**Next action:** merge only after full CI succeeds, then rerun `npm run cutover:audit`. Follow the P29 rule: map legacy aliases to Nebula’s existing runtime; do not copy state back into DSH.

### 6. Mountainview and Companion — meaningful code, live device proof absent

The high-level parity evidence lists focused tests, but cutover still requires real device/runtime inventory, pairing/revoke, offline retry, restart, and restore proof.

**Next action:** create a device test plan using non-production tenant data. Record capability negotiation, pairing, command replay/expiry, wake behavior, and recovery evidence.

### 7. SpaceMountain and shared shell — preserve authority, verify ingress and sessions

The code has shell/UI evidence and the live-source manifest marks the pinned comparison caught up. Production rollout still lacks public ingress/certificate proof, isolated preview storage/restore proof, and abuse/cost bounds.

**Next action:** leave permanent domains on the current authority. Later create a private canary hostname, validate session recovery and route compatibility, then perform a controlled DNS change only with rollback ready.

## Required tracker statuses

Every capability must use exactly one of these labels:

- `verified` — code, focused test, and required live/provider acceptance evidence exist;
- `ported-unverified` — Apollo code/test evidence exists, but live integration or owner acceptance is missing;
- `partial` — foundation exists but a required producer, adapter, UI, persistence path, or runtime wiring is missing;
- `missing` — no equivalent implementation was found;
- `retired` — owner explicitly chose not to preserve it, with rationale and migration impact recorded;
- `unknown` — donor usage or current production behavior was not re-confirmed.

Never turn `ported-unverified`, `partial`, or `unknown` into `verified` because a TypeScript build passes.

## Execution order

### Phase 0 — close current review items

1. Wait for PR #247 and #248 full `test` checks.
2. Merge only if required checks are `SUCCESS` and the diff remains narrow.
3. Rerun `npm run release:audit` and `npm run cutover:audit` on updated `main`.
4. Confirm PR #248 reduces structural errors to zero.

### Phase 1 — build the parity ledger

1. Copy every H/P/D/SW/SPMT audit row into the tracker.
2. Add owner, Apollo path, donor path/commit, test, live acceptance evidence, and decision.
3. Mark all rows without live evidence `ported-unverified`, `partial`, or `unknown`; never `verified`.
4. Review the first 10 rows with the owner before implementing more.

### Phase 2 — shared foundation

1. Reconcile SPMT identity, grants, tenant isolation, storage, provider references, and route compatibility.
2. Define migration receipts and backup/restore format.
3. Add two-tenant and restart tests before moving app-specific data.

### Phase 3 — highest-risk product paths

1. HearMeOut P01, then P05/P08/P09/P10, then room/persona/wake and widgets.
2. DSH P15/P16 so settings, decisions, notifications, and retries are truthful.
3. StreamWeaver runtime/provider paths, with explicit retirements for unsupported donor behavior.
4. Nebula, Mountainview, Companion, and shell live acceptance.

### Phase 4 — cutover proof

For every cohort, record:

- runtime inventory and exact build;
- production data counts and meaningful sample reconciliation;
- provider and external integration rehearsal;
- backup, restore, restart, and rollback evidence;
- owner acceptance;
- public ingress, isolated storage, quotas, rate limits, and cost alerts.

Only after all gates pass should Oracle be used for a private canary. Do not point `spmt.live`, `spacemountain.live`, or app subdomains at Oracle before then.

## Safe continuation commands

```bash
cd /home/ubuntu/ApolloStation
git fetch origin --prune
git status --short --branch
npm run release:audit
npm run cutover:audit

gh pr checks 247 --repo Mtman1987/ApolloStation
gh pr checks 248 --repo Mtman1987/ApolloStation

git grep -nE 'P0[1-9]|P[12][0-9]|P3[0-3]|SW-[0-9]+|missing|partial|unverified' -- docs config tests
```

If the existing checkout is partial or has no `.git`, restore it safely:

```bash
rm -rf /home/ubuntu/ApolloStation
gh repo clone Mtman1987/ApolloStation /home/ubuntu/ApolloStation
cd /home/ubuntu/ApolloStation
git fetch --all --prune
```

Do not run DNS changes, production migrations, secret rotations, destructive branch cleanup, or paid cloud provisioning from this handoff without an explicit owner decision and a rollback plan.

## What not to do

- Do not claim full parity from `appCodeParity: complete`.
- Do not treat a passing offline test as provider, browser, Discord, microphone, OBS, media, or live-data acceptance.
- Do not delete donor code because it is currently unwired.
- Do not copy secrets out of Fly.io or print secret values.
- Do not point permanent domains at Oracle while any cohort gate is pending.
- Do not create duplicate SPMT identity, wallet, grant, message-history, media, or reward authorities.
