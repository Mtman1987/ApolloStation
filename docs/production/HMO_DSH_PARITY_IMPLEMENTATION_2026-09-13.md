# Approved HMO and DSH implementation — 13 September 2026

All 58 review rows and all 33 work packages are approved. This record distinguishes authorization from working code and live deployment. No further batch approval is required.

Source baseline: Apollo `8ecd34b748bea47fbb718955a86c4d48509dc9bf`. The donor comparison and full authorization are in `docs/donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md`.

## Implementation evidence

| Package | Approval | Implementation status |
|---|---|---|
| P01 | Approved | Room broadcast model clarified by owner: one HMO playout per room/lane; viewers join the live feed. Volume is local, and silence sets volume to zero without pausing. Room clock and zero-viewer queue advancement implemented; see current continuation and P09 acceptance. |
| P02 | Approved | Unban, persistent server mute/unmute, room move and People/room moderation controls implemented. Real relay enforcement, re-entry, move isolation and cleanup tests pass. Live cloud moderation still needs provider acceptance. |
| P03 | Approved | Native FIFO waiting queue, owner admission, five-minute invitations, removal/revocation and retryable Commlink notification implemented. Privacy, duplicate admission and expiry cleanup tested. Discord entry/delivery remains P10. |
| P04 | Approved | Screen capture, remote viewing and optional shared-system audio wired into existing cloud/peer RTC, including peer video alongside fallback voice. Reuses the established configurable SPMT relay capacity instead of the eight-connection override. GitHub browser acceptance passed in run 34729947698, including received screen pixels alongside fallback voice. |
| P05 | Approved | UI and suite actions now share title/artist search and YouTube resolution jobs; current capable worker selection replaces the fixed Fly assumption. Added yt-dlp search, tenant-scoped production catalogs, stable retry keys and query UI. API/provider-adapter tests pass. Live provider activation and media delivery remain unverified (P09/P33). |
| P06 | Approved | User-scoped saved music, removal, pagination, recent/most-played records and enqueue-from-favorites implemented. Saved music is reachable from the home page with zero rooms and survives room expiry. Isolation, replay counting and deletion tests pass; the real home-page browser test lists and removes favorites with zero rooms. Donor favorites data transfer remains P33. |
| P07 | Approved | Room-owned auto-radio controller, shared Stellar recommendation call, durable history, manual queue priority, controller leases and late-result fencing implemented. Checkpoint f36191b passed GitHub CI run 34731644459, including the radio concurrency tests and required RTC/media/console browser checks. Live provider acceptance remains outstanding. |
| P08 | Approved | Approved; implementation remains outstanding. |
| P09 | Approved | Native room broadcast worker, live HLS windows, alternate audio, zero-viewer clock, process fencing and saved-YouTube re-resolution implemented. Full source/catalog/download/cache parity and production provider acceptance remain outstanding. |
| P10 | Approved | Signed HTTP interaction endpoint mounted; canonical owner identity, request-song aliases, room queue entry, slash requests and shared-chat !wr/!sr jobs connected to the Activity. Production bindings/command registration and remaining Discord invitations/panels require acceptance. |
| P11 | Approved | Production bot commands use the current shared public gallery/community descriptor and the same room persona store as the UI. An actual SPMT suite job adds/removes the UI persona by name/alias. Service reads expose public metadata only; speech/identity and deleted-room tests remain passing. |
| P12 | Approved | Approved; implementation remains outstanding. |
| P13 | Approved | Approved; implementation remains outstanding. |
| P14 | Approved | Approved; implementation remains outstanding. |
| P15 | Approved | Saved group routes, polling, templates and Spotlight enable/disable drive the running worker. Old-channel message cleanup and invalid-setting rollback tested. Signal and rendered-media setting consumers depend on P18/P19. |
| P16 | Approved | Web and suite decisions share templates, agreement offers and a durable DSH notification outbox. Failed delivery retries in the supervised worker; retry preserves the link/nonce. Concurrent delivery claims, restart, same-name command replay, agreement acceptance and simulation isolation tested. |
| P17 | Approved | Temporary guest targets now use the DSH monitor, existing live outbox and Discord message store. Shared Twitch grants resolve untracked creators without creating permanent members or fabricated identities. Offline posts expire after one hour; live guests refresh every ten minutes and expire after a continuous twenty-minute offline grace. UI and suite posting/removal, restart retries, concurrent delivery leases and late-message cleanup are wired and tested. Real provider production acceptance and media producers remain outstanding. |
| P18 | Approved | Approved; implementation remains outstanding. |
| P19 | Approved | Approved; implementation remains outstanding. |
| P20 | Approved | Approved; implementation remains outstanding. |
| P21 | Approved | Approved; implementation remains outstanding. |
| P22 | Approved | Typed hourly Raid Train reservations share the existing calendar and publication worker. Atomic claims, identity-bound cancellation, native web controls, shared suite actions, existing Discord button aliases and calendar artwork are implemented. Separate-process contention, restart publication, stale cancellation, tenant/guild isolation and web/chat/Discord integration tests pass. Live Discord acceptance remains outstanding. |
| P23 | Approved | Twitch schedules now resolve the existing SPMT provider identity and grant, retain successful snapshots during outages, and share the DSH calendar/image renderer. Native custom events, web controls, donor button aliases, tracked publication and restart refresh are implemented and tested. Private Google iCal imports and full partner forum-thread setup remain outstanding; live provider acceptance is pending. |
| P24 | Approved | Approved; implementation remains outstanding. |
| P25 | Approved | Moderation controls under DSH Settings now create exact message selections through shared suite jobs and the real Discord grant adapter. Bot/all/until scopes, durable previews, selected-ID execution, resumable partial deletion, server validation and job/plan leases are wired. Simulation and runtime read-only modes cannot execute live deletion. Six integration tests cover scope, newer-message preservation, restart/retry, concurrency, adapter grants, shared jobs and authenticated web controls. No live channel cleanup was performed. |
| P26 | Approved | Approved; implementation remains outstanding. |
| P27 | Approved | Native linking-panel publication and repair, destination recovery, signed donor button aliases and private SPMT setup links are wired. Community enrollment reuses the canonical account/ticket service and keeps each member separate from the workspace owner. New/returning members, conflicting provider identities, stale links and deleted channel/message recovery are tested. Cross-account conflicts retain the existing explicit recovery requirement; production OAuth acceptance remains pending. |
| P28 | Approved | Native member directory now reads tenant membership and active provider references from canonical SPMT accounts, pages actual Discord members/roles, and resolves current Twitch names by immutable ID. Existing role groups and routes feed the monitor, suite commands, partner calendars and Members UI. Owner settings, role changes, joins/leaves, unlinks during provider outages, restart, paging and lease fencing are tested. Donor membership/role-map transfer and live provider acceptance remain P33. |
| P29 | Approved | Approved; implementation remains outstanding. |
| P30 | Approved | Approved; implementation remains outstanding. |
| P31 | Approved | Shared Commlink ingress emits idempotent message metadata events without a second message history. Forward event pagination and DSH durable cursors feed the Members view with actual message counts, distinct UTC active days and last-seen channels. Bursts, restart, duplicate delivery, delayed messages, tenant boundaries and canonical identity resolution are tested. Unmeasured metrics remain null; historical donor totals remain P33. |
| P32 | Approved | Approved; implementation remains outstanding. |
| P33 | Approved | Approved; implementation remains outstanding. |

## Validation

- `npm run test:offline`: 1,099 passing, zero failures (full offline suite including the member directory and its running consumers).
- `scripts/test-hmo-media-browser.mjs`: two independent Chromium contexts with actual decoded audio and canonical room state.
- Required contracts/RTC CI now includes the room-media browser test.
- Existing room expiry and donor-bridge recovery tests remain passing; deliberately deleted rooms were not reimported.

## Deployment

Implementation is saved in draft PR #99 (`approved-hmo-dsh-parity`). Checkpoint `a4359e0` passed required GitHub contracts and RTC/media browser CI in run `34729277608`. Checkpoint `6e40e87` passed run `34729947698`, including real screen pixels, decoded RTC/media audio and the actual home-page library. Checkpoint ae91c0b passed run 34731200815; f36191b passed run 34731644459. P17/P22 checkpoint a7e3801 passed all 1,074 local offline tests and required GitHub contracts/RTC/media/console browser checks in run 34736435460. P25 checkpoint b582e2 passed all 1,080 local offline tests and required GitHub checks in run 34736953904.

This implementation checkpoint has not replaced live HMO or DSH. Public traffic replacement follows completion and acceptance of the full approved parity scope. The existing production rollout also has shared core, ingress and companion-client work; StreamWeaver and Nebula Arcade are not the only unverified cutover items.

## Development checkpoint

`ae91c0b` passed required GitHub CI run `34731200815`; all 1,060 offline tests and RTC/media/console browser checks passed. Auto-radio was preserved and validated in f36191b after the development environment disconnected. On recovery, work resumed from that exact remote checkpoint in a separate checkout to preserve an unrelated local asset edit. P17/P22 add temporary guest shoutouts and hourly Raid Train reservations. P25 adds reachable moderation previews and selected-message cleanup through the existing shared job system. The expanded suite-action catalog remains inside the existing Stellar prompt budget by grouping repeated authority labels. No live deployment occurred.


## Continuation: partner schedules, participation and account panels

The restored checkout started from `b582e2947351a95b103cf738224a75c43831100b`. Thirteen additional integration tests cover P23/P27/P31. No production provider state or room data was imported or changed.

- Twitch schedule semantics follow https://dev.twitch.tv/docs/api/schedule/: SPMT supplies an existing app/user token; an explicit 404 represents an empty schedule. Authorization/transport failures preserve the last successful snapshot. The donor's next-25-entry presentation is retained and identified when limited. Custom events survive provider refreshes and never produce calendar-admin XP.
- The donor also has private Google iCal import and partner forum-thread setup; those subfeatures are recorded as remaining rather than hidden by the new Twitch path.
- Shared event pagination keeps insertion order and accepts a tenant-bound `afterId`. SQLite reads the next bounded page directly. Existing newest-first reads are unchanged. DSH counts reference provider message IDs and contain no message text.
- DSH production identity scopes now cover its existing canonical identity/enrollment APIs. Sandbox credentials retain the prior prohibition on identity writes and onboarding. Unlinked live-ingress identities in a sandbox remain pending rather than silently acquiring production authority.
- A community enrollment path was necessary because the earlier SPMT invite method provisions a workspace owner. The new path uses existing canonical provider resolution and one-time setup tickets, grants community membership only after both providers are verified and password setup completes, and cannot replace the tenant owner. Conflicting already-linked people are not merged automatically.

The full approved list is still in progress. HMO Watch/HLS/Discord activity, media production, remaining community/reward/communications features and donor reconciliation must be completed before public replacement.

Validation for this continuation: `npm run test:offline` passed all 1,093 tests; `git diff --check` is clean. Checkpoint 896184c passed required GitHub contracts and RTC/media/console browser checks in run 34780373784 (contracts 103786172704, rtc-audio 103786172552).


## Continuation: canonical member directory

This continuation starts at `896184cc870aef889d0e8707e9c47ef36d9810e5` and implements P28 through existing owners:

- SPMT's account service exposes a credential-free, tenant-scoped directory to the authenticated, installed DSH service. It returns current Discord/Twitch references; revoked links and nonmembers are excluded. The API uses existing `identity:read` authority and creates no identities, links, memberships or credentials.
- DSH stores derived provider observations in its existing private SQLite database. Refreshes use a renewable, fenced tenant lease. Discord pages are complete up to the existing 10,000-member bound; incomplete/repeated pages do not replace the successful server snapshot. Twitch profile lookup is batched by immutable provider IDs, so renamed accounts keep their canonical identity.
- A successful canonical-account refresh applies known unlinks even if Discord or Twitch is subsequently unavailable. Successful provider observations remain available during outages, with visible pending status. Existing configured members bootstrap the directory until its first complete provider refresh, filtered by current account links once known. Successful activation must be verified before cutover.
- Owner Settings maps server roles to the existing Crew, Partners, Honored Guests, Raid Pile and Everyone Else groups. The donor's first mapped role rule is preserved. Until mappings are imported/saved for a server, existing explicit configured groups are retained. Unmapped roles then use Everyone Else. Existing group-channel settings control routes, and the destination must belong to that server.
- The existing tenant monitor has one destination per person. Ambiguous cross-server routes and multiple linked Twitch accounts without an existing selection are shown as unresolved rather than assigned a new precedence. Existing routing/account selections must be reconciled during P33; this is not a new identity or role authority.
- The running monitor, suite operations, selected-server partner calendars, Captain participation and web controls consume the same directory. Saved role edits apply without restart. Removing a provider link or leaving Discord removes tracking after reconciliation. Deliberately removed HMO rooms remain excluded from all imports.
- A retry defect exposed by repeated membership changes is fixed: rejoining the same stream gets a fresh transition receipt, subsequent removal can run again, and stale pending live actions are discarded before publication. This does not claim indefinite exactly-once Discord delivery across arbitrary process/network failures.

Validation: six new integration tests exercise real SPMT HTTP/SDK directory paging, credential/tenant boundaries, revoked links, 1,001 Discord members including a bot, provider renames, live Discord-message routing through the existing publisher, partner changes, owner web controls, restart, lease fencing and repeated same-stream entry/removal. The full offline suite passes 1,099 tests. Live Discord/Twitch acceptance, donor membership and role-map migration remain outstanding.

Provider contracts checked against the official [Discord guild API](https://docs.discord.com/developers/resources/guild#list-guild-members) and [Twitch Get Users API](https://dev.twitch.tv/docs/api/reference/#get-users). The Discord bot must retain the existing guild-member access required for a complete member read; no new write grant is requested.


## Current continuation: Discord entry and one room broadcast

The starting checkpoint `bcb226f` passed required GitHub contracts and RTC/media/console CI in run `34782010326`. All 58 audit rows and P01–P33 remain approved; unfinished packages have not been dropped.

The owner clarified the intended playback model during this continuation. A room plays once; HMO, Discord Activity and StreamWeaver are windows onto that broadcast. Closing every window does not stop the room. Returning to a 210-second song after 180 seconds leaves 30 seconds of room time. When a song ends, the room advances without a viewer sending an end event. Host play/pause/seek/queue operations change the room program. Volume affects only the local viewer. Silence is volume zero, never the media element's mute flag and never a room pause. These explicit instructions supersede earlier notes/tests describing shared media volume or the old owner-must-delete-to-leave behavior. Microphone moderation is a separate existing feature.

Implemented:

- The HMO server mounts the verified Discord endpoint and initializes only the configured, visible public Activity system room. Actual signed guild/application IDs bind to the configured community; immutable provider identity resolves through SPMT. A canonical owner retains host control without needing a Discord administrator bit. Unlinked users are not merged by display name.
- Slow identity/job requests receive a timely deferred response followed by a bounded Discord webhook update. Song-request forms open without waiting on identity; their submissions still check canonical identity and membership. Requests enter the existing durable suite queue. Shared Chat Gateway guild metadata survives StreamWeaver submission, and !wr/!sr use the same HMO executor and public Activity; explicit private rooms still require admission.
- Native room timelines advance independently of viewers and catch up across completed queued tracks after a restart. Owners can leave while retaining a discoverable room that they can rejoin or delete. The existing six-hour ordinary-room expiry remains in force; deleted orphan rooms are not imported or recreated.
- One HMO ffmpeg process per room/lane produces a bounded, live HLS feed, with alternate audio from the source. SQLite leases plus an OS encoder lock fence concurrent supervisors. Source reading, transcoding and source seeks happen in that worker. Native HMO, Discord Activity and StreamWeaver consume its output; reconnecting joins the current live window, subject to normal segment buffering. Private feeds check current room membership; the fixed public Activity exposes only its configured public system room.
- FFmpeg/ffprobe HTTP roots, redirects and nested HLS requests use a loopback egress proxy with validated and pinned public DNS. The only private origin exception is the existing SPMT public-media route. No provider credential store or second queue authority was added. Broadcast output is derived cache, separate from canonical room state.
- Players share the local HLS adapter and expose audio language. Local sliders and silence controls work for ordinary viewers. Legacy Discord volume/mute interactions direct users to their local player; they cannot mutate the room. The room API rejects shared volume changes, including suite/StreamWeaver requests. Old persisted volume fields remain readable solely for compatibility.
- Resolved requests freeze user intent in existing room operation receipts, so committed retries do not re-resolve or enqueue twice. Deleted rooms fence late results. Saved YouTube tracks re-resolve their immutable video ID through the existing worker before being queued, preserving favorites when providers fail.
- The existing HMO cutover configuration forwards optional Discord application/public-key/guild bindings and explicit broadcast binary paths after provisioning. Existing voice-only configuration does not assume system binaries are installed. Production requires ffmpeg, ffprobe and flock in the HMO runtime. A missing broadcaster is reported explicitly; the production room API does not fall back to separate source players.

Validation: all 1,106 offline tests pass after the broadcast changes. Local real-ffmpeg HTTP integration confirms one encoder across repeated window reads, continued operation with no members, lease fencing, access revocation and deletion cleanup. A deterministic 210-second/180-second room-clock case passes. The required browser job now checks a real two-language central broadcast, independent local volume, zero-volume silence without pausing, zero windows and return to the live edge. The local browser download is unavailable in this environment, so that check must finish in GitHub CI before this checkpoint can be called verified.

Live HMO/DSH traffic has not been replaced. Watch catalog/Xtream, remaining worker/provider functions, other approved packages and P33 donor/config reconciliation remain necessary. This continuation does not claim the complete platform is ready for cutover.

Test access: the release Sprite still shows its Fly.io organization sign-in wall; this session has no authenticated Sprite deployment connection. The existing deploy script provisions only FFmpeg, so FFprobe must be provisioned and both binary paths configured before activation. Keep live HearMeOut running. Use the isolated Apollo Activity room and Discord’s per-developer Application URL Override for the first two-window test; a separate development application mapping is needed for a full Discord-proxy acceptance test without redirecting live Activity users. Neither Sprite access nor the live Discord mapping has been changed.
