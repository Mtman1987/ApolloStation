# ApolloStation AI continuation handoff — 2026-11-03

**Repository:** `Mtman1987/ApolloStation`  
**Authority:** `main`  
**Last observed HEAD:** `dbf2cb8e458e3c88db7a5749fb28153dde745917`

## Instructions for the next AI

1. Fetch latest `main` before doing anything; this document is a status snapshot.
2. Read this handoff and inspect the current source/workflows named below.
3. Continue implementation on Apollo-owned `main`. User prefers concrete code, tests, commits and concise progress over extended planning.
4. Never call queued/in-progress Actions runs green. Recheck status and artifacts before reporting.
5. Unit/CI success is not live-provider acceptance or production readiness.
6. Treat donor repos as read-only evidence. Do not run donor applications, install their dependencies, or use secrets from them. REA/path/hash results are candidates, not proof of parity and not permission for automatic copying or merging.

## Current CI snapshot

- Last completed full release validation: [41703486111](https://github.com/Mtman1987/ApolloStation/actions/runs/41703486111) — PASS, four shards, 1,450 tests, zero failures (333 + 361 + 377 + 379). **This run predates the latest parity and browser workflow changes.**
- Current HEAD release validation: [41705281570](https://github.com/Mtman1987/ApolloStation/actions/runs/41705281570) — queued at last check. Recheck it.
- HearMeOut browser acceptance: [41705262124](https://github.com/Mtman1987/ApolloStation/actions/runs/41705262124) — in progress at last check, on parent commit `13cf2d22a5e0b039f35f724ec721cf6d6055bdd5`; latest HEAD adds a test guard after it. Check whether rerun is needed.
- Nightly donor evidence: [41704852808](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808) — pending at last check. Inspect it and its artifacts.
- Older full validation [41704852768](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852768) was still in progress on older commit `e3039342`; it is not the completed 1,450-test run.
- Latest observed HEAD commit message: `test(hearmeout): guard real-browser acceptance workflow`.

## Completed forum authority port

Commlink / Discord Stream Hub / Chat Gateway implementation includes native forum post/reply authority, provider-origin receipts, transactional idempotency, Discord forum import, source attribution, edit/delete sync, per-channel/shared-thread forwarding, rich payloads, loop prevention, tenant-scoped worker leases, and durable egress jobs.

Chat Gateway uncertain-create recovery:
- `apps/chat-gateway/src/service.ts` derives a stable 24-hex marker from tenant ID + durable job ID and appends it as a Discord spoiler token to the starter message.
- `apps/chat-gateway/src/provider-drivers.ts` checks the exact parent forum, scans active threads and bounded archived public threads, inspects starter messages, and returns the original thread/message IDs when the marker is found.
- Recovery fails closed when required listing/message reads are unavailable, archive scan bounds are exceeded, or parent guild ID is invalid. It must not create after an incomplete scan.
- Tests simulate remote create succeeding while the durable receipt is lost, then archived-thread recovery without a second POST. Lease renewal/health checks reduce overlap but do not create a Discord-side uniqueness guarantee if a stale request remains in flight.
- Main source/tests: `apps/discord-stream-hub/src/forum-forwarding.ts`, `apps/chat-gateway/src/service.ts`, `apps/chat-gateway/src/provider-drivers.ts`, `tests/chat-provider-drivers.test.mjs`.
- Status: **ported-unverified** until an authorized live Discord rehearsal passes.

## REA and donor parity automation

Scripts:
- `scripts/parity-rea.mjs`: static REA analysis; target is treated as data, not launched. Output now streams to stdout (`stdio: inherit`) to avoid the previous in-memory 50 MiB buffer limit. Workflow redirects stdout to JSON files and validates them with `jq`.
- `scripts/parity-donor-inventory.mjs`: safe file/hash inventory with exclusions for secrets, dependencies, binaries, symlinks and oversized files.
- `scripts/parity-compare-inventories.mjs`: normalized path/hash comparison; heuristic only.
- `scripts/parity-prepare-port.mjs`: creates review-only candidate port tasks and acceptance checklists; never auto-approves or auto-merges.
- Config: `config/apollo-donor-sources.v1.json`, `config/apollo-parity-capabilities.v1.json`.

Workflows:
- `.github/workflows/apollo-donor-inventory.yml`: manual allowlisted donor/app inventory + REA. Artifact list now includes donor/Apollo inventories, comparison, both REA reports, and both port-brief files.
- `.github/workflows/apollo-parity-nightly.yml`: nightly evidence for HearMeOut, StreamWeaver and Discord Stream Hub; now prepares/uploads the review-only port brief.
- `.github/workflows/rea-static-analysis.yml`: targeted Apollo REA with streamed JSON validation.
- Tests: `tests/apollo-parity-automation.test.mjs`, `tests/parity-rea-cli.test.mjs`.

Recent refinements also preserve explicit donor/Apollo commit and app-path provenance so generated port tasks map to the correct Apollo application. Workflow trigger coverage was added for parity tooling changes. **The latest nightly run was pending at last check; end-to-end artifact completeness is not yet confirmed.**

## HearMeOut browser/media work

- Room player: `apps/hearmeout/src/room-media-browser.ts` and related player/client code.
- Local test entry point: `npm run test:hmo-media-browser`.
- Browser workflow: `.github/workflows/hearmeout-room-player-browser.yml` (verify exact workflow from current tree).
- Browser acceptance run 41705262124 was in progress at last check. Inspect logs and artifacts, then rerun on current HEAD if necessary.
- Authorized provider-to-browser HLS playback still needs real provider account acceptance. Keep it **ported-unverified** until tested.

## Next work — priority order

1. Reconcile the current HEAD release validation, browser acceptance and nightly evidence runs listed above.
2. Inspect actual artifacts: verify every donor matrix row has both inventories, comparison, REA JSON outputs and port brief; verify the correct Apollo app path/commit is represented.
3. Dispatch the manual donor workflow for each allowlisted donor and relevant Apollo app. Start with high-priority HearMeOut and StreamWeaver gaps. Record run and artifact links here.
4. Review the generated briefs, select the highest-value real capability gap, inspect donor code as reference only, implement Apollo-owned behavior, add regression tests and validate.
5. Finish HearMeOut browser acceptance, then authorized provider-to-browser HLS rehearsal.
6. Rehearse Discord forum egress against an authorized connection: retry/fencing, lease expiry, archived-thread recovery, edit/delete, source attribution and marker reconciliation.

## Hosting and production boundaries

- Oracle Cloud is the intended future hosting direction; user signup/provisioning is not complete. Do not invent endpoints, deployments, credentials or DNS.
- `spacemountain.live`, `spmt.live` and app subdomains remain on existing authority until rollout gates, private canary, backup/restore, ingress and rollback evidence pass.
- No live Discord egress or production tenant acceptance is established by the test runs above.
- Do not describe Apollo as production-ready or authorize return-to-live from CI evidence alone.

## Resume instruction

Start by fetching latest `main`, then inspect current Actions runs and artifacts. Finish the REA evidence sweep and use reviewed port briefs to implement the next highest-priority Apollo-owned capability. Keep live-provider and deployment status unverified until actual authorized rehearsals pass.
