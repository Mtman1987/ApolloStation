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

## Remaining implementation groups

1. Import live graph packages and full Streamer.bot commands/actions/subactions without losing source fields or wiring; implement their supported replacements.
2. Finish media/TTS/STT services, profile and model preferences, asset controls, queues/mixer and actual overlay renderers.
3. Wire provider commands through shared grants; role-specific bot connections including owner-only Count; reward ingress and redeem controls.
4. Complete messaging/shared/private chat controls via the canonical owners, research/image preferences, and relay presentation behavior.
5. Complete creator-currency bulk operations and bounded diagnostics/data exports.
6. Verify all live game/collection/reward capabilities against Nebula counterparts without duplicating their authority.
7. Run per-feature acceptance, push completed tested increments, verify exact-commit promotion, and close the remaining entries only with evidence.

## Practical acceptance boundary

The Sprite network policy and provider-write mode are existing access controls. This work does not widen them. Credentialed Twitch/Discord, external model, paired-device and phone rendering acceptance remains separate from code and isolated-runtime tests. Any concrete block must be recorded with the missing service/configuration and its failed acceptance check.
