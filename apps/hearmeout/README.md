# HearMeOut

**Workspace:** @spmt/hearmeout  
**Location:** apps/hearmeout  
**Runtime surfaces:** authenticated watch/voice web app, Discord Activity, RTC transport broker, durable execution worker, and a migration-era DJ/voice worker adapter.

## 1. Product responsibility

HearMeOut owns synchronized watch/media rooms, playback queues and state, music/movie selection, Discord Activity integration, voice/persona audio, screen broadcast, LiveKit/WebRTC/relay transport selection, and room-scoped media/voice workflows.

SPMT owns canonical identity, tenant membership, shared events/jobs, provider grants and shared XP. HearMeOut owns its room, membership, playback, queue, media, voice-bridge and product-specific state.

## 2. Runtime composition

| Module | Responsibility |
|---|---|
| src/index.ts | App manifest, catalog registration and public exports |
| src/web-server-v3.ts | Current production web host, room APIs, browser routes, media/voice integrations |
| src/room-media-core.ts | Room/media/queue domain model and persistence |
| src/watch-runtime.ts and watch-state.ts | Watch request/playback state and room progression |
| src/watch-hls-policy.ts, xtream-hls-route.ts, xtream-hls.ts | HLS URL policy, route handling and stream delivery |
| src/xtream-provider.ts | IPTV/Xtream catalog search and resolution |
| src/movie-provider.ts | Movie catalog adapter; default Apollo path uses local Xtream catalog resolution |
| src/execution-worker.ts and execution-worker-start.ts | Durable music/movie search and resolution worker |
| src/prepared-media.ts and worker-media-cache.ts | Prepared media and bounded worker cache |
| src/youtube-resolver.ts and youtube-browser.ts | YouTube resolution/browser integration |
| src/discord-http.ts and discord-interactions.ts | Discord HTTP and interaction endpoints |
| src/activity-contract.ts, activity-room.ts, activity-web.ts | Discord Activity contract and room/browser integration |
| src/livekit-grants.ts and livekit-signer.ts | LiveKit grant/signing behavior |
| src/spmt-rtc.ts | Provider-independent RTC transport broker and fallback policy |
| src/spmt-rtc-relay.ts and spmt-rtc-socket-adapter.ts | WebSocket relay and socket adapter |
| src/rtc-room-gateway.ts and rtc-browser.ts | Room RTC gateway and browser client |
| src/voice-bridge.ts and voice-bridge-resilience.ts | Discord voice bridge control and recovery |
| src/discord-receive-audio.ts | Discord receive-audio gain and handling |
| src/persona-room.ts, persona-conversation.ts, persona-audio.ts | Room personas, conversation and audio |
| src/room-persona-routing.ts and room-persona-speech.ts | Persona routing and speech publication |
| src/suite-action-worker.ts and suite-action-executor.ts | Durable typed bot/room actions |

The current web host is web-server-v3.ts. Earlier web-server.ts and web-server-v2.ts are historical versions; do not route production back to them without an explicit regression/rollback reason.

## 3. Media and playback flow

1. A signed-in user creates or joins a tenant-bound room.
2. The room authority tracks membership, queue, current item, playback position and control state.
3. Media search/resolve requests become durable SPMT execution jobs.
4. The HearMeOut worker resolves approved music/movie sources and stores bounded prepared media/cache state.
5. Browser clients receive authorized playback URLs and synchronized room state.
6. Pause/resume/seek/skip changes are reconciled against the room's canonical playback state.
7. Late joiners and reconnecting clients rehydrate from the room state rather than trusting stale local browser state.

IPTV/Xtream search and HLS routes must validate source IDs, origin, path, query parameters and machine identifiers. Do not allow arbitrary URL proxying.

## 4. Voice and RTC flow

HearMeOut uses a transport broker that selects a room-wide realtime transport only after an adapter proves a successful connection. Supported transport kinds include LiveKit cloud/self-hosted, peer WebRTC and WebSocket relay.

The broker classifies rate limits, quota exhaustion, unavailable, auth, network and unsupported failures, applies cooldowns, and keeps room-wide transport preference stable. Transport selection is not room authority; room membership and playback remain in HearMeOut.

Discord bridge receive-audio, persona speech and local companion wake paths are separate capabilities. Verify audio in both directions in the actual browser/Discord path; a changing avatar or successful outbound stream is not proof that inbound Discord audio is audible.

## 5. Legacy worker boundary — active migration debt

apps/hearmeout/legacy-worker is a separate Node package with its own dependencies and validation workflow. The current HearMeOut web server imports legacy-worker-adapter.ts for voice bridge and persona publishing. This is therefore not dead code yet.

The adapter exposes bounded authenticated worker routes and intentionally does not receive provider refresh tokens. It can be removed only after the voice bridge and persona audio worker are fully native to Apollo, the same room/queue authority is preserved, and live bidirectional audio acceptance passes.

The legacy worker has a heavier dependency set (Discord voice/Opus, native RTC/WebRTC, Puppeteer, ffmpeg-related media, and YouTube tooling). Keep it out of the web request path. A future extraction into a separately managed Apollo-owned media/voice worker is preferable to bundling it into the shell.

## 6. Known retired donor-origin dependency

src/donor-origin.ts still defaults HEARMEOUT_DONOR_DEFAULT_ORIGIN to the old hearmeout-main Fly URL. live-lounge-bridge.ts uses that origin for the Lounge bridge, and movie-provider.ts retains a legacy-origin adapter for compatibility tests.

This is an active migration dependency, not dead code. It must be replaced by an Apollo-owned internal HearMeOut route/worker origin and explicit Hostless configuration before HearMeOut can be called donor-independent or Fly-free. Do not simply delete the bridge or default without migrating the Lounge read/control behavior and testing playback/queue state.

## 7. Persistence and ownership

HearMeOut owns private room/media/queue/voice state. SPMT owns identity, provider grants and shared jobs/events. The legacy worker is an execution adapter only; it must not become a second room or playback authority.

The current source includes SQLite-backed room/media stores, prepared-media/cache files, and durable execution job interfaces. Verify the effective Hostless paths and remote adapter before assuming data survives restart. Local /tmp paths are disposable, not durable production storage.

Before moving media/room data, record the source store, schema, owner, counts, backup/integrity result, restore test, and rollback.

## 8. Configuration

Exact runtime configuration is injected by the Hostless launcher and the worker configuration. Relevant variable families include:

- SPMT origin, service credential and worker identity;
- HearMeOut database/media/cache paths and worker runtime config;
- HEARMEOUT_DONOR_ORIGIN (legacy; must be replaced before donor-independent production);
- WATCH_PROXY_ALLOWED_HOSTS;
- LiveKit server URL/API key/secret and browser token grants;
- RTC transport enablement and relay origin;
- Discord application ID/public key and bot/voice bridge credentials;
- media worker ffmpeg/ffprobe and YouTube resolver settings;
- allowed media source origins and prepared-media cache controls.

Never put provider tokens, LiveKit secrets, Discord bot tokens, worker authorization or media-source credentials in browser code, URLs or logs.

## 9. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/hearmeout

The HearMeOut build also runs scripts/build-rtc-browser.mjs to produce the RTC browser artifact.

The separate legacy worker has its own locked dependencies and test command, invoked by .github/workflows/hearmeout-legacy-worker-validation.yml. Do not remove its package-lock or workflow until the adapter no longer imports it and its behavior has been replaced.

Focused tests cover room/media state, playback synchronization, movie provider/HLS security, worker media cache, persona audio, Discord Activity, RTC broker/fallback, voice bridge resilience, and persistent cutover behavior.

## 10. Security and reliability

- Tenant, room, membership and actor are validated on every state-changing action.
- Media URLs are allowlisted; redirects, embedded credentials and unapproved paths are rejected.
- HLS proxying is bounded and cannot be used as an arbitrary URL fetcher.
- Discord Activity and interactions validate signed/session context.
- RTC tokens are short-lived and scoped to the room/user/purpose.
- Voice bridge requests use authenticated bounded routes with no credentials in URLs.
- Playback mutations are idempotent and reconcile expected request IDs.
- Worker jobs use leases/fencing and bounded retries.
- Logs and diagnostics never contain provider tokens, cookies, raw session values or full private media URLs.

## 11. Performance guidance

- Keep media decoding/transcoding and browser automation in the worker process.
- Bound HLS segment and playlist size, media cache size, queue history, room events and worker downloads.
- Avoid polling the room state faster than the synchronization contract requires.
- Reuse prepared media and cache only rebuildable data with explicit invalidation.
- Avoid loading both old and new web-server versions in production.
- Keep RTC browser code in its dedicated built artifact, not duplicated across app bundles.
- Measure media start latency, playback drift, RTC connection success, worker queue depth, cache hit rate and memory.

## 12. Acceptance checklist

- [ ] Owner can sign in and create/join a HearMeOut room.
- [ ] Configured IPTV/Xtream catalog search returns possible matches before selection.
- [ ] Selected movie resolves through the Apollo-owned HLS route and decodes in the browser.
- [ ] Pause/resume/seek remain synchronized across participants.
- [ ] Late join and reconnect recover the correct current playback state.
- [ ] Music/YouTube jobs complete through the durable worker.
- [ ] Discord Activity and room invitations work with the intended guild/tenant.
- [ ] Voice audio is audible in both directions where configured; avatar changes alone do not count.
- [ ] RTC transport fallback works without splitting a room across transports.
- [ ] Legacy voice worker is either accepted as a bounded temporary dependency or replaced by Apollo-native workers.
- [ ] No Fly donor origin is required for Lounge or movie playback.
- [ ] Room/media/worker state survives restart and isolated restore.
