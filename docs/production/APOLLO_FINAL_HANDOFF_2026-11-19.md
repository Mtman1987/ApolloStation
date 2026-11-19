# ApolloStation final cleanup and handoff

**Audit date:** 2026-11-19  
**Repository:** `Mtman1987/ApolloStation`  
**Purpose:** one coordinated pre-handoff cleanup and codebase readiness record. This is not a production certification.

## Current result

The repository is in the final acceptance-and-hardening phase. The owner's estimate is that functional completion is above 90%; remaining work is concentrated in validation, live browser/device acceptance, deployment proof, archive/branch hygiene, and post-validation optimization.

Do not interpret a green build as proof of production behavior. Keep code changes small, preserve the two-node Hostless topology, and do not replay already-imported recovery data.

## Ordered cleanup sequence and status

### 1. Recovery workflow defaults — completed on main

- [x] Removed the push trigger that could automatically apply recovery data.
- [x] Kept workflow_dispatch as the only trigger.
- [x] Changed the `apply` input default to `false`.
- [x] Accepts both `recovered-json-manifest*.jsonl` and `recovered-json-manifest*.jsonl.gz`.
- [x] Fails closed unless exactly one supported manifest is selected.
- [x] Runs manifest validation as a dry run; only an explicit manual `apply=true` reaches the write step.
- [x] No recovery import was re-run. The previously verified 5,748-row import remains the accepted evidence.

**Commits:** recovery workflow `d18385a55d62d8761ed433594cf7bd7417d9f76a`; manual-only branch cleanup `8be04030358ba750fe03fb556f3d199329d66218`.

### 2. PR #527 repository hygiene — compile fix pushed; validation pending

- [x] Kept the broad hygiene/docs work on `chore/repo-hygiene-docs-audit-2026-11-19`.
- [x] Repaired `apps/companion/src/diagnostics.ts`: the snapshot interface had literal escaped newline characters embedded in the TypeScript source.
- [x] Pushed two corrective commits: `8d2b82ad518d0160bde994d54f6ea79a7bb55cbf` and `5cfe22d035c00ca798247636cfeee720a210a589`. The first repaired the interface but left escaped newline sequences elsewhere; the second normalized the entire source file after CI exposed the remaining line-12 parse error.
- [ ] Wait for the complete PR validation, Discord parity, Restream validation, and Hostless release checks.
- [ ] Merge only when all required checks are green and the PR diff has been reviewed against current main.

**Rule:** if any required validation remains red, keep #527 open and do not merge.

### 3. Diagnostic sanitizer — #525 merged; #518 closed

- [x] Confirmed PR #525 is merged to main.
- [x] Main sanitizer preserves safe query parameters while redacting secret query values.
- [x] Main sanitizer redacts PEM and PGP private-key blocks.
- [x] Main diagnostic artifact workflows gate uploads on successful sanitization.
- [x] Tests on main cover safe query preservation, PGP/PEM redaction, and unsupported binary artifact handling.
- [x] Closed #518 because its sanitizer implementation duplicates the now-merged #525 implementation and is older/weaker.
- [ ] Reopen a narrowly scoped follow-up only if a concrete missing sanitizer case is found in current main.

### 4. Owner diagnostic terminal — #528 remains draft

- [x] Terminal source is proposed as a read-only Overlay Bay source.
- [ ] Remove the obsolete client-side tenant-header dependency by changing the server/API contract to derive the active tenant from the validated Apollo session/shell.
- [ ] Keep access owner-only, read-only, bounded to health and operational logs, and free of arbitrary shell commands, environment dumps, secrets, or app-user data.
- [ ] Add tests proving session identity, owner authorization, tenant selection, bounded output, and denial for non-owner sessions.
- [ ] Re-run full validation; retain draft status until those tests and the user-facing browser path are ready.

**Important architecture note:** current `PlatformApiAdapter` reads `x-spmt-tenant` as a tenant selector and then authorizes the bearer session against that tenant. The header is not itself an authentication secret. Do not merely remove it from the browser request: first move tenant selection to the validated session/shell boundary and prove the server-side behavior. No new token or parallel login should be introduced.

### 5. Donor parity sweep — reviewed and refreshed for current main

- [x] Reviewed #520's foundation donor findings for Rotator, SPMT.live, and SpaceMountain.live.
- [x] Rebased the documentation content by recreating it from current main in this handoff branch.
- [x] Updated the shell sign-in note for merged PR #526 and the terminal note for draft PR #528.
- [ ] Merge this documentation only after the current-main handoff notes have been reviewed.

The audit distinguishes code-level equivalents from live acceptance. The key remaining foundation gaps are the Apollo-owned coder worker execution lifecycle, Hostless Node 1/2 health and recovery evidence, durable persistence/backup/restore proof, cross-app identity/workspace isolation, shell sign-in browser acceptance, Companion/MountainView route coverage, and mobile/desktop interaction proof.

### 6. Branch archive and cleanup — inventory refreshed; destructive work not performed

- [x] Refreshed the visible branch inventory: 50 branches were returned, including main.
- [x] Preserved the eight named recovery candidates for explicit review:
  - `feat/nebula-game-runtime-turso-store`
  - `feature/turso-live-runtime-smoke`
  - `feat/stellar-kokoro-self-hosted-tts`
  - `feat/hmo-xtream-watch-catalog`
  - `feat/dsh-mtfixit-intake-turso-followup`
  - `port/streamweaver-restream-golive-parity`
  - `feat/recovered-json-manifest-verification`
  - `feat/oracle-core-runtime-image`
- [x] Changed `.github/workflows/cleanup-merged-branches.yml` to manual dispatch only, with dry-run enabled by default; pushes to main can no longer delete branch refs automatically.
- [x] Confirmed the prior cleanup run reported `Deleted: 0`; no branches were removed by that run.
- [ ] Create and verify a Git bundle or equivalent full-history archive before deleting any branch.
- [ ] Delete only branches proven obsolete after the archive is verified.
- [ ] Keep main and branches belonging to intentional open PRs.

No branch has been deleted in this cleanup. The connected GitHub actions available in this session expose branch search/create/update, but not branch deletion, tag creation, or a workflow-dispatch action; the Rotator CLI/MCP tools described in its documentation are not connected in this session. The GitHub read API also cannot create a Git bundle. Do not substitute an inventory text file for a source archive, and do not claim archive/delete completion until verified.

### 7. Final green audit — pending

- [ ] No open red PRs intended to be kept.
- [ ] Recovery workflow remains manual-only and dry-run by default.
- [ ] Latest main validation, Hostless release, diagnostics, Discord, Nebula, and Restream checks are green.
- [ ] Confirm Node 1 and Node 2 deployment commits and health; Node 3 is retired.
- [ ] Verify sign-in in normal and incognito browser sessions, reload, sign-out, and bridge recovery.
- [ ] Verify Turso connectivity and durable data ownership on both production nodes.
- [ ] Produce a concise deployment-readiness report with exact commit SHAs and evidence links.

## Additional codebase review findings

### Keep the next changes focused

1. **Do not optimize before correctness.** First get the full validation suite green and capture baseline build/test timings. Then optimize only measured hot paths.
2. **Persistence boundary:** preserve one canonical owner per data domain. Keep SQLite local/cache use explicit and Turso remote authority deliberate; do not perform broad storage rewrites during this cleanup.
3. **Tenant and session context:** avoid parallel auth headers or client-invented tenant authority. The validated Apollo session and selected workspace should be the source of truth.
4. **Diagnostics:** keep sanitizer fail-closed, avoid printing raw logs to Actions consoles, and cap output/size.
5. **Hostless topology:** Node 1 and Node 2 only. Remove leftover Node 3 scripts/workflow references only after checking the hygiene PR diff and all runtime manifests.
6. **Documentation:** retain one professional root README, app READMEs, developer/operations indexes, and a clearly labelled `mt-delete-me-archive` for historical material pending review. Avoid restoring stale handoff notes into active docs.
7. **Workflow hygiene:** distinguish failed validation from cancelled/superseded runs and transient infrastructure errors. Retry only genuinely failed jobs after the underlying issue is fixed.
8. **Security:** never expose secrets in logs, browser bundles, source, PR text, diagnostic artifacts, or chat. Keep the terminal diagnostic-only, not an app execution surface.
9. **Dependency audit:** the PR validation install reported two high-severity npm advisories. Capture the full `npm audit --json` details and update only affected direct/transitive dependencies with compatibility tests; do not use `npm audit fix --force` as a blanket cleanup.

### Acceptance before optimization

- Full build/typecheck and required tests green.
- PR checks green on the exact reviewed commit.
- Node 1/2 release and health proof on the exact deployed commit.
- Sign-in/session and cross-app smoke tests complete.
- Recovery import count/hash evidence retained without replay.
- Backup/restore and rollback path documented and rehearsed.

After acceptance, profile the build and runtime, remove redundant work, optimize high-cost paths, and rerun the same correctness suite to prove no regressions.

## Handoff checklist for the next operator

- [ ] Review this PR and the refreshed donor sweep.
- [ ] Finish #527 validation; merge only green.
- [ ] Keep #528 draft until the tenant/session authority is corrected and tested.
- [ ] Finish Git bundle/archive and branch deletion using a connected, authorized Rotator/GitHub CLI path.
- [ ] Run the final main Actions and Node 1/2 acceptance audit.
- [ ] Only then start measured optimization.

## Evidence references

- Recovery workflow commit: `d18385a55d62d8761ed433594cf7bd7417d9f76a`
- Companion diagnostics source repair: `5cfe22d035c00ca798247636cfeee720a210a589`
- Merged sanitizer PR: [#525](https://github.com/Mtman1987/ApolloStation/pull/525)
- Merged sign-in bridge-gate PR: [#526](https://github.com/Mtman1987/ApolloStation/pull/526)
- Hygiene PR: [#527](https://github.com/Mtman1987/ApolloStation/pull/527)
- Owner terminal draft: [#528](https://github.com/Mtman1987/ApolloStation/pull/528)
