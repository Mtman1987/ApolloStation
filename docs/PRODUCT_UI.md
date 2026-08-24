# SpaceMountain product UI

`@spmt/ui` is the reusable visual contract for the ecosystem. It is framework-neutral: apps may use plain DOM, React, or another renderer while sharing the same product tokens and accessibility behavior.

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

This makes the suite feel like one ship with different rooms: familiar controls and color behavior, distinct imagery and purpose.

### Scene direction

| Surface | Default scene direction |
|---|---|
| SpaceMountain | Command bridge framed by the existing cosmic mountain/solar horizon |
| Nebula Arcade / Game Hub | A busy inhabited solar system with multiplayer routes, ships, and game activity |
| Commlink | A massive planet surrounded by a constellation of communication satellites and relay paths |
| StreamWeaver | Streaming signal lanes and broadcast relays crossing an active star system |
| Discord Stream Hub | A connected orbital community with live broadcast beacons |
| HearMeOut | An audio nebula with visible sound rings connecting people and rooms |
| MountainView | A panoramic observation station with camera and capture satellites |
| Companion | A nearby support craft linked securely to the main station |
| Stellar Core | A deep stellar furnace and intelligent constellation network |

These are art requirements, not hardcoded catalog entries. Each app owns its asset and passes its descriptor to the shared resolver.

## Theme presets

- `solar-flare`
- `nebula-purple`
- `oceanic-blue`
- `aurora-green`

`resolveProductTheme(theme, customAccent)` accepts a valid six-digit hex accent. Invalid or unknown values safely fall back to Solar. `resolveProductBackdrop(scene, theme, customAccent, customImageUrl)` keeps the app scene independent from that palette and accepts only root-relative or credential-free HTTPS images.

## Authority boundary

The UI package contains no app catalog, routes, authentication, browser storage, provider credentials, or data fetching. Apps still get identity, workspace, catalog, notification, and capability state through the public SPMT SDK. A developer manifest's optional `iconUrl` supplies its catalog artwork; SpaceMountain does not hardcode partner app cards.
