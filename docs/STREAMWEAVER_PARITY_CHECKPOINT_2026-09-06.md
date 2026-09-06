# StreamWeaver parity checkpoint — 6 September 2026

**Audit remains open. Do not retire `streamweaver-new`, delete its data, or treat this checkpoint as approval for a Fly cutover.** This tracks the original 18 absent and 21 partially wired capability groups against Apollo's actual production construction, not merely exported helpers. Equivalent ecosystem implementations are acceptable; provider acceptance and tenant-data migration are separate gates.

The [discovery audit](donor-audits/STREAMWEAVER_LIVE_AUDIT_2026-09-06.md) is pinned to live donor commit `4cb3c654b7e2c7a88ae5ec63c246f9902cc781af`, including the live filesystem patch set captured during that audit. Earlier reviews against repository main are historical.

## Deployment evidence

- First parity release: Apollo commit `47d42803405d2eed23b4704442758be4cbcc65e7`, 853 passing offline tests. [Sprite promotion succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34051365096); [Green Contracts succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34051365110).
- The existing push-to-main workflow targets `testing-968/web-terminal`, at `https://web-terminal-bvesa.sprites.app`. This is the configured Apollo deployment, not a replacement of the 13 Fly apps in `mtman-new`.
- This checkpoint's follow-up adds private assistant memory and replay, private image production and controls, public speech, welcome/shoutout/BRB producers, Twitch menu creation, and durable flow speech/points behavior.
- Public HTTP probing currently reaches Sprite authentication. No authenticated phone-browser, real Twitch reward, Discord delivery, paid speech/image response, or live HearMeOut audio acceptance is claimed by an offline test or a green deployment.

## Currency decisions that must survive every port

Twitch's one-point reward is a menu entry. A Twitch-funded notification does not waive the reward's configured streamer-currency requirement. Insufficient funds must reject the configured redemption; cancellation/refund requires a reward the configured Twitch application is permitted to manage. Rewards can charge local points, award them, or award once to the first successful claimant. Each reward chooses local currency, SPMT XP, or either.

The Points page displays both ratio directions and outstanding spendable totals. It refreshes every five seconds, on focus, and after local wallet changes. No local-point-to-XP conversion, XP minting, reserve, or treasury is created.

`XP price = local price × outstanding spendable SPMT XP / this streamer's outstanding local points`

Thus 100 local points costs 10 XP with 1,000,000 local / 100,000 XP outstanding, and 1 XP with 10,000,000 local / 100,000 XP. The inverse label is `1 XP = local supply / XP supply local points`. Zero-supply and integer-price behavior remain explicit in the implementation. Lifetime XP is not the spendable denominator. Canonical XP wallets retain their existing tenant scope; the aggregate rate is not a claim that wallets have been merged.

## Original 39 groups

“Implemented” describes code and offline coverage; it does not mean live provider acceptance has passed.

| # | Audit group | Current implementation and remaining work |
| --- | --- | --- |
| 1 | Pinned Athena speech | Shared Stellar speech worker, Deepgram primary, same-voice Eden failover, validation and cooldowns implemented. Credentialed provider and deployed-worker acceptance remain. |
| 2 | Transcription | Private recording upload, shared transcription jobs and StreamWeaver recording UI implemented. HearMeOut bot-card fallback is not connected to these production ports. |
| 3 | Voice catalog/preferences | Persisted voice, spoken-reply and Remember settings, actual private speech playback implemented. GIF preference alone does not implement GIF delivery. |
| 4 | Say/TTS lifecycle | Public Say tasks, published audio events and overlay playback implemented. Stream/listener discovery and consumer-presence controls remain. |
| 5 | Public HearMeOut persona speech | Coordinator contracts exist, but production speech transport is not constructed. The fallback currently queues text without completing the room reply. Public persona discovery/eligibility and room audio acceptance remain. |
| 6 | Private conversation | User/tenant-scoped persisted conversation, optional note context, bounded raw retention, clear/cancel, named summaries and browser replies implemented. Private Discord conversation delivery/settings remain. |
| 7 | Private Discord controls | Signed message-scoped controls, DM resolution, finalization, toggles and deletion remain unported. |
| 8 | Spoken-turn feed | Authenticated incremental feed with monotonic cursor and clear-epoch reset implemented; private web replies can synthesize speech. Private Discord feed integration remains. |
| 9 | Long-term memory | Private manual named summaries and automatic condensation after 20 new completed turns implemented. Public condensation and donor message-count adjustment remain. |
| 10 | Person notes | Private subject/person notes, CRUD and opt-in assistant context implemented in Stellar/StreamWeaver. The legacy MountainView-specific endpoint is not copied. |
| 11 | Persona optimizer | Shared assistant job creates a draft; owner explicitly puts it into the editor and saves. No automatic persona overwrite. Provider acceptance remains. |
| 12 | Private image gallery | Generation worker imports approved provider images into shared private binary assets; Image Studio carousel and Media Files lifecycle implemented. Discord carousel/delivery remains. |
| 13 | Image providers | SeaArt and Eden production providers plus fallback are constructed. Cloudflare, Perchance and Pollinations are not implemented; this is not five-provider parity. |
| 14 | Generation studio | Model/version, resolution, count, seed, prompt templates and bounded Eden provider parameters implemented. Full model/LoRA browsing and character-ID workflow remain. |
| 15 | Generation access | Persisted public everyone/mods/off policy and per-user private settings implemented; worker enforces current public policy across suite entry points. Separate legacy content-policy controls remain. |
| 16 | Prompt enhancement/fallback | Production Qwen enhancer, original-prompt fallback on enhancement failure, SeaArt/Eden chain implemented. External provider acceptance remains. |
| 17 | YouTube | Poll/send driver, discovery and grant refresh implemented. Account OAuth management and membership/Super Chat normalization remain. |
| 18 | TikTok | Running connector for chat/gifts/follows/shares/likes/room users and connection controls remains unported. |
| 19 | Social Stream | Compatible authenticated ingestion, normalization and status adapter remains unported. |
| 20 | Shared-chat desk | Pin, queue, feature, clear, next, auto controls and durable selected-message snapshots implemented. Selected messages survive eviction from the current 500-message feed. |
| 21 | Featured overlay | Dedicated selected-message renderer, hold-until-cleared duration, style and restart behavior implemented. Authenticated OBS/browser acceptance remains. |
| 22 | Saved chat workspace | Per-user filters, persistent selection and visible-page refresh implemented. |
| 23 | Rich chat/diagnostics | Operator-facing sanitized ingestion errors implemented. Rich attachment normalization and operator replay remain. |
| 24 | Twitch EventSub | Subscription/reconnect and reward/event ingress implemented. Actual broadcaster authorization and live redelivery/reconnect acceptance remain. |
| 25 | Redeems | Management UI, local/XP policy, balance checks, signed awards, first claim, replay protection, and one-Twitch-point menu creation/binding implemented. Validate live fulfillment/cancellation using the managing Twitch app. |
| 26 | Non-chat automation | EventSub event bindings can reach installed flows. Remaining platform-specific award-helper wiring and unavailable TikTok sources remain. |
| 27 | Welcome/walk-on | Atomic per-session welcome state, known-bot exclusions, durable welcome/shoutout tasks and production effect adapters implemented. Live session/provider acceptance remains. |
| 28 | Manual/voice shoutouts | Spoken-name matching, mode controls, clips, chat, public TTS and configured Discord destination implemented. Custom AI greetings, detailed configuration and audit download remain. |
| 29 | BRB | Broadcaster/viewer clip selection, durable start/stop program and timed Twitch-embed renderer implemented. Live clip/audio/browser acceptance remains. |
| 30 | Check-ins | Persistent check-ins, source/count displays and overlay implemented. Discord role lookup, invitation overrides and reward-flow details remain. |
| 31 | Translation | Shared production Qwen translation and stable request keys implemented. Actual translation/provider acceptance remains. |
| 32 | Watch time | Production Twitch chatter-minute snapshots and command service implemented. Validate real poll behavior and shared-presence ownership before cutover. |
| 33 | Pokémon collection/packs | Persistent API, UI, packs and collection command service implemented. Full card download/Pokédex details and team/attack command arguments require comparison. |
| 34 | Pokémon trading | Atomic persistent offers/acceptance and web trade UI implemented. Discord interaction presentation remains. |
| 35 | Gym/seasons | Persistent gym/season management UI implemented. Dedicated donor-overlay parity remains partial. |
| 36 | Legacy graph actions | Explicit speech and signed point steps added to bounded action types; speech resumes its saved job, points return a saved balance. Arbitrary scripts remain preserved but disabled until rewritten as supported capabilities. |
| 37 | Legacy sub-actions/triggers | Import preserves unsupported source and disables unmapped commands; some non-chat bindings run. Every retained live definition still needs a runnable mapping and migration acceptance. |
| 38 | Special bot administration | Known-bot welcome exclusion and existing canonical provider/tenant configuration available. Fleet/gift-bot admin, whitelist and role-specific account workflows remain. |
| 39 | State migration/restore | Flow archive import/export exists. No complete live export, balance/XP reconciliation, inventory/trade/check-in/media migration, secret remapping or rollback rehearsal has been performed. |

## Verification and next gate

The follow-up tests exercise private user/tenant isolation, memory opt-in, cancellation and late completions, cursor replay/reset, image-provider fallback and private settings, unsafe download rejection, public-image policy at worker execution, welcome/shoutout/BRB wiring, featured-message persistence, browser-bundle parsing, and speech-to-points flow sequencing/failure/retry behavior. Repository build and full offline results must be green for the commit being promoted.

Do not conflate generated-script parsing with rendered phone UI acceptance. Provider execution may remain disabled in an outbound-disabled deployment even though the implementation is installed.

The remaining code rows above must be finished before declaring feature parity. Then obtain authenticated runtime and tenant-export access, rehearse migration against a copy, reconcile canonical identities and both currencies, test provider effects and rollback, and only then decide which live app can be replaced. No branch deletion or live-app shutdown is warranted by this checkpoint.
