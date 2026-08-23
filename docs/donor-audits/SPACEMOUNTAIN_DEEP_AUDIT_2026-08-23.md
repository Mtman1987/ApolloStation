# SpaceMountain donor deep audit

Captured: 2026-08-23  
Donor: `Mtman1987/spacemountain-live`  
Donor commit: `1dc2c1f`  
Green destination: `apps/spacemountain` and `apps/spacemountain-web`

## Audit conclusion

SpaceMountain is not yet at production parity in Green. The donor is the real front door and must retain its user journeys, navigation, launch behavior, and standalone operation. The current Green implementation is a clean authority-backed foundation, not a replacement-ready port.

The donor combines a useful product shell with duplicate authority and private cross-app calls. Green must preserve the product while moving shared identity, XP, workspace, communications, registry, and overlay facts behind the same public SPMT contracts available to first- and third-party apps.

## Production runtime and visible surface

The Fly app is `spacemountain-live`. It runs a React/Vite/Express application, keeps one 1 GB `/data` volume, remains always on, and applies runtime patch scripts for session-cache and DSH community-status behavior.

The current frontend exposes these principal routes or tabs:

- `/` dashboard;
- `/bridge` developer/operations bridge;
- `/settings` account and workspace settings;
- `/shop` catalog and purchasing surface;
- `/arena` Rocket Arena;
- `/apps` Shipyard;
- `/inbox` Commlink;
- `/forums` community forums;
- `/rooms` HearMeOut rooms;
- `/builder` block-style builder;
- `/crew` crew/workspace;
- `/help` help and documentation;
- `/mtnview`, redirected into the app surface.

The server startup implementation declares 29 primary routes covering health, login/callback/session/logout, embed launch, workspace branding, tools and points, Arena XP, Commlink messages, local user/preferences/stats, direct DSH points, direct HearMeOut rooms/voice, direct Chat Tag state/Quackverse, DSH shoutouts/forums, shop create/capture, and static fallback. A legacy server still declares local settings, identity CRUD, forum reaction, and fallback routes.

## Capability disposition

| Donor capability | Green disposition | Current Green state | Remaining proof |
|---|---|---|---|
| Dashboard and navigation | PRESERVE | clean shell exists with Home, Shipyard, Commlink, Stellar Core, Operations, Workspace, Settings and Help | browser parity matrix against all retained donor journeys |
| One SPMT session and provider accounts | IMPROVE | secure session exists; active linked providers now render and can be unlinked through public SPMT SDK/API | provider link/claim/relink, callback, recovery, account-switch and migrated-user tests |
| Shipyard and app launching | PRESERVE/IMPROVE | canonical registry/install data and safe launch target exist | all production app manifests, standalone/embed/overlay launches, grants and revocation |
| Workspace/theme/background/dock | PRESERVE | canonical theme/accent/background rendering and revision-safe editor plus exactly three registry-backed dock slots implemented | complete donor profile migration, dock runtime controls, every-app reader and device round trip |
| Commlink Mail/Notifications/Events | PRESERVE | canonical lists, message reading, search, existing-conversation replies and notification read-state exist | compose/recipient discovery, sent/read state, actions and migrated two-account history |
| Commlink Live Chat | IMPROVE | truthful unavailable panel only | provider-neutral Chat Gateway, reconnect/replay/dedupe and external client |
| Forums/Discord bridge | PRESERVE/IMPROVE | missing | SPMT forum authority plus DSH bridge and source/provenance UI |
| HearMeOut rooms/voice | PRESERVE/IMPROVE | missing | public HearMeOut app contract and standalone/embedded media tests |
| Overlay Bay and three embed slots | PRESERVE/IMPROVE | workspace shell only | versioned scenes, source grants, editor, focused renderer, OBS and revoke tests |
| Stellar assistant/context | IMPROVE | context/capability catalog and honest unavailable execution state exist | real job worker, result delivery, entitlement and persona-isolation tests |
| Mission Control/coder bridge | IMPROVE | scoped logs and draft/queue contract exist | Rotator worker execution, audit, owner policy and no-autonomous-deploy proof |
| Shop/catalog | IMPROVE | not production complete | verified external checkout and signed idempotent entitlement event |
| Rocket Arena | MOVE/IMPROVE | assigned to Nebula Arcade, incomplete | game state, capped settlement, idempotency, overlay and leaderboard tests |
| Companion/MountainView | PRESERVE/IMPROVE | bounded package groundwork only | pairing, command relay, desktop installer and real-device proof |
| Block-style Builder | REMOVE | not ported | prove no authoritative workflow/page data and no live caller; keep developer platform as replacement |
| Help/developer docs | PRESERVE/IMPROVE | placeholder only | canonical generated docs, capability explorer, diagnostics and link checks |

## Duplicate state and private coupling to remove

The donor's local SQLite schema includes users with points/status, a hard-coded `community_tools` registry mirror, and local user preferences. The main frontend performs dozens of direct fetches and also contains browser-stored SPMT token remnants and local caches. Local UI state may remain local, but authentication and shared account state may not.

Green must not recreate:

- local canonical points or user identities;
- a hard-coded copy of the SPMT registry;
- direct SpaceMountain-to-DSH, HearMeOut, Chat Tag, or StreamWeaver authority calls;
- source-rewriting patch scripts;
- browser/localStorage token authority;
- fake builder success or fabricated shop capture;
- Firebase/Firestore remnants;
- duplicate workspace, background, overlay, or preference truth.

## Implementation order

1. Complete SPMT session, provider identity, recovery, workspace and XP contracts needed by the front door.
2. Rebuild every retained SpaceMountain page against public contracts while preserving direct standalone operation.
3. Connect Commlink Mail/Notifications/Events, then the separate Chat Gateway live feed.
4. Connect forum/DSH and HearMeOut integrations as ordinary scoped app clients.
5. Complete Overlay Bay editor and render grants, then Companion/Xbox sources.
6. Move Arena into Nebula Arcade and replace the shop capture with verified checkout.
7. Migrate retained donor records, exercise browser journeys with tenant fixtures, and measure compatibility callers before removing old routes.

SpaceMountain reaches parity only when the retained donor journeys work against migrated data both as the suite front door and through direct app URLs. A shell screenshot, registry card, or isolated demo does not satisfy that gate.
