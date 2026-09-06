# StreamWeaver parity checkpoint — 6 September 2026

**Audit remains open. Do not retire `streamweaver-new`, delete its data, or treat this checkpoint as approval for a Fly cutover.** This tracks the original 18 absent and 21 partially wired capability groups against Apollo's actual production construction, not merely exported helpers. Equivalent ecosystem implementations are acceptable; provider acceptance and tenant-data migration are separate gates.

The [discovery audit](donor-audits/STREAMWEAVER_LIVE_AUDIT_2026-09-06.md) is pinned to live donor commit `4cb3c654b7e2c7a88ae5ec63c246f9902cc781af`, including the live filesystem patch set captured during that audit. Earlier reviews against repository main are historical.

## Deployment evidence

- First parity release: Apollo commit `47d42803405d2eed23b4704442758be4cbcc65e7`, 853 passing offline tests. [Sprite promotion succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34051365096); [Green Contracts succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34051365110).
- The existing push-to-main workflow targets `testing-968/web-terminal`, at `https://web-terminal-bvesa.sprites.app`. This is the configured Apollo deployment, not a replacement of the 13 Fly apps in `mtman-new`.
- This checkpoint's follow-up adds private assistant memory and replay, private image production and controls, public speech, welcome/shoutout/BRB producers, Twitch menu creation, and durable flow speech/points behavior.
- Public HTTP probing currently reaches Sprite authentication. No authenticated phone-browser, real Twitch reward, Discord delivery, paid speech/image response, or live HearMeOut audio acceptance is claimed by an offline test or a green deployment.

- Second parity release: `e1159a8970c3ae7ab6e731fd42524ee90eb885d6`, 867 passing offline tests. [Sprite promotion succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34054028644); [Green Contracts succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34054028650).
- The current follow-up adds room completion/audio, listener diagnostics, public memory, Social Stream/private inbox, rich chat/replay, shoutout AI/settings/audit, YouTube event metadata and local provider awards. The repository build and all 886 offline tests passed for this batch. This batch is commit `d946fb8c97f4088fa1a12e5ba8e6e22ae6ba8b51`: [Sprite promotion succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34057679893), and [Green Contracts succeeded](https://github.com/Mtman1987/ApolloStation/actions/runs/34057679880).
- The YouTube OAuth follow-up and removal of obsolete conversion controls passed the repository build and all 889 offline tests (four concurrent test files). Commit `5460fb91e4ca55b9a0fe872271c2e23b8bacaf76` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34058968829) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34058968828).
- Native Discord correction follow-up: repository build and all 893 offline tests passed. Commit `c7b2c6947590f96c1e20a20f419f6628831321b0` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34059393089) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34059393063).
- Public room-persona follow-up: repository build and all 899 offline tests passed after integrating the concurrent flow-authoring and structured-output fixes, including actual owner-publication and room catalog/invocation routes. Commit `0d15db68792d96075ef70229bb9abd339c43b8c6` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34060332653) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34060332510).
- Pokémon completion follow-up: repository build and all 904 offline tests passed after preserving the concurrent AI draft-recovery change. Commit `8422988f610b3b01df6f025236bb72d61396d409` passed Green Contracts. [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34061410914) succeeded on retry after an occupied ephemeral test port affected the first attempt.
- Discord role-import and check-in retry follow-up: repository build and all 908 offline tests passed. Commit `d68affd11b821bb9292a35f1940da6fe2c3933e9` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34061876471) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34061876465).
- Reward-backed check-ins follow-up: repository build and all 913 offline tests passed, including paid-crash recovery, stable SPMT quotes, first-claim awards and browser retry after refresh failure. Commit `ba3a3659fe159f6a591f558ce973e3d6d5f05141` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34062248504) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34062248507).
- Eden model catalog/selection follow-up: repository build and all 915 offline tests passed. Commit `80195bf5dca9797f6f331ecbc4326a5767ddca5b` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34062599541) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34062599623).
- Public/private image prompt-check follow-up: repository build and all 917 offline tests passed. Commit `bd882cc3d9f98e8e953c7b43cf6cf35bdd902650` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34062986011) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34062985989).
- TikTok read-only source follow-up: repository build and all 923 offline tests passed, including cancelled handshakes/reconnect backoff, durable retry, all six event types, owner controls and canonical workspace/service boundaries. Commit `2e337d801812a0d19d1e10f747c376cbe4227f51` passed [Sprite promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34063980154) and [Green Contracts](https://github.com/Mtman1987/ApolloStation/actions/runs/34063980160).
- The user guide and integration reference are served at `/docs` and `/docs/developers/streamweaver`, with this checklist at `/docs/streamweaver/parity`.

## The 15 remaining groups from the follow-up request

“Code implemented” still requires authenticated/provider acceptance. Partial groups remain open; this is not a new audit of the other live apps.

| Group | Current status | Remaining requirement |
| --- | --- | --- |
| 1. HearMeOut persona and voice | Code implemented | Owner-published persona snapshots, public discovery/eligibility, persona-specific room jobs, selected voice, recording and completed browser/RTC playback implemented. Live room acceptance remains. |
| 2. Private Discord assistant | Open | DM setup, signed message controls, GIF/TTS delivery, deletion and image carousels. |
| 3. Public TTS players | Code implemented | Owner stream/widget listing, recent listener presence and playback status. Authenticated OBS/audio acceptance remains. |
| 4. Public memory | Code implemented | Public-only channel condensation, manual count adjustment, clear and saved-job lifecycle. Inference acceptance remains. |
| 5. Image Studio completion | Partial | SeaArt/Eden generation and worker-backed Eden model discovery/selection implemented. Separate public/private prompt checking is now enforced at the worker. SeaArt catalog/LoRA browsing, character workflow and additional legacy providers remain. |
| 6. YouTube | Code implemented | Account linking, owner offline chat consent, credential authority, gateway discovery/disconnect and canonical viewer resolution implemented. Google client configuration and live broadcast/send/refresh acceptance remain. |
| 7. TikTok | Code implemented; live acceptance open | Owner controls, read-only connector lifecycle, chat/gift/follow/share/like/viewer observations and durable shared-chat delivery. Real account/signing access acceptance remains. |
| 8. Social Stream | Code implemented | Authenticated public/private ingestion, metadata, status, rotation, edit/delete and owner inbox. External hosting-auth acceptance remains. |
| 9. Rich chat and replay | Code implemented | Discord attachments, native partial edits and single/bulk deletions, Social Stream media/edit/delete and validated projection replay implemented. Live provider and output checks remain. |
| 10. Platform event awards | Partial | Atomic configurable Twitch EventSub and YouTube event award consumer implemented. YouTube canonical identity uses verified OAuth links; TikTok verified identity/award consumers and remaining donor helper mappings remain. |
| 11. Shoutouts | Code implemented | AI/fallback greetings, owner voice/cooldown/exclusion/Discord settings and audit download. Provider/voice acceptance remains. |
| 12. Check-ins | Partial | Explicit owner Discord role import/refresh, invitation overrides and durable retry outcomes implemented. Reward-backed web/chat/Twitch-menu check-ins now reuse local/XP settlement and first-claim policies. Bulk rides/front-seat selection and bonuses, plus AI/spoken greetings remain. |
| 13. Pokémon | Code implemented | Shared Discord/chat team, trade and battle commands, searchable Pokédex, owned PNG/collection JSON downloads, Eevee packs and dedicated card/trade/HP widgets implemented. Live provider and rendered overlay acceptance remain. |
| 14. Legacy triggers/sub-actions | Open | Every retained unsupported live definition needs an explicit runnable equivalent and migration acceptance. |
| 15. Special bot administration | Open | Fleet, gift-bot, whitelist and role-specific account controls. |

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
| 2 | Transcription | Private recording upload, shared transcription jobs and StreamWeaver recording UI implemented. HearMeOut recording fallback now uploads private media and reconciles shared transcription jobs. Live microphone/provider acceptance remains. |
| 3 | Voice catalog/preferences | Persisted voice, spoken-reply and Remember settings, actual private speech playback implemented. GIF preference alone does not implement GIF delivery. |
| 4 | Say/TTS lifecycle | Public Say tasks, published audio events and overlay playback implemented. Owner stream/widget discovery, 15-second listener presence and completion-based playback are implemented. Live listener acceptance remains. |
| 5 | Public HearMeOut persona speech | The shared fallback now completes room text replies, resumes private speech jobs and mixes playback into the member’s active RTC stream. Owner-published persona discovery and eligibility now feed canonical persona-specific room jobs and the selected voice. This production path replaces the optional legacy coordinator dependency. Live room audio acceptance remains. |
| 6 | Private conversation | User/tenant-scoped persisted conversation, optional note context, bounded raw retention, clear/cancel, named summaries and browser replies implemented. Private Discord conversation delivery/settings remain. |
| 7 | Private Discord controls | Signed message-scoped controls, DM resolution, finalization, toggles and deletion remain unported. |
| 8 | Spoken-turn feed | Authenticated incremental feed with monotonic cursor and clear-epoch reset implemented; private web replies can synthesize speech. Private Discord feed integration remains. |
| 9 | Long-term memory | Private manual named summaries and automatic condensation after 20 new completed turns implemented. Public-only channel condensation, owner count adjustment and clear/late-completion protection are now implemented; private canonical context is excluded from stream replies. |
| 10 | Person notes | Private subject/person notes, CRUD and opt-in assistant context implemented in Stellar/StreamWeaver. The legacy MountainView-specific endpoint is not copied. |
| 11 | Persona optimizer | Shared assistant job creates a draft; owner explicitly puts it into the editor and saves. No automatic persona overwrite. Provider acceptance remains. |
| 12 | Private image gallery | Generation worker imports approved provider images into shared private binary assets; Image Studio carousel and Media Files lifecycle implemented. Discord carousel/delivery remains. |
| 13 | Image providers | SeaArt and Eden production providers plus fallback are constructed. Cloudflare, Perchance and Pollinations are not implemented; this is not five-provider parity. |
| 14 | Generation studio | Model/version, resolution, count, seed, prompt templates and bounded Eden provider parameters implemented. Worker-backed Eden model catalog and actual saved model selection now implemented. SeaArt model/LoRA browsing and character-ID workflow remain. |
| 15 | Generation access | Persisted public everyone/mods/off policy and per-user private settings implemented; worker enforces current public policy across suite entry points. Separate public/private prompt-moderation controls are now implemented, with current owner policy enforced for public jobs. Live provider acceptance remains. |
| 16 | Prompt enhancement/fallback | Production Qwen enhancer, original-prompt fallback on enhancement failure, SeaArt/Eden chain implemented. External provider acceptance remains. |
| 17 | YouTube | Poll/send driver, discovery and grant refresh implemented. Membership, milestone, gifted membership, Super Chat and sticker metadata now normalize into the rich feed. Account OAuth, owner chat consent, discovery/disconnect and canonical viewer linking are implemented in the follow-up. Credentialed acceptance remains. |
| 18 | TikTok | Read-only connector, owner controls, reconnect/backoff, durable chat/gifts/follows/shares/likes/viewer delivery implemented. Real provider/signing access and live acceptance remain. |
| 19 | Social Stream | Tenant-key authenticated public/private ingestion, safe rich normalization, edit/delete, status/rotation/disable and owner-only private inbox implemented. External Sprite-auth/bridge acceptance remains. |
| 20 | Shared-chat desk | Pin, queue, feature, clear, next, auto controls and durable selected-message snapshots implemented. Selected messages survive eviction from the current 500-message feed. |
| 21 | Featured overlay | Dedicated selected-message renderer, hold-until-cleared duration, style and restart behavior implemented. Authenticated OBS/browser acceptance remains. |
| 22 | Saved chat workspace | Per-user filters, persistent selection and visible-page refresh implemented. |
| 23 | Rich chat/diagnostics | Operator-facing sanitized ingestion errors implemented. Discord attachments, YouTube event metadata, Social Stream rich/edit/delete and validated-message replay implemented. Native Discord partial edits and single/bulk deletes now use a durable correction path with selected-message cleanup. Live acceptance remains. |
| 24 | Twitch EventSub | Subscription/reconnect and reward/event ingress implemented. Actual broadcaster authorization and live redelivery/reconnect acceptance remain. |
| 25 | Redeems | Management UI, local/XP policy, balance checks, signed awards, first claim, replay protection, and one-Twitch-point menu creation/binding implemented. Validate live fulfillment/cancellation using the managing Twitch app. |
| 26 | Non-chat automation | EventSub event bindings can reach installed flows. Owner-configured atomic local-point awards now consume Twitch EventSub and verified YouTube event metadata. Retained gift-sub bindings now receive aggregate gifts through a single-flow fallback alias. Remaining donor helper mappings and TikTok verified identity/award consumers remain; YouTube requires a verified account link. |
| 27 | Welcome/walk-on | Atomic per-session welcome state, known-bot exclusions, durable welcome/shoutout tasks and production effect adapters implemented. Live session/provider acceptance remains. |
| 28 | Manual/voice shoutouts | Spoken-name matching, mode controls, clips, chat, public TTS and configured Discord destination implemented. Saved AI greeting jobs with fallback, owner voice/cooldown/exclusion/Discord controls and a tenant-scoped audit download are now implemented. External acceptance remains. |
| 29 | BRB | Broadcaster/viewer clip selection, durable start/stop program and timed Twitch-embed renderer implemented. Live clip/audio/browser acceptance remains. |
| 30 | Check-ins | Persistent check-ins, source/count displays and overlay implemented. Owner-scoped Discord role import/refresh and invitation overrides now available; reward-backed check-ins now use shared settlement. Bulk rides/front-seat bonuses and AI/spoken greetings remain. |
| 31 | Translation | Shared production Qwen translation and stable request keys implemented. Actual translation/provider acceptance remains. |
| 32 | Watch time | Production Twitch chatter-minute snapshots and command service implemented. Validate real poll behavior and shared-presence ownership before cutover. |
| 33 | Pokémon collection/packs | Persistent API/UI, Eevee packs, searchable Pokédex, owned PNG/collection JSON downloads and full team/attack command arguments implemented. Live download acceptance remains. |
| 34 | Pokémon trading | Atomic persistent offers/acceptance, web trade UI and shared Discord chat commands implemented. Dedicated trade overlay shows offered cards and acceptance; live presentation acceptance remains. |
| 35 | Gym/seasons | Persistent gym/season UI, shared battle commands and dedicated team/HP/turn overlay implemented. Live overlay acceptance remains. |
| 36 | Legacy graph actions | Explicit speech and signed point steps added to bounded action types; speech resumes its saved job, points return a saved balance. Arbitrary scripts remain preserved but disabled until rewritten as supported capabilities. |
| 37 | Legacy sub-actions/triggers | Import preserves unsupported source and disables unmapped commands; some non-chat bindings run. Every retained live definition still needs a runnable mapping and migration acceptance. |
| 38 | Special bot administration | Known-bot welcome exclusion and existing canonical provider/tenant configuration available. Fleet/gift-bot admin, whitelist and role-specific account workflows remain. |
| 39 | State migration/restore | Flow archive import/export exists. No complete live export, balance/XP reconciliation, inventory/trade/check-in/media migration, secret remapping or rollback rehearsal has been performed. |

## Verification and next gate

The follow-up tests exercise private user/tenant isolation, memory opt-in, cancellation and late completions, cursor replay/reset, image-provider fallback and private settings, unsafe download rejection, public-image policy at worker execution, welcome/shoutout/BRB wiring, featured-message persistence, browser-bundle parsing, and speech-to-points flow sequencing/failure/retry behavior. Repository build and full offline results must be green for the commit being promoted.

Do not conflate generated-script parsing with rendered phone UI acceptance. Provider execution may remain disabled in an outbound-disabled deployment even though the implementation is installed.

The remaining code rows above must be finished before declaring feature parity. Then obtain authenticated runtime and tenant-export access, rehearse migration against a copy, reconcile canonical identities and both currencies, test provider effects and rollback, and only then decide which live app can be replaced. No branch deletion or live-app shutdown is warranted by this checkpoint.

- Gift-sub compatibility follow-up: build and all 924 offline tests passed. Exact gift-bomb binding takes precedence over the retained gift-sub alias; one source event retains one local award receipt. Promotion remains to be verified.
