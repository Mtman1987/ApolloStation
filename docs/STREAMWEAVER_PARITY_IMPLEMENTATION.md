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
