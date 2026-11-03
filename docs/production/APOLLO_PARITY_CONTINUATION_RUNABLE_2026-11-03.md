# ApolloStation repo-first continuation — 2026-11-03

Read after [the follow-up handoff](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md).
Baseline for this code batch: main at `069c6ddffef99838e3a3fe7154c5c45779a5c1ff`.

## Durable repair and workflow permission blocker

PR [#384](https://github.com/Mtman1987/ApolloStation/pull/384) merged at `069c6dd`.
The tested workflow/test pair is in the repository at
[patches/parity-artifact-upload-20261103.patch](patches/parity-artifact-upload-20261103.patch).
This is preserved source, not an active workflow change. The connected GitHub
connector rejected workflow writes with `403 after trying upscoping`.
The active manual upload name therefore remains broken; do not dispatch fresh
sweeps until authorized workflow-write access applies the pair together.

Applied-patch targeted validation: **7 passed / 0 failed**, diff check passed.
Use `git apply --check` and `git apply` on the patch, then run
`node --test tests/apollo-parity-automation.test.mjs tests/parity-rea-cli.test.mjs`.
All seven upload paths, JSON validation and donor read-only boundaries are unchanged.
Do not activate the regression alone.

## HearMeOut private Xtream delivery

Found a concrete gap in `apps/hearmeout/src/xtream-hls-route.ts`:
per-request authorized segment paths advertised `public, max-age=3600`.
Shared caches could serve bytes without revisiting tenant/membership authority.
Media preparation could also outlive the initial authorization decision.

The code batch changes manifest, segment, range and error delivery to
`Cache-Control: private, no-store` with `Vary: Cookie, Authorization`.
It rechecks authorization immediately before sending manifest/segment bytes and
closes segment streams on refusal. OPTIONS, range support, bounded manifest
validation and provider URL protection are preserved. Existing public-room policy
is unchanged; this is not a full media authorization redesign.

Added `tests/hearmeout-xtream-hls-private-delivery.test.mjs`: real HTTP fixture
coverage for master/variant/segment/range cache headers, revocation before delivery,
and the mounted handler's session, tenant, membership, leave/rejoin and inactive-stream
boundaries. Fixtures use local cached files; no donor/provider acquisition.

Validation: `npm ci --ignore-scripts`, full `npm run build`, and 20 targeted tests
passed (private delivery, HLS authorization/contract, Watch routes, byte ranges/room scope);
`git diff --check` passed. An initial test expected anonymous 403; the actual preserved
contract is 401, and the final fixture checks that exact status.
Dependency audit reported **2 high-severity vulnerabilities**; no dependency changes
or automatic audit fix were made in this bounded batch.
Remote CI and merge status remain to be inspected. No new Oracle, browser or live-provider
acceptance is established by these local tests.

## Next

1. Verify this code/test/doc batch on its remote branch and merge after applicable checks.
2. Inspect current Oracle findings, not only Actions status.
3. Apply the preserved upload patch with workflow-write access and dispatch fresh sweeps; inspect seven files and provenance for all three donors.
4. Continue authenticated watch/YouTube proxy cache policy and tenant-scoped stream registry review; do not infer those routes are fixed by this Xtream-only change.
5. Authorized configured-provider and Discord rehearsals remain open.

Apps remain offline. No donor execution, production secrets, deployment or DNS changes.
The older `3580544` work was not recovered; its remote branch and source bundle were unavailable.
User requires durable repo commits, not local-only completion.
