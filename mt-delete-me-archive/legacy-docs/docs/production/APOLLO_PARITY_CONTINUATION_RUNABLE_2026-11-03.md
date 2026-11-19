# ApolloStation repo-first continuation — 2026-11-03

Read after [the follow-up handoff](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md).
Fetch current main before resuming. This document is a status snapshot, not a parity claim.

## Newer continuation — read first

[Authenticated media proxy continuation](APOLLO_MEDIA_PROXY_CONTINUATION_2026-11-03.md) records PR #386 merged on main at ebcf466, private Watch/YouTube cache policy, tenant/user-scoped stream registry, and preparation-time session revalidation. It also supersedes the pending baseline Oracle status below: run 41710521401 actually recorded 1,458 passes and 3 failures from two stale HLS header assertions plus the enclosing test. Those assertions are repaired in #386, with stricter private/no-store and Vary expectations. New-code Oracle 41713920282 remained in progress at inspection; no findings/pass claim yet.

The rest is the earlier increment's historical snapshot. Its test results belong only to the recorded revision. Follow the linked newer handoff for next work and current status.

## Merged repository work

- PR [#384](https://github.com/Mtman1987/ApolloStation/pull/384): durable workflow/test repair patch and handoff, merged at `069c6ddffef99838e3a3fe7154c5c45779a5c1ff`.
- PR [#385](https://github.com/Mtman1987/ApolloStation/pull/385): private Xtream HLS delivery and final authorization, merged at `43df67a6cbef86e4293cbcd336399b2535c2d61c`.
- Code/test batch was first pushed at `5885185d1edee8b70342fc441a48498cde942312`, fetched back and tested. Source matched exactly; the remote regression differed from the initial local file only by its trailing newline. The fetched remote regression was rerun successfully.

No implementation produced in this continuation remains local-only. The older
`3580544` work was not recovered: its remote branch and source bundle were unavailable.
Do not describe that older work as merged.

## HearMeOut private Xtream delivery

A concrete gap in `apps/hearmeout/src/xtream-hls-route.ts`: authorized segment
paths advertised `public, max-age=3600`, allowing shared caches to replay bytes
without revisiting tenant/membership authority. Preparation could also outlive
the initial authorization decision.

The merged code uses `Cache-Control: private, no-store` with
`Vary: Cookie, Authorization` for manifests, segments, byte ranges and errors.
It rechecks authorization immediately before sending media bytes and closes
segment streams on refusal. OPTIONS, ranges, bounded manifest validation and
provider URL protection remain intact. Public-room access policy is unchanged.
This does not claim a complete media authorization redesign.

New tests: `tests/hearmeout-xtream-hls-private-delivery.test.mjs` covers actual
HTTP master/variant/segment/range headers, revocation before delivery, and the
mounted handler's session, tenant, membership, leave/rejoin and inactive-stream
boundaries. Tests use local cached files; no provider acquisition. Anonymous
requests preserve 401; authenticated outsiders and foreign tenants receive 403.

## Verified evidence

- `npm ci --ignore-scripts`, full `npm run build`, and `npm run typecheck` passed.
- **46 passed / 0 failed / 0 cancelled / 0 skipped** on the fetched remote code across nine targeted files: private delivery, HLS authorization/contract, Watch routes, byte range/room scope, UI/API contracts, Discord Activity, Watch security and HLS policy.
- `git diff --check` passed; remote source/tests are committed and merged.
- PR #385 was cleanly mergeable; it registered zero check runs and zero commit status contexts. This is not a CI pass.
- Baseline Oracle [41709670060](https://github.com/Mtman1987/ApolloStation/actions/runs/41709670060) at `069c6dd` completed/success. Downloaded report artifact [13267032583](https://github.com/Mtman1987/ApolloStation/actions/runs/41709670060/artifacts/13267032583): all four shards complete, **1,456 passed / 0 failed / 0 cancelled / 0 skipped**. This resolves the stale pre-merge assertion-repair pending status for that baseline, not for newer code.
- Post-code-merge Oracle [41710521401](https://github.com/Mtman1987/ApolloStation/actions/runs/41710521401) at `43df67a` was **in progress** when inspected. Its findings/report remain unverified. Always inspect findings, not only Actions success.
- Dependency audit reports **2 high-severity vulnerabilities** (`follow-redirects`, `sharp`). No dependency or automatic audit fix was made in this bounded batch.

## Workflow-write blocker remains

The connected GitHub connector rejected active workflow writes with
`403 after trying upscoping`. The tested companion repair is safely preserved
in main at [patches/parity-artifact-upload-20261103.patch](patches/parity-artifact-upload-20261103.patch),
but the active manual inventory upload name is still broken.

With authorized workflow-write access, apply the pair together:

```sh
git apply --check docs/production/patches/parity-artifact-upload-20261103.patch
git apply docs/production/patches/parity-artifact-upload-20261103.patch
node --test tests/apollo-parity-automation.test.mjs tests/parity-rea-cli.test.mjs
```

Applied-patch targeted validation was **7 passed / 0 failed**. All seven upload
paths, JSON validation and donor read-only boundaries remain unchanged. Do not
activate the regression alone or rerun old broken manual runs. Fresh sweeps remain
blocked until the actual workflow is repaired.

## Next approved work

1. Inspect post-merge Oracle run 41710521401 and its complete report; record exact findings.
2. Apply the upload patch with workflow-write access, merge the pair and dispatch fresh manual sweeps for all three confirmed donor/app pairs. Verify seven files and exact provenance.
3. Continue authenticated watch/YouTube proxy cache policy and tenant-scoped stream registry review; those routes are not fixed by this Xtream-only batch.
4. Review the two dependency advisories separately before choosing upgrades; do not run an uncontrolled audit fix.
5. Authorized configured-provider and live Discord rehearsals remain open. Before any return-to-live, invalidate any old shared-cache HLS entries from the previous public-cache policy. No cache invalidation was performed here.

Apps remain offline. No donor execution, production credentials, deployment or DNS changes.
No live-provider acceptance or production readiness is established by fixture/CI evidence.
User requires durable repo commits, not local-only completion.
