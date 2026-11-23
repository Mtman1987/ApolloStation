# SpaceMountain Frontend Replacement Test — Initial Audit

Branch: `node1/spacemountain-frontend-test`
Source repository: `Mtman1987/spacemountain-live`
Pinned source commit: `1b6eea2f601694c9e9de77b9ec3a39c642ccf02d`
Purpose: test replacing the legacy SpaceMountain browser experience with Apollo's existing shell/UI while preserving the legacy service behavior and appearance preferences.

## Safety boundary

- This is an isolated branch experiment only.
- No production branch, Hostless deployment, live database, user records, OAuth configuration, Discord bot, or provider integration was changed.
- The legacy repository is included as a pinned Git submodule at `legacy/spacemountain-live`; its source remains independently versioned.
- Do not point the test branch at production data or start its server with production credentials.
- Before running the legacy server, inspect its boot-time database initialization and all write paths. Use a disposable test database.

## Important discovery: Apollo already has a SpaceMountain host

Apollo main already contains `apps/spacemountain-web`, documented as the integrated browser host and same-origin gateway. Its documented role includes the Apollo shell, sign-in experience, workspace/app catalog, shared theme, app frames, and explicit API/media proxy routes.

Therefore, the experiment should not build another shell. The target is to reuse Apollo's existing SpaceMountain Web host and shared UI packages, then add a bounded adapter for the legacy SpaceMountain capabilities that are not already represented there.

The existing Apollo host documentation identifies:
- `apps/spacemountain-web/src/client.ts` as browser bootstrap, session, app catalog/workspace wiring, and diagnostics.
- `apps/spacemountain-web/src/integrated-server.ts` / `integrated-server-base.ts` as the production composition/gateway layers.
- Shared packages for SpaceMountain shell/UI, contracts, SDK, Nebula renderers, and StreamWeaver renderers.
- Node 1 as the intended home for the SPMT authority and SpaceMountain integrated web host.

Do not create a competing root app or second global navigation system.

## Legacy frontend inventory

Source repository is a Vite + React + TypeScript application:
- `src/main.tsx` mounts the React application.
- `src/App.tsx` is approximately 5,356 lines and is the main composition/state/network orchestration file.
- UI components include `RocketDock`, `CosmicHeader`, `MainAppSuite`, `Shop`, `Arena`, `OverlayWorkspace`, `WorkspaceTray`, `CompanionSurfaces`, and lazy-loaded home/workspace/settings routes.
- `src/components/SettingsPanel.tsx` contains the legacy appearance controls.
- `src/index.css` contains the legacy cosmic/cyber-glass visual system.
- `public/assets` contains app art and four theme background images.

This is a substantial UI, not a trivial static page. The UI replacement should be capability-by-capability, not a wholesale delete of the legacy app before parity is proven.

## Legacy backend inventory

The legacy `server.ts` is approximately 1,619 lines. It combines Express routes, SPMT proxy/session bridging, a local SQLite/Drizzle store, external app integrations, and Vite/static serving.

Observed route families:
- Health and session: `/api/health`, `/auth/callback`, `/auth/login`, `/api/session`, session upgrade/logout, embed launch.
- SPMT proxy: `/api/spmt/*`.
- Branding and app registry: `/api/branding`, `/api/tools`, tool points.
- Arena XP: `/api/arena/kill-xp`.
- Messages and user preferences: inbox/outbox/messages/read, user, user preference.
- Stats and integrations: DSH points, HearMeOut rooms/voice, Chat Tag state/Quackverse.
- Community: shoutouts and forwarded forum posts.
- Shop: products and order create/capture.
- Vite middleware and static frontend fallback.

The legacy server is therefore not just a tiny backend. It has a compact but meaningful BFF/integration layer. Its route contracts are the first preservation target.

## Data and side-effect boundary

Legacy SQLite connection defaults to `DATABASE_PATH` or `/data/spacemountain.db`, enables WAL, and initializes tables on startup. The visible schema includes users, community tools, user preferences, forwarded forum posts, community shoutouts, internal messages, and additional tables initialized in the connection module.

Critical caution: startup performs database creation/schema initialization and may seed records. Do not run against any existing production database during this UI-only experiment. A disposable DB is required.

The frontend makes same-origin calls to the legacy server and direct SPMT API calls. It also stores some UI/overlay state in browser localStorage. These must be inventoried separately:
- legacy-owned endpoints should map to a SpaceMountain compatibility adapter or existing Apollo service contract;
- SPMT-owned identity, account, settings, messages, overlays, and platform surfaces should use canonical SPMT/Apollo contracts, not be recreated as shadow local stores;
- local presentation caches may remain client-side only where they are not authoritative.

## Theme and appearance decision

Do not flatten the legacy app's appearance choices into Apollo's defaults.

Legacy theme presets found:
- Solar Flare — `#F97316` / `#FBBF24`
- Nebula Purple — `#A855F7` / `#E879F9`
- Oceanic Blue — `#3B82F6` / `#22D3EE`
- Aurora Green — `#10B981` / `#A3E635`

The legacy appearance model also includes accent saturation, glow, star density, shooting stars, glass opacity, blur, nebula intensity, parallax, border strength/glow, hover glow, corner radius, density, sidebar/topbar/tab layout, chat transparency, avatars, motion, particles, animation speed, voice controls, and accessibility.

The legacy `SPACEMOUNTAIN_THEME` version 2 bridge serializes theme colors and a large appearance preference object. The legacy UI documentation states that SPMT is the source of truth for account-backed `WorkspaceProfileV1`, universal settings, worktray/dock slots, and overlay workspace; SpaceMountain is a host/consumer and may relay derived appearance to embedded apps.

Target rule:
- Keep Apollo's shell, starfield/background treatment, global navigation, and shared visual framework.
- Preserve the four legacy color identities and their appearance controls/mappings as first-class selectable themes.
- Use one canonical account-backed settings source (SPMT/Apollo shared settings) and adapt the legacy theme model to it.
- Do not create competing Apollo-vs-SpaceMountain preference databases or silently discard fields. Build an explicit field mapping and report unsupported fields before migration.


## Verified settings contract — preserve the controls and make them real

A source-level inspection of the legacy `SettingsPanel.tsx`, `workspace-profile.ts`, `types.ts`, and `SHARED_THEME_BRIDGE.md` confirms that this is not a speculative settings design. The controls already have a complete preference model and a persistence/relay contract.

### Canonical ownership and persistence

- The legacy shared-theme specification explicitly assigns account-backed `WorkspaceProfileV1` and universal Settings to SPMT.
- The canonical surface is `/embed/settings?mode=full&app=<app-id>`; Apollo/SpaceMountain should host or expose this existing surface rather than invent another settings database.
- The profile is read and patched through `/api/workspace-profile`; PATCH uses the `If-Match: "workspace-<revision>"` revision guard and returns conflict state on HTTP 409.
- The profile draft includes `appearance`, `dockSlots`, `activeOverlaySceneId`, `ttsSubscriptions`, `appThemeMappings`, and `savedThemes`.
- `spmt.surface.updated` is an invalidation signal. The host must re-read the authoritative profile instead of trusting profile data in the message.
- `SPACEMOUNTAIN_THEME` v2 is a compatibility/presentation relay for embedded apps, not durable state ownership.

### Exact appearance fields to retain

The legacy preference model and profile converter cover:
- Theme and color: `themeId`, `accentColor`, `accentSaturation`.
- Visual effects: `glowIntensity`, `borderStrength`, `borderGlow`, `hoverGlow`.
- Cosmos/background: `starDensity`, `shootingStars`, `nebulaIntensity`, `parallaxDepth`.
- Surfaces: `glassOpacity`, `blurStrength`, `cornerRadius`.
- Layout: `density`, `sidebarCollapsed`, `sidebarStyle`, `sidebarPosition`, `topbarStyle`, `tabStyle`, `tabPosition`.
- Chat: `chatTransparency`, `showAvatars`.
- Motion: `smoothTransitions`, and nested animation `enabled`, `speed`, `particles`, `shootingStars`.
- Voice UI: `pushToTalk`, `pushToTalkKey`, `micButtonStyle`, `voiceWaveStyle`.
- Accessibility: nested `highContrast`, `colorVisionMode`, `textScale`, `reduceMotion`, `focusHighlight`.

The UI also exposes four established preset identities: `solar-flare`, `nebula-purple`, `oceanic-blue`, and `aurora-green`. Keep these IDs stable so saved themes and app mappings remain valid.

### Wiring requirements

1. Every control must update the in-memory appearance state immediately and visibly affect the Apollo shell/component styles where that capability exists.
2. Persist the full normalized appearance through the canonical revision-guarded workspace profile API; handle 409 by reloading/reconciling rather than overwriting another device's changes.
3. On startup and after `spmt.surface.updated`, re-read the canonical profile and hydrate all controls and rendered tokens from it.
4. Relay the derived appearance to embedded app frames using the versioned compatibility envelope; do not treat the relay as the database.
5. Keep voice/chat-specific settings available even when the current screen cannot use them; apply them in capable chat/voice surfaces.
6. Saved theme import/export/apply/delete and app-theme mappings must use the existing profile fields, not localStorage as durable storage.
7. Any field not yet consumed by a component must remain round-trippable and be explicitly marked as pending effect implementation. Never silently drop it.

### Acceptance checks for the settings replacement

- Change each range/toggle/segmented control and verify the corresponding visual or behavioral effect, not merely a state label change.
- Reload and verify values are restored from the canonical profile.
- Change settings in the SPMT Settings surface and verify Apollo refreshes after the invalidation event.
- Verify embedded app frames receive the same derived appearance update.
- Verify all four preset IDs and saved theme round trips.
- Verify reduced-motion, high-contrast, text scale, color-vision mode, and focus highlight have actual accessibility effects.
- Verify profile revision conflicts do not lose edits.

## Proposed replacement boundary

1. Keep Apollo's existing `apps/spacemountain-web` shell and route composition.
2. Keep shared Apollo/SpaceMountain UI packages and global starfield/background assets.
3. Reuse legacy feature capabilities only where Apollo does not already provide an equivalent.
4. Implement a compatibility adapter with explicit route-to-contract mapping; do not add a broad arbitrary URL proxy.
5. Preserve legacy API semantics initially. Avoid backend schema changes during the first UI replacement.
6. Replace one screen/feature at a time, with contract and browser tests before retiring its legacy component.

## Two-pass execution

### Pass 1 — Decapitation and mapping (read-only / isolated)

- Inventory every legacy screen, route, API call, WebSocket/event path, browser-storage key, and theme preference.
- Mark each item as: Apollo already owns it; legacy backend owns it; shared canonical service owns it; UI-only; obsolete/unknown.
- Produce a mapping manifest with source UI action, source endpoint, target Apollo route/contract, data shape, auth requirement, side effects, and confidence.
- Build a mock-data mode so the replacement UI can be reviewed without live services.
- Identify any legacy feature whose backend side effects are not safe to exercise in a test.

### Pass 2 — Adapter and UI swap (after map review)

- Add only explicit adapter routes for approved mappings.
- Translate request/response shapes without changing backend business logic.
- Keep auth/session handling on the canonical Apollo/SPMT path.
- Preserve the legacy theme IDs and all representable appearance fields.
- Test read-only screens first, then controlled writes against disposable data.
- Run browser smoke tests for navigation, mobile layout, theme switching, settings persistence, and API error states.
- Retire a legacy UI module only after its Apollo replacement passes the same workflow checks.

## Immediate next work

1. Inspect the Apollo shell route/app catalog and current SpaceMountain pages to determine what already replaces legacy screens.
2. Finish extracting the legacy UI's endpoint and storage inventory from `src/App.tsx` and child components.
3. Compare each endpoint with Apollo's existing server routes and service contracts.
4. Generate the first machine-readable mapping manifest; do not connect production APIs yet.


## Implemented appearance-wiring slice — PR #615

The first settings implementation is now in the test branch and draft PR:

- The canonical `AppearanceV1` profile accepts the legacy control fields that were missing: accent saturation, border/hover glow, corner radius, voice presentation, nested accessibility, animation enabled, and the legacy sidebar/topbar/tab layout choices.
- The Workspace screen now exposes those controls and previews changes immediately as the user moves sliders, changes selectors, or toggles settings.
- Save remains a revision-guarded SPMT workspace update; the existing canonical workspace profile remains the authority.
- The shared `applyWorkspaceAppearance` renderer translates saved values into CSS tokens and root data attributes used by the shared product UI.
- Apollo applies the profile to the shell and relays the versioned `SPACEMOUNTAIN_THEME` v2 envelope to same-origin app frames.
- Embedded app frames apply that envelope and re-read the canonical workspace after a trusted `spmt.surface.updated` message from a mounted settings/worktray/profile iframe.
- Profile updates remain complete/round-trippable even where a specialized voice or accessibility effect is only meaningful inside the app that owns that capability.

### Verification

- Latest test branch commit at this audit update: `dfdb646a981c2aa2fca57ce14b416c11316feee4`.
- Draft PR: https://github.com/Mtman1987/ApolloStation/pull/615
- Hostless release-gate typecheck and focused Node 1/Node 2 build passed for the immediately preceding code commit; deploy jobs were skipped because the ref is a pull request.
- The full pull-request offline regression suite is still running; do not mark the settings slice fully accepted until that run completes successfully.
- No production deployment or production workspace/profile writes were performed.

## Current status

- Isolated test branch exists.
- Legacy source pinned as a submodule.
- Initial frontend/backend/theme inventory completed.
- No decapitation or backend changes have been made yet.
- No deployment or production data access has occurred.
