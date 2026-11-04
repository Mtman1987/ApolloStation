# Nebula Arcade settings and shared rules

Updated 5 September 2026. The implementation and launch instructions are in [the release runbook](../NEBULA_RELEASE.md). Open **Nebula → Arcade Controls** for active games, moderator actions, global exclusions and settings. Every game has accent and text-size settings; refresh existing browser sources after changing native settings.

| Game | Editable surface | Additional rules retained in source |
|---|---|---|
| Tag | Rotation/forced timers, immunity, reward/penalty, IT, passes, crowns, score adjustments, Pin counts, away status | Pass caps and spending window |
| Quackverse | Collection, owned decks, saved decks, seats, full battle actions, NPC/practice, Art Studio and batch jobs | Card balance, formations, pack composition and four-pack daily cap |
| Bingo | Personal center, shared phrase edits/reset, generated boards, themed AI generation, claims | Board dimensions, one contribution per stream, claim/win rewards |
| Chaos Mode | Appearance, overlay layout, game actions | Thresholds, effects and timing |
| Chat Garden | Appearance, layout, plant contributions | Vocabulary and growth/weather behavior |
| Chat Wars | Appearance, layout, team choice | Territory behavior |
| Chicken Royale | Lobby seconds, player cap, start/stop | Race mechanics |
| Color Symphony | Appearance, layout, color contributions | Color-to-note mappings |
| Color Wars | Round seconds, appearance, team choice | Painting behavior |
| Dancing Parade | Dancer cap, appearance, join/dance | Movement |
| Emoji Rain | Particle cap, appearance, emoji contributions | Intensity and combo rules |
| Emoji Tower | Tilt threshold, appearance, drops | Cooldown, block size and gravity |
| Memory Lane | Appearance, layout, memory messages | Keyword/mood dictionaries |
| Pet Race | Appearance, layout, pet choice | Pet attributes and race physics |
| Phrase Guess | Shared phrases, reveal interval, match threshold, hidden-letter percentage | Native round state |
| Pixel Battle | Appearance, layout, paint actions | Palette, board geometry and cooldown |
| Rhythm Pulse | Appearance, layout, native volume/mute | Beat recognition and timing |
| Treasure Hunt | Treasure count, appearance, A1–J10 dig coordinates | Native board behavior |
| Word Chain | Timer, long-word time bonus, categories and starter words | Structural word checks, score multiplier |
| Word Storm | Appearance, layout, word contributions | Word limit, common-word filter and combo behavior |

Word Chain checks starting letter, minimum length and repeated words. Neither the live source nor this port contains a semantic classifier. An Animals category supplies animal starter words; it does not establish an animal dictionary. Native widgets still hold round timers/random choices in each browser, so separate instances can diverge. Authoritative shared rounds would be an additional feature.

`spmt join` enrolls one canonical identity in the persistent player pool. It no longer asks the user to choose a game. Eligible actions in active games establish current-room participation. Linked accounts can be recognized across providers; unlinked provider identities cannot be assumed to be the same person. `spmt <game> leave` excludes that game; `spmt leave` leaves the pool. Seat, team and pet choices remain meaningful game choices.

Global channel/player exclusions are durable, editable and imported from the live blacklist/opt-out flags. They gate all game ingress, guides, Tag targets/rotation and delivery. Excluding a player clears their IT status and claimed battle seat, preserving scores and collections. Restoring pool consent never overrides a blacklist. Counts on the activity box represent recently present participants, not the entire global pool.
