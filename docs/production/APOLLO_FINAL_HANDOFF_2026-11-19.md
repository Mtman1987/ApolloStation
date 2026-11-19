# ApolloStation final cleanup and handoff

**Audit date:** 2026-11-19  
**Repository:** `Mtman1987/ApolloStation`  
**Purpose:** one coordinated pre-handoff cleanup and current readiness record. This is not a production certification.

The owner's estimate is that functional completion is above 90%. The remaining work is concentrated in deployment proof, durable runtime persistence, live browser acceptance, branch archival, a small number of donor-origin fallbacks, and post-acceptance optimization.

Do not interpret a green build or a populated recovery staging table as proof of production behavior. Do not replay the already verified recovery import.

## 1. Ordered cleanup sequence

### 1. Recovery workflow defaults — complete on main

- [x] Removed the push trigger that could automatically apply recovery data.
- [x] Kept `workflow_dispatch` as the only trigger.
- [x] Set `apply` default to `false`.
- [x] Supports `recovered-json-manifest*.jsonl` and `recovered-json-manifest*.jsonl.gz`.
- [x] Fails closed unless exactly one supported manifest is selected.
- [x] Dry-run validation precedes the explicit manual write step.
- [x] Did not re-run the import. The existing 5,748-row import remains the accepted evidence: 16 Nebula + 5,732 StreamWeaver.

**Main commit:** `d18385a55d62d8761ed433594cf7bd7417d9f76a`.

### 2. PR #527 repository hygiene — merged green

- [x] Repaired `apps/companion/src/diagnostics.ts` after CI exposed literal escaped newline characters in the TypeScript source.
- [x] Restored `docs/donor-audits/app-code-parity.v1.json` at its active path; the audit and tests still consume it.
- [x] Updated the parity capability registry to resolve historical donor reports from `mt-delete-me-archive/legacy-docs/`.
- [x] Retired the Node 3 app-creation workflow, bootstrap script, and package command.
- [x] Restricted Hostless account diagnostics to Node 1 and Node 2.
- [x] Rebuilt the root README and app/development-tool documentation; preserved old material in the quarantine archive.
- [x] Changed the reference app's default execution target from legacy Sprite to hosted.
- [x] All five required checks passed on the rebased head: main validation, Hostless release validation, Discord parity, Nebula parity, and Restream validation.
- [x] Merged as `ec06baa46bca01539c6820a64b59dbdfc00b80bf`.

### 3. Diagnostic sanitizer — complete

- [x] PR #525 is merged on main.
- [x] Safe query parameters are preserved while secret query values are redacted.
- [x] PGP/PEM private-key blocks are redacted.
- [x] Diagnostic artifact uploads fail closed when sanitization fails.
- [x] Main tests cover safe query preservation, private-key redaction, and unsupported artifact handling.
- [x] Closed #518 because it duplicated older/weaker sanitizer work.

### 4. Owner diagnostic terminal — implemented in draft PR #528

- [x] Terminal uses the existing same-origin signed Apollo session; no separate login or invented secret.
- [x] Removed `x-spmt-tenant` from the terminal request.
- [x] Added `/v1/operations/logs/owner`, deriving tenant scope from the signed session's owner roles and `operations:logs:read`.
- [x] Only the canonical SPMT owner identity receives the existing diagnostics scopes during the normal bridge/callback session issuance.
- [x] The endpoint returns allow-listed metadata only: ID, tenant, source app, level, kind, and timestamps. It omits summaries, details, labels, reporter IDs, and app payload data.
- [x] Member and service identities are denied by tests.
- [x] All three checks passed on the latest-main rebased head `88780e9944d48a7ce39d684f57865bb58e118de6`: Apollo validation, Hostless PR validation, and StreamWeaver parity.
- [ ] Keep draft until the owner verifies the browser path on Node 1. If the existing browser session predates the new scopes, refresh the existing sign-in once; there is no terminal-specific login.

**Architecture note:** other application API routes still use `x-spmt-tenant` as a workspace selector. It is not an authentication secret. The terminal no longer uses it and its server-side scope comes from the signed session.

### 5. Donor parity sweep — carried into this handoff

- [x] Reviewed #520's foundation donor findings for Rotator, SPMT.live, and SpaceMountain.live.
- [x] Recreated the donor sweep against current main in this handoff branch.
- [x] Included the merged sign-in bridge-gate work from #526 and the owner-terminal work from #528.
- [x] Closed #520; its useful findings are preserved in this handoff.

### 6. Branch archive and cleanup — safe defaults; archival/deletion still pending

- [x] Refreshed the branch inventory on main: 53 branches, including main.
- [x] Preserved the eight recovery candidates for individual review:
  - `feat/nebula-game-runtime-turso-store`
  - `feature/turso-live-runtime-smoke`
  - `feat/stellar-kokoro-self-hosted-tts`
  - `feat/hmo-xtream-watch-catalog`
  - `feat/dsh-mtfixit-intake-turso-followup`
  - `port/streamweaver-restream-golive-parity`
  - `feat/recovered-json-manifest-verification`
  - `feat/oracle-core-runtime-image`
- [x] Made `.github/workflows/cleanup-merged-branches.yml` manual-only with dry-run enabled by default.
- [x] Made `.github/workflows/consolidate-reviewed-branches.yml` manual-only with dry-run enabled by default.
- [x] The earlier cleanup run reported `Deleted: 0`.
- [ ] Create and verify a full-history Git bundle or equivalent archive before deleting any branch.
- [ ] Delete only individually reviewed obsolete branches after the archive is verified.
- [ ] Keep main and intentional open-PR branches.

**No branches have been deleted. No full-history bundle has been created or verified.** The branch inventory text is not a source-code archive. The connected GitHub actions in this session expose branch search/create/update but not branch deletion, tag creation, or workflow dispatch. The Rotator CLI/MCP actions described in its documentation are not connected here. Do not claim archive/delete completion until a real bundle or equivalent is verified.

### 7. Final acceptance — partially complete

- [x] Main Oracle release validation passed on commit `18c6dd387bdfc7b939454db9301f58204203d790`.
- [x] Hostless runtime diagnostic snapshots were collected; both node log-snapshot jobs succeeded.
- [x] The Hostless release workflow was hardened in `9e9a1601bd268be1992e3b94e899efe233763f86`: PR runs have separate concurrency groups, main typecheck is mandatory, the commit-message validation bypass is removed, and workflow-only edits no longer trigger production deploys.
- [x] The #527 merge's Hostless release passed typecheck and both Node 1/2 shared-Turso preflights. Both preflights saw the same database and all 5,748 staged records.
- [ ] Confirm Node 1 and Node 2 deployment completion and domain/read-back health. The first main release run was cancelled before read-back because PR validation shared the old main-release concurrency group.
- [ ] Verify signed-in browser behavior in normal and incognito sessions, including reload, sign-out, and bridge recovery.
- [ ] Prove durable runtime persistence and backup/restore on both production nodes.
- [ ] Complete the live owner-terminal browser check.
- [ ] Complete the full-history branch archive, then delete only confirmed trash branches.

**Important deployment evidence (15:05 UTC snapshot):**

- Node 1 app `apollo-node-1` reported `UPDATING`. New deployment `6aff0e9ac0e8a79ec57e28aa` was at `BUILD_STARTED`; the older deployment `6aff00cbc0e8a79ec57d234c` was still active. Its health endpoint was ready, but reported `buildSha: dev` and `authority-storage: sqlite:wal`. Safe configuration reported `SPMT_ORIGIN` not configured.
- Node 2 app `apollo-node-2` reported `UPDATING`. New deployment `6aff0eb7a8f48b734523ad50` was at `DEPLOYMENT_STARTED`; its health endpoint reported the StreamWeaver app ready; safe configuration reported `SPMT_ORIGIN` configured, with the value redacted.
- The GitHub deploy jobs were cancelled before final deployment read-back. Hostless may have continued the accepted deployment requests, but the available snapshot does not prove completion. Do not report either deployment as successful yet.
- The 5,748 rows are in the Turso recovery staging table. They do **not** prove the application runtime has switched to Turso authority; Node 1 still reported SQLite WAL at the time of the snapshot.

## 2. Final codebase review

### Safe cleanup already completed

- The obsolete Sprite/Fly authenticated terminal workflow was moved to `.github/archived-workflows/`; it is no longer an active workflow. Main commit: `6091c1cdbe12c1a821712b2c2ed7742da1c7fd30`.
- Node 3 creation tooling was removed by #527. The historical workflow filename `hostless-three-node-deploy.yml` remains because path filters and tests still reference it; its deployment matrix targets Node 1 and Node 2 only.
- The remaining `HOSTLESS_NODE3_TOKEN` reference in secret-exclusion logic is a defensive guard against propagating a stale secret, not a Node 3 deploy target.
- Remaining `FLY_API_TOKEN` references in sandbox policy are denylist guards, not live Fly API calls.
- The active machine-readable parity manifest was kept out of the historical archive; the registry points to archived donor reports only.

### Live migration debt — document and verify before deleting

1. HearMeOut Lounge bridge still has a donor Fly origin.
2. Nebula Mosaic generation still has an old StreamWeaver Fly origin fallback.
3. Companion/MountainView download routes still reference donor release assets.
4. Some worker paths still default to Sprite execution.
5. HearMeOut's worker adapter still supports Fly/Sprite rather than the Hostless hosted target.
6. Restream Control exists but is not yet part of the Node 2 process composition.
7. Node 1 still has a `/tmp` SQLite fallback; the 15:05 health snapshot reported SQLite WAL rather than Turso authority.
8. SpaceMountain Web and SPMT Service still transitively depend on heavy app packages; optimize after acceptance with measured profiling.
9. PR validation reported two high-severity npm advisories. Capture `npm audit --json` and remediate only the affected dependencies with compatibility tests; do not use `npm audit fix --force`.

The owner added [DONOR_ORIGIN_OVERRIDES.md](DONOR_ORIGIN_OVERRIDES.md) with Hostless environment overrides for Mosaic, HearMeOut, and Spotlight. Apply and verify those exact routes before deleting source-level donor fallbacks. A configured origin is not proof of live parity.

The latest Hostless runtime diagnostics run completed successfully on both nodes. An earlier diagnostics retry failed at the Hostless CLI installer with a connection reset; the subsequent run collected both snapshots successfully.

## 3. Explicit next steps

1. Verify the Hostless deployment IDs and live health/read-back for Node 1 and Node 2. If still incomplete, rerun the validated main release after confirming the new concurrency policy is active.
2. Resolve the runtime persistence boundary: Turso staging is not the same as the application using Turso as its authority store. Keep backup/restore and rollback proof.
3. Validate sign-in and the owner diagnostic terminal in the Node 1 browser. No terminal-specific login is allowed.
4. Apply and test the documented Hostless donor-origin overrides; only then remove source fallbacks.
5. Create and verify a full-history Git bundle; only then delete individually reviewed trash branches. Preserve all eight recovery candidates.
6. Capture the full npm advisory report and fix only verified dependency issues.
7. After the owner validates and baseline timings are captured, profile and optimize measured hot paths. Re-run the same correctness suite.

## 4. Evidence and PRs

- Recovery workflow: `d18385a55d62d8761ed433594cf7bd7417d9f76a`
- Merged-branch cleanup manual/dry-run: `8be04030358ba750fe03fb556f3d199329d66218`
- Reviewed-branch consolidation manual/dry-run: `44aea41392e60888c4486121e175d01c7e7b6d7e`
- Sprite/Fly workflow archive: `6091c1cdbe12c1a821712b2c2ed7742da1c7fd30`
- Hostless release concurrency/mandatory validation: `9e9a1601bd268be1992e3b94e899efe233763f86`
- #527 hygiene merge: `ec06baa46bca01539c6820a64b59dbdfc00b80bf`
- Owner donor-origin override guidance: `18c6dd387bdfc7b939454db9301f58204203d790`
- Sanitizer: [PR #525](https://github.com/Mtman1987/ApolloStation/pull/525), merged.
- Sign-in bridge gate: [PR #526](https://github.com/Mtman1987/ApolloStation/pull/526), merged.
- Repository hygiene: [PR #527](https://github.com/Mtman1987/ApolloStation/pull/527), merged green.
- Owner diagnostic terminal: [PR #528](https://github.com/Mtman1987/ApolloStation/pull/528), draft; CI green, browser acceptance pending.
- Consolidated cleanup and donor sweep: [PR #530](https://github.com/Mtman1987/ApolloStation/pull/530), draft.
- #518, #520, and #529 are closed/superseded.

## 5. Handoff checklist

- [x] Recovery workflow is manual-only and dry-run by default.
- [x] #525/#526 are merged; #527 is merged green.
- [x] #528 is implemented and CI-green as a draft.
- [x] Branch inventories and open-PR review are refreshed on main.
- [ ] Verify Node 1/2 deployment completion and runtime Turso authority.
- [ ] Complete browser acceptance for sign-in and owner diagnostics.
- [ ] Create/verify the full-history branch archive before any deletion.
- [ ] Complete donor-origin route acceptance and npm advisory review.
- [ ] Only after owner validation, run measured optimization and regression checks.

## 6. Final environment walkthrough and pause handoff

**Walkthrough update:** 2026-11-19, after the donor-origin override documentation was merged.

### What was verified in this walkthrough

- Main is at merge commit 18c6dd387bdfc7b939454db9301f58204203d790 for the production donor-origin override guide.
- docs/production/DONOR_ORIGIN_OVERRIDES.md exists on main. It documents STREAMWEAVER_URL, HEARMEOUT_DONOR_ORIGIN, HEARMEOUT_VOICE_BRIDGE_ORIGIN, and SPOTLIGHT_ENDPOINT, intended node placement, and the rule not to remove fallbacks until the Apollo route is proven healthy.
- The handoff branch has now been refreshed onto the latest main commit. Its current diff adds only the final handoff, foundation donor-sweep report, and production index link; no runtime code changes are included.
- PR #530 remains open and draft. PR #528 remains open and draft.
- The maintained topology and production guide specify Hostless Node 1 and Node 2 only. Node 3 is not an approved deployment target.
- The production path explicitly separates CI, deployment, and live acceptance. A green check is not proof of a live release.

### Environment access limitation

This walkthrough had GitHub repository access and CI-collected Hostless diagnostic artifacts, but no connected Hostless runtime or Rotator terminal. It inspected the 15:12 UTC snapshots, not a live interactive node session. The #527 merge automatically triggered the normal Hostless release: typecheck and both shared-Turso preflights passed, and Hostless accepted Node 1/2 deployment requests, but the GitHub jobs were cancelled before final read-back. No manual deployment, restart, workflow dispatch, secret change, database write, or recovery import was performed.

The latest recorded Hostless snapshot in this handoff is the 15:12 UTC diagnostics artifact in section 1. It is a CI-collected snapshot, not a live Hostless session. Node 1 and Node 2 were still `UPDATING`; Node 1 reported SQLite WAL and SPMT_ORIGIN not configured, while Node 2's readiness route reported StreamWeaver ready and safe configuration reported SPMT_ORIGIN configured. The new deployments remained at `BUILD_STARTED` and `DEPLOYMENT_STARTED` respectively. Recheck both nodes before relying on those values or declaring a release complete.

### Remaining work — resume in this order

1. **Confirm the two-node release.** Inspect the latest main-branch Hostless run and exact commit. Confirm Node 1 and Node 2 both deployed the intended SHA, then verify each node's readiness, domain routing, and cross-node service calls. A partial Node 1 success is not a successful release.
2. **Verify owner browser acceptance on Node 1.** Test a fresh normal browser session and incognito: sign-in/bridge recovery, workspace load, app catalog, app launch, reload, sign-out/sign-in, mobile layout, and absence of a blank shell or duplicate login-refresh chrome.
3. **Finish PR #528 acceptance.** Its latest recorded CI was green on head 88780e9944d48a7ce39d684f57865bb58e118de6; the remaining gate is the real owner browser path on Node 1. Keep it draft until that passes. Use the existing signed Apollo session; do not add a second terminal login or restore a made-up tenant secret/header.
4. **Prove runtime persistence, not just staging.** The 5,748 recovery rows (16 Nebula + 5,732 StreamWeaver) are already verified in the recorded recovery/staging evidence. Do not replay or re-apply them. Separately prove which adapter the live SPMT and app services actually use, that durable writes/read-backs survive a fresh process and restart, and that backup, isolated restore, integrity, tenant ownership, and rollback work. Turso staging/preflight is not proof that every runtime store has switched to Turso.
5. **Apply and verify donor-origin overrides.** Set the documented variables only in the appropriate protected Hostless app configuration. Confirm each exact route returns a healthy response from the intended Apollo service before removing any Fly fallback from source. The documentation merge did not configure Hostless variables or prove any route live.
6. **Complete the remaining runtime parity.** Verify real Twitch/Discord OAuth and provider connections; Chat Gateway reconnect/dedupe/leases; StreamWeaver commands/personas/rewards and audible speech; Nebula games/Tag/Quackverse/Mosaic generation; DSH publishing/media delivery; and HearMeOut playback plus bidirectional Discord audio. Offline tests and code presence do not satisfy these checks.
7. **Finish the supporting service ports.** Integrate and rehearse Restream Control in the Node 2 process map. Replace Companion/MountainView donor release-asset URLs with Apollo-owned signed artifacts. Migrate remaining Sprite/Fly execution-target defaults and the HearMeOut legacy-worker adapter only after replacement behavior and acceptance tests exist.
8. **Review dependencies and performance after correctness.** Capture a fresh npm audit --json, identify the exact affected dependency paths, and remediate narrowly with compatibility tests. The previously reported two high-severity advisories are not a current audit result. Profile hot paths only after live acceptance and capture a comparable baseline.
9. **Archive branches safely.** Preserve the eight named recovery-candidate branches in section 1. Create and verify a full-history Git bundle or equivalent external archive before deleting anything. The 53-branch inventory is not a source archive; no branch deletion is approved by this handoff.
10. **Keep the docs synchronized.** Update docs/CURRENT_STATE.md only when new deployment, persistence, or browser evidence is verified. Do not create another parallel status document for each small issue.

### Explicitly not done in this walkthrough

- No manual Node 1 or Node 2 deploy/redeploy/restart was performed; the automatic #527 release attempt and its incomplete read-back are recorded above.
- No recovery import or replay of the 5,748 already verified rows.
- No secret values read, copied, or changed.
- No Hostless environment overrides configured or asserted healthy.
- No branch deletion or full-history archive claimed.
- No merge of PR #528 or PR #530.
- No removal of Fly/Sprite compatibility code without a verified replacement.

### PR and resume pointers

- [PR #528 — owner-only diagnostic terminal](https://github.com/Mtman1987/ApolloStation/pull/528): draft; recorded CI green; owner browser acceptance pending.
- [PR #530 — final cleanup and handoff](https://github.com/Mtman1987/ApolloStation/pull/530): draft; handoff and foundation donor-sweep documentation.
- [Main commit — donor-origin override guide](https://github.com/Mtman1987/ApolloStation/commit/18c6dd387bdfc7b939454db9301f58204203d790): merged.
- [Current production path](../PRODUCTION_PATH.md), [current state](../CURRENT_STATE.md), and [donor-origin overrides](DONOR_ORIGIN_OVERRIDES.md) remain the maintained operating references.