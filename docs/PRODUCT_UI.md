# SpaceMountain product UI

`@spmt/ui` is the reusable visual contract for the ecosystem. It is framework-neutral: apps may use plain DOM, React, or another renderer while sharing the same product tokens, viewport behavior, and accessibility rules.

## Adopt it in an app

Add `@spmt/ui` as a workspace dependency, reference `packages/ui` in the app's TypeScript project, then install the shared style once:

```ts
import { configureSurfaceRoot, installProductBackdrop, installProductUiStyles, resolveProductBackdrop } from "@spmt/ui";

installProductUiStyles(document);
const root = configureSurfaceRoot(document.querySelector("#app")!, "standalone");
root.classList.add("spmt-product-surface");

const backdrop = resolveProductBackdrop(
  { appId: "nebula-arcade", imageUrl: "/assets/nebula-arcade/solar-system.webp" },
  workspace.appearance.theme,
  workspace.appearance.accent,
  workspace.appearance.backgroundUrl,
);
installProductBackdrop(root, backdrop);
```

Use `spmt-product-glass`, `spmt-product-kicker`, and `spmt-product-status` for shared shell surfaces. App-specific screens may keep their own personality, but should consume these tokens for navigation, status, focus, and shared overlays.

## Required visual rule

Every full first-party app uses the same product grammar without becoming a copy of the same screen:

1. The canonical workspace theme supplies the color language: Solar, Nebula, Oceanic, Aurora, or a valid custom accent.
2. Each app supplies one default scene image that reflects what the app does. Changing the workspace theme recolors that scene; it does not swap the scene for a theme-specific image.
3. The shared animated star layer, glass surfaces, accessibility behavior, and rocket-navigation interaction come from `@spmt/ui`.
4. The app supplies its own navigation items, routes, content, logo, and specialized controls. It must not fork the shared rocket-navigation behavior.
5. A saved `backgroundUrl` remains an explicit user override. When it is blank, every app returns to its own default artwork.
6. `overlay` and chrome-free `popout` outputs omit the background, stars, header, and rocket navigation unless their output contract explicitly requires them.
7. **Use the fewest visible surface layers necessary.** Layout wrappers are transparent unless they genuinely need to be a readable/interactive surface.
8. **Every deeper visual layer becomes more translucent.** The global Glass control sets the strength of the first functional layer; depth two, three, and four are automatically capped lower so nesting never turns an app into stacked opaque rectangles.

The shared depth ladder is intentionally simple:

| Depth | Purpose | Multiplier of Glass setting |
|---|---|---:|
| 0 | Layout/background only | transparent |
| 1 | Primary functional card/panel | 0.90 |
| 2 | Section inside a functional panel | 0.68 |
| 3 | Nested row/message/content surface | 0.48 |
| 4 | Deep control/field surface | 0.32 |

For example, at an 80% Glass setting the effective surface alpha trends about 72% -> 54% -> 38% -> 26% as depth increases. Apps may use fewer layers, but they must not make deeper layers more opaque than their parents. Opacity is applied to the surface background/tint, never the entire element, so text and controls stay crisp.

## Shared viewport and scrolling rule

SpaceMountain Home defines the canonical usable content rectangle. Every other shell page and every opened app uses that exact same rectangle.

- The shared header and rocket/sidebar chrome stay fixed.
- The content rectangle starts below the measured shared header and ends above the bottom safe area/build guard.
- Home screens fit inside the rectangle and do not scroll.
- Shipyard, Workspace, Settings, and other long SpaceMountain pages scroll **inside** the rectangle.
- Embedded apps keep the same outer rectangle. They may own an internal scroll region but must not scroll the browser document or slide behind the shared header.
- Shell-rendered long apps such as Stellar Core or Mission Control may scroll the shared content pane. Commlink keeps its workspace fixed and scrolls the feed or other intended inner region.
- Do not create a scrollable top padding spacer to clear the header; that spacer scrolls away. The scroll container itself must begin below the header.
- Use `overscroll-behavior: contain` on internal long-page scrollers so wheel/touch momentum does not hand control back to the outer document.

Switching between apps must therefore feel stationary: the header, sidebar, content top edge, width, and bottom edge do not jump.

This makes the suite feel like one ship with different rooms: familiar controls and color behavior, distinct imagery and purpose, and enough background visibility to preserve each app's cosmic scene.

### Scene direction

| Surface | Default scene direction |
|---|---|
| SpaceMountain | Command bridge framed by the existing cosmic mountain/solar horizon |
| Nebula Arcade / Games Hub | A busy inhabited solar system with multiplayer routes, ships, and game activity |
| Commlink | A massive planet surrounded by a constellation of communication satellites and relay paths |
| StreamWeaver | Streaming signal lanes and broadcast relays crossing an active star system |
| Discord Stream Hub | A connected orbital community with live broadcast beacons |
| HearMeOut | An audio nebula with visible sound rings connecting people and rooms |
| MountainView | A panoramic observation station with camera and capture satellites |
| Companion | A nearby support craft linked securely to the main station |
| Stellar Core | A deep stellar furnace and intelligent constellation network |

These are art requirements, not hardcoded catalog entries. Each app owns its asset and passes its descriptor to the shared resolver.

## Nebula Arcade composition rule

Nebula Arcade is the Games Hub. Its twenty games are equal catalog peers. A game module may be enabled by default for compatibility or readiness, but it receives no featured/priority product status.

The Arcade home is logo/hero-first with three primary destinations: Games, Overlay Bay, and Stats. The Games catalog leads to a full game page containing truthful runtime status, commands/examples, overlay capabilities, screenshots/placeholders, README-style documentation, and a reserved attributions/social/source section.

Overlay Bay owns reusable Arcade overlay scenes. A saved scene contains an ordered set of game layers and exposes one stable browser-source URL. Multiple games may therefore share one OBS/browser source without requiring SpaceMountain's workspace to understand each game's private state.

Generic chat commands remain natural. When exactly one enabled game matches a command it may execute immediately. When multiple enabled games share that command, Nebula Arcade must ask the chatter which game they intended instead of firing every matching game.

Chat Tag remains a bounded game module inside Nebula Arcade for its own commands, runtime, compatibility, persistence, scoring, and overlay behavior. It is not a separate public ecosystem product surface.

## Theme presets

- `solar-flare`
- `nebula-purple`
- `oceanic-blue`
- `aurora-green`

`resolveProductTheme(theme, customAccent)` accepts a valid six-digit hex accent. Invalid or unknown values safely fall back to Solar. `resolveProductBackdrop(scene, theme, customAccent, customImageUrl)` keeps the app scene independent from that palette and accepts only root-relative or credential-free HTTPS images.

## Authority boundary

The UI package contains no app catalog, routes, authentication, browser storage, provider credentials, or data fetching. Apps still get identity, workspace, catalog, notification, and capability state through the public SPMT SDK. A developer manifest's optional `iconUrl` supplies its catalog artwork; SpaceMountain does not hardcode partner app cards.
