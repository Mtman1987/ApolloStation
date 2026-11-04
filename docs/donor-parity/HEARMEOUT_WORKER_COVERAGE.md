# HearMeOut Worker Route and Callback Coverage

Baseline: current `hearmeout-main/worker/src/server.js` ported to `apps/hearmeout/legacy-worker/src/server.js` in ApolloStation branch `parity/hearmeout-ledger` on 2026-10-27.

This worker is a separate runtime from Apollo's SPMT execution-job worker in `apps/hearmeout/src/execution-worker.ts`. Do not conflate the two. The copied runtime preserves Discord voice, browser/YouTube media preparation, HLS conversion, Lounge, Spotlight and restream capabilities. It is not cutover-ready: its callback contract still contains donor-era API assumptions.

## Ported worker route inventory

| Worker endpoint | Current purpose | Apollo integration / status | Required before donor retirement |
|---|---|---|---|
| `GET /health` | Worker health | PORTED; no app callback needed | Add worker readiness details to ops inventory and verify all process groups |
| `POST /rip`, `GET /music/:videoId`, `GET /stream`, `GET /extract`, `GET /extract/discord-audio`, `GET /watch/youtube/discord-audio/:videoId/stream` | YouTube extraction and audio delivery | PORTED; overlaps Apollo `youtube-resolver`, `prepared-media`, `worker-media-cache` | Decide canonical owner: preserve the working legacy extraction path until Apollo resolver equivalence is proven; then remove duplicate implementation deliberately |
| `GET /offline-music`, `GET/POST/DELETE /offline-music/catalog`, `GET /offline-music/stream`, `GET /cache-stats` | Offline library/catalog and cache diagnostics | PORTED; Apollo has `worker-music-catalog` and `worker-media-cache`, but endpoint contract parity is not established | Compare catalog format, user ownership, file path containment, deletion semantics, cache quotas and durable media across restart |
| `GET /watch/youtube/browser/:videoId`, `POST /watch/youtube/browser/:videoId/prepare`, `POST /watch/youtube/browser/:videoId/:track` | Browser-uploaded audio/video preparation | PORTED; Apollo `prepared-media.ts` calls these worker endpoints | Verify size caps, ownership tenant, no credential leakage, restart behavior and concurrent audio/video uploads |
| `GET /watch/youtube/hls/:videoId/:file`, `GET /watch/youtube/cache/:videoId/stream`, `GET /watch/youtube/cache/:videoId` | HLS delivery and cache | PORTED; Apollo `prepared-media.ts` proxies HLS to same-origin URLs | Validate manifest child rewrites, byte ranges, cancellation, cache bounds and multi-machine routing |
| `POST /watch/cache/control`, `GET /watch/cache/status` | HLS cache prepare/prune/clear/status | PORTED | Ensure only operations are exposed to authorized service principals; verify active jobs cannot be cleared and quotas are enforced |
| `GET /watch/xtream/hls/:streamId/:file`, `GET /watch/xtream/direct/:kind/:streamId` | Xtream HLS conversion and direct/ranged media | PORTED but still calls the donor's `/api/watch/xtream/source` endpoint through `APP_URL` | Implement Apollo-owned credential-protected source resolver; keep provider URLs/passwords server-side; validate range forwarding, HLS/audio tracks, timeout and cache eviction |
| `POST /dj`, `GET /dj` | DJ lifecycle/status | PORTED but callbacks still use donor-era room and LiveKit endpoints | Replace callbacks with Apollo's canonical room, identity and RTC authorities; preserve retry, cleanup, idempotency and worker status |
| `POST/GET /voice-bridge`, `POST /voice-bridge/gate`, `POST /voice-bridge/audio-profile`, `POST /voice-bridge/receive-gain` | Discord voice bridge and receive processing | PORTED; Apollo has `legacy-worker-adapter.ts`, bridge resilience and receive-audio modules | Compare every request/response contract; run PCM gain/jitter/privacy tests and a real multi-person audio acceptance before retiring current worker |
| `GET /spotlight/status`, `POST /spotlight/start`, `POST /spotlight/consent`, `GET /spotlight/program`, `GET /spotlight/hls.js`, `GET /spotlight/hls/:generation/:file`, `GET /spotlight/live.mp4` | Spotlight capture and HLS viewer | PORTED; Apollo has `spotlight-media-bridge.ts` and `spotlight-media.ts` | Verify consent, authenticated source lifecycle, HLS segment access, click recovery and real viewer playback |
| `GET /lounge/media/program`, `POST /lounge/media/actions`, `GET /lounge/music/hls/*`, `GET /lounge/hls.js`, `GET /lounge/status`, `POST /lounge/start`, `GET /lounge/live.mp4`, `GET /lounge/direct/status`, `GET /lounge/direct/hls/*` | Permanent Lounge media renderer and control | PORTED; Apollo has `broadcast-program.ts`, `live-lounge-bridge.ts`, `live-lounge-runtime.ts` and broadcast routes | Move state ownership and all writers to Apollo before switching `LOUNGE_SOURCE_URL`; verify movie/music with sound and autoplay in actual browser source |
| `GET /restream/status`, `POST /restream/start`, `POST /restream/reset` | Restream automation | PORTED; no exact Apollo equivalent established | Explicitly classify as required, shared-owned or intentionally retired; do not drop restream credentials/state without a migration record |

## Donor callback dependencies found in copied worker

The source originally defaulted `APP_URL` to `https://hearmeout-main.fly.dev` and defaulted Lounge source URLs to that donor. The Apollo copy removes that fallback and now refuses to start without an explicit `APP_URL`. This is deliberate fail-closed behavior: **the worker must not silently continue to call the donor after migration.**

The current worker still calls the following donor-era routes and these must be mapped/adapted before cutover:

- `/api/watch/xtream/source/:kind/:streamId` — credential-protected provider URL resolver. Needs an Apollo-owned endpoint; raw provider URLs must never be returned to browsers.
- `/api/auto-radio` — legacy auto-radio callback. Apollo has its own room-scoped `/api/hearmeout/rooms/:roomId/radio` controller and `HearMeOutAutoRadio`; route the worker through the canonical controller or retire this callback only after proving it is unused.
- `/api/db?collection=rooms&id=...` and `POST /api/db` — donor-local database reads/writes. Must be replaced with authenticated Apollo room/media APIs, not copied as a generic database route.
- `/api/livekit-token` — use Apollo's existing RTC gateway, grants and signer; do not duplicate token issuance.
- `/api/discord/bot-token` — use canonical secret/provider connection ownership. Never expose a bot token through an unauthenticated or browser-callable route.
- `/api/lounge-media/program` and overlay URLs — bind to Apollo's program state and public Lounge surface. The copied worker's default `LOUNGE_SOURCE_URL` now derives from the explicit `APP_URL`, not the donor hostname.

Other callback paths and authorization headers must be audited in `server.js` before the worker can be considered independent. A source copy alone is not parity.

## Deployment boundary

- Worker source is now in Apollo at `apps/hearmeout/legacy-worker/`; tests and package lock are retained there.
- `Dockerfile` is adjusted to build from that directory.
- A dedicated GitHub Actions workflow caches this worker's npm dependencies and runs its regression tests.
- The old Fly process-group config is **not** treated as a ready-to-deploy Apollo config. Recreate it under Apollo only after app URL, service routing, process-group ports, secrets, volumes and rollback are explicitly validated.
- Keep the currently referenced worker service running until a replacement has passed automated tests plus real voice, Watch, Lounge and Spotlight acceptance.

## Exit criteria

No donor worker route/callback remains unclassified; all required behavior is implemented in Apollo or its Apollo-owned worker; every retained route has focused tests; no callback defaults to a donor URL; secrets and persistent state have explicit owners; and a staged cutover/rollback rehearsal succeeds. Only then is the worker donor eligible for retirement.
