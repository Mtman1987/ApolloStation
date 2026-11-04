# HearMeOut Discord Activity startup repair

Live source: `Mtman1987/hearmeout-main`, repair `a1d37e214244ac4771d867a8c5880592a1c41f4b`, deployment gate repair `76d0287c1461f65e213179b621ac38e8bdfbeea5`.

## Confirmed failure

Unauthenticated production requests returned a 307 from `/activity` to `/login?next=%2Factivity`, and 401 from both `/api/watch/sessions/discord-music-room/state` and `/api/activity/hls`. Root launches containing `frame_id` also redirected to login. Discord cannot supply the user's separate HearMeOut website cookie. The bot could still enqueue and play music while the iframe was stuck in the account shell.

The live fix makes only the shared Discord session routes and playback resources available without that cookie, rewrites root Activity launches directly to the standalone player, keeps the legacy redirect relative to Discord's origin, avoids external-origin API fallback and browser YouTube uploads inside Discord, and bounds polling requests. Private room sessions and account/admin routes remain authenticated. The production image now runs the actual middleware/generated-player regression tests. A pre-existing nullable fallback value and a stale TTS participant-list assertion also blocked deployment and were repaired.

## Apollo port

Apollo has a different server, no Next middleware, and tenant-isolated room state. `activity-web.ts` is wired into the actual `createHearMeOutWebServer` request handler before account APIs. `/activity`, `/activity-lite`, and root launches with `frame_id` render the standalone handshake/error surface without a website session. The shared state endpoints read the existing `SqliteHearMeOutRoomMediaRuntime`; they do not create another queue, initialize rooms on GET, impersonate a host, or accept a tenant from URL parameters.

Deployment must bind the public Activity to its community using `HEARMEOUT_ACTIVITY_TENANT_ID` and `DISCORD_CLIENT_ID`. Without that binding, the player displays a connection error and the state endpoint returns 503. Initialize the existing public system room through the authorized admin/Discord interaction path. Do not choose the first available tenant as a fallback.

The port supplies shared movie/music selection, synchronized native playback, queue display, local mute and reconnect. Queue mutations continue through existing authenticated room APIs and Discord command/interaction adapters. It does not claim parity with every control or provider in the donor player. Public media capability URLs use Apollo's existing same-origin `/v1/media/public/` proxy; other providers still need their Discord URL mappings and supported media rendition validated during cutover. No live Discord mapping or Apollo deployment was changed by this port.

## Verification

- Live: production build, typecheck, 4 Activity startup tests, and 26 required voice/persona tests.
- Apollo: `node node_modules/typescript/bin/tsc -b apps/hearmeout`.
- Apollo: `node --test tests/hearmeout-discord-activity.test.mjs tests/hearmeout-room-browser-parse.test.mjs tests/hearmeout-room-media.test.mjs tests/hearmeout-discord-interactions.test.mjs`.
- Regression coverage checks the exact same request/playback before and after a canonical pause, tenant isolation, no-cookie startup, no room creation on GET, and generated JavaScript/handshake behavior.

An actual Discord client launch after deployment is still the final check of Discord's configured URL mappings and Electron playback. A regular browser or mocked handshake is not equivalent to that check.
