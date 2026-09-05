# StreamWeaver parity implementation

The requested endpoint is complete functional parity with the current live StreamWeaver source, with each capability assigned to its proper Apollo ecosystem owner. This is the ongoing implementation ledger, not a full-parity declaration. Reference: `Mtman1987/streamweaver` main `d4327a16feebf1661b5b3fbbf13e93580228e9b0`; Apollo baseline `d22f632`.

## Ownership decisions

| Capability | Authority | StreamWeaver counterpart |
| --- | --- | --- |
| Tenant personas, names, aliases, instructions, automation preferences | StreamWeaver | App-owned settings and presentation sent to shared execution |
| Commands, flows, branches, local automation variables, creator currency | StreamWeaver | Editable independent packages, durable execution, tenant-local wallets |
| Canonical identities, roles, provider OAuth and short-lived grants | SPMT Account | Role-specific connection controls consuming canonical links; no copied token store |
| Chat sockets, normalized ingress, provider egress | Chat Gateway | Installed command consumers and explicit destination requests |
| Stream presence shared by apps | Ecosystem presence owner | Read existing projections; no new polling authority |
| AI inference, research, job routing and metering | Stellar Core / SPMT jobs | Preferences, prompts, job references and actual returned results |
| Speech, media queues, local devices and OBS | HearMeOut / paired Companion | Voice, sound and OBS actions through bounded capabilities |
| Public/Personal outputs and three persistent embeds | Overlay Bay / Workspace | Actual contributed renderers and shared Simulation Rooms |
| Community embeds, shoutouts, calendar and Discord delivery policy | Discord Stream Hub | Registered actions and previews with actor attribution |
| Games, packs, trading, collections and gym mechanics | Nebula Arcade / canonical inventory | Trigger owning capabilities; no second game-state authority |
| Shared XP | SPMT ledger | Bounded idempotent awards; distinct from creator currency |

Legacy code, HTTP and local file operations must retain their intended behavior through an authorized capability or bounded data API. Preserving an unmapped import is necessary for migration, but does not count as completed functionality.

## Completed after the baseline

- Condition steps with equality, numeric comparisons, includes and existence; explicit true/false edges; cycle validation; a command starts at its first step.
- Persistent variables scoped to tenant and flow, plus per-run snapshots. Templates accept live-style `vars`, `args`, `tags`, and `lastOutput` paths without evaluating JavaScript.
- AI flow steps submit through the existing shared assistant, save a job reference, and resume with actual output. Existing suite-action jobs similarly resume before later steps consume their result.
- Pending waits are persisted instead of blocking ordinary Chat Gateway ingress. Simulation workers retain their renewable lease and complete delayed outputs in the same room input.
- Each run pins its original package, command, input and completed results. Editing an installed draft does not change a pending run. Completed chat steps are not repeated on ordinary retries; ambiguous network retries retain the same egress key.
- Flow Builder exposes branches, persistent-value scope, AI prompts, result names and suite result visibility. Ordered pipelines remain available.
- Host reconciliation now resumes saved flows alongside persona replies. Activity reports waiting versus failed versus succeeded.

Validation: 741-test offline suite passed before the added delayed-simulation acceptance test; the added acceptance test and all nine existing simulation tests also passed. DOM checks cover generated script parsing and existing editor behavior. No authenticated phone browser or real provider delivery evidence is claimed. External assistant execution remains disabled in the existing read-only simulation environment.

## Import follow-up

The next increment reads legacy StreamWeaver graph/package JSON and Streamer.bot commands/actions/subactions, expands referenced actions, preserves aliases and graph outcomes, and retains the exact original archive (including fields not understood by Apollo). Commands and reusable actions become separate private drafts; importing does not enable or install them. Reimporting the same archive in the same tenant returns its existing drafts rather than overwriting edits. IDs are scoped to the importing tenant.

Flow Builder now exposes minimum access, case sensitivity, personal cooldown and shared cooldown. Legacy access fields that cannot be represented safely require an explicit replacement access choice; their original values remain in the archive. Raw scripts, unregistered plugin actions and provider/device steps still need their actual ecosystem counterparts and are not counted as parity merely because import preserves them.

Validation: 747 offline tests passed, including authenticated mounted-app archive import/reimport and installation. A subsequently added focused test covers a graph action followed by reusable action steps. Import and graph runtime tests cover source preservation, aliases, branch outcomes, recursive-action rejection, scope isolation, role enforcement, case matching and shared cooldown. Existing browser-controller DOM checks passed.

## Twitch grant follow-up

Installed native Twitch commands now obtain short-lived grants from Chat Gateway's existing SPMT broker. StreamWeaver stores only the explicitly selected linked broadcaster ID. Integrations validates that selection against the owner's active Account links. The adapter preserves `/helix`, uses broadcaster-authorized follower history, refuses redirects, and has a bounded request timeout. Captured environments reject title/category/clip/shoutout writes before requesting a grant. No OAuth scope or credential allowlist is expanded by this integration.

A failed or unavailable native action is now recorded as a failed flow, rather than a successful completion. Focused acceptance covers installed follower/title commands through the actual consumer, scoped broker requests, denied writes, owner-only broadcaster selection, and grant isolation. Cross-provider follow-history identity lookup, shared-presence integration, role-specific OAuth setup, and credentialed provider acceptance remain open.

## Overlay renderer follow-up

StreamWeaver now contributes real transparent renderers for chat interactions, Bic, gamble results, creator leaderboards, avatar, speech/captions, and shoutout/BRB media. Apollo's output gateway resolves the existing tenant or opaque grant before returning HTML or an allowlisted widget snapshot. Public payloads omit credentials and unrelated widget data. Revocation and app disable stop output access. The sandbox registers these widgets for installed StreamWeaver tenants, so they appear in Overlay Bay.

Simulation Rooms have a StreamWeaver stage using the same renderers and room-isolated events; it stays mounted while histories refresh. Avatar controls accept idle and talking assets. Creator-currency chat settlements and owner adjustments publish actual leaderboard/result snapshots. The media renderer supports ordered playback and captions, but speech generation and the HearMeOut producer/control integration remain open; a playable renderer alone is not a completed TTS or BRB workflow. Game widgets remain owned by Nebula.

Validation includes actual output-grant issuance, HTML and JSON polling, revocation, tenant/widget isolation, authenticated avatar saving and widget discovery, installed command simulation, and DOM execution covering origin checks, escaped text, event deduplication and sequential media playback. Authenticated phone layout and real audio-device acceptance remain unobserved.

## Currency administration follow-up

Local give/heist/gamble/roll operations now commit their wallet changes, cooldowns and receipts together. A failed receipt write rolls the operation back. Moderator single-wallet and bulk operations now honor operation IDs, preserve the original bulk recipient set on replay, and reject reuse with different values. All bulk wallets commit or roll back together.

The owner UI exposes bulk add/subtract/set for existing creator-currency wallets, with a cursor-paged ledger showing before/after amounts, operation and actor. Ledger entries begin with this release; earlier balances are retained without inventing historical transactions. Owner edits and command settlements update the existing overlay projection. Zero jackpot/win percentages now remain zero, and a configured 100% win chance remains 100%; the previous runtime silently forced them to 1% or 99%.

Validation covers injected receipt failure in both memory and SQLite stores, transaction rollback, retry/conflict behavior, recipient-set stability, cross-tenant balances, ledger pagination, percentage boundaries and mounted authenticated owner controls. Canonical SPMT XP remains separate. Activity also offers a bounded runtime diagnostic export; it omits saved flow bodies, private voice content and provider credentials.

## Remaining implementation groups

1. Finish replacements for the imported raw script/HTTP/device/media nodes, event-trigger bindings, and legacy provider-specific access rules. The supported graph/archive converter is implemented above.
2. Finish media/TTS/STT services, profile and model preferences, asset controls, queues/mixer and actual overlay renderers.
3. Wire provider commands through shared grants; role-specific bot connections including owner-only Count; reward ingress and redeem controls.
4. Complete messaging/shared/private chat controls via the canonical owners, research/image preferences, and relay presentation behavior.
5. Complete creator-currency bulk operations and bounded diagnostics/data exports.
6. Verify all live game/collection/reward capabilities against Nebula counterparts without duplicating their authority.
7. Run per-feature acceptance, push completed tested increments, verify exact-commit promotion, and close the remaining entries only with evidence.

## Practical acceptance boundary

The Sprite network policy and provider-write mode are existing access controls. This work does not widen them. Credentialed Twitch/Discord, external model, paired-device and phone rendering acceptance remains separate from code and isolated-runtime tests. Any concrete block must be recorded with the missing service/configuration and its failed acceptance check.

## HearMeOut media counterpart

StreamWeaver now has a Media & Mixer page using the same authenticated HearMeOut room API as HearMeOut itself. It selects existing rooms, supports private admission, reads both canonical queues, adds playable media, and controls play/pause/next/jump/seek/volume/mute/clear. The two browser players use real media URLs; local playback starts only after the operator enables it. Refresh updates queue state without replacing unfinished forms. This is a shared operator surface, not a second queue database.

Media enqueue/control HTTP requests now retain idempotency keys; durable receipts validate the original actor, room, lane and input. Repeated requests cannot add a second copy, advance twice or silently reuse a key for different media. Room membership is checked before a receipt is returned. Suite media reads also require admission. Companion workers now fail rejected device commands instead of recording them as successful.

Acceptance covers integrated signed-in HTTP queue operations, conflicting retries, unauthenticated/cross-origin denial, suite room privacy, and rejected device execution. The generated controller is exercised in a DOM harness for explicit playback, draft preservation, endpoint wiring, mixer values, private admission and restarting playback. Actual audio/network playback on the user's device remains unobserved. This increment does not yet supply server TTS/STT, BRB/shoutout generation, an authorized device-automation binding, or a private-room-to-public-output binding.

The concurrent Nebula release changed Sprite promotion to manual while the release repository is assembled. Subsequent StreamWeaver commits preserve that workflow and are pushed to main without silently restoring automatic deployment.

## Companion automation and legacy continuation

SPMT now stores per-app automation grants on the user's paired device. Only its signed-in owner can grant selected scene/media actions. StreamWeaver service jobs must match that grant, the device owner, the capability, and the Companion execution route. The non-secret grant ID pins the authorization revision: revoking and later re-enabling access does not revive old queued commands. Claims and worker updates are restricted to the target paired device, and app disablement or device revocation prevents execution.

The Devices page creates a one-time pairing code, lists the owner's paired computers and saves action permissions. Flow Builder selects a device and edits OBS scene or media input, play/pause, seek, volume and mute controls. A real flow creates the canonical job and waits for the Companion receipt before continuing. Simulation Rooms update a separate device state without submitting a device job or touching the user's computer.

`npm run companion:obs` is the runnable local counterpart. It exchanges the pairing code with the chosen SPMT origin, keeps its service credential in a private local state file, renews its session, reports readiness after reaching OBS, claims only its device's jobs, and calls loopback OBS WebSocket v5. Its OBS password stays local. See [OBS's protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md). OBS request rejection, authentication failure and disconnects are surfaced as failures. This is a Node runner in the repository; it is not a signed desktop installer and has not been run against the user's OBS installation.

Acceptance runs an installed StreamWeaver scene flow through SPMT admission, a paired Companion worker and its receipt. It also checks denied self-grants, another user's denial, wrong-device claims, revocation, old-grant jobs, isolated simulation state, pairing and grants through Apollo HTTP, and the OBS v5 challenge and exact request mapping against a protocol fixture. Source-visibility actions, raw scripts/HTTP replacement and further live node types remain separate work.

Imported nested graph actions now return to the enclosing action for both condition outcomes, including an empty branch. Imports no longer flatten a nested graph into a sequential chain. Regex matching follows the command's selected case rule. Runtime tests exercise both actual branch paths and case-sensitive versus insensitive matching.

Device increment validation: the full offline repository gate passed 785 tests. A final focused check additionally exercises a connection loss after job admission and confirms retry reuses the original job. Device job timestamps and identifiers are stable for the captured input. The OBS runner parses successfully and the generated app controller passes its DOM checks. No user OBS, provider or external model credentials were used for these checks.
