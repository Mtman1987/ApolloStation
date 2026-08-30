# Shared Surface and Developer Platform Contract

Updated: 2026-08-23
Status: **required Green contract**

This contract exists to prevent two failures from the Blue system from returning in Green:

1. each app inventing a different workspace/embed/header/overlay implementation; and
2. first-party apps bypassing the same developer platform that outside developers are expected to use.

The SpaceMountain ecosystem apps are flagship/reference integrations. If the first-party apps cannot build cleanly on the public contracts, the public contracts are not finished.

## 1. One surface model

Every web UI declares exactly one `SurfaceModeV1`:

- `shell` — rendered inside the SpaceMountain workspace and shared header;
- `standalone` — direct app URL with the app's own product chrome but SPMT identity;
- `overlay` — controls-free output for OBS/browser source or other headless rendering;
- `popout` — independent utility window/panel without the SpaceMountain shell header.

Apps do not create their own fifth mode, alternate workspace container, alternate shared header, or custom iframe protocol.

The same application components may render differently by surface mode, but identity, state ownership, theme tokens, capabilities, events, and permissions remain the same contracts.

## 2. One workspace embed path

SpaceMountain owns one `AppFrameV1` host and one `EmbedBridgeV1` protocol for every embedded first-party and third-party app.

The bridge carries versioned messages for:

- session/authenticated identity status;
- tenant and app identity;
- theme/design tokens;
- shell layout metrics and safe insets;
- navigation/deep links;
- requested capabilities and granted scopes;
- lifecycle/readiness/degraded state;
- open-direct/popout requests;
- focus, resize, and accessibility metadata where needed.

Cross-origin apps receive the same bridge contract as same-origin apps. An app may not invent app-specific postMessage payloads, iframe query conventions, or localStorage synchronization when the shared bridge covers the behavior.

A small bootstrap query such as a versioned surface mode or signed launch identifier is allowed, but long-lived identity, permissions, theme, workspace state, or secrets are never encoded into iframe URLs.

## 3. Header-safe layout invariant

No interactive Green UI may become unreachable or obscured behind the shared SpaceMountain header.

The shell measures its real header height dynamically, including wrapping, responsive changes, and device safe-area insets. The measured values are exposed as versioned layout metrics and CSS tokens, including a canonical top inset concept equivalent to:

```css
--spmt-header-height
--spmt-safe-top
--spmt-safe-bottom
--spmt-shell-top-inset
--spmt-shell-available-height
```

Same-document surfaces consume the tokens directly. Cross-origin `AppFrameV1` children receive the values through `EmbedBridgeV1` and apply equivalent local variables.

The contract applies to **all** shell-integrated UI, not only page content:

- main page/content roots;
- fixed and sticky sidebars;
- drawers and sheets;
- dialogs and modal content;
- dropdowns, menus, comboboxes, tooltips, and popovers;
- command palettes;
- notification/toast stacks;
- floating action buttons and control trays;
- workspace docks;
- editor chrome and overlay previews;
- portal roots rendered outside the normal component tree.

No component may hard-code a duplicate header height. No app may solve the problem with a one-off `padding-top` number.

### Positioning rule

In `shell` mode, ordinary interactive UI is constrained to the usable shell rectangle below the measured shared header and inside device safe areas. Fixed/sticky sidebars and portal/floating roots use that same rectangle.

Use dynamic viewport measurements (`dvh`/measured available height) rather than assuming `100vh` is the visible usable space.

A modal may deliberately cover the header only when the shared component contract explicitly marks it as a whole-shell blocking experience. Even then its controls must remain inside device safe areas and above all clipping layers.

### Overlay and popout exception

`overlay` and `popout` surfaces do **not** inherit a header inset when no shared header is rendered. Their shell top inset is zero plus any real device/output safe area.

An OBS/browser-source renderer never includes workspace/header chrome unless the output specification explicitly calls for it. Overlay **editors/previews** inside SpaceMountain remain `shell` surfaces and therefore obey the header-safe inset.

## 4. One shared layer scale

Green defines one semantic layer scale instead of app-specific arbitrary z-index numbers. At minimum it distinguishes:

1. base content;
2. sticky content/sidebars;
3. floating controls/popovers;
4. shared shell header/navigation;
5. modal/dialog surfaces;
6. toast/critical transient surfaces;
7. explicitly authorized whole-shell emergency/blocking surfaces.

Components use semantic layer tokens. They do not compete by adding larger arbitrary z-index values.

### Product chrome and scene invariant

Every full first-party app surface uses the shared `@spmt/ui` product grammar: animated ecosystem stars, glass and focus tokens, and the rocket-navigation interaction. Apps provide their own navigation descriptor and routes; they do not copy or fork the navigation implementation. An app may change its logo, content, accent details, and specialized controls without changing the familiar interaction model.

The workspace theme and app artwork are separate inputs. The canonical workspace theme selects the palette and tints every app consistently. Each app owns one default scene image appropriate to its purpose, and that image remains the same when the theme changes. A canonical user background URL is an explicit override, not a replacement for the app-owned default scene contract.

`overlay` and chrome-free `popout` modes omit the product background, star field, shared header, and rocket navigation unless their versioned output contract explicitly requires one of those layers.

## 5. Shared workspace, messaging, and overlays have one owner each

### Workspace

- SPMT owns portable workspace/profile state.
- SpaceMountain owns the canonical workspace editor/host UI.
- Apps consume workspace/profile state through the SPMT developer contracts.
- Apps do not duplicate a second workspace editor or authoritative workspace database.

### Messaging / Commlink

- SPMT owns Mail, Notifications, and App Event account data.
- SPMT owns authorized shared live-chat history; the provider-neutral Chat Gateway owns provider connections, normalization, cursors, and reconnect behavior.
- StreamWeaver consumes normalized live chat for configured personas and commands; it does not own a private ecosystem chat contract.
- SpaceMountain owns the combined Commlink workspace presentation.
- Apps publish/consume through versioned messaging/event SDK/API contracts rather than embedding unrelated bespoke inboxes for shared messages.

An app may have product-specific chat or room UI where the conversation itself belongs to that product, but shared ecosystem messages still use the Commlink contracts.

### AI presentation and invocation

- Stellar Core owns provider-neutral execution, routing, durable jobs, health, usage, and structured results. It does not own or select a public persona.
- `spmt.community-assistant` is the stable technical identity for the default Community Assistant; **Stella** is its public display name.
- Stella is an SPMT ecosystem capability, not a feature locked to SpaceMountain or StreamWeaver. Authorized shell, standalone, Commlink, StreamWeaver, and external clients invoke her through equivalent versioned SDK, HTTP API, CLI, MCP, event/job, and live-result contracts.
- StreamWeaver may choose Stella as its community bot or use a tenant/user-configured persona. Athena identifies only the owner's StreamWeaver persona.
- Invocation must enforce SPMT tenant/user or delegated-user authority, app grants, scopes, provider/routing entitlements, memory boundaries, retention, correlation, and audit uniformly across every client.
- An unavailable inference route produces a truthful unavailable/degraded result. No UI or developer adapter invents a reply.
- App registration alone grants no ingestion. Apps or users initiate calls/events unless a separately authorized subscription, import, synchronization, or feed contract says otherwise.

The first public Stella vertical uses one operation contract through every adapter:

| Developer surface | Discovery | Invocation |
|---|---|---|
| SDK | `getCommunityAssistant(tenantId)` | `invokeCommunityAssistant(tenantId, input, idempotencyKey)` |
| HTTP | `GET /v1/assistants/community` | `POST /v1/assistants/community/invocations` |
| CLI | `assistant show TENANT` or `stella show TENANT` | `assistant invoke TENANT JSON IDEMPOTENCY_KEY` or the `stella` alias |
| MCP | `spmt.assistants.community.get` | `spmt.assistants.community.invoke` |
| Commlink/app UI | read the same descriptor | submit the same scoped invocation and follow its returned job ID |

The invocation never returns fabricated completion. With no worker it returns `status: unavailable` and a reason. With a connected durable runtime it returns `status: accepted` plus `jobId`; progress and the final structured result must use the normal authenticated job/event delivery contract.

### Overlays

- SPMT owns canonical scene/profile metadata and grants.
- SpaceMountain owns the canonical overlay/workspace editor experience.
- Product apps publish versioned `OverlayWidgetManifestV1` capabilities and controls-free renderers.
- Apps may expose focused product controls/previews, but they do not create competing general-purpose overlay editors.
- One widget/source has one stable ownership contract even if it is rendered in OBS, SpaceMountain, Companion, or a standalone preview.

The implemented widget/runtime registration vertical uses one operation contract through every adapter:

| Capability | SDK | HTTP | CLI | MCP |
|---|---|---|---|---|
| Register widget | `registerOverlayWidget(tenantId, manifest)` | `PUT /v1/overlay/widgets` | `overlay register TENANT MANIFEST_JSON` | `spmt.overlay.widgets.register` |
| List widgets | `listOverlayWidgets(tenantId, appId?)` | `GET /v1/overlay/widgets` | `overlay list TENANT [APP_ID]` | `spmt.overlay.widgets.list` |
| Issue output | `issueOverlayOutput(tenantId, appId, widgetId, viewerUserId?, ttlMs?)` | `POST /v1/overlay/outputs` | `overlay issue TENANT APP_ID WIDGET_ID [VIEWER_USER_ID] [TTL_MS]` | `spmt.overlay.outputs.issue` |
| List outputs | `listOverlayOutputs(tenantId, appId?)` | `GET /v1/overlay/outputs` | `overlay outputs TENANT [APP_ID]` | `spmt.overlay.outputs.list` |
| Revoke output | `revokeOverlayOutput(tenantId, grantId)` | `POST /v1/overlay/outputs/{grantId}/revoke` | `overlay revoke TENANT GRANT_ID` | `spmt.overlay.outputs.revoke` |
| Report runtime | `reportRuntimeState(tenantId, state, detail?)` | `POST /v1/runtime/state` | `runtime report TENANT STATE [DETAIL]` | `spmt.runtime.state.report` |
| List runtime | `listRuntimeStates(tenantId, appId?)` | `GET /v1/runtime/state` | `runtime list TENANT [APP_ID]` | `spmt.runtime.state.list` |

Widget registration requires an enabled tenant install, validates HTTPS renderer/preview URLs and app-declared scopes, and derives the caller app from the authenticated service identity rather than `x-spmt-app`. Ordinary app services can write and read only their own widget/runtime records. Cross-app maintenance requires an explicit `overlay:widgets:any` or `runtime:any` grant. Output grants are tenant-owner-only, require a registered widget on an enabled install, return an opaque browser-source URL once, persist only the token hash, expire and revoke closed, and resolve server-side to a verified tenant/app/widget/viewer principal without a redirect or caller-controlled identity parameters. Output inventory never returns the bearer URL. A product's private runtime state remains owned by that product.

## 6. First-party apps dogfood the developer platform

Every first-party flagship app must integrate with SPMT through the same public/versioned developer surface an external developer would use whenever that surface is appropriate.

The app catalog is one contract for every publisher. SpaceMountain-owned apps publish the same `AppCatalogRegistrationV1` record and register through the same `apps.register` SDK/API/CLI/MCP authority as outside developers. A catalog `launchUrl` is a complete publisher-supplied URL and is never reconstructed from a special first-party host convention. SpaceMountain ownership may change review policy, approved scopes, or publisher authority; it does not create a private launch path, URL validator, or registration shortcut.

### Preferred interface by job

- **TypeScript/JavaScript SDK** — default first-party application client for identity, app registry, workspace, messaging, events, jobs, overlay manifests, device contracts, and typed API calls.
- **HTTP API** — language-neutral canonical network contract and integration fallback.
- **WebSocket/SSE** — authenticated live feeds, job progress, presence, and real-time event delivery where required.
- **Events/webhooks** — decoupled asynchronous cross-app outcomes and third-party callbacks.
- **CLI** — developer/operator setup, inspection, validation, local testing, publishing, and automation; not a runtime dependency when an SDK/API is the natural interface.
- **MCP** — AI/developer/operator access to documented, scoped capabilities; not a bypass around authorization or an excuse to expose private internals.
- **Website/Shipyard/deep links** — discover, install, authorize, configure, launch, and document apps through the same experience third-party apps receive.

A first-party app must not use direct shared-database access, undocumented cross-app HTTP endpoints, copied provider secrets, or private local files simply because both apps are owned by SpaceMountain.

The operations console follows the same rule. Apps publish redacted structured operational evidence and prepare coder handoffs through the public SDK/API/CLI/MCP contracts. Your SpaceMountain view can consolidate every app covered by your owner/maintainer grants; another developer receives the same operations capability limited to their own approved apps and tenants. Rotator-wide `:any` scopes remain private high-risk maintenance grants, not a different API.

Same-process modules may call each other directly when they are deliberately packaged as one deployable, but the externally meaningful capability must still have a versioned contract if another app or developer could need it.

## 7. Flagship/reference implementation requirement

For every major developer capability, at least one first-party app is the tested reference implementation.

Examples:

- SPMT login/session restore → all flagship apps;
- workspace/theme SDK → StreamWeaver, DSH, HearMeOut, and Nebula Arcade;
- messaging/events → DSH and Nebula Arcade producing events, SpaceMountain/Commlink consuming them;
- live feed/WebSocket/SSE → Chat Gateway, StreamWeaver, and Commlink;
- overlay widget manifest → StreamWeaver, DSH, HearMeOut, and Nebula Arcade;
- jobs/worker SDK → Stellar Core/Stella, StreamWeaver worker, DSH clip worker, HMO DJ/media worker, and Nebula Arcade bot/worker;
- device API → Companion/MountainView;
- CLI → local developer bootstrap, conformance and deployment inspection;
- MCP → Stella, configured StreamWeaver personas, developer, and operator read/action flows through normal Stellar Core/SPMT scopes; Athena is only the owner's configured persona.
- operations/coder contracts → each app proves self-scoped logging and coder handoff; SpaceMountain Mission Control proves owner-scoped consolidation; the Rotator proves separately approved cross-app maintenance scopes.

Documentation examples should be generated from, or continuously tested against, these real reference integrations whenever practical.

If a first-party team needs a private shortcut because the public contract cannot perform a normal integration task, that is treated as a developer-platform gap. The preferred fix is to improve the public contract, not preserve the shortcut.

## 8. Required automated proof

Before a flagship app can be called Green-ready:

### Surface/layout tests

Test at desktop/mobile widths and multiple simulated header heights, including a wrapped/tall header. Assert that visible interactive rectangles for pages, sidebars, drawers, dialogs, menus, popovers, toasts, docks, and editor controls do not enter the reserved header/safe-area region unless explicitly authorized.

Test `shell`, `standalone`, `overlay`, and `popout` modes separately. Cross-origin embed tests must prove layout metric updates propagate after resize/header-height changes without reload.

### Embed tests

- one `AppFrameV1`/`EmbedBridgeV1` handshake works for every flagship app;
- account switch/logout/revocation updates the embedded app;
- theme/workspace change reaches the app without app-specific storage bridges;
- unavailable/degraded state is visible and does not fabricate success;
- no secrets appear in iframe URLs or postMessage payloads.

### Developer-platform conformance

- first-party runtime network calls are traceable to documented SDK/API/event contracts;
- scopes and tenant context are enforced exactly as for third-party callers;
- SDK and raw API contract tests agree;
- operations evidence is redacted before persistence, app-service callers cannot cross app boundaries, owner/developer consolidation follows tenant/maintenance grants, and a disconnected coder produces only a truthful draft;
- CLI and MCP cannot perform an action that their underlying authenticated/scoped API would reject;
- reference examples run in CI against the same schemas used by the flagship apps.

## 9. Definition of failure

The following are release blockers, not cosmetic bugs:

- a sidebar, popup, dialog, overlay editor, or control becomes hidden behind the shared header;
- one app requires a custom workspace/embed protocol to function;
- two apps keep separate authoritative copies of the same workspace/message/overlay fact;
- a first-party app can perform a cross-app action only through a private undocumented endpoint;
- the public SDK/API says a capability exists but no flagship/reference app proves it;
- an OBS/headless output accidentally renders workspace/header chrome;
- a fixed component works at one hard-coded header height but breaks when the header wraps or a device safe area changes.
