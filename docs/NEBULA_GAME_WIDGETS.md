# Nebula Arcade game widgets

The seventeen HTML game widgets are ported from `Mtman1987/chat-tag`, under
`public/nebula-arcade/games/`, commit
`42cb6401b3adf87a8c008474787d05d1dcf757db`. Their original Social Stream Ninja gameplay and
rendering code is retained. Apollo supplies canonical provider-neutral input;
external iframe/socket connections and generated demo chat are disabled.

Widgets run in script-only sandboxed frames. They cannot access Apollo sessions,
parent DOM, provider credentials, or network services. The shared stage translates
SPMT commands and delivers each persisted input once per loaded widget.

Chicken Royale uses the bundled Three.js r160 build from `mrdoob/three.js`, commit
`d04539a76736ff500cae883d6a38b3dd8643c548`. Its MIT license is included in
`thirdparty/THREE-LICENSE`.
