# Nebula Arcade chat commands

All Nebula chat input requires a complete leading `spmt` token, case insensitive. `!join`, `!accept`, `!pack`, `spmtpack`, mentions in ordinary conversation, and messages without the prefix are ignored by game handlers. `spmt pack` opens Quackverse; another bot can continue owning `!pack`.

## Guides

- `spmt help` and `spmt commands` list commands for games running in the current channel.
- `spmt rules` lists rules for those running games.
- `spmt <game> help`, `commands`, or `rules` selects that game's guide, including when it is stopped.
- Global replies link the complete commands or rules page. Specific replies link that game's section.
- Full pages: `/apps/nebula-arcade?view=commands` and `/apps/nebula-arcade?view=rules`, with all 20 games. Games navigation includes both pages.
- `spmt tag rules`, `spmt chattag rules`, `spmt chat tag rules`, and `spmt chat-tag rules` are equivalent. These are chat aliases only; app, API, service and storage identities remain Nebula Arcade.
- Compact, spaced, hyphenated and underscored catalog names work: for example `wordchain`, `word chain`, `word-chain`, `word_chain`.

Global help is handled before Tag routing. It does not belong to Tag and works without Tag enabled. Replies are split into provider-sized chunks with stable delivery keys. Public guide links use the configured Nebula public origin; a relative route is used when none is configured.

## Participation and routing

Explicit commands retain game rules, eligibility, moderator checks and game-specific choices. `spmt join` remains the existing Tag shortcut; global enrollment is not implemented in this change. Other games can be joined explicitly, for example `spmt wordchain join`.

For a running continuation game the player has joined in this channel, `spmt orange` supplies `orange` as game input. `spmt word chain orange` explicitly targets Word Chain. Ordinary conversation updates recent chat presence only: it cannot play a word, award game points, enter the widget input feed, or wake the activity box. Bot messages do none of these.

When an action has multiple game targets, the bot prompts with `spmt 1`, `spmt 2`, etc. The pending choice survives restart for 30 seconds, scoped to tenant, provider connection, channel and actor. Bare numbers do not select a game. Team color commands retain their existing compatible broadcast behavior.

The durable activity membership is channel scoped. Joining in another channel does not grant shorthand input eligibility here. Tabletop actions preserve their existing card/deck/seat rules. Native widget adapters translate validated prefixed input into their private input format; old `!` syntax inside those isolated adapters is not a public chat entry point.

## Optional activity box

Overlay Bay's existing Nebula source editor has a **Show Arcade activity box** checkbox. It is saved with the Game Mix and can be included in the chosen personal or public scene output. Existing mixes default to off.

Any human `spmt` message, including `spmt` alone, shows the box for 30 seconds in its channel. Each new prefixed message renews that period. A browser timer hides it even if polling stops.

Rows combine selected overlay games with running channel games. Running games missing from the overlay are identified. Selected stopped games remain visible as stopped. Counts include joined players who chatted in this channel within the last five minutes; stopped games report zero. This is recent chat participation, not a provider presence roster or a count of everyone historically enrolled. No data crosses tenant/channel boundaries.

## Shared channel opt-out

The existing durable channel opt-out is checked before all Nebula provider commands, guides, feed input, activity and scoring. A broadcaster or moderator can use `spmt optout` even when Tag is stopped or absent. Direct game-action and Tag-rotation HTTP routes also reject opted-out channels. Discord dashboard publishing observes this gate.

A shared-chat source room remains a separate room: its opt-out blocks forwarded input from that source without opting out the receiving room. Provider and canonical state channel aliases are both persisted for direct-channel opt-outs.

This does not port the legacy blacklist administration/import UI or its player flags. See [game settings audit](NEBULA_GAME_SETTINGS_AUDIT.md).

## Verification

`tests/nebula-spmt-commands.test.mjs` exercises strict-prefix isolation, all catalog spellings, Tag aliases, guides, channel-scoped membership and counts, durable numeric selection, all-game opt-out, shared-chat isolation, HTTP guides/mixes, the independent visibility timer and native input translation. Existing provider and Preview Studio tests use prefixed Nebula commands while other applications retain their own commands.
