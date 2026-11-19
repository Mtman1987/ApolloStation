# ApolloStation AI continuation handoff — 2026-11-03

> **Superseded status snapshot — read the latest continuation first.**
> The current repo handoff is [APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md).
> It was refreshed after PR #399 added the Commander MT listener and records
> its successful build/test evidence. PR #399's merge commit is
> `9330f522f1c1eaabf7241db55efa80dac0bf1a92`. Fetch main before work.
> The historical baseline and pending statuses below are not current authority.

**Repository:** `Mtman1987/ApolloStation`  
**Authority:** `main`  
**Last observed baseline HEAD:** `15c806750c2b70aa1dec10d5aa3dae2343035298`

## Instructions for the next AI

1. Fetch latest `main` before doing anything; this document is a status snapshot.
2. Read this handoff and inspect the current source/workflows named below.
3. Continue implementation on Apollo-owned `main`. User prefers concrete code, tests, commits and concise progress over extended planning.
4. Never call queued/in-progress Actions runs green. Recheck status and artifacts before reporting.
5. Unit/CI success is not live-provider acceptance or production readiness.
6. Treat donor repos as read-only evidence. Do not run donor applications, install their dependencies, or use secrets from them. REA/path/hash results are candidates, not proof of parity and not permission for automatic copying or merging.

## Current CI snapshot

- Baseline release validation: [41705653182](https://github.com/Mtman1987/ApolloStation/actions/runs/41705653182) — completed/success at `15c80675`, but its downloaded report records **1,454 passed / 2 failed / 1,456 tests**, zero cancelled/skipped, all four shards complete. Actions success and the report's `Overall result: PASS` mean diagnostic execution completed, **not zero assertion failures**. Always read the findings/table.
- Both failures are in `tests/apollo-parity-automation.test.mjs`: manual and nightly workflow tests assert the obsolete generic `rea-analysis.json` filename twice instead of validating the separate donor and Apollo files. This continuation repairs the assertions to require `jq` object validation for each actual output; no production workflow check is removed or weakened. Post-merge Oracle verification remains pending for this repair.
- Previous baseline run [41705281570](https://github.com/Mtman1987/ApolloStation/actions/runs/41705281570) is now completed/success. Its status alone is not a zero-failure claim.
- HearMeOut browser acceptance: [41705262124](https://github.com/Mtman1987/ApolloStation/actions/runs/41705262124) — completed/success at `13cf2d22a5e0b039f35f724ec721cf6d6055bdd5`. Retrieved job logs confirm both browser checks passed. The later `dbf2cb8` commit adds a workflow guard test, not a browser runtime change; this run is still evidence for its exact tested SHA only.
- Nightly donor evidence: [41704852808](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808) — still in progress at inspection. Discord Stream Hub and StreamWeaver jobs completed/success; HearMeOut reached artifact upload, which remains in progress. Do not call the entire matrix complete.
- Last historical zero-failure evidence: [41703486111](https://github.com/Mtman1987/ApolloStation/actions/runs/41703486111), 1,450 tests. It predates these changes.

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

Recent refinements also preserve explicit donor/Apollo commit and app-path provenance so generated port tasks map to the correct Apollo application. Workflow trigger coverage was added for parity tooling changes.

### Evidence inspected during this continuation

Downloaded and parsed the two available nightly ZIPs from run 41704852808. Each contains all seven expected files: donor/Apollo inventories, comparison, donor/Apollo REA JSON and both port-brief files. Their inventory, comparison and brief provenance agree on Apollo commit `e3039342e10d2e0a5d2dc5d26ddea55732fc8664` and the mapped app path; the Apollo REA subject/input points at that app's `dist` directory. REA does not independently attest the Git commit.

| Donor | Exact donor commit | Apollo app | Artifact |
| --- | --- | --- | --- |
| StreamWeaver | `ad2e43fd27f03b4c11fdaa1585ee1ad7ff4fcf80` | `apps/streamweaver` | [13264644125](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808/artifacts/13264644125) |
| Discord Stream Hub | `535fb6c52ce3b4e0b95a52567a32a67328796eff` | `apps/discord-stream-hub` | [13264149182](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808/artifacts/13264149182) |

HearMeOut's bundle is not yet available, so three-row completeness remains open. StreamWeaver's generated P0 list is a triage prompt, not proof of absent functions: the September checkpoint already documents implementations for the original groups, with migration/restore and live acceptance outstanding. Inspect executing donor/Apollo paths before selecting a port; do not re-port empty graphs or duplicate existing functionality.

Dispatched the manual donor workflow for all three confirmed donor/app pairs at baseline `15c80675`: runs [41706393191](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393191), [41706393224](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393224), and [41706393624](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393624) are in progress. Inspect their inputs/job logs and complete artifacts before assigning acceptance. No donor application or dependencies were run locally.

## HearMeOut browser/media work

- Room player: `apps/hearmeout/src/room-media-browser.ts` and related player/client code.
- Local test entry point: `npm run test:hmo-media-browser`.
- Browser workflow: `.github/workflows/hearmeout-room-player-browser.yml` (verify exact workflow from current tree).
- Browser acceptance run 41705262124 passed both steps: actual two-browser audio with pause/seek/next, local volume, stale drawer preservation, duplicate-end protection and membership revocation; synthetic FFmpeg HLS playback across native/Activity windows, two audio languages and returning-viewer broadcast position. This workflow uploaded no standalone browser artifacts; inspected evidence is its job log.
- Authorized provider-to-browser HLS playback still needs real provider account acceptance. Keep it **ported-unverified** until tested.

## Next work — priority order

1. Inspect the post-merge Oracle report for this assertion repair: require zero findings before describing the tests as passing; a green diagnostic run alone is insufficient.
2. Finish artifact inspection for the pending HearMeOut nightly row and the three dispatched manual sweeps. Verify all seven files and mapped app/commit provenance for each.
3. Record those run/artifact results here. Browser fixture acceptance is established at its tested SHA; real configured provider acceptance remains open.
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
