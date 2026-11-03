# ApolloStation continuation handoff — 2026-11-03

**Repository:** `Mtman1987/ApolloStation`  
**Authority:** `main`  
**Purpose:** Resume Apollo-owned parity work with current implementation and validation evidence.

## Current revision and release validation

- Current main code/test head: `75dda1123e9cf5725a80c3eb79bfe51bd95c6485`.
- Latest full validation: [41703486111](https://github.com/Mtman1987/ApolloStation/actions/runs/41703486111) — **PASS**. Four shards executed 1,450 tests: shard 1 333/333, shard 2 361/361, shard 3 377/377, shard 4 379/379. Aggregate report: `diagnostic execution: PASS; test failures: 0`; aggregate go/no-go succeeded.
- The run validates the latest fixes for Chat Gateway OAuth worker-scope fixtures, HearMeOut's authenticated internal catalog route, the parity audit's path-valued fields, donor repository identifier validation, Nebula control-script syntax, HearMeOut retry queue semantics, HLS fixture regex/segment generation, and active public-room HLS authorization.
- The full suite is green, but this is not a live-provider acceptance test and does not authorize a production cutover.

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
- `tests/chat-provider-drivers.test.mjs` simulates a successful remote create followed by a lost durable receipt, archives the thread before retry, and verifies retry recovers the original IDs with no second POST. A distinct marker creates a distinct thread. The provider-driver suite passed 10/10 in the preceding diagnostic run and the full suite is now green.
- The worker renews the durable job lease before and during a potentially slow create, then checks lease health before recording success. This reduces lease-expiry overlap; it does not provide a Discord server-side uniqueness guarantee if a worker loses its lease while a remote request is already in flight.
- Key commits: `71618bf` job marker; `c18d0f3` provider reconciliation; `0672e49` initial regression; `93d7291` in-flight lease heartbeat; `4e70e65` guild-ID validation; `ee931ee` archived-thread regression.
- This closes the retry-after-uncertain-create path covered by tests. It does not prove live Discord acceptance; keep this capability `ported-unverified`.

## REA and donor-parity automation — existing foundation

The repository already contains a useful, guarded evidence pipeline:

- `scripts/parity-rea.mjs` runs REA static application analysis against a supplied file/directory and explicitly does not launch the target application.
- `scripts/parity-donor-inventory.mjs` inventories source files/hashes while excluding secrets, dependencies, binaries, symlinks and oversized files; donor code is not executed.
- `scripts/parity-compare-inventories.mjs` compares normalized paths and hashes, while warning that path overlap is only a heuristic.
- `scripts/parity-prepare-port.mjs` converts capability gaps and donor-only path candidates into review-only port tasks with source links and acceptance checklists.
- `.github/workflows/apollo-donor-inventory.yml` is a manually dispatched, allowlisted donor-to-Apollo inventory + REA workflow.
- `.github/workflows/apollo-parity-nightly.yml` runs nightly evidence collection for HearMeOut, StreamWeaver and Discord Stream Hub.
- `.github/workflows/rea-static-analysis.yml` provides targeted Apollo-app REA analysis.

This is evidence generation and prioritization, not automatic code porting. Donor-only paths are candidates, not proof of missing behavior; generated tasks remain review-required and must never auto-merge. The next automation pass should fix the manual workflow's artifact path list and make the nightly bundle include the generated port brief, then run the pipeline for each allowlisted donor and use its REA findings to prioritize concrete ports.

## Next implementation passes

1. Finish the REA workflow integration: repair the manual evidence-bundle artifact paths, add `parity-prepare-port` to the nightly matrix, and verify each workflow uploads inventories, REA reports, comparisons and port briefs.
2. Use the evidence pipeline to prioritize actual donor-to-Apollo code ports; start with the highest-priority open HearMeOut and StreamWeaver gaps, not path-count differences.
3. Verify the existing HearMeOut room media player in two real browser contexts using `npm run test:hmo-media-browser` (source exists; full browser acceptance is separate from the 1,450-test run). Then verify provider-to-browser HLS with an authorized provider account. Keep provider acceptance `ported-unverified` until that rehearsal is completed.
4. Rehearse the integrated DSH + Chat Gateway lifecycle against an authorized Discord connection: retry/fencing, lease expiry, archived-thread recovery, edit/delete and marker reconciliation.

## Boundaries — do not cross

- No live Discord connection, production tenant egress, or real-provider recovery has been verified by this code work. Do not call the bridge live or production-ready.
- Oracle Cloud is the intended future hosting direction, but signup/provisioning is not complete. Do not invent endpoints, secrets, deployments, or DNS records.
- Keep `spacemountain.live`, `spmt.live`, and app subdomains on the existing authority until rollout gates, private canary, backup/restore, ingress, and rollback evidence pass.
- Continue Apollo-owned implementation on `main`; donor repositories remain read-only. Do not run donor applications or copy donor secrets.

## Key files

- `apps/discord-stream-hub/src/forum-forwarding.ts`
- `apps/chat-gateway/src/service.ts`
- `apps/chat-gateway/src/provider-drivers.ts`
- `apps/hearmeout/src/room-media-browser.ts`
- `scripts/parity-rea.mjs`
- `scripts/parity-donor-inventory.mjs`
- `scripts/parity-compare-inventories.mjs`
- `scripts/parity-prepare-port.mjs`
- `.github/workflows/apollo-donor-inventory.yml`
- `.github/workflows/apollo-parity-nightly.yml`

## Resume instruction

The Chat Gateway forum-create retry recovery is implemented and the full 1,450-test release validation is green. Continue by repairing and verifying the REA evidence bundle, then use its reviewed findings to port the next highest-priority donor capabilities into Apollo. Keep live-provider status `ported-unverified` until authorized rehearsals pass.