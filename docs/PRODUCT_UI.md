# SpaceMountain product UI

`@spmt/ui` is the reusable visual contract for the ecosystem. It is framework-neutral: apps may use plain DOM, React, or another renderer while sharing the same product tokens and accessibility behavior.

## Adopt it in an app

Add `@spmt/ui` as a workspace dependency, reference `packages/ui` in the app's TypeScript project, then install the shared style once:

```ts
import { configureSurfaceRoot, installProductUiStyles, resolveProductTheme } from "@spmt/ui";

installProductUiStyles(document);
configureSurfaceRoot(document.querySelector("#app")!, "standalone");
document.querySelector("#app")!.classList.add("spmt-product-surface");

const theme = resolveProductTheme("solar-flare");
document.documentElement.style.setProperty("--spmt-accent", theme.accent);
document.documentElement.style.setProperty("--spmt-accent-secondary", theme.accentSecondary);
```

Use `spmt-product-glass`, `spmt-product-kicker`, and `spmt-product-status` for shared shell surfaces. App-specific screens may keep their own personality, but should consume these tokens for navigation, status, focus, and shared overlays.

## Theme presets

- `solar-flare`
- `nebula-purple`
- `oceanic-blue`
- `aurora-green`

`resolveProductTheme(theme, customAccent)` accepts a valid six-digit hex accent. Invalid or unknown values safely fall back to Solar.

## Authority boundary

The UI package contains no app catalog, routes, authentication, browser storage, provider credentials, or data fetching. Apps still get identity, workspace, catalog, notification, and capability state through the public SPMT SDK. A developer manifest's optional `iconUrl` supplies its catalog artwork; SpaceMountain does not hardcode partner app cards.
