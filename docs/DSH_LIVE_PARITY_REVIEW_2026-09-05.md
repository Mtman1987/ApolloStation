# Discord Stream Hub: live functionality and Apollo parity review

Date: 5 September 2026. Scope: current source, the supplied Apollo screenshots, and execution checks of the changes in this commit.

**Apollo does not yet have full functional parity with live Discord Stream Hub.** The live implementation contains substantial community workflows that cannot be replaced by a runtime summary, an empty page, or a tested payload helper. This update repairs navigation and calendar controls and consolidates pages. It does not certify all the remaining workflows as production-ready.

The earlier Simulation Room/widget release (`a0ab176b73b68a95a185904f29c052acfeb1ef18`) and Commlink repair (`7836c4a0cdf62678b3589219c291904719633f4d`) were pushed to `origin/main` and passed CI and Sprite promotion before this DSH work began, as requested.

## Evidence and limits

The comparison uses these remote main revisions:

| Repository | Reviewed revision | Purpose |
| --- | --- | --- |
| [DiscordStreamHub](https://github.com/Mtman1987/DiscordStreamHub/tree/d97af868a3929e44b02103c347bb5680abe4c465) | `d97af868a3929e44b02103c347bb5680abe4c465` | Existing DSH pages, Discord payloads, interactions, services and settings |
| [spmt-live](https://github.com/Mtman1987/spmt-live/tree/df18ae6bd7becd784fa5d614d9119d73b59e5b0e) | `df18ae6bd7becd784fa5d614d9119d73b59e5b0e` | Shared SPMT presence and live-community read contract |
| [spacemountain-live](https://github.com/Mtman1987/spacemountain-live/tree/3dcb653cd99cc10d1f7d791c8584f869797577cf) | `3dcb653cd99cc10d1f7d791c8584f869797577cf` | Community feed projection and its upstream producer |
| ApolloStation | Baseline `7836c4a0cdf62678b3589219c291904719633f4d`, plus this commit | Actual replacement implementation |

“Present in live source” means the implementation was inspected; it does not mean every branch of that deployed application was exercised. The authenticated Sprite browser was blocked by its sign-in/front-door flow, so exact phone geometry and real Discord delivery have not been visually verified in this session. The screenshots are evidence of the reported symptoms, not evidence that every legacy source feature works perfectly.

## Ownership: shared ecosystem status, DSH presentation and delivery

Your concern about duplicating stream monitoring is correct. The shared read path already exists. It also has a legacy dependency that must be handled deliberately:

- SPMT's `GET /api/live-community` forwards the SpaceMountain community feed. Apps should consume this common read contract.
- SpaceMountain's `GET /api/community/shoutouts` combines its stored projection with `fetchDshCommunityStatus`. The old DSH producer still participates underneath that shared API.
- SPMT's `/api/presence` heartbeat contract tracks app/workspace activity with expiry. That is distinct from whether a creator is streaming on Twitch.
- Apollo still contains a DSH Twitch poller. A shell helper that counts events containing “live” does not establish that a replacement ecosystem collector handles online/offline transitions, stale state and replay correctly.

These findings come from [SPMT presence/bootstrap code](https://github.com/Mtman1987/spmt-live/blob/df18ae6bd7becd784fa5d614d9119d73b59e5b0e/presence-bootstrap.cjs), [SpaceMountain's server](https://github.com/Mtman1987/spacemountain-live/blob/3dcb653cd99cc10d1f7d791c8584f869797577cf/server.ts), and Apollo's [current worker](../apps/discord-stream-hub/src/live-worker.ts).

| Responsibility | Correct owner and integration | Port decision |
| --- | --- | --- |
| Account identity, tenant membership, Twitch/Discord linking and credentials | SPMT identity and short-lived provider grants | Reuse. Do not copy DSH login, recovery, credential storage or automatic identity creation into Apollo UI. |
| Stream online/offline state and current game/viewers | Shared ecosystem feed, backed by one authoritative ingestion path | Reuse the existing SPMT feed now. Migrate its legacy producer only after the replacement proves equivalent transitions, freshness and recovery. |
| App/workspace online presence | Shared SPMT heartbeat/expiry service | Reuse; keep this distinct from stream status. |
| Which Discord community card is appropriate, group routing, spotlight policy and message update/delete | DSH | Port missing behavior here, consuming shared status. |
| XP balances, rank and settlement | Canonical SPMT XP service | DSH supplies attributable, idempotent activity events; no private shared balance. |
| Chat history, destinations, app attribution and cross-app composition | Commlink, Chat Gateway and the existing app action contracts | Reuse. DSH supplies Discord-specific transport/presentation. |
| Media rendering and gameplay capture | Existing media/job and Nebula Arcade capabilities | DSH requests real output and renders it in cards; no second rendering stack or invented clip URL. |
| Simulation Rooms | Persistent shared workspace rooms with app handlers and redirected transports | Reuse the same actions and payloads, with room output replacing external delivery. |

**This commit adds no stream-monitoring loop and disables no legacy collector.** Live & Shoutouts reads the existing SPMT community feed in live-read mode. Isolated Green mode reports that source as unavailable; it does not call an invented Green endpoint. The unused DSH polling-interval input was removed from this page because the current control did not configure the shared feed.

## What this update repairs

| Reported problem | Change | Execution evidence |
| --- | --- | --- |
| Home stays visible and pushes the selected page down | An explicit hidden-page CSS rule now wins over the Home grid display. Embedded app content uses one bounded grid row, and navigation starts the selected page at its top. | Actual browser scripts executed in a DOM harness: only Calendar, Applications or Live & Shoutouts is visible after its navigation action. Phone rendering remains unverified. |
| HTML is parsed as JSON | Browser requests use app-prefixed API routes that the integrated host forwards to the existing handlers. Canonical API routes remain supported. Non-JSON responses produce a recoverable service error. | Integrated HTTP tests exercise authenticated snapshot/control requests, mutations and JSON 404s. The specific live ingress response from the screenshot could not be captured, so the original HTML-producing layer is not asserted as proven. |
| Calendar has no usable calendar | Month grid, previous/next month, Today, selectable dates, event cards, Captain's Log claim/release, owner mission creation and event edit/delete. | HTTP tests create, move, retrieve and delete persistent events; DOM checks exercise month/day selection and forms. |
| Calendar requires a Discord server before it can be used | Tenant workspace calendar is usable independently. A selected guild can include its existing events; publication includes workspace events. Chat/voice calendar operations use the same store. | Tests exercise workspace calendar actions before Discord setup and tenant isolation. |
| Applications and Application review are separate pages | One Applications page contains the participation card, publishing, pending answers, owner decisions and decision history. Existing `reviews` navigation messages open this page. | DOM check submits a decision through the actual review script; existing signed-interaction and API tests remain applicable. |
| Live now and Shoutouts repeat the same task | One Live & Shoutouts page shows the shared live community feed, spotlight and DSH tracked delivery records. Existing `live` navigation messages open it. | Shared-feed test verifies one GET to the existing SPMT endpoint, with no forwarded session cookie/authorization or direct Twitch call. |
| Refresh/save loses work or repeated taps repeat a mutation | Form drafts survive refresh and failed saves; an in-flight save does not erase a newer draft. Pending submission rejects duplicate taps. | Actual browser script checks cover failure, duplicate submission and a newer draft typed during a save. |
| Re-publishing can duplicate a calendar/application after a transient error | A failed edit preserves the tracked message. A replacement is created only after Discord reports that the message is missing. Calendar summaries are ordered and bounded. | Regression tests cover transient edit failure, missing-message replacement, date filtering and long schedules. |

The integrated ingress also validates the browser's original Origin before proxy rewriting; a cross-origin calendar delete is rejected. Tenant owner/member checks stay server-side.

## Feature-by-feature parity and recommended destination

| Live DSH capability | Apollo status after this update | Why preserve it, with an example | Port/reuse decision |
| --- | --- | --- | --- |
| Useful live creator/group view | Shared live list and spotlight now visible; detailed group management and manual action controls remain incomplete. | An owner needs to see who is live and where their card was delivered, then act on that creator without navigating unrelated runtime records. | Keep one DSH Live & Shoutouts page, consume shared presence, add DSH-owned delivery controls. |
| Crew, Partner and community-specific shoutout formatting | Generic live card exists; full editable group template flow is absent from Apollo UI/runtime. | A Partner card should carry its partner badge and copy; a Crew card should communicate the crew role, game and viewers. One generic card loses that community meaning. | Port the distinct payload behavior and effective template settings, using current theme controls and tenant storage. |
| Rotating community spotlight | Selection/publishing primitives exist. Media injection and the fuller live presentation are not fully connected. | Spotlight should feature the current creator, correct avatar, game/viewers, rotation timing and real clip media. | Keep DSH rotation/delivery; use shared live status and existing media jobs. |
| Welcome/onboarding community card | A limited optional join button exists, but the full welcome card and its end-to-end interaction are missing. | A new Discord member needs one clear route to link/claim the same SPMT identity, with context about the featured creator and community. | Port card composition; reuse SPMT onboarding. Do not port a competing identity flow. |
| Web calendar and event maintenance | Month grid and CRUD restored here. Captain avatars, persistent mission colors, compact mission rows, month PNG download and participation totals are now implemented. | Members must see which day is claimed and owners must be able to move or remove a mission. | Keep this DSH calendar and store; bring across useful visual cues and accessibility. |
| Interactive Discord calendar and mission log | Apollo now publishes one image embed containing the month, captain avatars and every mission description. Previous/next month, captain claim and mission forms share the app store and Simulation Room handler. The separate legacy mission embed is intentionally consolidated into the requested single image. | A member should claim a day from Discord and see the same changed event in Apollo and the room preview. | Port renderer, components and real interaction handlers together. A button payload alone is insufficient. |
| Inquiry-first applications | Public inquiry card, role information, bounded application modal and stored submission exist. Publishing/review now share one page. | People should understand responsibilities before being asked to apply. | Preserve existing Apollo interaction implementation and expand the same Applications page. |
| Crew advisory votes, owner decision, archive views | Owner decision/history exists. Crew voting and the fuller archive workflow are missing. | Crew can advise on a developer application while the owner retains the final decision; advisory votes remain private and auditable. | Port application-owned votes/history, enforcing canonical roles server-side. |
| Approved-applicant agreement acceptance and receipt | Apollo mentions later acceptance in inquiry copy, but the inspected application store/handlers do not implement the live offer/acceptance/receipt flow. | “Approved” must not silently stand in for the applicant reviewing and explicitly accepting the versioned terms. | Port the workflow, matching SPMT identity, version/hash checks and receipt storage. Do not invent new terms or grant access merely on approval. |
| Custom approval/rejection DMs and resend | Apollo sends basic hard-coded decision copy. Live has per-role templates and agreement resend. | A rejected Partnership inquiry needs appropriate wording; an approved applicant may need the original offer resent. | Port effective templates and delivery retry/status into Applications. |
| Community/admin/targeted proposal cards | Live Applications includes a proposal composer with audience, channel, text, color and vote buttons. Equivalent Apollo workflow not found. | Crew can seek a community decision about an event without misusing a membership application. | Add a Proposals area within Applications/community controls; preserve audience rules, handlers and attributable votes. |
| Signal Seeker opt-in card, expiry and role changes | Apollo contains signal stores/payload/policy helpers, but a complete published panel + interaction + runtime workflow is not wired into the reviewed DSH web/worker path. | A member joins the hunt, sees a genuine signal, claims it once and later leaves; expired signals should disappear consistently. | DSH owns Discord interaction/delivery; reuse existing command, discovery and XP owners. Do not add another independent random-signal scheduler. |
| Raid Pile / Raid Train membership and target controls | Group-name normalization is present. That does not implement join/leave, target advancement, membership state or the live page. | Community members need to join the raid activity and see its actual next target and live participants. | Port the lifecycle, state and Discord handlers together. Use shared stream status. |
| Manual shoutouts for untracked creators and message lifetime | Apollo suite action requires a configured tracked member and creates a basic message. Live has manual tracking, grace/expiry and media cooldown behavior. | Shouting out a visiting creator should not require pretending they are a permanently tracked SPMT member. | Port bounded manual-target tracking and cleanup; keep canonical identity rules for linked users and verify channel authorization. |
| Group/channel/role routing and settings that affect execution | Apollo has static runtime config and a settings store. Saved web settings are not comprehensively consumed by the current worker. | “Save spotlight channel” must affect the next relevant delivery and expose a failure if it cannot, rather than just storing a value. | Reconcile DSH-owned routing with the worker's effective config. Move ecosystem presence settings to their owner; preserve actual channel and role behavior. |
| Leaderboard, point configuration and calendar rewards | Canonical wallet/ledger and point services exist. The page is not the original leaderboard/configuration UI. New calendar records queue durable canonical XP awards; retries use stable idempotency keys, and sandbox delivery does not award live XP. The broader leaderboard/configuration UI remains a separate gap. | Claiming a date should produce exactly one intended award, and the community should see the right rank. | Reuse canonical XP; complete event-to-settlement integration and leaderboard UI/publishing. Never create a parallel wallet. |
| Rich message/forwarding workspace | The standalone live app has rich Discord content, attachment/media handling, destinations and composition. Apollo Commlink has shared feed/compose, but full Discord presentation parity needs separate checks. | A rich embed or image must remain readable and replyable from the shared workspace. | Restore missing rendering/transport behavior through Commlink and Chat Gateway. Avoid another message history or login island inside DSH. |
| Animated banners, clips and gameplay media | Apollo has role-aware banner, clip library and Nebula gameplay helpers, but their existence does not prove worker publication uses the assets. | A clip should actually play in a shoutout and a creator's avatar should stay their avatar. | Connect genuine rendering/job outputs; retain the current role/brand policy and Nebula Arcade naming. |

## The Discord embeds worth recovering

These are distinct products with different interactions, not cosmetic versions of the same generic card.

| Card | Live content/controls | Apollo gap and acceptance example |
| --- | --- | --- |
| Crew shoutout | Creator information, game/viewers, crew badge/copy, group styling and media | Configure a Crew template, preview an actual Crew shoutout, verify the changed fields in the Discord payload and room rendering. |
| Partner shoutout | Partner-specific title/copy/badge/footer and creator media | A Partner shoutout must retain partner identity and effective configured copy. Test separately from Crew. |
| Community spotlight | Featured creator, game/viewers, rotation context, media and optional welcome/banner composition | Advance a rotation and verify the intended tracked message changes, old content is cleaned up, and the creator avatar remains correct. |
| Welcome aboard | Community identity/onboarding explanation and featured-creator context | Open the welcome card's action and arrive in the existing SPMT claim/link flow; do not create a second account. |
| Calendar + Mission Log | Calendar image, today's Captain highlight, upcoming missions and month/claim/add buttons | Press Next Month, claim a free date and create a permitted mission in a room. See the same store update and revised embed. |
| Application inquiry + private role information | Three role inquiries, responsibilities/perks/terms, application-start button and modal | Inquire, submit, review, vote, decide and explicitly accept the offered terms through the full workflow. Current Apollo covers only part of that chain. |
| Proposal vote | Audience-specific proposal, resource link, color and configurable vote labels/emoji | Publish a Crew-only proposal in a room; reject a vote from an ineligible actor and retain an eligible actor's vote. |
| Signal Seekers | Join/leave hunt controls, opt-in role and time-bounded signal behavior | Join, receive an actual signal, claim it once, observe expiry, and leave without residual role/state. |
| Raid Pile | Live/offline participant list, viewers, join/leave and next-target controls | Join two participants, update shared live status and advance the correct target without duplicate memberships. |
| Community leaderboard | Ranked community output and publishing/configuration controls | A settled activity changes the canonical rank and the same displayed leaderboard, including restart/replay without a duplicate award. |

Source examples: [shoutout templates and composition](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/shoutout-service.ts), [calendar renderer and components](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/calendar-discord-service.ts), [welcome card](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/spmt-onboarding-embed.ts), [signal lifecycle](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/signal-seeker-service.ts), [raid pile](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/raid-pile-service.ts), [application votes](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/app/api/applications/vote/route.ts), [agreement workflow](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/app/api/applications/agreement/route.ts), [manual shoutouts](https://github.com/Mtman1987/DiscordStreamHub/blob/d97af868a3929e44b02103c347bb5680abe4c465/src/lib/manual-discord-shoutout-service.ts).

## Preserve the current style while restoring functionality

Keep Apollo's existing navigation rail, scene, theme tokens, translucent cards and three persistent workspace embeds. The large introductory hero belongs on Home. Each task page should begin with its own title and its first useful control; optional publishing/settings details can expand below it.

Use one Live & Shoutouts destination for live creators, group routing, spotlight and delivery actions. Use one Applications destination with clearly separated sections for publishing, submissions/review, agreements, notification templates and proposals. Calendar keeps a visible month grid and date-level actions. Settings explains the effective DSH configuration and links to the shared account/identity owner.

Discord cards should retain Discord-native layout inside the simulation pane: author/avatar, colored edge, title, description, fields, media, footer and actual buttons/forms. Stream overlay preview should use the real 16:9 widget output. These panes remain in the shared room when the active app changes. DSH-specific preview buttons should select or write to that room, not create a private command-scoped room.

On mobile, the app page and bounded lists must scroll, controls must wrap, and dialogs must fit the viewport and keyboard. DOM checks verify state and interaction; they cannot substitute for the final phone/browser check of these dimensions.

## Do not copy ineffective or placeholder legacy code

The source review also found reasons to port behavior selectively:

- Some enhanced template editor fields do not line up with every legacy template reader/render branch. A visible editor control is not proof that its saved value affects a posted card. Port the effective field contract and prove the round trip.
- The legacy shoutout-card service contains placeholder clip data and code that derives a supposed MP4 URL by changing a GIF extension. That is not a working media pipeline. Use actual capture/render outputs.
- Some legacy services overlap with shared identity, messages, XP and presence. Recreating these inside DSH would introduce competing authorities and drift.
- Apollo's prior “ported” source-slice labels and unit tests are insufficient evidence of complete user-facing parity. Several helpers exist without a reachable page, consumer, scheduler or Discord interaction handler.

## Release completion criteria for the remaining port

The next DSH parity work should complete coherent workflows: first effective routing/settings and the missing interactive calendar; then applications voting/agreements/templates/proposals; then community welcome/group/spotlight media and Signal Seeker/Raid controls through their proper ecosystem owners. Existing live functionality remains the reference, but each workflow must use current contracts.

For each workflow, require a reachable control, real stored state, effective runtime consumption, the actual Discord/overlay payload, a working interaction handler, observable failure/retry behavior, and a simulation-room rehearsal using that same handler. Validate tenant/role boundaries and restart/replay where the feature stores state or awards XP. A mock card, hard-coded success toast or disabled placeholder does not meet completion.

Live outbound sends were not triggered for this review. Passing the automated suite and Sprite health checks supports releasing the repairs in this commit; it does not close the remaining parity gaps above or certify the whole ecosystem for final live testing.

Validation for this repair: `npm test` passed all **701 tests** with no skips, cancellations or failures. The separate DOM execution check passed navigation, calendar controls, failed-save/draft races, duplicate submission prevention, edit/delete, consolidated review and shared-feed rendering. These checks do not establish live-provider credentials, delivery or phone rendering.


## Calendar and native Discord Events follow-up

This follow-up implements the requested common calendar across the app, a downloadable month image, the Discord calendar embed, and Discord native Scheduled Events. It incorporates the already-published Nebula command work from `fde941f2d673aa5e349a4da3e7ce2891af931c26`.

| Behavior | Implementation and example |
|---|---|
| Captain duty | Choosing September 7 records the member as that day's captain. Their linked Discord avatar appears in the date cell. Duty is not listed among missions and never creates a Discord Scheduled Event. The current month image labels the captain for today. |
| Missions | Each mission receives a persistent color. The date dot and compact mission row use that same color; adding an earlier mission does not recolor existing missions. Titles, dates, times, locations and complete descriptions are included in the image. |
| One saved image | A shared SVG layout renders to PNG with bundled fonts. The PNG contains the complete month and mission list independent of browser scrolling. Discord receives a real multipart attachment in one embed. The room renders the same calendar view, avoiding oversized base64 image records. |
| Native Events | Future app missions create native Discord events; native events import as **Discord event**. Event IDs are persisted. Edits and deletions propagate in either direction; the existing calendar image refreshes after changes. Captain duty is excluded. |
| Recurring and voice events | Native recurrence rules are preserved and expanded into the displayed month. Editing an imported voice or stage event preserves its channel and type. Completed and canceled native status remains visible. |
| Simultaneous changes | If the same linked event changes on both sides, both versions remain available in Calendar → Discord Events. The owner chooses **Use calendar** or **Use Discord**. |
| Lost responses | A create attempt is saved before the provider request. A returned calendar link lets a restarted worker adopt the already-created event after a lost response. An uncertain, unmatched attempt remains visible for review; it does not blindly create another event. |
| Provider outage or missing message | A failed event listing cannot delete local events. Missing listed events are checked individually before deletion. A failed image edit keeps the tracked message; only a confirmed 404 permits replacement. Dirty images retry after restart. |
| App refresh | The calendar reads updates every five seconds while idle, preserving drafts and scroll position. Native Events reconcile every thirty seconds in a separate calendar worker loop; app mutations request an immediate pass. This adds no stream-monitoring authority. |
| Discord controls | Signed captain/mission submissions resolve the existing canonical SPMT identity and role. Mission creation requires the tenant owner; members may claim a captain date. Replayed interaction IDs do not create another record. Slow submissions acknowledge Discord first and finish through its interaction response webhook. |
| Participation | Calendar → **Captain participation this month** shows each crew member's days chosen, including zero-day members, and the number still needed. The owner can set the minimum there. These counts are omitted from the public image. |
| XP | Calendar awards use the existing DSH points service and canonical SPMT ledger. Pending awards survive restart; captain duty uses one award key per member/date. Native imports do not pretend raw Discord IDs are canonical users or create awards for them. |

### Deployment boundary and remaining verification

The Sprite deployment still runs with provider egress disabled, its existing network allowlist and offline guard. In that environment outgoing Discord messages and native-event mutations are captured in Simulation Rooms; isolated room tests mutate only room data. **Pushing this implementation does not connect a Discord bot, open the Sprite's network policy, or certify a live-server round trip.** Actual native-event ingestion requires the existing provider-grant connection plus permitted Discord API access. Live operation also needs Manage Events permission, message/attachment permissions in the destination channel, and the configured signed interaction endpoint. The install link now requests Manage Events.

Discord's limits are enforced without silently shortening existing data: event names permit 100 characters, descriptions 1,000, and external events require an end time and location. New app forms default to one hour and expose both controls. Outgoing app-created events include a useful calendar link within the description budget. Historical missions stay in the calendar; Discord cannot create a new scheduled event in the past. Very large calendar previews or images fail explicitly instead of dropping mission rows.

No live Discord messages or events were created as part of verification. Automated provider fixtures exercise real API payloads and multipart images, server-side permissions, duplication prevention, deletion, recurrence, conflicts, timeout/restart recovery and sandbox write capture. The generated month PNG was visually inspected; DOM execution verified mission/duty separation, avatar/dot markup, controls, refresh and draft retention. Authenticated phone rendering and the live Discord round trip still require testing in the connected environment.

This calendar completion does **not** close the other live-parity gaps in the report: tier-specific shoutout media, community onboarding, applications voting/agreements, Signal Seeker/Raid workflows and remaining leaderboard controls retain their own status above.

Final combined validation: `npm run test:offline` passed **727 tests**, with zero failures, skips or cancellations. The generated browser scripts and DOM controls passed the separate execution check; the complete browser module graph is covered by the automated suite.
