# Original Chat Tag donor audit

Donor: `Mtman1987/chat-tag`

Audited commit: `8170c51` (`Merge pull request #66 from Mtman1987/fix/game-hub-runtime-foundation`)

Audit date: 2026-08-23

Scope: the original persistent Chat Tag game only. Quackverse, Bingo, the wider Game Hub, UI parity, overlays, and provider workers remain separate ledger slices.

## Production behavior preserved in this slice

- `spmt join` and `spmt leave` membership.
- One current **it** player across the tenant game.
- Free-for-all when nobody is it, with double local game points.
- `spmt tag @user` transfer, 100 local points to the tagger, and a 50-point local penalty to the tagged player.
- 20-minute post-tag immunity, sleeping/offline immunity, and the donor no-repeat-tag guard.
- `spmt sleep`, `spmt wake`, `spmt away`, `spmt status`, `spmt whosit`, `spmt score`, `spmt stats`, `spmt rank`, and `spmt players` compatibility vocabulary.
- Earned passes, maximum wallet of three, maximum spend of three per 24 hours, and double-point `spmt pass @user` tags even when the caller is not it.
- Moderator-only pass grants, manual it assignment, and free-for-all control.
- Restart-safe, versioned private game state with a bounded command-id receipt set for replay deduplication.
- Tenant-scoped public SPMT events and idempotent SPMT XP awards. Local Chat Tag scoring remains game-specific and is not a second ecosystem XP authority.

## Donor sources used

- `GAME_COMMANDS.md` — player/mod command contract and auto-rotation rules.
- `bot.js` — Twitch command parsing, target lookup, status/score/rank responses, pass flow, overlay dispatch, and cross-channel behavior.
- `src/app/api/tag/route.ts` — authoritative membership, tag, immunity, pass, score, history, FFA, and admin mutations.
- `src/lib/volume-store.ts` — private JSON volume state and atomic write boundary.
- `src/lib/scoring.ts` — default 100/-50 scoring.
- `src/lib/pass-policy.ts` — three-pass wallet and three spends per 24 hours.
- `src/lib/chat-tag-command-text.js` — public command wording and aliases.

## Green ownership and boundaries

- Nebula Arcade owns private Chat Tag state and rule execution.
- The provider bot is a leased ingress worker and owns no canonical state.
- SPMT owns tenant identity, canonical ecosystem XP, and the shared event stream.
- Discord Stream Hub consumes the public tag event for announcements.
- StreamWeaver consumes downstream public announcement events for overlay cues.
- No Firebase compatibility, shared-volume mount, universal secret, browser-token authority, direct DSH call, or direct StreamWeaver call is introduced.

## Deliberately deferred child slices

- Auto-rotation using live/offline provider signals and the 40-minute/5-hour donor timers.
- Twitch, Discord, Kick, and shared-chat ingress adapters and immutable provider-ID resolution.
- OBS overlay rendering and muted-channel overlay mode.
- Monthly crown administration and fixed crown XP payouts.
- Player-list live/chatting pagination, Pin ranking, support tickets, and channel opt-out management.
- Migration of current Blue players/history/pass wallets after reconciliation against SPMT identities.

Those capabilities remain parity obligations. They are not removed by this implementation.
