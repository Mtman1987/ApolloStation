# StreamWeaver ecosystem integration reference

See the [user guide](../ECOSYSTEM_USER_GUIDE.md) and [current parity checkpoint](../STREAMWEAVER_PARITY_CHECKPOINT_2026-09-06.md). This is an implementation reference, not a declaration that all 15 backlog groups or the live cutover are complete.

## Ownership and authorization

SPMT remains the canonical authority for accounts, scoped jobs, spendable XP, shared media and output grants. StreamWeaver owns its local economy, reward definitions, persona settings, stream operations, game state and flow imports. Commlink owns the public chat projection. Stellar owns generic inference, private assistant state and public channel summaries. HearMeOut checks room membership before accessing its room request bindings.

Browser requests carry the signed-in session. App proxies derive the workspace from that session and check same-origin mutations. Public browser-source grants authorize only their configured output; listener reports do not expand that grant. Services obtain their own scoped token. Never turn a display name, Social Stream payload role or client-provided identity into canonical authority.

## Current HTTP surfaces

| Surface | Authorization and behavior |
| --- | --- |
| `GET /v1/assistant/preferences`, `POST /v1/assistant/preferences` | Signed-in user/workspace; speech/GIF/Remember preferences |
| `/v1/assistant/conversation`, `/conversation/feed`, `/conversation/condense`, `/conversation/clear` | Private user/workspace thread, completed-turn cursor, named summary, clear/cancel |
| `/v1/assistant/notes` | Private note CRUD; no public stream context reuse |
| `POST /v1/assistant/speech/transcribe` | Owned private audio asset, installed source app, enabled execution and ready worker |
| `POST /v1/assistant/speech/synthesize` | Valid voice and text, stable request key, installed source app |
| `GET /v1/assistant/streams` | Workspace owner; speech widgets and ephemeral listener reports |
| `GET /v1/assistant/public-memory` | Owner; public channel summaries/counts/pending state |
| `POST /v1/assistant/public-memory/condense`, `/adjust`, `/clear` | Owner; provider/channel scope; adjustment requires idempotency key |
| `GET /v1/assistant/public-memory/context?jobId=…` | Stellar service identity with `jobs:read`; derives scope from an eligible stored stream job |
| `GET/POST /v1/commlink/social-stream` | Owner management, status/private inbox, rotate/disable/clear-private actions |
| `POST /v1/commlink/social-stream/:tenant` | Dedicated tenant bridge bearer key; no session fallback |
| `POST /v1/commlink/ingestion-errors` | Owner replay of a stored validated message by failure ID |
| `/api/streamweaver/control/stream-operations` | Session-scoped reads; owner configuration and presentation tasks; member check-ins/redeems |
| `/api/streamweaver/control/stream-operations/shoutout-audit` | Owner JSON download, last 5,000 entries |
| `/api/hearmeout/rooms/:room/personas/requests/:id` | Current room membership plus bound user/room request and shared-job ownership checks |

The shell prefix for StreamWeaver controls is `/apps/streamweaver/api/control`. Standalone uses `/api/streamweaver/control`. The shared assistant/Commlink routes retain their `/v1` paths. The app-backed HTTP additions above do not imply corresponding CLI/MCP tools have been created; public memory's worker lookup also has `SpmtClient.getStellarPublicMemoryContext()`.

## Social Stream and rich messages

`normalizeSocialStream` accepts donor text/source/author fields, bounded credential-free HTTPS attachments, donation/membership display metadata and explicit message/edit/delete events. The URL tenant is authoritative. The source/channel/upstream message identity is hashed; roles are empty and canonical identity is absent. A mirrored record uses provider `social-stream`, which is not added to the verified provider-driver union.

Tenant bridge keys have 256 bits of randomness; only their SHA-256 hashes are stored. Comparison is timing-safe. Rotation returns the new token once and invalidates the old one. Ingestion has a 64 KB body bound and 1,000/minute tenant rate limit. The last 10,000 receipts suppress repeated requests; message-level identities preserve insert idempotency beyond the receipt window. Very old edit replay is not a provider-version conflict-resolution protocol.

Private targets use `commlink_social_private`, never the public projection or featured publisher. Retention is 100 entries per tenant, with seven-day read/periodic expiry. Management authorization is checked before inbox reads. Clear does not clear receipt history, so retrying a previously received payload does not restore cleared inbox content.

The shell has an exact dedicated ingestion route. It forwards the bearer bridge key and strips session cookies. Ordinary browser mutations retain their same-origin checks. The upstream handler authenticates the key and requires an active workspace with StreamWeaver enabled. An external private Sprite authentication gate is a separate deployment dependency.

Discord attachment-only messages normalize into the same `rich` projection. YouTube membership, membership-gifting, milestone, gift-received, Super Chat and Super Sticker data become rich event labels. See the [YouTube resource contract](https://developers.google.com/youtube/v3/live/docs/liveChatMessages). Native Discord partial edits and single/bulk deletions are implemented through a separate durable correction queue. YouTube OAuth and canonical viewer linking are described below.

Validated ingestion replay is stored only after normalization and tenant validation. It calls the projection's idempotent ingest, not provider egress. Malformed raw payloads and credentials are not made replayable. Social Stream edits revise retained selected snapshots; deletion also unpins/unqueues/unfeatures them.

## Speech and room completion

HearMeOut bindings contain tenant/user/room scope, a request fingerprint and shared job IDs. They are saved before submission and reject identifier reuse with different input. Reply jobs must be owned by Stellar, billed to the bound user and have the room conversation ID. Speech/transcription jobs must be owned by HearMeOut and billed to the same user. Current membership is independently checked on every HTTP read.

Completed room text is appended with a deterministic message ID. The speech job is separately checkpointed, and synthesis unavailability returns the completed text. Private audio is played through a browser AudioContext, mixed with the microphone into the existing authorized RTC transport, and torn down on completion or room exit. Live browser/RTC acceptance is still required. Room deletion removes bindings; shared-job and media lifecycles are separate.

TTS output polling sends `x-spmt-listener-id`, `x-spmt-listener-state` and `x-spmt-listener-event`; the shell forwards them only on output routes. The output gateway updates presence only after grant/install validation. Presence is bounded, ephemeral, tenant-scoped and expires after 15 seconds. Treat it as untrusted diagnostics, never billing or authorization. Playback waits for the audio's end event, with a 180-second watchdog instead of the ordinary widget display timer.

## Memory

Private notes and private threads remain partitioned by tenant and user. Public condensation reads only public Commlink records from the selected provider/channel, bounded to the latest 100 available messages. It tracks seen IDs, owner count adjustments and a saved condensation job. At 50 observed messages, an eligible public persona request may queue a summary. Summary inference uses `remember:false`; previous public summary and public text are explicit reference data.

The worker context endpoint requires the Stellar service, derives scope from a stored StreamWeaver presentation job, and rejects non-stream/private/unremembered requests. Public replies no longer load a user's generic canonical personal context. Existing recent assistant history still matches conversation and presentation identity. Owner clear rotates the summary epoch and drops/cancels the pending binding, preventing late completion from restoring cleared memory. It does not erase source chat or audit/jobs automatically.

## Economy and presentation

The local/XP ratio uses outstanding spendable supplies. No conversion or minting operation is introduced. Reward quotes round upward and SPMT redemption requires an explicit maximum price. Twitch menu funding never waives configured local price. Keep first-claim receipts, debit/award atomicity and provider-redelivery checks when migrating.

Provider awards are explicit owner settings and operate only on local currency. The award receipt and balance update share one SQLite transaction. Replay returns the original result even after settings change. Twitch per-unit inputs come from verified EventSub bits/gift totals/raid viewers. YouTube rich event awards need a canonical viewer identity; the channel must have completed Account OAuth linking. Social Stream does not enter this award consumer. Anonymous/unresolved events cannot credit a user.

Shoutout AI stores its accepted job and resumes it without replaying effects while pending. It uses explicit owner style plus public profile facts, with no remembered private context. Failed AI returns the configured fallback. Voice, cooldown, exclusion and Discord toggle settings are owner-only writes. Effect delivery retains existing stable IDs; durable local audit entries complement published audit events. Live external exactly-once delivery still depends on each provider's acknowledgement semantics.

## Verification and deployment

Run `npm run test:offline` from the repository root. It builds all packages/apps and runs the network-guarded suite. The relevant regression files cover room completion/ownership, public memory isolation and late completion, authorized output polling, bridge authentication/private routing, sanitized rich messages and validated replay, shoutout progress/fallback, and atomic event awards.

Push-to-main promotion currently targets `testing-968/web-terminal`. A passing promotion and offline suite demonstrate installation, not real provider execution. Keep outbound policy, secrets and tenant migration as separate gates. Do not shut down `streamweaver-new` or delete branches/data on the basis of this reference.

## YouTube OAuth and connection lifecycle

SPMT owns `/v1/identity/providers/youtube/start` and `/callback`. The default purpose links a viewer channel with the read-only YouTube scope. `purpose=chat` requires the current workspace owner and active StreamWeaver/Chat Gateway installations, requests `youtube.force-ssl` plus offline consent, and stores refresh credentials in the encrypted provider authority. These follow [Google’s web-server OAuth flow](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps).

Set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in the existing deployment secret configuration, and register the exact callback at the configured public SPMT origin followed by `/v1/identity/providers/youtube/callback`. This implementation does not provision a Google OAuth client or claim that these credentials are already deployed. The configured public origin must be the browser-reachable Apollo origin. Provider execution still obeys runtime outbound policy.

Pending state is server-stored for ten minutes and bound to the initiating user, workspace, purpose and PKCE verifier. A secure HttpOnly SameSite=Lax cookie must match. Callback consumes the state before exchange, validates granted scopes and retrieves the authenticated channel from `channels.list(mine=true)`. No browser-supplied channel is trusted. A viewer account link never stores a chat credential or grants chat access.

Owners inspect/disconnect through GET/POST `/v1/identity/providers/youtube/connections`. Disconnect revokes the credential and marks the desired connection off. Internal GET `/v1/chat/youtube-connections` is restricted to the Chat Gateway service with `providers:grant`, filtered by its authorized tenants, and is not exposed by the browser proxy. Active gateway reconciliation discovers changes every five seconds and uses the normal supervised grant/driver path; it never receives refresh tokens. Suspended tenants, disabled installations and a changed/unlinked owner withdraw the desired connection. Existing short-lived grants bound the effect of a discovery outage.

The account resolver accepts only verified YouTube links. The legacy Discord/Twitch grandfather operation explicitly excludes YouTube. Owner-configured event awards use the canonical linked viewer and an atomic local-currency receipt. OAuth consent, token refresh, actual live broadcast discovery and provider send/receive still require credentialed acceptance after offline tests.

## Native Discord corrections

Gateway `MESSAGE_UPDATE`, `MESSAGE_DELETE` and `MESSAGE_DELETE_BULK` follow the [Discord gateway event contract](https://docs.discord.com/developers/events/gateway-events). Partial updates preserve fields omitted by Discord. Correction delivery is distinct from normalized new-message delivery: it cannot run commands, assistants, award consumers or outbound senders.

`CommlinkProviderMutationV1` carries only the connection identity, source message, edit/delete operation, timestamp and optional text/rich fields. It cannot replace author identity or roles. The supervisor checks the established connection boundary before enqueuing; the gateway saves corrections in SQLite and retries failed delivery after restart. `POST /v1/commlink/live/mutations` requires the Chat Gateway service, `commlink:live:write`, an active tenant and enabled gateway installation. It is not a browser mutation endpoint.

SPMT merges partial edits, ignores older edits and keeps deletion tombstones across restart and late original-message delivery. The original provider/author identity remains unchanged. Selected operator snapshots receive edits; deletions clear pin, queue and featured state and publish the revised output. Corrections cannot retract text already spoken or sent to another provider, or rewrite a previously generated summary. Existing public-memory clear controls remain separate.

## Published personas in HearMeOut

The production room UI uses canonical published-persona jobs, without requiring the optional legacy conversation-coordinator adapter. StreamWeaver owns the editable persona; owner-only `/api/streamweaver/control/persona/public` publishes its saved instructions, display name, aliases and selected voice, or withdraws sharing. Unsaved browser instructions are not forwarded. Updating the private editor alone does not change the published snapshot.

SPMT owns `public_room_personas`. GET `/v1/assistant/public-personas` returns only eligible public metadata to authenticated users. GET with `own=true` and POST publish/withdraw require the workspace owner; publication also requires active StreamWeaver installation. Prompt instructions never appear in catalog responses. Eligibility checks the current owner, active source tenant, enabled installation and explicit sharing flag. The Count's reserved identities are rejected.

POST `/v1/assistant/public-personas/invocations` requires the requesting human's `assistants:invoke`, an active destination workspace and HearMeOut installation. Canonical construction supplies the selected private instruction snapshot and bills the requesting user in the room's tenant. The job uses `remember:false`, presentation `memoryPolicy:off`, and `hearmeout:<room>:<public-persona>` as its conversation binding. It cannot load private notes or a persona owner's private conversation. Generic human-supplied presentation remains forbidden on the general assistant endpoint.

HearMeOut checks room admission before catalog, join, invocation and result polling. Its saved request binding verifies the returned job's user, tenant and persona-specific room conversation, persists the canonical name/voice and passes that voice into shared speech synthesis. Browser playback uses the existing local/RTC mix. Withdrawal blocks new requests; it does not cancel previously accepted jobs or retract already published room replies. Runtime availability and actual audio transport health remain separate.

## Pokémon command and display completion

`executePokemonCommand` connects installed native Pokémon flows to the same tenant-scoped SQLite transactions as Games, using delivery-derived request IDs. Verified linked identities are required. Team, offer/accept/cancel and attack/switch arguments resolve against the actor’s visible state; ambiguous trades or battles require an explicit ID. Eevee packs select the loaded Eevee-family catalog while retaining original card identifiers.

Authenticated Pokémon control routes expose searchable, paged `pokedex`, current-user collection `export`, and owned `card` details. PNG download requires active operation mode and ownership, constructs a fixed `images.pokemontcg.io` URL from bounded identifiers, rejects redirects, enforces a 12 MiB limit and validates PNG bytes. Catalog-provided URLs cannot redirect the server fetch. JSON export remains available without provider egress.

Native `pokemon-pack`, `pokemon-collection`, `pokemon-trade` and `gym-battle` widgets project explicit card fields from the existing outbox. Gym updates replace displayed state with current HP and turn information. Tests cover actual gateway command dispatch, inventory isolation, trade/battle transactions, download restrictions and overlay projection. Provider downloads and rendered OBS/mobile presentation still require acceptance.

## Check-in role imports

Owner-only DSH `GET /api/discord-stream-hub/control/checkin-members` validates the tenant-configured guild and exact role, reads Discord member pages with the existing scoped grant, excludes bots and rejects oversized or non-advancing results. It requires active operation mode. Discord requires the privileged member-list intent for [List Guild Members](https://docs.discord.com/developers/resources/guild#list-guild-members); a failed lookup never returns a partial replacement roster.

StreamWeaver’s owner UI verifies the returned workspace before submitting the roster to owner-only, same-origin `POST /api/streamweaver/control/checkin-role` (3 MiB maximum). This is owner-curated display data, not canonical identity or role authorization. A SQLite transaction validates all member IDs and replaces only that guild/role/group snapshot, preserving existing invitation overrides. Manual entries and other tenants are untouched. Refresh is explicit. Imported Discord IDs never create canonical XP wallets or authorize privileged commands.

Check-in redelivery validates actor, partner and source against the saved request and returns its durable outbox outcome, preserving original totals and partner details after later changes or removal. Remaining bulk/front-seat and AI/spoken greeting parity stays open.

### Reward-backed check-ins

A partner’s optional `rewardId` binds one configured reward. Owner writes reject ambiguous reuse across partners; roster refresh preserves bindings. Direct web/chat check-ins freeze their partner/reward/session before using the existing reward settlement runtime. A completed settlement precedes check-in recording; a stable payment key permits recovery between those operations. No extra XP issuance or wallet conversion is introduced. SPMT requires an explicit maximum price and is disabled for read-only/simulation check-in execution.

Normal reward and Twitch EventSub redemption paths freeze the optional check-in target before settlement and record it only on completion, using a distinct durable check-in key. Historic free check-ins replay without retroactive charging. Local insufficient-funds and first-claim rejections produce no check-in, while ambiguous SPMT transport failures retain the original quote and settlement key. Offline coverage includes crash-after-payment recovery, changed local supply during retry, first-claim awards, target removal and historical replay.

## Eden model catalog and selection

The active image worker discovers Expert Model image identifiers through Eden’s authenticated [`GET /v3/info/image/generation`](https://www.edenai.co/docs/v3/expert-models/listing-models) endpoint. Discovery is bounded to 20 seconds/1 MiB, rejects redirects and projects only validated image model IDs and labels. The shared app database caches successful catalog metadata; credentials and arbitrary provider fields never enter the public control response. Failed refresh retains the last successful snapshot.

`edenModel` is separately persisted for public and per-user private generation settings, validated as an image-generation model identifier, passed by the claimed image worker and applied in the existing universal-AI request. It does not override SeaArt model/version settings. The UI consumes the cached catalog through the authenticated generation endpoint. Offline tests exercise catalog projection, worker selection, private upload, credential-free media download and stale-catalog retention. SeaArt catalog/character/LoRA workflows and the other legacy image providers remain separate gaps.

### Image prompt moderation

Public and private settings persist `contentModeration`, with public-on/private-off defaults. The worker reads current owner policy for public jobs, ignoring any job-supplied attempt to turn it off. Private jobs use their user-scoped preference snapshot. The generation service checks the final enhanced prompt before entering the image-provider fallback loop; cached generated results are checked again when the current policy requires it.

The configured Eden adapter uses [`POST /v3/moderations`](https://www.edenai.co/docs/api-reference/moderations/create-moderation) with `openai/omni-moderation-latest`, a 30-second timeout and redirect rejection. Missing credentials/adapters, provider failure or malformed decisions stop generation when checking is enabled. No provider fallback bypasses a failed moderation decision, and provider error bodies are not exposed. Tests cover final-prompt checking, blocked and malformed results, public policy override attempts and private scope separation.

### TikTok read-only lifecycle

Chat Gateway lazily loads pinned `tiktok-live-connector@2.4.4` through its documented legacy export. StreamWeaver stores owner configuration, revision-bound status and a bounded SQLite delivery outbox. Connections have a 20-second handshake timeout, 60-second reconnect backoff and cancellation on disable, reconfiguration or shutdown. Canonical tenant/app eligibility refreshes every 15 seconds; the canonical API checks it again for each delivery. Each source accepts at most 1,000 observations per minute.

`GET/POST /v1/commlink/live/tiktok` requires the Chat Gateway service and `commlink:live:write`, matching tenant scope, an active tenant and enabled Chat Gateway/StreamWeaver installs. Sanitized records never acquire canonical identity or roles. Six source event types project into Commlink; gift streaks emit only on completion. Stable source IDs deduplicate queued delivery and the most recent 10,000 sent receipts per tenant. Sources without event IDs use a best-effort fingerprint; this is not a financial exactly-once boundary. Failed tenants do not block other tenants' deliveries.

Owner-only `/control/tiktok` persists settings and returns status. Read-only operation never constructs the connector or drains its queue. Optional `TIKTOK_SIGN_API_KEY` stays server-side; authenticated WebSocket cookie forwarding and mobile mode remain disabled. Live acceptance needs a real broadcasting account and compatible signing access. This implementation does not add TikTok sending, canonical account linking or point-award consumers.

### Retained gift-sub event compatibility

`StreamWeaverProviderRuntime` resolves an exact enabled event binding first, then uses `gift-sub` as the fallback alias for `gift-bomb`. Both consume the same aggregate `channel.subscription.gift` notification; no recipient identity or per-recipient notification is fabricated. `{count}` exposes its quantity. Delivery IDs and local award receipt keys remain based on the original provider event, so a retry cannot award points twice and enabling both names cannot invoke two flows.

### Durable check-in presentation

A successful `StreamWeaverCommunityStore.checkin` commits its receipt, overlay event and optional `checkin-greeting` task in one SQLite transaction. Native runtime calls and web controls supply the authenticated display name; inactive operation supplies no presentation request. Reward settlement remains in the existing shared runtime and is not repeated by the presentation consumer.

`StreamWeaverPresentationRuntime` consumes those tasks using current owner settings. AI requests use a dedicated public stream presentation with memory disabled, a fixed conversation/request ID and persisted job state. Job reads validate tenant, billed owner, owning app and conversation. Terminal inference failures use the owner's fallback. Provider transport failures retry under stable Twitch/Discord egress and public speech-job keys; the canonical systems retain delivery and billing authority. Optional Discord delivery requires a configured tenant destination. Public speech requires a configured persona owner and the existing listener/overlay acceptance. Bulk ride selection/front-seat bonuses remain separate work.

### Bulk ride settlement and eligibility

`activeRideLookup` intersects owner-imported community Discord members with the authenticated broadcaster's current Twitch chatter list using existing canonical provider links. It never grandfathers an identity or matches usernames. Non-404 authority failures abort eligibility; bounded roster limits fail explicitly. Twitch pagination now deduplicates IDs and rejects repeated cursors or incomplete page-limit results.

`StreamWeaverRideStore` durably freezes the actor/source/currency signature, roster, reward snapshot and stream session. The common reward runtime settles first. A SQLite reservation picks a front-seat rider outside the latest `max(5, floor(riderCount × 0.6))` winners when possible and retains 20 winners. A separate atomic local ledger receipt adds 100 points once. Stable per-rider check-in receipts resume partial progress without recounting; their individual overlay outbox rows remain as sent receipts. One bulk reveal and optional greeting task precede the final completed ride receipt. This is recoverable staged execution across app stores, not a cross-database transaction.

Web reward controls, native `!checkin --ride`, ordinary redeem commands and Twitch reward notifications share this path. Active-operation gating, canonical actor identity, explicit SPMT maximum price and normal reward acceptance/first-claim rules remain enforced. Disabling rides pauses pending attempts; restoring the configuration permits their frozen settlement to resume. Live Discord-link, broadcaster-grant, Twitch redemption, OBS/audio and real roster acceptance remain open.

### Cloudflare and binary image providers

Configure `STREAMWEAVER_CLOUDFLARE_ACCOUNT_ID` and `STREAMWEAVER_CLOUDFLARE_API_TOKEN` together on the image worker. The account ID must be 32 hexadecimal characters. When configured, Cloudflare precedes the existing SeaArt/Eden fallback chain; explicit provider choices remain exclusive. The initial adapter supports [Cloudflare's FLUX.1 Schnell contract](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) through a fixed account-scoped REST endpoint, redirect rejection, a three-minute request timeout and a 12 MiB response limit. No provider body is exposed in errors.

Binary results are limited to four images and 8 MiB per image, with canonical Base64 encoding and format-signature checks. The worker checkpoints generated bytes in app-private SQLite before importing them into canonical media storage under its current fenced job lease. Private job results contain asset IDs only. Public suite-image jobs receive publication permission from canonical action creation; simulation overrides cannot obtain that permission. Public results contain managed URLs, never image bytes, and expire after seven days. Direct non-worker adapters reject binary results.

A catalog refresh replaces entries only for providers that returned models, retaining the last successful entries of unavailable providers. Live Cloudflare credential, moderation, image-rendering and public-output acceptance remain required; additional Cloudflare models and other missing providers are still open.

### Pollinations adapter

`STREAMWEAVER_POLLINATIONS_API_KEY` enables the Pollinations worker adapter, appended after the existing automatic fallback providers. The [current provider contract](https://github.com/pollinations/pollinations/blob/main/APIDOCS.md) supplies the authenticated image endpoint and `/image/models` catalog. Requests use a fixed HTTPS origin, encoded prompt path, explicit dimensions/seeds, a bearer header and redirect rejection. The API key never enters query strings or browser settings.

Catalog reads request non-community models, project validated IDs/descriptions with image output modality, exclude video models and limit input to 1 MiB. Generation accepts at most four images, uses separate seeds and a three-minute timeout per request, and validates each returned image's signature and 8 MiB bound through the binary-image pipeline. Completed generation checkpoints protect storage retries; a provider failure during a partial multi-image generation is not an exactly-once provider-billing guarantee. Sandbox/inactive operation remains disabled.

### Durable suite-action completion delivery

`StreamWeaverBotActionReplies` records the initial outbound response and pending job reference in app SQLite before egress. Original delivery retries replay that receipt. Completion reconciliation never recreates a job: it reads the saved ID, verifies tenant, billed actor, input actor, action, owner app, capability, execution owner and original chat source, and then sends a separate stable completion key. An unacknowledged initial reply delays completion; API/egress failures retry at five-second intervals. The runtime requires active provider writes, no simulation and the original configured destination. A process guard avoids overlapping local flushes; provider idempotency covers restart or overlapping-process sends.

Successful public image jobs also publish `streamweaver.image.generated.v1` with a stable event key. Fast image jobs register for overlay publication without a second chat reply. The event contains at most four HTTPS image URLs and the requester’s username, never prompt/provider metadata or image bytes. Public media visibility and a non-simulation chat source are mandatory. `generated-image` is a native, non-audio widget with a 30-second presentation and an allowlisted projection. Private studio jobs are not registered for this path. Failed event delivery retries using the same key; real provider/OBS acceptance remains separate.

### Cloudflare model routing

The adapter now implements all five retained model choices. FLUX.1 uses JSON; Klein 4B/9B use multipart prompt/dimension/seed/guidance fields with four fixed steps, following the [4B REST contract](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/) and [9B REST contract](https://developers.cloudflare.com/changelog/post/2026-01-28-flux-2-klein-9b-workers-ai/). [Lucid Origin](https://developers.cloudflare.com/workers-ai/models/lucid-origin/) and [Phoenix](https://developers.cloudflare.com/workers-ai/models/phoenix-1.0/) use bounded JSON parameters; Phoenix binary responses go through the same MIME/signature validation as base64 results. All routes retain the fixed API origin, redirect rejection, response-size limit and managed media publication rules.

The worker derives provider `surface` from canonical job media visibility. Public settings and provider execution both reject Klein 9B; a caller-supplied surface does not override that derived value. Reference inputs now use the owned-media path described below.

### Owned reference-image inputs

Image Studio uploads resized private PNG references through the shared media API. Its generation endpoint accepts at most four UUID asset IDs and checks each using the signed-in caller’s media access before creating the job. The job freezes those IDs in `input.mediaAssetIds`. The worker reads each asset through the current lease/fencing epoch, verifies tenant and billed owner again, and validates PNG signature, IHDR dimensions below 512 × 512 and the 1 MiB limit. No caller-provided reference URL is fetched. Klein receives multipart binary inputs; unsupported providers cannot silently drop references during fallback. Existing generated-output checkpoints avoid re-reading inputs or regenerating after an output-storage retry.

Revalidation against the pinned donor found that `generationLoras` contains explicitly future placeholders; `seaartCharacterId` is only persisted/displayed and `requestSeaArtCharacterCompletion` has no external caller. The default Perchance adapter returns Pollinations fallback URLs on challenge/failure; an optional custom endpoint remains unverified. TikTok observations are emitted by `multi-platform.ts`, but no consuming points-award listener was found. None of these declarations alone establishes an additional live functionality gap.

### Private control counterpart

`POST /v1/assistant/conversation/control` applies `gif` or `delete` to a turn in the signed-in canonical user’s tenant-scoped thread. There is no caller-selected user authority. Deletion removes the selected execution job, cancels/deletes pending condensation and clears the generated summary note while preserving separately saved notes. The thread epoch changes so feed clients reset. GIF visibility persists per turn; GIF selection is an owned `image/gif` media asset checked by the preferences API. The browser uses authenticated private media URLs and existing shared speech jobs for explicit read-aloud.

This uses the existing app conversation, settings, speech and media surfaces rather than duplicating the donor’s signed Discord link system. Native Discord DM transport remains a different surface, not an implemented transport claim. The user explicitly accepts equivalent functions elsewhere in Apollo.
