# HearMeOut parity handoff

Last updated: 2026-10-29. Read this before continuing parity work.

## Goal and operating rules

Continue porting required behavior from the read-only HearMeOut donor into
`Mtman1987/ApolloStation` `main`. The scope and exclusions remain in
[`HEARMEOUT_SCOPE.md`](HEARMEOUT_SCOPE.md); route dispositions are tracked in
[`HEARMEOUT_ROUTE_COVERAGE.md`](HEARMEOUT_ROUTE_COVERAGE.md) and the
[`HEARMEOUT_PARITY_LEDGER.md`](HEARMEOUT_PARITY_LEDGER.md).

- Work in Apollo only; donor checkouts are read-only and must not be run.
- Follow `AGENTS.md`: merge completed, reviewed PRs promptly, then use the
  post-merge main workflow as diagnostic feedback. Do not weaken tests to hide
  a real defect.
- Do not run local builds, typechecks, or tests for this continuation; use the
  Oracle workflow on main. Never report a test as passing unless its workflow
  result confirms it.
- Do not deploy or make live configuration changes as part of this repo task.
- Preserve provider credentials, signed URLs, and raw upstream URLs on the
  server side. Review origin/tenant boundaries, ranges, redirects, timeouts,
  response bounds, and cancellation before changing media routes.

## Current repository and completed increment

- Current `main`: `f40b0be30abfac62b53e3ce27d6ab72654d37fe2`
  (`test(hearmeout): cover xtream HLS route methods`, PR #320).
- The latest Oracle validation is
  [40906472006](https://github.com/Mtman1987/ApolloStation/actions/runs/40906472006):
  all four shards completed, 1,407/1,407 tests passed, zero failures.
- This continuation merged PR #316 (resolver replay regression), #317
  (production route fix), and #318 (verification/handoff documentation).
- Run [40754875281](https://github.com/Mtman1987/ApolloStation/actions/runs/40754875281)
  exposed the underlying bug: the mounted room media route performed provider
  resolution before ordinary enqueue, bypassing the durable `enqueueResolved`
  receipt. PR #317 now routes query and YouTube URL requests through that
  receipt; direct user-owned media URLs keep ordinary enqueue. Same-key replay
  avoids new provider jobs, and changed intent under the same key is rejected
  before resolution. Run
  [40755646722](https://github.com/Mtman1987/ApolloStation/actions/runs/40755646722)
  verified the fix (1,404/1,404); 40756147169 verified the final main revision.
- PR #320 adds no-network contract tests for the mounted XTREAM HLS handler:
  OPTIONS preflight, non-GET rejection, and unrelated-path decline. Oracle run
  40906472006 confirms these and the full suite pass. This small route-method
  subtask is **DONE**; it does not verify actual accepted-episode media delivery.
- The working tree was clean on `main` at the recorded revision.

## Next action

Continue the open Watch/media parity. The next concrete bounded target is the
accepted-episode Xtream HLS integration:

1. Re-read `HMO-009-WATCH-STATE-GAP.md`, the HLS rows in
   `HEARMEOUT_ROUTE_COVERAGE.md`, and current tests/handlers in Apollo and the
   donor before proposing implementation.
2. Trace a real accepted episode/request through the mounted Apollo route,
   worker HLS handler, manifest-child rewriting, byte-range forwarding, error
   handling, and browser consumer. The route-method test is done; this actual
   end-to-end stream path is still open.
3. Add a focused regression for the accepted episode's Apollo-owned HLS path
   and relevant credential/URL boundary. Do not expose donor hostnames, provider
   URLs, or credentials to the browser. Do not blindly copy the donor route.
4. Merge first per `AGENTS.md`, then inspect the main Oracle report and record
   the result in the relevant gap document.

The accepted-episode-through-HLS streaming test, the
`recordQueued` versus enqueue failure ordering decision, Internet Archive
fallback (explicitly excluded by scope), remaining API route dispositions,
session revocation, and Twitch redirect registration remain open. Do not imply
that HMO-011 or P08 is complete.

## Key references

- `AGENTS.md` — merge-first and repair workflow.
- `docs/donor-parity/HEARMEOUT_SCOPE.md` — owner-approved boundaries/exclusions.
- `docs/donor-parity/HEARMEOUT_PARITY_LEDGER.md` — parity status and current
  findings.
- `docs/donor-parity/HMO_011_UI_CONTRACTS.md` — verified UI/API contract work.
- `docs/donor-parity/HMO-009-WATCH-STATE-GAP.md` — Watch state, route, and
  remaining end-to-end HLS gaps.
- `tests/hearmeout-media-resolution.test.mjs` — resolver retry integration
  regression added in PR #316.
