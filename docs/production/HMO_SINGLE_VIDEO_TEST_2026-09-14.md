# One video, independent viewing windows

Owner clarification, September 14, 2026: the immediate acceptance target is exactly one server video broadcast. Every explicitly opened HearMeOut and Discord media window watches the same feed, regardless of its viewing location. In HearMeOut, create or join a room first, then open the clapper. Closing all windows does not pause or restart it. A room never owns this program's lifetime. Multiple selectable videos, with at most one selection per viewing room, are a later step after this proof works.

The release test activates a standalone durable program. Its queue, clock and encoder lease have no room foreign key or room expiry. The existing encoder and HLS player are reused; no hidden room is created. Opening a window is read-only. Public requests retain guest/provider attribution and use the operator's existing SPMT execution account, supplying the missing billedUserId that caused the reported HTTP 400. Private room content and host playback controls retain their existing access boundary.

The old machine-owned Discord Activity room is retired only on this approved test deployment. The live donor HearMeOut and production Discord mapping are not changed. The developer Activity URL override is /activity on the test Sprite; /watch is the same broadcast in a website window. Native HearMeOut room watch panes embed /watch. Music/movie legacy Activity URLs resolve to that same program during the test.

Verification added:

- A program runs with zero room records, survives deleting both public/private viewing rooms and reopening its database, and retains 30 seconds of a 210-second item after 180 seconds.
- A guest HTTP request passes through real authenticated SPMT execution jobs and the media worker without creating an Apollo user or joining any room. Request retries do not duplicate jobs or queue entries.
- All Activity aliases and ordinary native room views reference the same program. Private native room content remains protected.
- Browser playback checks cover one encoder, local volume and zero-volume silence, closing all windows, deleting the only viewing room, and reopening on the advancing broadcast.
- Release verification reads the program without starting a video or creating a room. An idle program stays blank until a viewer submits a request.

This does not claim complete provider/catalog parity or actual acceptance inside the tester's Discord client. CI and Sprite deployment evidence must be checked for each deployed commit; implementation text alone is not readiness.


Owner test feedback and correction, September 14, 2026:

- HearMeOut starts at Create Room / Browse Rooms. After joining, the participant card's clapper opens the music/movie window and its request bar. There is no player or feed fetch before that click. An idle program displays a blank video area.
- Closing the clapper, navigating to the directory/home, switching rooms, leaving, or deleting the viewing room destroys that local iframe. Native room binding does not instantiate the old hidden music and movie players when the single program is active.
- The selected request type reaches the existing resolver, while both types still share one program/queue. Deleting a viewing room leaves that program advancing. A new room is silent until its clapper is opened.
- Routine shell snapshots repeated host.hello. HMO republished its manifest each time; the shell re-opened the remembered Rooms page, which cleared the room console. HMO now publishes once per launch in each document, retaining initial/reloaded-document handshakes. Visibility/online recovery renews presence without rejoining.
- Deployment verification never queues a video. A narrowly scoped, idempotent cleanup removes only the exact deployment sample request seeded by PR #107; even a viewer request for that same URL is retained.
- Regression coverage includes the actual mobile HMO UI inside the AppFrame bridge, a typed request producing real HLS video, 100 seconds of recurring shell snapshots, and the complete close/delete/create/reopen sequence. Provider adapters use a local media fixture in this browser test; the existing HTTP integration test exercises real SPMT jobs and the media worker. Actual provider availability and Discord client acceptance remain distinct from those checks.

Development allowance correction, September 14, 2026:

- The reported request failure was `409: Free hosted-worker-minutes allowance reached`. The SPMT sandbox had applied the production free-plan allowance to the broadcast execution account. Each metadata search/resolve job currently records one hosted-worker-minute unit; that counter does not represent 30 minutes of watched video.
- The existing server `sandbox` runtime now records usage without enforcing plan allowances. Plans, historical usage and request replay records are retained. Production continues to enforce the canonical plan limits; request parameters cannot select development billing.
- Account usage identifies development mode and shows recorded counts without exhausted-plan bars. Release verification checks the public sandbox health report for `usageLimitsEnforced: false` without starting media or exporting private usage records.
- Paired production/sandbox HTTP tests exercise real SPMT jobs and the HMO worker at the free-plan boundary. The sandbox accepts the next request and records unit 31; production reports the specific 409. Replays produce no duplicate jobs or usage. A SQLite restart test verifies existing exhausted usage is retained.

Discord request and playback follow-up, September 14, 2026:

- The user changed the Activity root mapping to the Apollo Sprite and reached its player. Apollo ingress compared Discord's iframe Origin to the rewritten Sprite Host and returned `cross_origin_request`. The existing server-configured Activity client ID now authorizes only its exact HTTPS `discordsays.com` origin on the public broadcast-request POST route. Private room and account writes retain their existing origin checks. Viewer cookies support partitioned iframe storage.
- Idle state polling no longer clears an already empty media element. Playback promises are coordinated; a source-change AbortError does not become a user-facing media failure. Requests have an in-flight guard, successful POST state cannot be overwritten by an older poll, and known failed requests receive a fresh retry key. Network-uncertain retries retain their original key.
- Real-browser regression covers enabling sound while idle, a reported provider failure, and a rapid double submission on retry, followed by actual HLS playback and the existing sustained room-presence checks.
- Prepared-worker HTTP failures now retain a predefined source/authentication failure category instead of always reporting `No safe media source`. A release probe requests the fixed public Blender video `aqz-KE-bpKQ` through the existing media adapter and records only readiness, an error category and HTTP status. It never queues a broadcast video or exports configuration, credentials, source URLs or user records. Provider readiness must be evaluated separately from deployment success.

IPTV search and selection correction, September 14, 2026:

- The owner clarified that movie titles must search the existing IPTV account and show possible matches before the viewer selects one. The previous suite resolver sent typed movie queries through music/YouTube search and selected its first result. The deployed donor has a separate IPTV catalog/search route.
- Apollo now submits `hearmeout.movie.search` and `hearmeout.movie.resolve` through the existing HearMeOut execution worker. The adapter reuses `https://hearmeout-main.fly.dev/api/watch/search` and its existing prepared IPTV HLS routes; provider credentials stay in the existing live service. This remains a provider bridge dependency on that service.
- A typed movie request shows the returned VOD titles, years and available quality labels. Search never queues or starts a movie. Selecting a title passes its provider item ID with the query; the worker checks that result and prepares only that selection. The existing program, guest attribution, execution account and retry rules remain in use. Direct media/YouTube links and music requests keep their respective paths.
- Current scope is IPTV movie/VOD selection. Series/episode browsing and the missing YouTube browser-assisted preparation are not claimed complete. The existing donor browser path passes media URLs and cached audio, not a YouTube session token from localStorage. Its `hmo_user_id` is only a generated viewer identifier.
- PR #113 deployed successfully as `9d07f86e1fc0ee4f65d672e5adbb0b58b9149991` and verified the public Discord request origin at 2026-09-14T09:02:48Z. Its actual fixed-source check returned `provider-denied`, HTTP 502, for unaided YouTube preparation. Successful web deployment is therefore not complete media readiness.
- The movie release check only verifies that a fixed-title search receives a valid response. It prints no returned titles, identifiers, catalog counts or provider credentials, and does not select or queue anything. Actual selected-title availability still depends on the IPTV provider.

Cached-audio buffering correction, September 14, 2026:

- The owner confirmed that worker-cached audio plays, but stalls repeatedly. A real cached-audio HLS fixture reproduced a stall when one viewer segment was delayed five seconds: the four-second live offset provided too little headroom. Merely increasing the live offset also failed when the viewer opened a freshly started broadcast before enough segments existed.
- Broadcast HLS now uses complete segments, an eight-second target offset and four initial segments before starting. It retains a playback rate of 1 and no forced maximum-latency catch-up. Native return-to-live also retains eight seconds of headroom. This trades a short startup buffer for tolerance of segment delivery delays.
- A real-browser regression covers cached audio through the existing authenticated prepared-media adapter and one real Apollo encoder. A five-second segment delay produces no waiting/rebuffer event or rate change, both with an established feed and after the startup correction. The startup case is retained in CI. The existing two-language, independent-volume and close/reopen browser test also passes.
- This addresses a reproduced delivery problem. It does not resolve new YouTube sources that the provider refuses, and it does not claim immunity to longer network interruptions or sustained encoder overload.

Sprite validation load correction, September 14, 2026:

- Both the PR and merged-main CI runs passed for the buffer correction. Sprite promotion of `9bcf6f64b83a394c7f662d392463f98fe3c20449` then hit a supervised-app startup timeout. One retry passed that check but failed two media tests that required a new two-second segment after a fixed 2.2/2.5-second sleep.
- Sprite validation now runs the same complete test file set with Node test concurrency 1. This bounds simultaneous test servers and encoders on the shared test machine; no test is skipped and the ten-minute release gate remains.
- The two media tests poll actual segment progress with an eight-second upper bound. They still require the same encoder to advance while no members are present. The private-room test observes its generated fixture playlist before rejoining, so joining cannot manufacture the progress being asserted.

Public-entry and HTML-response correction, September 14, 2026:

- Sprite run 34830018914 passed all 1,126 tests, activated `7a0af5173e96f6970d1acd81fbe2e26c503a6714`, and passed internal verification at 09:58:22Z. The public health request timed out, and the workflow's error trap restored the Sprite organization login wall. The owner subsequently reported an HTML document being parsed as JSON while preparing a request.
- Public verification still fails on an unsuccessful check, but no longer changes the owner's approved public entry into an organization login page. Existing Apollo account/private-room assertions remain before and after opening. Read-only transport failures receive at most two retries; HTTP/authentication assertions and writes are not retried.
- The player checks for JSON before parsing. Unexpected or malformed responses show a retryable service error, release the Request button and clear the Preparing status. An unconfirmed response retains its request operation key to avoid duplicating an accepted request. The actual browser regression exercises an HTML response, a known provider failure and a rapid double-click retry before real playback.
- Real-provider limitations remain: the unaided YouTube probe returned provider-denied/502, and the new IPTV search probe returned HTTP 401 because the live search route requires its website session. The picker UI and buffer fix do not establish provider readiness. A service-authenticated catalog bridge and browser-assisted YouTube preparation remain unfinished.
