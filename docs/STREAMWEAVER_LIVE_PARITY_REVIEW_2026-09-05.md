# StreamWeaver live parity review — 2026-09-05

This release restores the missing command editor, fixes execution and delivery defects, and makes the existing runtime more usable in Apollo. It is **not a claim of complete StreamWeaver live parity**. The remaining gaps below include implementation work, not just credentials. A command catalog, exported function, or capability declaration is not proof that a feature is connected to the deployed runtime.

## Evidence and scope

| Source | Revision | What was inspected |
| --- | --- | --- |
| [Current StreamWeaver repository](https://github.com/Mtman1987/streamweaver/tree/d4327a16feebf1661b5b3fbbf13e93580228e9b0) | `d4327a16feebf1661b5b3fbbf13e93580228e9b0` | Navigation, dashboard, commands, action/flow editor and runtime, integrations, Bot Functions, currency, redeems, Voice Reply, and route inventory |
| ApolloStation | Baseline `852209f972063df346b9e4c8a1c20e6d6f98ff4a`, plus this release | Actual app web server, authenticated controls, installed-flow consumer, provider runtime, simulation runtime, stores, and tests |
| [Existing ownership contract](STREAMWEAVER_FLOW_AND_OVERLAY_OWNERSHIP.md) | Current Apollo contract | Individual flow packages, blank initial installs, shared identity/jobs, Overlay Bay, and persistent Simulation Rooms |

The source comparison uses a fresh checkout of the current counterpart repository, not a frozen donor mirror. The live health URL was not accessible through the available public lookup, so this report does not assert that the running Fly instance serves that exact revision. Phone browser rendering and real provider delivery were not observed in this session. Generated browser code was executed in a DOM harness; the authenticated application routes were exercised through the integrated Apollo HTTP host.

## What was broken and what changed

| Defect in Apollo | Repair | Concrete example |
| --- | --- | --- |
| Creating a command required AI or pasted JSON | A manual Flow Builder edits names, descriptions, triggers, aliases, match modes, cooldowns, related commands, ordered steps, and action settings | Create `!welcome`, add a chat reply containing `Welcome %userName%!`, save a private draft, then enable/install it |
| Community flows could be installed or removed but not conveniently customized | Create a private copy, edit it, and publish it separately; original community packages remain intact | Customize `!boop` into `!greet` without changing `mtman1987.boop` for anyone else |
| No pause/resume control | Tenant-specific installation enable state, persisted in SQLite | Pause one noisy command flow while retaining its package and configuration; resume it later |
| Concurrent edits could silently replace a draft | Saves require the draft's last update marker; timestamps advance even for rapid saves | A second tab saving an old version gets a reload error instead of erasing newer work |
| Execution used the order of the package's action array rather than the command's configured wiring | Execute `command.actionIds` in order | A value-setting step runs before the reply that uses it, even when the exported array lists the reply first |
| Chat replies were combined and delayed until every step finished | Send each chat step at its execution point, with a distinct stable delivery key | “Starting now” appears before a later action runs; a later failure does not erase that earlier reply |
| Flow cooldown values were unused | Enforce the configured per-actor cooldown, bounded by tenant, provider, channel, package, and command | A second `!hi` within the `!hello` flow's ten-second cooldown is told how long to wait |
| Retry after a late failure could rerun earlier steps | Persist completed step receipts; reuse the same gateway delivery key when retrying a chat send | A Discord message sent before a later native-action failure is not recreated by the subsequent retry |
| Renaming a command could make its native action stop matching | Explicit native bindings resolve their selected native command independently of the incoming trigger | `!greet` bound to the native boop action produces the boop response |
| `set-variable` and `send-discord` were accepted as package types but had no runtime execution | Implement execution-local values and Discord egress through Chat Gateway | Set `greeting=Welcome`, reply `{{greeting}} %userName%`, or send a message to an explicitly configured Discord connection/channel |
| Unsupported code/HTTP/OBS steps could appear to complete | Preserve imported configuration but reject enabling unsupported steps; fail truthfully if an old installation reaches one | An imported `execute-code` step remains exportable and editable, but is not reported as executed |
| Provider runtime constructed native services with an empty options object | Wire creator link settings, social event production, and the existing persistent Bic runtime | `!webpage` uses the saved creator URL; `!boop` publishes its real social event; `!bic` updates its real tenant counter |
| Link commands had no usable configuration page | Add validated public HTTPS creator links to Integrations | Save a Discord invitation URL and install the corresponding link flow |
| `!commands` gave a generic direction to a directory | Generate a directory from actual enabled installations, alongside the built-in currency commands | A paused flow drops out of the effective installed-command list |
| Voice completion inspected the wrong JSON level | Read the actual `{ job }` envelope, display terminal output, and stop polling on terminal failure | A succeeded job's reply appears in conversation history rather than leaving “waiting” on screen |
| Voice history was eight transient browser entries and omitted final results | Keep up to fifty tenant/user-scoped entries, restore pending jobs after reopening, record terminal results, and provide clear-history | Reopen Voice Commander and inspect the last delivery result; “Private · do not remember” stays out of this saved history |
| Several scripts replaced `window.fetch` and competed over page content | One page controller owns the app's controls; no fetch replacement or command-page mutation-observer repair loop | Refresh does not erase an unfinished message, rerender the search input on every character, or compete with another command renderer |
| Browser controls used root API URLs even inside the mounted app | Select the app-prefixed control API when loaded under `/apps/streamweaver` | Flow save, persona, links, wallet, and history work through `/apps/streamweaver/api/control/...` |
| Currency management showed settings and a leaderboard but no wallet management | Add owner wallet lookup and add/subtract/set operations with an atomic request receipt | Retry adding ten credits after a network interruption: the balance increases once; changing the amount under the same request key is rejected |
| No useful per-flow execution view | Persist bounded command run records with input, actor, source, ordered steps, output, failure, and cooldown state | Activity distinguishes a completed command from a cooldown rejection or a later failed step |
| BotShare runtime existed without a setting in Apollo | Expose its existing tenant opt-in in Bot & Persona | Both communities still have to opt in before autonomous bot relay is allowed |

The account starts with zero installed flows. The fifty curated packages remain independently selectable. This release does not bulk-install a donor command library.

## Navigation and visual treatment

Apollo's scene, theme tokens, shared home/page visibility behavior, app navigation, and three-slot workspace remain authoritative. The new editor uses the same translucent cards, borders, text colors, and button controls. Forms collapse to one column at narrow widths; cards and fieldsets can shrink within the embedded app; long JSON wraps inside a bounded scrolling dialog.

Community search updates the results list without replacing the input. Initial state is fetched once; later shared snapshots update overlay information without replacing editable forms. The explicit Refresh control updates library/installation state without discarding an open editor. Save errors leave the current draft available.

These are DOM and CSS checks, not a claim that the exact Android layout in the screenshots has been visually verified. The shared page-visibility fix from the DSH release remains in place.

## Live functionality map and port decisions

The live navigation is defined in [its sidebar](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/components/layout/sidebar.tsx). The following table distinguishes a usable replacement from an unresolved gap.

| Live feature | Apollo after this release | Why preserve it / correct destination |
| --- | --- | --- |
| Dashboard and setup progress | Setup Guide, working shortcuts, installed flows, provider state, persona configuration, and shared app/runtime data | Keep the guided route from connection to first tested command. A second dashboard should not become a duplicate stream-presence authority. |
| Feature Library / community sharing | Independent community packages, search, install, customize, native JSON export, private drafts, publication | Preserve one feature per package; choosing a greeting must not install an author's entire library. |
| Chat Commands create/edit/enable | Manual editor and installation pause/resume restored | Basic command creation must work without a paid or networked AI request. |
| Related commands and reusable action wiring | Related commands and ordered bindings are editable in one package | A feature such as lurk/unlurk should travel together without becoming two disconnected imports. |
| Action Steps and live flow execution | Chat, Discord text, wait, execution-local values, native commands, and registered suite actions execute; detailed run history added | Preserve exact order and observable side effects. Activity must show execution evidence rather than a generic event count. |
| General graph editor, branching, conditions, persistent automation variables | **Partial: ordered pipelines only.** No full graph/branching port in this release | Live's graph can choose different branches and carry results between node types. Example: only greet a returning viewer, then select a different action based on the result. This needs a typed graph execution contract, durable resume state, and an editor that preserves edges. |
| AI-response and TTS graph nodes | **Not equivalent.** General assistant jobs exist, but these node types are not wired into Apollo's flow schema | An AI response reused as TTS or as a later step's argument is more than an independent assistant job. Port through Stellar/HearMeOut services and persist the returned job/result reference. |
| Custom script, arbitrary HTTP, direct OBS actions | Imported package settings remain preserved; unsupported execution is blocked | Preserve export and the intended behavior, but replace raw execution with registered, authorized capabilities. An OBS scene change belongs to a paired Companion/OBS capability, not arbitrary server JavaScript. |
| Streamer.bot import/export | Existing single-flow Streamer.bot-shaped export remains; Apollo JSON file import is usable | **Not full Streamer.bot archive import.** Live has a converter for commands/actions/subactions. A broad import must report every unmapped step and preserve its original data; an export compatibility wrapper is not the same as importing a complete archive. |
| Messaging and shared chat | Shared Commlink/Chat Gateway contracts remain; Voice Commander sends to configured provider channels | Preserve source identity and destination selection through those owners. Apollo still lacks the live app's complete messaging/shared-chat operator surface inside StreamWeaver itself. |
| Private Chat | Remembered assistant conversation plus explicit non-remembered input; job output/history repaired | Preserve durable replies and privacy choice. This does not port every live private-chat attachment, research, and media affordance. |
| Voice Commander / Voice Reply | Explicit microphone, editable transcript, AI/private/provider destination, asynchronous result/history | Browser speech recognition is used where available. Live's server transcription/upload route and full Voice Reply recording workflow remain a separate missing port. |
| Bot identity, persona and memory | Existing canonical persona store remains; editable name, aliases, home channels, instructions and memory; BotShare added | Keep StreamWeaver's tenant presentation distinct from persona-neutral Stellar execution. |
| Bot avatar, idle/talking animation and Discord media slots | **Missing usable controls and complete runtime connection** | Live has a preview plus idle/talking assets and separate private/public Discord media. Example: the bot visibly switches state while speaking, and its DM response uses the selected media. Port bounded media storage and rendering through shared asset/overlay contracts. |
| Image-generation settings, models, LoRAs and prompt controls | Image job/runtime code exists; **live settings UI is not fully ported** | Preserve model choice, image count, resolution and prompt controls without moving service credentials into the page. A declared image capability does not replace these controls. |
| Research/knowledge controls | Stellar capability information is available; **research settings UI and equivalent routing are incomplete** | Live exposes research enablement, live search, knowledge packs, sources and caching. Route requests to the shared assistant/research owner while retaining tenant preferences. |
| Broadcaster, bot, community bot and owner-only Count connections | Account identities and configured bot channels are displayed; **role-specific connection management is incomplete** | Preserve distinct connection purposes. Use canonical provider grants and the existing owner gate for TheCountSPMT; do not copy the old OAuth/token stores. |
| Creator links | Restored settings and connected link-command execution | A community flow such as `!discord` needs the tenant's actual invitation, not a default or a source-repo URL. |
| Social interactions and Bic | Actual social events and Bic state are connected to provider execution; configured links also copy into the isolated room runtime | Preserve effects alongside chat text. **Complete social/Bic visual widget delivery remains unproven**; event publication by itself is not proof of an on-stream animation. |
| Twitch clip, uptime, followers, title/category and native shoutout commands | Adapter implementation exists; **not connected by this release's provider constructor** | This needs the right shared grant, broadcaster/moderator identity, and a read/write-aware transport. Connecting it blindly would risk adding a second stream-monitoring path or letting simulation calls reach Twitch. |
| Currency and gamble settings | Tenant-local settings, wallet/leaderboard, owner lookup/adjustment, existing commands and bounded SPMT exchange | Keep creator currency separate from canonical XP. Bulk member administration and a full ledger browser from live are not equivalent yet. |
| Channel Point Redeems | Existing catalog/runtime helpers; **no equivalent deployed redeem-management page** | Live supports reward configuration, community/crew/mod/partner check-ins and pack rewards. This requires both management controls and EventSub reward ingress tied to canonical provider identity and idempotent fulfillment. |
| Overlay URLs, TTS player/listener/mixer, social/avatar, BRB/shoutout playback and game overlays | Canonical Public/Personal output controls, widget list and Simulation Rooms remain; **many StreamWeaver renderer/player behaviors are not end-to-end ports** | Keep Overlay Bay as composition owner. Port each actual renderer, playback queue/cursor, expiry and media behavior as a widget/service; do not create a competing StreamWeaver composite or label an unserved legacy route as working. |
| Pokémon packs, collections, trading, gym and reward overlays | Existing pure runtime functions and catalog/activity descriptions; **not a complete connected user experience** | The Games page's presence is not evidence of usable collections or trading. Coordinate these game capabilities with Nebula Arcade and canonical inventory rather than duplicating collection authority. |
| Logs / run inspection | Actual installed-flow run records added; Voice Commander has persisted terminal output | Keep errors attached to the command and source that caused them. Live's full diagnostics/system log viewer is not reproduced by this smaller activity view. |
| Live Files / raw local data browser | No equivalent raw filesystem browser added | Replace user-relevant data inspection with bounded app APIs and exports. Tenant controls must not expose arbitrary files or provider credentials. |

Source examples: [live flow editor](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/components/flow/flow-editor.tsx), [live node execution](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/lib/flow-runtime.ts), [Bot Functions controls](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/app/(app)/bot-functions/page.tsx), [currency management](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/app/(app)/currency/page.tsx), [redeems](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/app/(app)/redeems/page.tsx), [connections](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/app/(app)/integrations/page.tsx), and [Voice Reply](https://github.com/Mtman1987/streamweaver/blob/d4327a16feebf1661b5b3fbbf13e93580228e9b0/src/app/(app)/voice-reply/page.tsx).

## Ecosystem ownership: what should not be duplicated

| Concern | Owner | StreamWeaver's responsibility |
| --- | --- | --- |
| Sign-in, canonical user/tenant and provider links | SPMT Account and identity authority | Consume authenticated context; display relevant link state |
| Provider connections, inbound normalized chat and outbound delivery | Chat Gateway and provider-grant authority | Match installed flows and send through the existing egress contract |
| Shared stream online/offline presence | Existing ecosystem presence/ingestion owner | Consume freshness/status; do not introduce another polling authority |
| Personas and automation preferences | StreamWeaver app-private state | Store and edit the tenant's configured presentation and flow packages |
| Model execution, job admission and metering | Stellar Core / SPMT jobs | Submit typed requests and show their actual result |
| Voice/media execution | Existing HearMeOut/Companion services as applicable | Retain user choices and request the registered service |
| Public/Personal composition and pinned embeds | SPMT workspace / Overlay Bay | Contribute actual widgets and open the shared room viewer |
| Game state and mechanics | Nebula Arcade, with canonical inventories where applicable | Trigger game capabilities without creating another authoritative copy |
| Discord community embeds and delivery policy | Discord Stream Hub | Request registered DSH actions; retain source/actor attribution |
| Shared XP | SPMT ledger | Produce bounded, idempotent awards; maintain creator currency separately |

## Validation and practical limits

- The offline repository test gate passed: **737 tests, zero failures**, including the rebuilt module graph and the new parity tests.
- New runtime tests cover draft ownership/conflicts, pause/resume, original-package preservation, wiring order, variables, aliases, cooldowns, replay, partial failures, Discord delivery keys, renamed native bindings, links/social/Bic service construction, atomic wallet changes, and tenant/user history isolation.
- Integrated HTTP tests use a real SPMT sandbox session and Apollo ingress to create/edit/approve/pause/delete a flow, persist links and BotShare, adjust a wallet with duplicate-request protection, and verify remembered versus private Voice Commander retention.
- DOM execution checks generated-script syntax, manual editor wiring and saves, search-input preservation, unsent-draft preservation on snapshots, zero-valued settings, destination selection, and nested job-result completion. They do not substitute for visual testing on the user's phone.
- Simulation room input still uses the actual installed-flow runtime. Link settings are copied into the isolated room database; currency, command state and game state remain isolated from real provider writes.
- The Sprite's existing network policy and disabled outbound-provider mode are unchanged. External AI/image calls stay blocked there; provider replies use shadow delivery. This release does not claim live Twitch/Discord bot rehearsal.
- Per-step receipts and gateway idempotency cover the tested retry paths. They are not a blanket exactly-once guarantee for every external side effect, arbitrary native adapter, crash window, or edited flow during an in-flight retry.

## Follow-up implementation

The subsequent graph/runtime increment and current ownership decisions are tracked in [the implementation ledger](STREAMWEAVER_PARITY_IMPLEMENTATION.md). It adds branches, persistent variables, durable waits, shared-assistant nodes and resumable suite results; those rows above describe the earlier `d22f632` release. The remaining feature groups are still being implemented.

## Remaining release work

Before declaring full live parity, finish and prove: graph/AI/TTS node execution; role-specific bot setup; media/avatar/TTS/mixer controls and renderers; reward ingress and redeem administration; research/image configuration; stream-provider commands through shared grants; and complete game/inventory workflows with the owning app. Each item needs its actual UI, state owner, transport, failure/retry behavior, and both simulation and credentialed live evidence. The table above records these as open work rather than hiding them behind a readiness badge.
