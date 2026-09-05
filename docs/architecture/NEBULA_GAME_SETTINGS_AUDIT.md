# Nebula Arcade settings and shared rules audit

Audit scope: ApolloStation's 20 current game handlers, imported native widgets, Overlay Bay integration, membership and shared channel policy. This documents the editable surfaces that actually exist; it does not introduce a new settings system or shared enrollment.

## Editable surfaces

Overlay Bay edits game selection, arrangement, style, mode, rotation interval and the optional activity box. These are overlay settings, not game-rule settings. Most native game rules remain constants inside `apps/nebula-arcade/widgets/<game>.html`; the new guide is generated from `apps/nebula-arcade/src/game-guide.ts`.

| Game | Existing editable surface | Rules/settings still in code |
|---|---|---|
| Tag | Chat player actions, moderator pass grants, channel opt-out, overlay mode | 100/-50 scoring, 20-minute immunity, three passes per 24 hours, 40-minute rotation, five-hour forced rotation |
| Quackverse | Collection/deck management and battle actions; moderator reset | Pack limit, card balance, pack composition, battle rules; no integrated balance editor |
| Bingo | Chat commands for personal center phrase, moderator replacement of 24 shared phrases and reset | Board/match behavior; no dedicated settings form |
| Chaos Mode | Game actions; overlay layout | Thresholds, effects and timing |
| Chat Garden | Plant contributions; overlay layout | Plant vocabulary, growth/weather behavior |
| Chat Wars | Team choice | Team/territory behavior and 60 territories |
| Chicken Royale | Join and moderator start/stop | 45-second lobby, 100-player cap; native query options are not wired through the embedded editor |
| Color Symphony | Color contributions | Color-to-note mappings and frequencies |
| Color Wars | Team choice | 120-second rounds and painting behavior |
| Dancing Parade | Join and dance | 30-dancer cap and movement |
| Emoji Rain | Emoji contributions | 150-particle cap, intensity and combo behavior |
| Emoji Tower | Drop action | One-second cooldown, 60px block size, gravity 0.5 and tilt threshold 15 |
| Memory Lane | Memory messages | Keyword/mood dictionaries and layout behavior |
| Pet Race | Pet choice | Pet attributes, race physics and pacing |
| Phrase Guess | Legacy native control panel for phrases, reveal/match settings and round controls | Panel uses browser local storage and a separate native session; not integrated tenant settings. The opaque iframe sandbox can obstruct persistence |
| Pixel Battle | Paint action | 20×15 grid, 400×300 canvas, 20px cells, palette and cooldown |
| Rhythm Pulse | Native volume/mute controls | Beat definitions, recognition and timing |
| Treasure Hunt | Dig action | Native 10×10 board versus current chat validator A1–H8: a parity gap |
| Word Chain | Word submissions | 60-second timer, theme starter lists, validation and scoring; no integrated editor |
| Word Storm | Word contributions | 50-word limit, common-word filter and fade/combo behavior |

## Word Chain validation

The current native game checks the starting letter, minimum length and previously used words. It does not call a dictionary, language model or semantic category classifier. Theme names select starter words only.

An Animals round starting with TIGER can accept RAIN; it can also accept a made-up word such as RZZZX if it meets the structural checks. Consequently, changing an Animals starter list does not make the game reject weather words. A future category setting needs a real allowed-word collection or another explicit validation strategy.

Rounds start with 60 seconds. A word of at least seven letters adds five seconds. The score starts from word length, with consecutive contributions by the same player increasing the multiplier by 0.5 up to 3×. These values are code constants today.

Several native widgets own timers, random choices and round state in each browser. Two overlay instances can therefore diverge. A settings editor should be paired with authoritative shared round state before promising synchronized public and personal gameplay.

## Global rules and blacklist

The existing durable Apollo channel opt-out is now enforced before every Nebula game, help/rules, widget feed, chat scoring and activity wake-up. `spmt optout` remains moderator/broadcaster-only and works without Tag active. HTTP game actions and Tag rotation reject opted-out channels; dashboard publishing respects it. Shared-chat source opt-outs do not disable the receiving channel. Tests cover all 20 game IDs and restart persistence.

The legacy blacklist is broader. The live source at commit `42cb6401b3adf87a8c008474787d05d1dcf757db` stores `botSettings.blacklistedChannels` and updates matching streamer/player flags. Apollo does not yet provide the complete corresponding management/import surface and player-flag migration. The common-word filter in Word Storm is not a global blacklist. Do not describe the entire blacklist port as complete.

Source: [legacy blacklist route](https://github.com/Mtman1987/chat-tag/blob/42cb6401b3adf87a8c008474787d05d1dcf757db/src/app/api/bot/blacklist/route.ts). Historical opt-out and player eligibility flags must be preserved when a full migration is added; importing players must not silently reenroll blacklisted users.

## Enrollment recommendation — not implemented

A persistent “willing to play Nebula” enrollment would simplify the user's proposed cross-stream flow. One `spmt join` could establish global enrollment for a stable canonical identity, with linked provider identities recognized across streams. Participation and overlay counts would still be current-channel facts, so enrollment would not count somebody as present in every stream.

Game actions could establish current-channel participation automatically for an enrolled player when the game is active. Explicit choices would remain for competitive seats, teams, pet selection and other game requirements. Tag would still enforce pass availability, eligibility and immunity. A global leave/unenroll action and preservation of existing opt-outs are necessary parts of that design.

Today, Tag and the generic game store retain their existing separate enrollment behavior, and shorthand continuation eligibility is per game and channel. This publication implements the approved prefix, guides, overlay activity and shared channel opt-out fix only.

Recommended follow-up order: complete global blacklist administration and migration; define shared enrollment and leave semantics; move native round state to shared authority; then expose typed per-game settings with validation, defaults and tenant-scoped editing.
