# ApolloStation ecosystem guide

This guide describes implemented ApolloStation behavior. The [StreamWeaver parity checkpoint](STREAMWEAVER_PARITY_CHECKPOINT_2026-09-06.md) records unfinished ports and live acceptance gates. Only StreamWeaver was the source of this audit; finding its equivalents across Apollo does not certify the other live applications.

## Your workspace

Sign in, select the workspace, and install enabled apps through Shipyard. Account owns your identity, linked provider accounts and personal usage. Workspace owns shared appearance, dock slots and overlay scenes. An app in a dock slot or a Simulation Room can remain open while you use another app.

| Service | Where its responsibilities sit |
| --- | --- |
| ApolloStation / SpaceMountain | App discovery, accounts, workspace, app installation and shared navigation |
| SPMT | Canonical identity, permissions, spendable XP wallets, jobs, events and media authority |
| Commlink and Chat Gateway | Conversations and shared chat; provider connections, normalization and delivery |
| Stellar Core | Assistant inference, scoped memory, transcription and speech; Stella is its default presentation |
| StreamWeaver | Streamer currency, rewards, persona presentation, commands, stream operations, image tools and collections |
| HearMeOut | Room membership, conversation and room audio |
| Discord Stream Hub | Discord community workflows and their configured destinations |
| Nebula Arcade | Ecosystem games and game widgets |
| MountainView / Companion | Authorized device integration and local execution |

Capabilities require the relevant app installation, permissions and an available runtime. A queued job is not yet a delivered result. Simulation output is visible in Simulation Rooms and does not prove delivery to Twitch, Discord or an audio listener.

## StreamWeaver points and rewards

The Points page displays the outstanding local streamer-point supply, global outstanding spendable SPMT XP supply, and both directions of the current ratio. It refreshes every five seconds, on window focus and after a local wallet mutation. Spendable XP is distinct from lifetime XP.

`SPMT XP price = streamer-point price × spendable SPMT supply / streamer-point supply`

| Outstanding streamer points | Outstanding SPMT XP | Reward price in streamer points | Equivalent XP price |
| ---: | ---: | ---: | ---: |
| 1,000,000 | 100,000 | 100 | 10 |
| 10,000,000 | 100,000 | 100 | 1 |

The inverse display is `1 SPMT XP = streamer-point supply / SPMT supply streamer points`. Fractional redemption prices round up to whole XP. A zero or unavailable supply produces an explicit unavailable price. Nothing converts local points into XP or mints new XP. The aggregate exchange ratio does not merge tenant wallets.

In **Stream operations**, a reward can charge local points, award local points, or do both. Choose streamer points, SPMT XP, or either as its accepted payment. “First successful redemption per stream” can award a prize once. The session identifier must change for the next stream; live Twitch session discovery also updates it.

Adding a reward to the Twitch menu creates a one-Twitch-point entry. That menu price does not satisfy the StreamWeaver price. Insufficient local funds reject a local-currency redemption. SPMT payments require the user's selected currency and maximum accepted XP cost; use the reward desk to review the price. Twitch fulfillment/cancellation requires the managing application's broadcaster grant.

Owners can configure point awards for verified Twitch follows, subscriptions, resubscriptions, gifts, cheers and raids. Twitch bits, gifted subscriptions and raid viewers can multiply the configured award. YouTube membership and paid-message events carry their event details; their awards require the viewer to link that YouTube channel in Account. These awards affect local currency only. An anonymous or unresolved identity receives no award. Repeated delivery of the same event cannot credit it twice.

## YouTube connections

Viewers use **Account → Link YouTube** to link their own channel to their Apollo identity. The workspace owner separately uses **StreamWeaver → Integrations → Connect YouTube chat** to authorize reading and sending live chat. Enable both StreamWeaver and Chat Gateway first. Viewer linking alone does not start a chat connection.

Google authorization must be configured by the deployment operator. Owner consent requests offline access so SPMT can renew the connection without exposing tokens to the browser. Integrations shows the requested connection and offers Disconnect. A requested connection still needs an active broadcast, an available gateway and working provider access; it is not proof that chat has connected. Unknown YouTube viewers are not automatically assigned an account or awarded points.

## Chat desk and Social Stream

The chat desk offers platform/search filters, saved filters, pinning, a feature queue and a Featured chat output. Selected message snapshots survive normal feed eviction. Attachments appear as safe HTTPS links. Discord attachment-only messages and Social Stream media are retained in the shared projection. Native Discord edits update text and attachments; single and bulk deletions remove content from the feed and clear its pinned, queued or featured presentation. Corrections do not run chat commands or award points again.

Owners can create or rotate a Social Stream bridge key in the chat desk. Copy the displayed ingestion URL and send the key in `Authorization: Bearer <key>`. A new key is shown only when created; rotation invalidates the previous key. Disable stops further ingestion.

Public bridge messages appear in shared chat. `private: true`, `isPrivate: true`, or `visibility: "private"` routes a message to the owner's private bridge inbox. That inbox is separate from the private AI conversation and cannot appear in shared chat or overlays. It retains at most 100 messages; messages older than seven days are removed on reads and by the periodic cleanup. Clear removes the active inbox. Social Stream edit/delete events update their selected public snapshots and deleted messages are removed from the feature queue.

Mirrored Social Stream display names are not verified SPMT identities or moderator roles. They do not execute privileged commands or produce point awards. The bridge accepts at most 1,000 requests per minute per workspace and 64 KB per request.

**Ingestion failures** displays sanitized diagnostics. **Replay validated message** appears only for a previously validated provider message whose projection failed. Replay restores the shared feed using its original identity; it does not send a message to the external provider.

A private hosting authentication gate can still prevent an external bridge from reaching the ingestion URL. Successful local tests do not bypass that deployment gate.

## Assistant, memory and room audio

The private assistant conversation, preferences, notes and generated media are scoped to your account and workspace. Remember opts into saved context. Raw private turns expire after one hour without Remember and seven days with Remember; saved notes remain until deleted. Clear stops/removes the active conversation's jobs. Delete saved notes separately if you also want those removed.

Public stream memory has separate channel controls on the Assistant page: inspect its summary/count, condense now, adjust the count and clear the saved memory. Automatic condensation starts after 50 observed public messages when an eligible remembering persona next replies. It uses bounded public Commlink history, not private conversations or personal canonical context. Clearing the summary prevents a late pending condensation from restoring it. It does not erase the original public chat or existing audit history.

In HearMeOut, an admitted room member can request an assistant reply or record up to eight seconds for transcription. The shared fallback now waits for the completed reply. Requested speech is played locally and mixed into the member's active room audio transport. If speech cannot be created, the text reply remains available; retry resumes the saved request. Owners can publish their saved persona and a room voice with **StreamWeaver → Persona → Share with HearMeOut**. Save editor changes before publishing; publishing creates the shared snapshot used by room replies. HearMeOut members select that persona from the room catalog. Stop sharing removes it from discovery and blocks new requests; previously accepted jobs may still complete. Disabling StreamWeaver, suspending the source workspace or changing its owner also removes eligibility. The Count is excluded from public room conversation. Live room-audio acceptance remains.

In Stream operations, **Speech players** shows recent authorized TTS output listeners and their playing, idle, muted or blocked reports. Reports expire after 15 seconds without a heartbeat. Add a speech/TTS widget through Overlay Bay and open its issued output in OBS. A blocked player may require a browser play gesture. Playback follows actual audio completion, with a bounded watchdog.

## Stream presentation and image tools

Configure welcomes, shoutout mode, BRB clip source and partner entries in Stream operations. Shoutout settings include optional AI greeting instructions, a fallback greeting, voice, automatic cooldown, excluded usernames and Discord delivery. Greetings use a saved assistant job and fall back when generation fails. Manual/voice shoutouts retain their cooldown-bypass behavior while honoring exclusions. Owners can download the last 5,000 shoutout audit entries.

Image Studio supports private generation, prompt templates/enhancement, model/version identifiers, resolution, count, seed and bounded provider parameters. SeaArt, Eden, Cloudflare and Pollinations are constructed providers. SeaArt model/LoRA browsing, character workflow and additional legacy providers are still open; a provider name or preference alone does not make those functions available. Generated images use shared media ownership and visibility controls.

The Games page offers Pokémon collections, packs, trades, gym battles and seasons. Its Pokédex searches loaded sets by name, card ID, type or national Pokédex number and shows your owned counts. Download your collection as JSON, or an owned card as PNG when provider downloads are enabled. Owners load sets and grant packs; the Eevee pack becomes available when at least nine Eevee-family cards are loaded.

Linked chat users can use `!pokemon help` for team, trade and battle commands, including on Discord. Trades use the same inventory and atomic acceptance as the web controls. Add the Pokémon pack, collection, trade or gym-battle widget to an overlay for card art, trade offers and battle HP. These widgets still need live OBS and phone acceptance.

## Release status

The configured main-branch promotion targets the Apollo Sprite `testing-968/web-terminal`. Its successful deployment does not replace any Fly app in `mtman-new`. Provider credentials, outbound execution policy, authenticated browser use, migration reconciliation and rollback rehearsal are separate acceptance requirements.

Continue the current StreamWeaver checklist before starting the next live-app audit. The next app receives its own source audit and documentation delta.

## Discord check-in groups

Owners can open StreamWeaver → Stream operations → Import Discord check-in group, enter a server and role configured in Discord Stream Hub, and choose partner, crew, mod or community. Import again to refresh the saved roster. This is an explicit snapshot, not continuous Discord synchronization. Bots are excluded. Use **Edit / invite override** on a partner to set its invitation link; refresh preserves that override and removes people who left the imported role without changing manual partners.

Discord Stream Hub must be installed and connected, and its bot must have access to the server and member-list intent. Live lookup is unavailable when provider access is disabled. Both app pages must use the same workspace. Check-in retries keep the originally recorded totals and partner even if the roster later changes. Bulk rides, front-seat rewards and AI/spoken check-in greetings remain in the parity checklist.

To price a check-in, configure a reward first, then set its ID on the partner using **Edit / invite override**. The check-in buttons show the accepted currency and current price. The same reward can charge local points, award local points, restrict the first successful claim, or accept SPMT XP at the supply ratio. One reward can be assigned to one partner; a Twitch menu redemption of that reward also records the check-in. Unlinked users cannot use priced check-ins, and insufficient funds do not record a check-in. `!checkin <partner-id> spmt <maximum-xp>` explicitly caps chat spending. Retries resume the original payment; they do not create another charge or award.

## Eden image models

Image Studio has a separate **Eden image model** selector for your private settings and, for owners, public chat settings. Choose a catalog model and save; **Worker default** uses the operator’s configured default. The active image worker refreshes the provider catalog hourly and keeps the last successful catalog during an outage. The timestamp identifies that cached list. Reopen or reload Image Studio to see a refreshed catalog. Selecting a model now reaches the Eden generation request; SeaArt model/version fields remain separate. Provider availability, parameters and costs depend on the selected model.

Image Studio also has **Check image prompts before generation** for public and private settings. It defaults on for public chat and off for private generation, matching the live StreamWeaver settings. Owners control the public switch; each user controls their private switch. When enabled, Eden checks the final prompt before an image provider runs. A blocked prompt or unavailable checker stops generation. These app checks do not change the image provider’s own content rules.

### TikTok live observations

In StreamWeaver → Accounts & Chat, the workspace owner can set a TikTok username and enable its read-only live source. The status refreshes every five seconds and shows connection state, received observations, viewers and likes. Chat, completed gift streaks, ordinary gifts, follows, shares and likes appear in shared chat. Failed delivery queues retry; disabling or changing the source clears its pending observations.

The source requires active operation and enabled StreamWeaver and Chat Gateway installations. TikTok does not provide a public chat-send API through this connector. These observations do not establish verified account identity, run commands or award points. The deployed private, outbound-disabled environment does not connect until its operating restrictions are deliberately changed. Real TikTok/signing access still requires acceptance.

### Gift event bindings

A retained `gift-sub` command now receives Twitch's aggregate gifted-subscription event when no enabled `gift-bomb` command is configured. If both are enabled, `gift-bomb` takes precedence and only one flow runs. `{count}` expands to the gifted-subscription quantity; `{user}` remains the gifter. Local event awards still use the single `twitch:gift-bomb` award policy and its durable receipt.

### Check-in greetings and speech

Owners can enable **Check-in greetings** in Stream operations, choose a fallback message and voice, and optionally enable AI text, spoken greetings or delivery to the configured Discord channel. `{user}` is the viewer's display name and `{partner}` is the check-in partner. Greetings remain off until configured.

Successful web, chat and Twitch-menu reward check-ins queue their presentation after settlement. A failed payment produces no greeting. Presentation retries reuse the original check-in and payment; they do not charge again. AI failures use the fallback, and pending AI jobs wait without blocking the check-in. Disabling greetings stops pending presentation tasks. Speech uses the public Speech / TTS player in Overlay Bay. Provider and OBS/audio acceptance remain required.

### Space Mountain bulk rides

1. Import a Discord role into the **community** check-in group. Refresh that role when membership changes.
2. Create an enabled reward with the ride's cost, accepted currency and any first-claim rule. Use a separate reward from individual partner check-ins.
3. In **Space Mountain rides**, select that reward ID and enable rides. Viewers use its normal reward button, its one-point Twitch menu entry, or `!checkin --ride`. For SPMT, use the reward button's displayed price or `!checkin --ride spmt <maximum XP>`.

Riders must have existing Discord and Twitch links to the same Apollo account and be present in the streamer's current Twitch chat list. Display names do not establish eligibility. The current implementation supports up to 500 imported community entries, 2,000 current chatters and 200 eligible riders. Lookup failure or an empty eligible list stops the ride before payment.

After payment, a front-seat rider receives **100 streamer points**. Selection prefers people outside the recent-winner window, retains the last 20 winners and falls back to all riders when everyone has won recently. The ride uses the configured reward's normal local/SPMT pricing and awards; the front-seat bonus is additional local currency. No SPMT XP is created or converted.

Rider eligibility and reward terms freeze for a request. Interrupted rides resume with the same payment, winner and bonus receipts. Every rider contributes to check-in statistics, with one bulk overlay reveal. Optional check-in greeting/speech settings also apply. Imported membership is an owner-refreshed snapshot; refresh it before relying on new role changes.

### Cloudflare image generation

Image Studio now offers **Cloudflare → FLUX.1 Schnell** in both private and public generation settings when its worker credentials are configured. It supports one to four images, a seed and 1–8 steps. Cloudflare uses its own default image size; the resolution selector applies to Eden/SeaArt. Prompts must fit within 2,048 characters. The additional model choices are described below. LoRAs and reference-image workflows remain pending.

Private results go to Media Files. Public chat image actions publish managed image links that expire after seven days and can be revoked or deleted through Media Files. Storage retries reuse the generated images. Existing prompt-check controls apply; when enabled, checks still require the configured Eden moderation service. Inactive or sandbox runtimes do not call Cloudflare.

### Pollinations image generation

Image Studio now offers **Pollinations** with a worker-refreshed image-model catalog and a saved model choice for each private/public scope. Choose a supported image model, resolution, count and seed. A zero seed requests fresh seeds; selected models determine which settings they honor. Advanced provider-parameter JSON must be empty for this adapter.

Completed images use the same managed storage as Cloudflare: private results stay in Media Files, and public image actions receive revocable links with seven-day expiry. The worker needs its own configured Pollinations API key and provider allowance. Existing application prompt checks remain effective. Actual provider/budget and rendered-output acceptance remain open.

### Completed image replies and overlays

When a chat image or cross-app action takes longer than the initial wait, StreamWeaver acknowledges that it is queued and later replies to the original message with the completed result. Pending replies survive a restart and retry provider outages without starting another job or charging again. Failed jobs receive a short failure reply; activity retains the details. Delivery pauses when that chat destination is inactive.

Add **Generated images** from StreamWeaver’s overlay widgets to show completed public chat images for 30 seconds. The widget displays up to four images and the requester’s chat name. Private Image Studio images stay private. Both fast and delayed public image jobs feed this widget. Real OBS rendering and provider delivery still need live acceptance.

### Additional Cloudflare image models

Cloudflare now offers FLUX.2 Klein 4B, Lucid Origin and Phoenix 1.0 for public or private generation, plus FLUX.2 Klein 9B for private generation only. Save the model in the appropriate Image Studio settings. All support one to four images and prompts up to 2,048 characters. Unlike FLUX.1 Schnell, these models use the selected resolution.

Klein runs a fixed four steps. Lucid accepts 1–40 steps; Phoenix accepts 1–50. Advanced JSON uses `steps` and `guidance_scale` (0–10, or 2–10 for Phoenix); Phoenix also supports `negative_prompt`. Unsupported settings fail before the provider request. Reference-image uploads are not yet available. Provider account/model access and actual rendered output still require acceptance.
