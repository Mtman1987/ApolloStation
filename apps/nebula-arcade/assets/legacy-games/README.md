# Legacy Nebula Arcade game implementations

Ported from `Mtman1987/chat-tag/public/nebula-arcade/games/` into ApolloStation to preserve the source game experiences alongside Apollo's provider-neutral Nebula Arcade domain/runtime.

## Ported games

- `chaosmode.html`
- `chatgarden.html`
- `chickenroyale.html`
- `colorsymphony.html`
- `dancingparade.html`
- `emojirain.html`
- `emojitower.html`
- `petrace.html`
- `phraseguess.html`
- `pixelbattle.html`
- `rhythmpulse.html`
- `wordchain.html`
- `wordstorm.html`

## Integration status

This is a source-preservation port, not a claim that Apollo already serves or wires every standalone game into its catalog. Before serving them, verify each game's API/message contract against `apps/nebula-arcade/src/game-hub.ts`, `game-runtime.ts`, and the application host. Keep these implementations intact while adapter parity is completed; do not replace Apollo's native runtime with framework-specific Chat Tag routes.

Source: https://github.com/Mtman1987/chat-tag
