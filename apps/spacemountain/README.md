# SpaceMountain

**Workspace:** @spmt/spacemountain  
**Location:** apps/spacemountain  
**Role:** shared shell state model, workspace/app navigation, universal appearance, app-frame integration, OverlayBay and Simulation Rooms UI. The HTTP host is a separate package: apps/spacemountain-web.

## 1. Product responsibility

SpaceMountain is the user-facing ecosystem shell. It combines SPMT session/identity state, app catalog and installs, workspace/profile settings, entitlements/usage, XP, events, Commlink, Stellar, operations, notifications and app launches into one coherent workspace.

The package owns the shell controller and browser presentation. SpaceMountain Web owns the HTTP server, static routes, sign-in gate and same-origin gateway. SPMT Service owns identity and shared facts. Product apps own their product UI and private state.

## 2. Main modules

| Module | Responsibility |
|---|---|
| src/index.ts | Shell snapshot types, source-state aggregation, app catalog mapping, navigation and SPMT client composition |
| src/shell-ui.ts | UI adapter, app frame host and OverlayBay controller composition |
| src/shell-ui-base.ts | Main shell browser UI, navigation, workspace, app catalog, settings and visual composition |
| src/product-shell-css.ts | Shared shell layout and component styling |
| src/themed-surface-css.ts | Universal theme and surface normalization across apps |
| src/overlay-bay-ui.ts | OverlayBay scene/source editor, widget discovery, save state and app-frame controls |
| src/overlay-scenes.ts | Overlay source/scene schemas, validation, layout and save helpers |
| src/simulation-rooms-ui.ts | Simulation Rooms browser experience and room controls |

## 3. Shell data flow

1. SpaceMountain Web presents the initial HTML and sign-in/recovery gate.
2. The browser obtains the authenticated SPMT session.
3. The shell controller loads session, identity, workspace, XP, app catalog/installs, entitlements, usage, events, Commlink, notifications, Stellar and operations sources.
4. Each source is reported as ready, degraded or unavailable; optional source failure must not blank the entire shell.
5. App cards are built from SPMT catalog metadata and granted scopes.
6. App launch resolves through the registered launch URL and supported shell frame protocol.
7. Shared appearance and workspace profile settings are applied to the shell and compatible embedded surfaces.

The shell must never invent a session or grant. It renders the source state and routes to the owning service.

## 4. Workspace and app frames

The shell owns navigation, workspace, dock, app catalog and frame orchestration. Embedded apps communicate through the versioned SPMT surface/embed protocols, not arbitrary postMessage payloads.

Frame behavior must preserve:

- caller app and tenant context;
- app launch URL and granted scopes;
- allowed surface modes;
- safe origin and framing policy;
- navigation back to the SpaceMountain shell;
- bounded message types and payload validation.

The shell should not implement product business logic on behalf of embedded apps.

## 5. OverlayBay

OverlayBay is the shared scene/source editor. It supports widget, web, image, video, frame, text, camera, screen, Xbox, alert, links, ticker, weather and Nebula source kinds.

Scene schemas include canvas size, source position/size, z-order, visibility, lock, opacity, interactivity, parallax and source config. Validation bounds the number of scenes and sources.

OverlayBay should use the existing source controls and scene save model. A terminal, app frame, or widget can be added as a source/panel without building a second window manager.

Expected frame controls include move, resize, stack, lock, hide, mute, duplicate, close, reopen and save. Personal Bulletin is a preset/scene choice, not a separate runtime or workspace authority.

## 6. Universal appearance

The universal theme system resolves the user's appearance/theme tokens and applies them consistently to shell and app surfaces. Shared CSS variables and product-surface helpers are the implementation boundary.

Rules:

- universal appearance settings propagate from the canonical workspace profile;
- embedded apps may retain app-specific art and product identity;
- shared cards, glass panels, type hierarchy, spacing, controls and focus states remain consistent;
- avoid duplicate headers/login refresh bars and floating orphan text;
- do not flatten every app into the same background or remove its personality;
- preserve mobile safe areas, nested scrolling and frame sizing.

## 7. Dependencies

- @spmt/contracts — runtime state, app frame, surface and workspace contracts.
- @spmt/sdk — authenticated SPMT client.
- @spmt/embed — frame host, bridge messages and shell layout metrics.
- @spmt/ui — shared themes, backdrops, product UI and navigation components.

The package should remain browser-focused. Do not add provider SDKs, database drivers, native media libraries or large worker dependencies.

## 8. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/spacemountain

The root build compiles the SpaceMountain controller and browser modules through TypeScript project references.

Relevant regression areas include app catalog mapping, shell snapshot source states, app frame URL/protocol validation, workspace profile, universal appearance, OverlayBay scene save/restore, Simulation Rooms, mobile layout and navigation.

## 9. Performance and maintainability

The current shell-ui-base.ts is a large monolithic browser source file. It is core product code, not dead code. It is a candidate for a staged modularization after behavior is fully covered:

- split shell navigation, account/settings, app catalog, workspace, overlays and operations into lazy or separately testable modules;
- keep shared styles in focused CSS modules;
- avoid bundling all product app controls into the shell;
- lazy-load expensive OverlayBay widget discovery and editor controls;
- avoid duplicate session refresh loops and repeated source polling;
- cache only safe/rebuildable catalog/theme data;
- bound source refresh, frame count, overlay scene/source count and message payload size;
- measure initial JS transfer/parse, shell cold start, memory, frame navigation latency and mobile interaction before/after.

Do not split the file mechanically without tests for event wiring, DOM ownership, navigation and save/restore behavior.

## 10. Security and reliability

- SPMT session and granted scopes are authoritative.
- Shell frame messages are schema-validated and origin-checked.
- Do not let arbitrary app content navigate the shell to untrusted origins.
- Optional source failures degrade only the relevant panel where possible.
- Keep browser diagnostics bounded and redacted.
- Overlay source URLs and widget manifests must be validated and allowlisted.
- Scene saves use canonical workspace state and revision/conflict handling.
- A frame failure must not blank the shell or prevent sign-out/recovery.

## 11. Acceptance checklist

- [ ] Signed-out initial page visibly presents SPMT bridge recovery.
- [ ] Owner can sign in in normal and incognito browsers.
- [ ] Shell sources load and degrade independently.
- [ ] App catalog, installs, grants and launch URLs are correct.
- [ ] Workspace profile and exactly three dock slots persist.
- [ ] Universal appearance propagates without flattening app-specific art.
- [ ] App frames use the shared bridge and correct navigation.
- [ ] OverlayBay saves/restores scenes and supports all normal source controls.
- [ ] Terminal/app frames can be hosted using existing controls without a separate workspace manager.
- [ ] Mobile layout has safe areas, contained scrolling and no clipped controls.
- [ ] Shell JS/bundle and startup metrics are measured before/after future modularization.
