# Nebula Arcade Overlay Bay Game Mix Contract

Status: ACCEPTED for Green implementation on `work/remaining-app-ingestion`.

## User-facing rule

SpaceMountain Overlay Bay is the only visual overlay editor. Nebula Arcade does not expose a competing scene editor.

When a user selects **Add Source -> Nebula Arcade** in Overlay Bay, the source opens a Nebula **Game Mix** editor inside Overlay Bay. The mix can include any subset of the twenty Nebula games and is saved as one app-owned source configuration.

## Stable browser-source identity

A saved Game Mix is referenced by one stable widget/source identity:

`game-mix:<mix-id>`

Changing which games are enabled, their positions, sizes, styles, opacity, z-order, or switching behavior does not require changing the issued Overlay Bay browser-source URL.

OBS therefore consumes the final SpaceMountain Overlay Bay output URL rather than one URL per Nebula game.

## Composition model

Overlay Bay owns final visual composition across ecosystem sources.

Nebula Arcade owns game state, game rendering, and persisted Game Mix configuration.

A Game Mix supports:

- any subset of the twenty registered Nebula games;
- per-game enabled state;
- per-game x/y position, width, and height;
- per-game opacity and z-order;
- `full`, `compact`, and `minimal` presentation styles;
- `simultaneous` mode for showing enabled games together;
- `activity` mode for automatically presenting the game receiving activity;
- `rotate` mode with a configurable rotation interval;
- `manual` mode with an explicitly selected active game.

Multiple Game Mixes may be saved for different stream layouts. A single Overlay Bay scene may also contain more than one Nebula Game Mix source when a creator deliberately wants independently positioned game groups.

## Compatibility

The existing Nebula overlay-scene storage remains supported as the legacy ordered-game-layer representation. Game Mixes can project to that representation while adding editor-specific layout/style/switching data.

The Nebula app may expose a **Manage Overlay** action, but it must navigate into SpaceMountain Workspace -> Overlay Bay -> Nebula Arcade instead of opening another visual editor.

## Ownership boundary

- SpaceMountain Overlay Bay: all visual editing, ecosystem composition, final output grants/URLs.
- Nebula Arcade: game runtime, game rendering, persisted Game Mix state.
- OBS/browser source: one stable final SpaceMountain output URL; no requirement to manage twenty game URLs.
