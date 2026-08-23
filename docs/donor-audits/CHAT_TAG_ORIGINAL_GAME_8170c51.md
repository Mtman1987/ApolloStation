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

## Green completion checkpoint

Status: **READY FOR PRIVATE SPRITE SANDBOX**. This is an implementation gate, not a production-cutover claim.

| Retained behavior | Green evidence |
|---|---|
| Persistent join/leave, it/FFA, tags, scores, immunity, passes, moderator controls | `chat-tag-parity.test.mjs`, `chat-tag-runtime.test.mjs` |
| Any-player chat activity clears away/offline and updates last seen | `chat-tag-experience.test.mjs` |
| Live holder rotation at 40 minutes, offline holder FFA at 40 minutes, forced assignment at 5 hours, FFA reminder at 60 minutes | `chat-tag-overlay-rotation.test.mjs` |
| Twitch/Discord/Kick normalized messages, immutable provider-scoped fallback identity, durable replay protection, provider-neutral replies | `chat-gateway.test.mjs`, `chat-tag-runtime.test.mjs` |
| Live/chatting/offline player directory, bounded paging, `spmt more`, and live-only view | `chat-tag-experience.test.mjs` |
| Pin ranking from canonical tag history | `chat-tag-experience.test.mjs` |
| Durable support tickets, broadcaster/mod overlay mode, durable overlay messages, permanent channel opt-out | `chat-tag-experience.test.mjs` |
| Monthly crowns and fixed one-time SPMT XP payouts | `chat-tag-parity.test.mjs` |
| Controls-free transparent OBS renderer with one-second state polling | `chat-tag-overlay-rotation.test.mjs`, `chat-tag-sandbox-server.test.mjs` |
| Donor players/history/pass wallets/crowns imported once without replaying historical XP | `chat-tag-migration.test.mjs` |
| Standalone private Sprite process on port 8080, health probe, test console, command API, persistent SQLite, and OBS route with provider egress rejected | `chat-tag-sandbox-server.test.mjs`, `npm run sandbox:chat-tag` |

The sandbox deliberately replaces real provider sockets with its same-origin command console and keeps outbound integrations disabled. The shared Chat Gateway still owns live Twitch/Discord/Kick sockets, ephemeral provider grants, reconnects, and provider egress; those are ecosystem infrastructure and require a later credential-scoped live-provider proof. The production opaque output gateway also remains a platform deployment gate. Neither gap removes Chat Tag behavior from the Green app implementation.

## Remaining cutover evidence

- Reconcile Blue identities, current players, history, pass wallets, channel settings, and monthly winners against canonical SPMT IDs; run the one-time importer on a captured copy.
- Publish and review the exact Green commit, then run the private Sprite checklist and open the renderer as an OBS browser source.
- Run contract tests against the live Chat Gateway provider adapters with test identities before granting any production identity.
- Mount the existing opaque SPMT output token resolver in the production output gateway.
- Compare live donor responses and Green responses for the retained command matrix, then record owner acceptance and rollback checkpoint.

Broader Nebula Arcade games—Quackverse, Bingo, Arena, Game Hub, and their separate overlays—remain independent ledger slices and are not included in this completion claim.
