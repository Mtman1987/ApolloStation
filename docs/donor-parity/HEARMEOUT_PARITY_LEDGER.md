# HearMeOut → ApolloStation Parity Ledger

Status: **Inventory started — no parity item is marked complete by this document alone.**

## Canonical ownership

- Target/source of truth: `Mtman1987/ApolloStation`, branch `main`, app `apps/hearmeout/`.
- Donor under audit: `Mtman1987/hearmeout-main`, branch `main`.
- Do not deploy or treat the donor as a live production app. Port required behavior into ApolloStation.
- Preserve Apollo-only functionality. Equivalent behavior is sufficient; implementations do not need to be textually identical.
- The closed ApolloStation PR #224 / branch `feat/hmo-xtream-watch-catalog` is a reference lead, not proof of shipped parity. Its Xtream Watch catalog/proxy behavior must be audited separately before porting.

## Audit method

A raw repository merge is not a reliable parity test here: the donor is a Next.js application with a large `src/app` route tree, while Apollo's HearMeOut is an integrated TypeScript app made of modules under `apps/hearmeout/src`. The first tree scan found **zero same-relative-path matches** between donor `src/**` files and Apollo's `apps/hearmeout/**` files. A literal merge would therefore miss semantic overlap and missing functionality.

For each domain below:
1. Map donor routes, components, libraries, data models, workflows, and tests to Apollo's equivalent modules or mark them as missing.
2. Record each discovered difference as a stable ID with donor evidence, Apollo evidence, expected behavior, chosen resolution, and verification.
3. Implement in Apollo only: port, adapt, combine, or retain Apollo's existing equivalent.
4. Run focused tests plus the relevant Apollo build/type-check/test workflows. A failed check is a fix-and-rerun item, not a reason to mark parity complete.
5. Mark an item complete only after code is merged to Apollo `main` and fresh verification supports it.

## Baseline inventory (2026-10-27)

- Donor `main`: 932 tracked tree entries; 576 under `src/`, including 408 under `src/app/`; 106 API `route.ts` files; 15 `public/` entries; 9 GitHub workflow files.
- ApolloStation `main`: 67 entries under `apps/hearmeout/` (including directories); 64 existing HearMeOut-focused tests under `tests/`.
- These counts are inventory signals, not a claim that every donor file is a product feature. Generated assets, deployment files, duplicated routes, legacy code, and donor-only infrastructure must be classified rather than copied.
- The donor's current `main` is the comparison baseline. Historical PRs and branches are leads only; they do not override current `main` or prove Apollo parity.

## Parity ledger

Legend: **OPEN** = not yet evaluated in enough detail; **ADAPT** = known architectural translation required; **VERIFY** = candidate existing parity needs behavioral proof.

| ID | Domain / evidence to compare | Initial Apollo mapping | Status | Resolution / acceptance evidence |
|---|---|---|---|---|
| HMO-001 | Authentication, middleware, roles, room access, and session lifecycle across donor `src/app/api/auth/**`, middleware, and related libraries | `apps/hearmeout/src/room-identity.ts`, `discord-adapter.ts`, `web-server*.ts`; inspect shared auth/contracts too | OPEN | Inventory routes and access rules; test allowed/denied and room/tenant isolation |
| HMO-002 | Activity / Discord Activity lifecycle, handshakes, session state, accept/request/control flows | `discord-activity-handshake.ts`, `activity-room.ts`, `activity-web.ts`, `discord-interactions.ts` | OPEN | Route/behavior matrix plus focused activity tests |
| HMO-003 | Lounge, room media, player controls, queue, playback recovery, and persisted checkpoints | `lounge-room.ts`, `live-lounge-bridge.ts`, `live-lounge-runtime.ts`, `room-media-*.ts`, `playback-source.ts`, `prepared-media.ts` | VERIFY | Compare donor behavior with Apollo queue/state/recovery tests; port only actual gaps |
| HMO-004 | YouTube discovery/resolution, audio/video broadcast, provider playback and proxy/HLS paths | `youtube-browser.ts`, `youtube-resolver.ts`, `movie-provider.ts`, `watch-hls-policy.ts`, `broadcast-*.ts` | OPEN | Provider-by-provider route and failure-mode matrix; preserve credential boundaries |
| HMO-005 | Auto-radio, music library/catalog, song-family behavior and worker-side catalog refresh | `auto-radio.ts`, `worker-music-catalog.ts`, `worker-media-cache.ts` | VERIFY | Reconcile donor current `main` with existing radio/music tests; include prior radio-family recovery as a lead |
| HMO-006 | Personas, bot actions, speech/TTS, conversation and room assistant jobs | `persona-*.ts`, `bot-action-adapter.ts`, `suite-action-*.ts`, `room-assistant-jobs.ts` | OPEN | Map commands, permissions, TTS/audio routing and recovery behavior; add regression tests |
| HMO-007 | Broadcast/RTC/WebRTC/LiveKit, screen sharing, egress, relay, and gateway lifecycle | `rtc-*.ts`, `spmt-rtc*.ts`, `livekit-*.ts`, `screen-*.ts`, `broadcast-*.ts` | OPEN | Compare transport, auth, reconnect, cleanup, and failure behavior; validate live-path boundaries |
| HMO-008 | Watch/catalog providers, including Xtream Watch catalog, episodes, direct playback, HLS, queue insertion and credential privacy | `web-server-v3.ts`, `room-media-browser.ts`, `movie-provider.ts`, `watch-hls-policy.ts`; PR #224 branch is reference only | OPEN — SECURITY SENSITIVE | Audit donor `src/app/activity-provider/**`, `activity/watch/**`, related API routes and closed PR branch. Do not ship until credential secrecy, URL/redirect validation, byte ranges, HLS segments, auth/room scope and queue idempotency are tested |
| HMO-009 | Persistence, database schema/migrations, import/export, room state and durable checkpoints | `persistent-migration.ts`, `blue-import.ts`, `blue-import-apply.ts` and shared persistence packages | OPEN | Compare schemas and migration order; prove old data compatibility and restart durability |
| HMO-010 | UI pages, components, hooks, browser media controls, accessibility and user-facing settings | Apollo API/module surface plus relevant shared UI packages | OPEN | Build donor UI/behavior inventory and map each user-visible workflow to Apollo's UI or API; do not port Next.js pages blindly |
| HMO-011 | API route inventory, request validation, origin checks, rate/size bounds, errors and response contracts | `web-server.ts`, `web-server-v2.ts`, `web-server-v3.ts`, `discord-http.ts`, `discord-interactions.ts` | ADAPT | Create donor-route → Apollo endpoint matrix; document intentional omissions and test each required contract |
| HMO-012 | Background workers, caches, cleanup, scheduled work and recovery jobs | `execution-worker*.ts`, `legacy-worker-adapter.ts`, `worker-*.ts`, `room-expiry`/cleanup modules | OPEN | Compare lifecycle, retry bounds, ownership and shutdown behavior; verify no duplicate workers or restart loops |
| HMO-013 | Production config, deployment workflows, diagnostics and environment variables | Apollo workflows and app configuration; donor `.github/workflows/**`, `Dockerfile`, `fly.toml` are evidence only | ADAPT | Port required operational behavior into Apollo workflows/config without adopting donor deployment ownership or leaking secrets |
| HMO-014 | Automated tests, fixtures, validation scripts, and documented regression coverage | Existing `tests/hearmeout-*.test.mjs` and Apollo CI workflows | OPEN | Map donor tests by behavior; port/adapt missing regression coverage; run fresh checks on Apollo |
| HMO-015 | Donor-only files, duplicate/legacy routes, generated media/assets, and dead code | No direct equivalent presumed | OPEN | Classify as required feature, operational-only, duplicate/obsolete, or donor-specific; record rationale before excluding |

## Per-item record template

For each concrete difference, add a child ID (for example, `HMO-008.03`) with:

- **Donor source:** exact file/route/test and behavior on donor `main`.
- **Apollo source:** exact equivalent or explicit “missing”.
- **Difference:** missing behavior, behavior mismatch, code conflict, or compatibility risk.
- **Decision:** port / adapt / combine / already equivalent / intentionally exclude.
- **Apollo change:** commit or PR link once implemented.
- **Verification:** test/workflow name and fresh result.
- **State:** open / in progress / blocked / verified.

## Exit criteria for HearMeOut

HearMeOut parity is complete only when all donor capabilities are classified, every required difference is verified in Apollo, exclusions have written reasons, security-sensitive media and authentication paths have focused tests, and the resulting checklist is reviewed against donor `main` one final time. Only then can this donor be considered eligible for archival/removal; do not delete it before parity and recovery evidence are confirmed.

## Ecosystem sequence

1. HearMeOut — this ledger.
2. Nebula / ChatTag — confirm canonical repo and app paths before scanning.
3. StreamWeaver — target `ApolloStation/apps/streamweaver`; do not use obsolete `streamweaver4ev4`.
4. Discord Stream Hub — respect the established ownership boundary: `DiscordStreamHub/clip-worker` is the worker parity source; Apollo's `apps/discord-stream-hub` is the integrated app surface.
5. The `.live` projects — audit each donor against its canonical Apollo app, and preserve `studio` as the SPMT documentation/operations archive rather than treating it as a production app.
6. Final ecosystem-wide parity audit, then archive/delete donor repositories only after verified parity and retained migration/audit records.
