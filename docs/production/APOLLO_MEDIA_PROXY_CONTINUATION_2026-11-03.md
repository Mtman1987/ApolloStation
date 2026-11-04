# ApolloStation authenticated media continuation — 2026-11-03

Read after APOLLO_PARITY_CONTINUATION_RUNABLE_2026-11-03.md. Fetch current main before continuing. This is a bounded security/porting increment, not full donor parity or production acceptance.

## Merged repository work

PR [#386](https://github.com/Mtman1987/ApolloStation/pull/386) merged at **ebcf46627b4ace6f04cd1a6e2e63c1826ce5985c**. Fetched main and verified the merge commit is on main. All source, diagnostic regressions and this handoff are durable in the repository.

Post-merge Oracle [41713920282](https://github.com/Mtman1987/ApolloStation/actions/runs/41713920282) completed/success against that exact code SHA. On 2026-11-04, downloaded and read consolidated report artifact **13268722598**: **1,468 passed / 0 failed / 0 cancelled / 0 skipped**, all four shards COMPLETE (357, 363, 400 and 348 cases). This supersedes the earlier pending status. Evidence applies to ebcf466 only, not later main revisions or live deployment.

## Baseline findings inspected

Oracle run [41710521401](https://github.com/Mtman1987/ApolloStation/actions/runs/41710521401) at 43df67a completed/success, but downloaded consolidated report artifact 13267578894 records **1,458 passed / 3 failed / 0 cancelled / 0 skipped**, all four shards complete. Actions success means diagnostic execution completed; it is not a claim of zero assertion failures. The two failing nested assertions in hearmeout-episode-hls-integration.test.mjs expected the obsolete no-store header; the enclosing test accounts for the third recorded failure. This batch requires private, no-store and Vary: Cookie, Authorization instead, preserving media/range/leakage assertions.

## Increment

- Watch proxy binary/range and manifest responses are private, no-store.
- Generic YouTube proxy no longer copies upstream Cache-Control; bytes, HEAD and upstream errors are private too.
- Every matched authenticated media route sets Vary: Cookie, Authorization, including authentication/input/allowlist/provider failures.
- YouTube registry keys include authenticated tenant AND user as well as video and kind; neither caller body nor query fields supply authority. Missing identity fails closed. Another tenant/user cannot retrieve or overwrite an owner's signed URL. Registration/proxy paths remain unchanged.
- Registry stores/returns URL snapshots, requires explicit scope, and retains existing TTL and global cap.
- Watch/YouTube media delivery and registration recheck session immediately before headers/commit; revocation or identity change cancels acquired bodies and refuses delivery. This is a pre-delivery check, not continuous revocation of an already streaming response.

Seven new diagnostic tests cover private HTTP headers, manifests/ranges/HEAD/upstream failures, scoped audio/video registrations, foreign tenant/user and forged authority fields, missing identity, preparation-time revocation and body cancellation, registration-time revocation, and immutable registry snapshots. Existing stream fixtures now supply explicit scope and retain TTL/cap/media-type/range/redirect/secret-boundary checks.

## Validation status

Exact fetched remote source and both updated existing fixtures matched reviewed local files; new regression differed only by final newline. git diff --check passed. JS syntax-only checks passed for fetched regression fixtures; no local builds, typechecks or test execution and no PR test gating. Connector escaping issues were caught and corrected before the ready PR; ffprobe fixture string uses template quoting while retaining the existing value. Do not claim these new tests passed from their source or successful merge alone.

## Remaining work and boundaries

1. Complete post-merge Oracle 41713920282 report inspected: zero findings at ebcf466. Continue from the [Hostless follow-up](APOLLO_HOSTLESS_CONTINUATION_2026-11-04.md); inspect each later main revision's diagnostics separately per AGENTS.md.
2. Existing workflow upload-name patch remains stored but inactive; authorized workflow-write access and fresh evidence sweeps are still separate work.
3. Watch manifest size/time limits, redirect-relative resolution, generic upstream error sanitization, exact byte-window response bounds and registry per-tenant quotas deserve separate bounded reviews. Global cap may evict another tenant's entry but cannot expose its URL.
4. Tenant/user scope is not room-membership authorization. Generic Watch/YouTube proxy routes still authenticate users rather than enforce a room ACL; no full room authorization claim.
5. ResolvePrincipal retains existing guest/Twitch/SPMT authentication semantics; this batch does not redesign sessions or bearer handling.
6. Configured-provider/browser/live Discord acceptance and dependency advisory upgrades remain open.

No donor app was run. No production credentials, deployment, DNS or live configuration changes; apps remain offline. Old shared-cache entries still need authorized invalidation before return-to-live.
