# HearMeOut parity matrix, in-scope domains (first pass, 2026-10-28)

Scope: HMO-001, 003, 004, 008, 011 (see HEARMEOUT_SCOPE.md). Donor source: `hearmeout-main` `8401114`. Apollo source: `main` `2c5011f`.

Status key: EQUIV = Apollo already covers it (cite evidence); VERIFY = Apollo has a module, behavior not proven; GAP = missing; DECIDE = needs owner call; EXCLUDE = intentionally not ported.

## HMO-001 Auth, roles, room access

| Donor route | Donor behavior | Apollo equivalent | Status |
|---|---|---|---|
| `auth/guest` POST | Creates an anonymous user cookie. In development it maps every visitor to one shared `dev_local_user` | None. Identity comes from SPMT `/v1/session` | DECIDE. Porting it as is would add an anonymous identity path without SPMT's tenant checks. Proposed: EXCLUDE, reason given |
| `auth/logout` POST | Clears session cookie | SPMT owns the session. Apollo does not set its own cookie | VERIFY. Confirm the SPMT logout path ends the Apollo session |
| `auth/spmt/login`, `auth/spmt/callback`, `auth/complete`, `auth/auto-login` | SPMT login handshake | `resolvePrincipal` (web-server-v3) against SPMT `/v1/session` | VERIFY. Tests cover anonymous and non-member refusal (`tests/hearmeout-watch-routes.test.mjs`) |
| `auth/discord/callback`, `auth/twitch/callback` | Provider OAuth callbacks | `discord-adapter.ts`, `discord-activity-handshake.ts`. No Twitch OAuth in Apollo | VERIFY Discord. DECIDE Twitch. Twitch login may not be needed if SPMT provides identity |
| Room membership, join, leave, moderation | `rooms/:id/join`, `leave`, `moderation` | `web-server-v3.ts` routes plus `requireMembership` | EQUIV in code. Tenant isolation tested in `tests/hearmeout-byte-range-and-room-scope.test.mjs` (PR #284) |

## HMO-003 Lounge, media, queue, recovery

| Donor route | Apollo equivalent | Status |
|---|---|---|
| `lounge-media/start`, `status`, `program`, `live.mp4` | `spotlight-media.ts`, `spotlight-media-bridge.ts`, `live-lounge-bridge.ts`, `live-lounge-runtime.ts` | VERIFY. Donor `spotlight-media/*` (consent, current, start, status, live.mp4) matches Apollo `spotlight-media` routes. Needs a consent and live-stream test |
| `lounge/theme-music`, `offline-music`, `dj`, `room-admin`, `room-expiry`, `presence/prune` | `auto-radio.ts`, `room-media-*`, presence in `lounge-room.ts` | VERIFY. Queue and recovery covered by existing `hearmeout-voice-queue` and room-media tests. Playback recovery after restart not yet proven |
| `music/session/request`, `control`, `state`, `favorites` | `/api/hearmeout/music/favorites`, `rooms/:id/media/music`, `/media/music/control` | EQUIV in code. VERIFY queue idempotency for music enqueue (only movie enqueue is tested) |

## HMO-004 YouTube and providers

| Donor route | Apollo equivalent | Status |
|---|---|---|
| `watch/youtube/resolve` | `youtube-resolver.ts` (`HearMeOutYoutubeResolverCoordinator`, stages cache, yt-dlp, youtubei, browser, chromium) | VERIFY. Stage fallback order and failure messages need a provider failure matrix |
| `watch/youtube/hls/[videoId]/[file]` | `prepared-media.ts`, `watch-hls-policy.ts` | VERIFY. HLS segment serving covered by PR #300 test (Xtream path). YouTube HLS path not yet tested |
| `watch/youtube/player`, `watch/youtube/upload` | `youtube-browser.ts` (`prepareHearMeOutYoutube`) | VERIFY. Upload path has no Apollo equivalent found. DECIDE whether upload is in scope |
| `youtube-audio/*`, `youtube-video/proxy`, `youtube-proxy` | Byte-range helper `parseHearMeOutByteRange` in `youtube-resolver.ts` (PR #284 test). No proxy route found in web-server-v3 | VERIFY. Confirm whether proxying runs through `prepared-media` or is absent. Donor proxies must not leak provider URLs |
| `watch/youtube/*` credential handling | `writeHearMeOutYoutubeCookiesBase64`, cookie path `/data/youtube-cookies.txt` | EQUIV in code. Covered by credential tests in PR #283 |

## HMO-008 Watch and Xtream

| Donor route | Apollo equivalent | Status |
|---|---|---|
| `watch/search`, `watch/catalog`, `watch/service`, `watch/activity-default` | `/api/watch/search`, `/api/watch/activity-default` (web-server-v3), `watch-runtime.ts` | EQUIV in code. Request/accept routes tested in PR #301 |
| `watch/sessions/:id/request`, `accept`, `state`, `control`, `quick-control` | `/api/hearmeout/rooms/:id/watch/request` and `/watch/accept`. `control` and `state` are routed through `/media/movie/control` and `/broadcast/movie/:id` | VERIFY `state` and `quick-control` have no direct equivalent |
| `watch/xtream/hls/[streamId]/[file]` | `xtream-hls.ts`, `/api/watch/xtream/hls/` route | EQUIV. PR #300 tests segment and traversal |
| `watch/xtream/source`, `direct-test`, `status` | `xtream-provider.ts`, `xtream-hls.ts` | VERIFY. `direct-test` and `status` are diagnostics, DECIDE whether needed |
| `watch/proxy` | Not found in Apollo | DECIDE. Check whether it is a generic media proxy that would leak credentials. Likely EXCLUDE |
| Internet Archive fallback | Not ported | EXCLUDE (owner decision, see gap doc) |

## HMO-011 API contracts

Donor has about 106 `route.ts` files. Apollo's HearMeOut API is about 30 endpoints dispatched in `web-server-v3.ts`, `web-server-v2.ts`, and `discord-http.ts`. Per-route contract tests have not been written. This matrix does not yet cover request validation, origin checks, size limits or error shapes per route. That is the next step once the DECIDE items are resolved.

## Open decisions for the owner

1. Guest login (`auth/guest`): propose EXCLUDE. Apollo identity stays with SPMT.
2. Twitch login (`auth/twitch/callback`): is Twitch login needed for HearMeOut, or does SPMT cover it?
3. YouTube upload (`watch/youtube/upload`): in scope or excluded?
4. `watch/proxy` and `youtube-*/proxy`: confirm exclusion or port.
5. Donor diagnostics (`xtream/direct-test`, `xtream/status`): include or exclude?

## Owner decisions (2026-10-28)

1. Guest login (`auth/guest`): PORT, behind SPMT. No Apollo-local anonymous identity. Guest sessions must come from SPMT and carry its tenant checks. The donor's shared `dev_local_user` behavior is NOT ported.
2. Twitch login (`auth/twitch/callback`): PORT.
3. YouTube upload (`watch/youtube/upload`): EXCLUDE.
4. Proxy routes (`watch/proxy`, `youtube-audio/proxy`, `youtube-video/proxy`, `youtube-proxy`): PORT. Required tests: no provider URL, cookie, or credential in any response, and origin checks on every proxy route. The matrix reviewer had recommended EXCLUDE for leak risk. The owner chose PORT, so the leak tests are mandatory.
5. Diagnostics (`xtream/direct-test`, `xtream/status`): PORT. They must not return credentials or raw provider URLs.

## Blockers found while starting the decided ports (2026-10-28)

- **Guest login (behind SPMT):** SPMT in this repo exposes only `/v1/session` and `/v1/auth/service-token`. No guest-session endpoint exists here. Porting needs either an SPMT endpoint (lives in the SPMT repo, not this one) or an owner decision to accept an Apollo-owned guest session, which conflicts with "behind SPMT". BLOCKED on owner.
- **Twitch login:** needs Twitch client ID and secret, plus a redirect URI for Apollo. Will request via ask_secrets. Blocked until the secrets are provided.
- **Proxy routes (4) and diagnostics (2):** decided PORT. Not started. Donor routes to read first: `watch/proxy`, `youtube-audio/proxy`, `youtube-video/proxy`, `youtube-proxy`, `xtream/direct-test`, `xtream/status`.
- **YouTube upload:** EXCLUDED.
