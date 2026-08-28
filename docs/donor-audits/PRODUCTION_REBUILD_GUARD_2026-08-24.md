# Production rebuild preservation guard

Captured: 2026-08-24

Status: **CUTOVER BLOCKED**. The current Apollo app catalog and UI are not evidence that the donor applications are fully ported.

Machine-readable authority: `docs/donor-audits/production-rebuild-guard.v1.json`.

## Rule

The rebuild may simplify implementation, remove patch-era plumbing, centralize shared authority, and move capability ownership to cleaner bounded apps. It may **not silently lose a working production capability**.

Anything found in a donor that has not been classified is `VERIFY`, never `REMOVE`. A donor remains available until every retained behavior has implementation, migration, restart/restore, tenant-isolation, replay/idempotency, provider, and cutover evidence or the owner explicitly approves removal with measured zero-use evidence.

A manifest, a Shipyard card, a nice home page, a Workspace iframe, or one successful cross-app test is scaffolding. It is not production parity.

## Public contract rule

Shared ecosystem operations must converge on the same scoped authority. Where the operation naturally belongs to the developer platform, the SDK, HTTP API, CLI, and MCP are clients of that same operation and must not create separate behavior or bypass authorization.

Provider sockets, long-lived workers, media pipelines, and device runtimes do **not** need to run through CLI or MCP. They use the appropriate documented SDK/API/event/WebSocket/job/device contract, while CLI/MCP expose the human/developer operations that make sense for the same authority.

If a first-party app requires an undocumented private cross-app endpoint for a normal integration, the fix is to improve the shared contract rather than preserve the shortcut.

## Donor heads

| Product | Donor | Frozen production evidence | 2026-08-24 main | Rule |
|---|---|---|---|---|
| SPMT authority | `Mtman1987/spmt-live` | `bbd335ce8083b540ba9c7f8468edbfbfa46fc5d5` | same | audit all retained authority/provider/developer behavior |
| SpaceMountain front door | `Mtman1987/spacemountain-live` | `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43` | same | preserve public/shell/session/shared UI behavior |
| StreamWeaver | `Mtman1987/streamweaver` | `387acf70552f9a6a557a83e8804c328245932961` | same | inventory commands/actions/providers/personas/overlays/workers |
| Discord Stream Hub | `Mtman1987/DiscordStreamHub` | `e35a1b06479adf73565da9b3a7eff4dc27ebe38b` | same | inventory Discord, Twitch, points, raids, clips and worker behavior |
| HearMeOut | `Mtman1987/hearmeout-main` | `686d237fbb5bfa56f2356dba9dfdb7c023d5ac23` | same | inventory LiveKit, Discord, media, rooms and DJ worker |
| Nebula Arcade / Chat Tag | `Mtman1987/chat-tag` | `8170c51b04598774cbaa67981888e30b0c51f2fd` | `c4b99179eff47e41e920603f96f6342b04390eee` | audit the union; main is 10 commits ahead of the freeze |
| Rotator / MountainView / local AI | `Mtman1987/fly-machine-rotator` | `66e66b8b8502a6cf1dd94aee0163c443459a6d08` | same | inventory Rotator, MtFixIt/Coder, MountainView and local worker behavior |

The Chat Tag drift is important: newer donor commits include Quackverse image-generation fixes and the wider Nebula Arcade launch. The older freeze remains historical evidence, but it cannot be the only cutover baseline.

## Required audit families

Every donor/product slice must account for:

- Discord: bot ingress/egress, commands, interactions, OAuth/linking, guild/channel/message access, moderation/forums, embeds/invites, voice where present.
- Twitch: OAuth/grants/refresh, account linking, bot identity, chat ingress/egress, Helix/live polling, watch state, moderation/blacklists, reconnect/cursors.
- XP/points/wallet: balance, award/add, spend, transfer, set/admin repair, rank, leaderboard, bulk operations, settlement/gamble behavior, migrations and reconciliation. Product-local scoring stays separate when it is genuinely game-specific.
- Commands/actions/redeems: exact command vocabulary, aliases, permissions, cooldowns, action graphs, tenant configuration and enabled/default behavior.
- Events and live transport: public events, WebSockets, provider-neutral Chat Gateway, dedupe, cursors, retries and loop prevention.
- Overlays/OBS: saved scenes, personal outputs, game/product renderers, alerts, revoke/expiry, transparent/headless behavior and output URLs.
- Workers/processes: provider bots, schedulers, polling, media workers, clip jobs, Xbox sessions, Companion/local compute, Rotator and Coder jobs.
- Data: every durable donor table/file/volume must be classified as canonical authority, app-private authority, cache, staging, outbox, migrated data, or owner-approved removal.
- Auth/recovery/provider links: direct, shell, embed and bot/service identities; claim/relink; refresh/revoke; account migration; no display-name merge.
- Operational proof: health/readiness, degraded state, cold start, drain, restart, restore, rollback, duplicate/replay and two-tenant isolation.

## Concrete preservation evidence already found

### StreamWeaver

The donor freeze inventory contains **71 commands + 176 actions = 247 behaviors**. Its modules include 37 economy entries, 28 redeem-pack entries, 27 starter-social entries, 25 core-utility entries, 22 event-hooks, 19 menu-mode, 13 AI-bot, plus Pokémon, death counter, chat bridge, clips, music, translation, Discord and Kick behavior. Apollo's current StreamWeaver catalog entry and home surface therefore do not constitute a port.

### Discord Stream Hub

The donor includes a real points/wallet surface: balance, add, set, update, user rank, leaderboard, add/set to all, gamble settlement, tenant balances, and an SPMT XP bridge. It also has Twitch API/OAuth/linking/chat/polling/live-status/blacklist paths. Each retained operation must either map to canonical SPMT XP/provider contracts or stay app-private for a documented reason; duplicate authorities are not acceptable.

### HearMeOut

The donor includes LiveKit token/health/media behavior and Discord OAuth, Activity, guild/channel/message/chat, embeds, invitations, interactions and a Discord voice bridge with PCM/jitter worker logic. Rebuilding the room model alone is not enough.

### SPMT

The donor audit found about **190 unique HTTP method/path pairs**, while Green had about **60** at that audit point. Raw route count is not the parity target, but the difference proves the current service is still a foundation. XP spend/transfer/settlement/leaderboard/reconciliation, presence, forums/Discord bridge, complete overlay scenes, Companion device gateway, Cloud Xbox workers and full developer-platform compatibility still require explicit completion evidence.

## Cutover veto

Do not delete, archive as obsolete, disconnect, or replace a donor production app solely because an Apollo app with the same name exists.

Do not describe an app as ported until its donor inventory is complete and its retained capabilities pass the required proofs.

Do not promote a shared operation that only works through a first-party private shortcut. Add the missing public contract and test SDK/API/CLI/MCP convergence where those client forms are appropriate.

Do not retire old data until migration reconciliation proves the same identities, balances, histories, settings, scenes and entitlements in the new authorities.

## Still unresolved

The baseline proves 11 named Fly apps plus an SPMT Xbox process group, while the owner reports roughly 13 live Fly apps. Remaining live Fly names must be captured before the production deployment inventory is called complete.

Twenty-three additional GitHub repositories remain a discovery queue. Some are workers/assets, some are products/releases, and some are predecessors or experiments. None is silently excluded until deployment/import/use evidence classifies it.
