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

Check-in redelivery validates actor, partner and source against the saved request and returns its durable outbox outcome, preserving original totals and partner details after later changes or removal. Remaining bulk/front-seat/greeting and reward-flow parity stays open.
