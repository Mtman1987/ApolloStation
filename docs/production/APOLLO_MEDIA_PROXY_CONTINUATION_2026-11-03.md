# ApolloStation authenticated media continuation — 2026-11-03

Read after APOLLO_PARITY_CONTINUATION_RUNABLE_2026-11-03.md. Fetch current main before continuing. This is a bounded security/porting increment, not full donor parity or production acceptance.

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

Source/diff reviewed; git diff --check passed. No local builds, typechecks or tests were run, honoring repo merge-first/Oracle workflow. Fetch the completed branch to verify exact source before merge; connector uploads require preserving literal backslashes. The initial upload escaping issue was caught before merge and corrected on the branch. PR merge and post-merge Oracle findings must be recorded after they occur. Do not claim these new tests passed from their source alone.

## Remaining work and boundaries

- Inspect the post-merge Oracle report, including findings rather than just Actions conclusion.
- Existing workflow upload-name patch remains stored but inactive; authorized workflow-write access and fresh evidence sweeps are still separate work.
- Watch manifest size/time limits, redirect-relative resolution, generic upstream error sanitization, exact byte-window response bounds and registry per-tenant quotas deserve separate bounded reviews. Global cap may evict another tenant's entry but cannot expose its URL.
- Tenant/user scope is not room-membership authorization. Generic Watch/YouTube proxy routes still authenticate users rather than enforce a room ACL; no full room authorization claim.
- ResolvePrincipal retains existing guest/Twitch/SPMT authentication semantics; this batch does not redesign sessions or bearer handling.
- Configured-provider/browser/live Discord acceptance and dependency advisory upgrades remain open.
- No donor app was run. No production credentials, deployment, DNS or live configuration changes; apps remain offline. Old shared-cache entries still need authorized invalidation before return-to-live.
