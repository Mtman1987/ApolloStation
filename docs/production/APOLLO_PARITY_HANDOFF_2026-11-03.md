# ApolloStation continuation handoff — 2026-11-03

**Repository:** `Mtman1987/ApolloStation`  
**Authority:** `main`  
**Purpose:** Resume Apollo-owned parity implementation without relying on stale handoff snapshots.

## Current revision and validation

- Latest code/test revision: `9ca93bf` — `test(dsh): include guild ID in signal drop fixture`.
- DSH forum adapter repair `36978cf` proxies `getChannelMessage`, `listActiveThreads`, and `listArchivedForumThreads`; it removed the earlier shared TypeScript build blocker.
- Latest full diagnostic run: [41699667192](https://github.com/Mtman1987/ApolloStation/actions/runs/41699667192) — **PASS / all four shards completed**. It executed 1,450 cases: 1,439 passed and 11 assertion failures were recorded. The aggregate PASS means all shards and the report completed; it does not mean every assertion passed.
- Targeted suites passed in that run: Chat Gateway provider drivers 10/10; DSH forum forwarding 12/12; DSH member activity 4/4; DSH signal drops 3/3; DSH shoutout presentation and partner schedule checks passed; DSH Voidwalker role-ordering and community-control checks passed.
- The 11 remaining diagnostics are outside the forum-create recovery change: HearMeOut playback/watch-route failures, two Chat Gateway OAuth tests reporting missing `jobs:work`, Nebula browser script syntax failures, and parity-inventory/audit path mismatches. See run artifact for exact stacks.

## Forum authority work already on main

The current Commlink / DSH / Chat Gateway port includes:

- Native Commlink forum post/reply authority and provider-origin receipt protection, including transactional receipt checks across SQLite connections.
- DSH import of native Discord forum topics/replies, source attribution, edit/delete synchronization, per-channel/shared-thread forwarding, rich payload forwarding, loop prevention, and exact source-message lookup.
- Tenant-scoped durable DSH worker leases with ownership-checked renewal/release and concurrent replay regression coverage.
- Deterministic forum-thread starter markers and active/archived-thread recovery to reconcile uncertain DSH creates.
- Chat Gateway-owned Discord forum thread creation/archive and durable Commlink forum egress jobs. DSH owns forwarding rules/mappings; Chat Gateway owns Discord destination egress.

These are code-port statements, not live-provider acceptance claims.

## Chat Gateway forum-create recovery

- `apps/chat-gateway/src/service.ts` derives a stable 24-hex marker from `tenantId + job.id` and appends it as a Discord spoiler token to the forum starter message.
- `apps/chat-gateway/src/provider-drivers.ts` checks the exact parent forum before creating. It scans active guild threads and bounded pages of archived public forum threads, reads each candidate starter message, and returns the original thread/message IDs when the marker is found.
- Recovery fails closed if active/archived listing or starter lookup is unavailable, the archive scan exceeds its bound, or the parent lacks a valid guild ID. It does not silently create after an incomplete scan.
- `tests/chat-provider-drivers.test.mjs` simulates a successful remote create followed by a lost durable receipt, archives the thread before retry, and verifies retry recovers the original IDs with no second POST. A distinct marker creates a distinct thread. All 10 provider-driver tests passed.
- The worker renews the durable job lease before and during a potentially slow create, then checks lease health before recording success. This reduces lease-expiry overlap; it does not provide a Discord server-side uniqueness guarantee if a worker loses its lease while a remote request is already in flight.
- Key commits: `71618bf` job marker; `c18d0f3` provider reconciliation; `0672e49` initial regression; `93d7291` in-flight lease heartbeat; `4e70e65` guild-ID validation; `ee931ee` archived-thread regression.
- Related DSH test and parity corrections: `3cbda13` plain-object thread state; `76a1a08` activity-worker client fixture; `973d961` community-worker service stubs; `90471ab` restored donor tier/banner behavior; `9ca93bf` signal-drop guild fixture.
- This closes the retry-after-uncertain-create path covered by tests. It does not prove live Discord acceptance; keep this capability `ported-unverified`.

## Immediate next steps

1. Resolve the two Chat Gateway OAuth test failures reporting missing `jobs:work`; verify whether test credentials or service identity scope wiring is wrong before changing runtime authorization.
2. Continue the remaining HearMeOut and Nebula diagnostic failures as separate parity tasks; do not mix unrelated changes into forum recovery.
3. Validate the integrated DSH + Chat Gateway lifecycle against an authorized Discord connection: retry/fencing, lease expiry, archived-thread recovery, edit/delete, and marker reconciliation.
4. Record exact CI and live-acceptance evidence in the parity tracker. Keep this capability `ported-unverified` until an authorized live Discord connection has been exercised after deployment.

## Boundaries — do not cross

- No live Discord connection, production tenant egress, or real-provider recovery has been verified by this code work. Do not call the bridge live or production-ready.
- Oracle Cloud is the intended future hosting direction, but signup/provisioning is not complete. Do not invent endpoints, secrets, deployments, or DNS records.
- Keep `spacemountain.live`, `spmt.live`, and app subdomains on the existing authority until rollout gates, private canary, backup/restore, ingress, and rollback evidence pass.
- Continue Apollo-owned implementation on `main`; donor repositories remain read-only. Do not run donors or copy donor secrets.

## Key files

- `apps/discord-stream-hub/src/forum-forwarding.ts`
- `apps/chat-gateway/src/service.ts`
- `apps/chat-gateway/src/provider-drivers.ts`
- `tests/dsh-forum-forwarding.test.mjs`
- `tests/chat-provider-drivers.test.mjs`
- `docs/donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md`

## Resume instruction

The Chat Gateway forum-create retry recovery and DSH integration tests are in place. Continue with the two missing-scope OAuth test failures, then proceed through the remaining parity gaps. Keep live-provider status `ported-unverified` until an authorized Discord rehearsal is complete.