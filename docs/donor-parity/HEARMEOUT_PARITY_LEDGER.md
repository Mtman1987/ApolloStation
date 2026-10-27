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


## Reuse of existing approved HearMeOut audit (important)

Do not redo the old feature-by-feature review from scratch. Apollo already contains a more detailed approved review at [`docs/donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md`](../donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md). It records 58 live-capability review rows and 33 HMO/DSH work packages, including the HearMeOut work packages P01–P14. Treat those findings as the starting hypothesis and evidence trail; refresh them against today's donor `main` and Apollo `main` before declaring anything still missing or now complete.

### Previously identified HearMeOut gaps to re-check first

The existing review names these concrete behaviors. They should become child ledger items, not be lost inside broad domains:

| Child item | Previously identified behavior | Existing work package | Re-check target |
|---|---|---|---|
| HMO-003.01 | Owner moderation: unban, enforced server mute/unmute, moving participants between rooms | P02 | Compare current donor moderation routes/UI with Apollo RTC membership controls |
| HMO-003.02 | Voice waiting queue, invitations, admission/removal workflow | P03 | Confirm donor's queue/invite flow and Apollo's production caller/UI |
| HMO-007.01 | Room screen capture/share and participant viewing | P04 | Confirm actual capture and RTC video path, not just grant types |
| HMO-003.03 | Real synchronized room audio/video player with seek, next, mute, volume and queue controls | P01 | Verify the main room mounts a real player; playback labels/state alone are not parity |
| HMO-004.01 | Search by title/artist/YouTube URL, resolve playable source, and enqueue it | P05 | Follow donor provider search → resolver → worker → player path end-to-end |
| HMO-005.01 | Saved favorites plus recent/most-played history | P06 | Verify durable persistence and user-visible add/list/remove controls; cache entries do not equal favorites |
| HMO-005.02 | Auto-radio lifecycle, recommendation history, and choose-next behavior | P07 | Include the later radio song-family recovery already merged into Apollo; verify current donor behavior against it |
| HMO-008.01 | Watch catalog for movies/live channels/series/episodes, provider picker, recommendation acceptance and series progression | P08 | Include donor's current catalog routes and the closed PR #224 Xtream catalog branch as evidence only |
| HMO-008.02 | Media preparation and delivery: HLS, probing, audio tracks, direct downloads/uploads, bounded caches | P09 | Trace real consumers and worker/server wiring; helper modules alone do not establish parity |
| HMO-002.01 | Discord Activity shares canonical room/watch state and supports the same request/control path | P10 | Verify Activity launch, room/session binding, provider playback, request and control actions together |
| HMO-006.01 | Persona, wake settings, local Companion input, and speech/TTS lifecycle | P11–P12 | Verify end-user configuration, producer/consumer wiring, permissions and audio routing |
| HMO-006.02 | Commlink room context and Overlay Bay widgets | P13–P14 | Confirm integration contracts and rendered/user-observable behavior |

**Important baseline warning:** the prior review froze donor `hearmeout-main` at commit `e89b266058d4aacbbb54298e2fa6ac7de35607f0`, while today's inventory reads donor `main`. The current branch has moved since that frozen review. Reconcile the changed donor files and newly added routes against these P01–P14 rows before implementing; don't assume the September findings describe all current functionality.

### Current donor API family inventory

The current donor tree has 106 API `route.ts` files. First-level counts from the current tree:

- Watch: 18
- Discord: 12
- Authentication: 8
- Internal: 5
- Spotlight media: 5
- Lounge media: 4
- Music: 4
- Twitch: 4
- Voice: 4
- YouTube audio: 3
- Activity and bots: 4 combined at their top-level route groups, plus separate activity-room routes
- Remaining route families include Xtream/YouTube provider playback, LiveKit health/token, room administration/expiry, persona voice, presence, health/system, worker-media and other single-route groups.

Use this as a route coverage checklist, not a raw endpoint-count target. Several donor routes are aliases, compatibility wrappers, diagnostics, experimental provider adapters, or legacy paths; classify each as keep/adapt/alias/deprecate/remove-later based on callers and behavior. The donor's own `docs/HEARMEOUT_MEDIA_ROUTE_INVENTORY.md` already documents canonical watch-session APIs and legacy aliases and should be consulted before mapping routes.

### Immediate next actions

1. Reconcile P01–P14 with current donor `main`, current Apollo `main`, and the latest test tree.
2. Turn each remaining difference into a child ledger row with exact donor file/route, Apollo module or “missing,” and a decision.
3. Start with P01 room player/media foundation, then provider search/resolution, worker/media delivery, Watch catalog, and Activity/control integrations as dependencies require. Do not blindly follow file order.
4. Keep this draft PR as the audit record until the rows are concrete enough to review. Do not merge a checklist merely to make the ledger look complete; feature implementation and parity evidence are the real completion criteria.


## Current-main revalidation findings (2026-10-27)

The September audit is a starting point, not a current status report. Today's Apollo source has several capabilities that older rows called missing:

- **P01 room player — implemented in source, behavior still needs verification.** `web-server-v3.ts` calls `window.HearMeOutMedia?.mount(wrap,p,lane)`; `room-media-browser.ts` creates native audio/video players per lane, polls room state, syncs sources/position and wires controls. Acceptance must prove two-browser sync, late-join seeking, pause/seek/next, and idempotent advancement. Do not rebuild this solely based on the older audit.
- **P05 music search/resolution — implemented in source, provider parity needs verification.** Room requests use `SpmtHearMeOutSuiteMediaResolver` and execution jobs for search/YouTube resolution. Compare current donor ranking, offline/cache behavior, caller wiring and failure semantics.
- **P06 favorites/library — implemented in source, persistence/ownership needs verification.** Apollo has music library and favorites add/remove/queue routes, core storage, and UI for favorites/recent/most-played. Test user scoping, restart durability, and owned media vs disposable cache.
- **P07 auto-radio — implemented in source, current donor parity needs verification.** Apollo has `auto-radio.ts`, room-scoped radio routes/history and `tests/hearmeout-auto-radio.test.mjs`; include the previously merged radio song-family recovery.
- **P08 Watch catalog — confirmed donor dependency, not parity-complete.** Apollo's `movie-provider.ts` still hardcodes `https://hearmeout-main.fly.dev` for catalog search and HLS; `execution-worker.ts` validates that origin. Port the provider catalog and required series/episode selection into Apollo, plus an Apollo-owned authenticated Xtream source/HLS path. Never expose provider credentials or signed source URLs to browsers.
- **P09 worker — source preserved, integration/cutover incomplete.** The donor's legacy worker runtime is now copied under `apps/hearmeout/legacy-worker/` on this branch, including package lock, Dockerfile, scripts and regression tests. The Dockerfile uses the new directory layout, a test command and cached-dependency workflow were added. The worker is not deployed from Apollo yet; callback contracts, secrets, process groups and persistent volumes still need adaptation. The copied worker's donor URL fallback was removed; it requires explicit `APP_URL`.
- **P10 Activity — implemented in part, end-to-end verify.** Apollo has Activity handshake/room/web, player/broadcast-window code and interaction tests. Verify tenant binding, request/accept/control, provider playback, shared room state and duplicate handling.
- **P02/P03/P04/P11–P14 — partial/verify.** Current source has RTC/moderation, screen-broadcast, voice queue tests, persona jobs and surface integration. Exact donor behavior and production callers still need comparison; helper modules and type definitions do not establish parity.

The current donor has **106** API `route.ts` handlers. See `HEARMEOUT_ROUTE_COVERAGE.md` for the route-by-route checklist and `HEARMEOUT_WORKER_COVERAGE.md` for worker routes/callbacks. These are classification aids, not completion evidence.
