# App Contracts

Every rebuilt app and worker must satisfy these rules before it can join the new ecosystem.

`SURFACE_AND_DEVELOPER_CONTRACT.md` is normative. The app contracts below do not permit an app-specific workspace/embed/header solution or a private cross-app shortcut that contradicts that shared contract.

## What counts as a port

An app manifest, package boundary, route placeholder, mock response, isolated contract test, or single cross-app vertical is **scaffolding**, not parity and not a ported app.

A production app counts as ported only when:

- its current deployed donor commit has a machine-checkable inventory of routes, commands, events, sockets, overlays, workers, jobs, state, auth, providers, and operational behavior;
- every discovered user capability is implemented in Green or has an explicit owner-approved `REMOVE` decision;
- retained behavior works through the public SPMT SDK/API/event/WebSocket/job/device contracts instead of a new private shortcut;
- app-private durable state, cache, staging, and outbox data have real bounded storage adapters and restart/restore proof;
- shell, standalone, overlay, popout, bot, and worker surfaces required by the donor all operate;
- compatibility, two-tenant isolation, duplicate/replay, restart, dependency-failure, and cross-app tests pass;
- no fake success, donor-only hardcoded secret, duplicate shared authority, retired Firebase path, or unexplained dead route remains.

Refactoring may change implementation, package layout, process boundaries, and route internals. It must preserve the real user capability and its supported public entry points unless removal is explicitly approved. The purpose is the same usable app with clean platform plumbing, not a thinner demonstration of the app.

## Identity

- Use immutable SPMT user and tenant IDs.
- Use SPMT authorization; do not mint a replacement ecosystem identity.
- Treat Twitch, Discord, Xbox, and other accounts as linked providers.
- Never merge identities by display name.
- Separate the authenticated service from the authorized tenant/user action.

## Data

- Declare an owner for every field and event.
- Read shared facts from SPMT contracts.
- Publish durable outcomes with stable idempotency keys.
- Small local volumes are allowed for app-private durable data, rebuildable caches, temporary staging, and durable retry/outbox records.
- Label every local dataset as `private-authority`, `cache`, `staging`, or `outbox`; define its owner, retention, size limit, and recovery behavior.
- A cached or staged shared fact never becomes canonical until the storage authority acknowledges the idempotent write.
- Never silently fall back to an unmounted local database in production.
- Never write Firebase or Firestore.

## APIs and events

- Version all durable contracts.
- Validate payloads at the boundary.
- Require tenant context and least-privilege scope.
- Make retries safe.
- Use transactional outbox semantics when a database mutation must publish an event.
- Return accepted job IDs for asynchronous work; do not claim completion early.
- First-party apps use documented/versioned SPMT SDK/API/event/WebSocket contracts for cross-app behavior whenever those interfaces naturally fit.
- CLI and MCP are first-class developer/operator clients of the same scoped contracts; they do not bypass authorization or become awkward runtime dependencies when SDK/API calls are the correct interface.
- If a flagship app requires an undocumented private endpoint for a normal integration, treat that as a developer-platform defect and improve the shared contract rather than normalizing the shortcut.
- Prefer caller-initiated integration: an app invokes a documented contract or publishes a scoped event. Registration alone does not authorize SPMT or Stellar Core to crawl the app's content.

## Functional foundation

- Map every retained capability in `config/capability-wiring.v1.json` before declaring it wired. The row names its entry points, public contract, data owner, execution owner, route mode, migration, metering, and evidence.
- Use `ExecutionJobV1` for asynchronous AI, image, media, Xbox, clip, coding, or Companion work unless a documented specialized protocol is required. Return the durable job instead of claiming early success.
- Separate the physical `executionTarget` (`sprite`, `fly`, or `companion`) from the Account `meteringTarget` (`hosted` or `companion`).
- Never place credentials in job payloads/results. Installed services obtain short-lived, scope- and capability-bounded credentials from the SPMT provider-grant broker.
- Keep personal profile, plan, billing, and usage in **Account**. Keep normal and advanced product configuration in that app's **Settings** surface using a versioned app-owned settings definition.
- App-private SQLite stores use the shared migration/checkpoint conventions but remain separately owned databases. Applied migrations are immutable and sensitive settings are encrypted and write-only in public documents.
- Every job transition emits content-minimized correlation, state, target, duration/attempt, and resource evidence for Mission Control; the Account usage ledger remains the usage authority.

## Shared surfaces

- Declare one `SurfaceModeV1`: `shell`, `standalone`, `overlay`, or `popout`.
- Use the one shared `AppFrameV1`/`EmbedBridgeV1` workspace integration path; do not invent app-specific iframe/postMessage/localStorage bridges.
- Consume shared theme, identity, lifecycle, capability, and layout metrics through the canonical contracts.
- In `shell` mode, all content roots, sidebars, fixed/sticky regions, portal roots, dialogs, drawers, menus, popovers, toasts, docks, editor controls, and other interactive floating surfaces must honor the measured shared-header and safe-area inset.
- Never hard-code a duplicate header height or solve header collision with a one-off app padding value.
- `overlay` and `popout` surfaces that do not render the SpaceMountain header use zero shell-header inset plus any real device/output safe area.
- OBS/headless output routes do not include workspace/header chrome unless the output contract explicitly requires it.
- Use the shared semantic layer scale; do not escalate arbitrary z-index values to fight other ecosystem components.
- Full first-party app surfaces use the shared animated star field, glass tokens, and rocket-navigation implementation from `@spmt/ui`; the app supplies only its navigation descriptor and routes.
- Keep workspace palette and app artwork separate: the selected theme recolors the app's own stable scene, while a saved custom background remains an explicit user override.
- Do not render product chrome, background art, or the rocket dock in controls-free `overlay` and `popout` outputs unless their output contract explicitly requires it.

## Shared workspace, messaging, and overlay ownership

- SPMT owns portable workspace/profile state; SpaceMountain owns the canonical workspace host/editor UI.
- SPMT owns shared Mail, Notifications, App Event, and authorized live-chat history; the provider-neutral Chat Gateway owns live provider connections, normalization, cursors, and reconnects; the registered Commlink app owns the combined presentation; SpaceMountain discovers and launches it through the same registry contract used for every other app; StreamWeaver is a scoped persona/command consumer.
- SPMT owns canonical overlay scene/profile metadata and grants; SpaceMountain owns the general overlay editor; product apps publish `OverlayWidgetManifestV1` plus focused controls-free renderers.
- Apps may own product-specific room/chat/game/editor state where it is genuinely product-specific, but must not create a second authority for shared ecosystem state.

## Shared AI identity and invocation

- Stellar Core is persona-neutral execution infrastructure and never chooses the public speaker name.
- `spmt.community-assistant` is the stable platform role; **Stella** is its public display name.
- Any authorized shell, standalone app, StreamWeaver tenant, Commlink client, or external developer app can invoke Stella through the same public SDK/API/CLI/MCP/event/job contracts. No caller must sign into or keep StreamWeaver open first.
- StreamWeaver may present Stella as a community bot or present a tenant/user-configured persona. Athena is only the owner's configured StreamWeaver persona.
- Every invocation carries tenant, user/delegation, caller app, conversation/surface, scope, correlation, retention, and audit context. An app cannot borrow another tenant's persona or memory.
- App-owned presentations carry a bounded snapshot whose `sourceAppId` is derived from the authenticated service, never trusted from the request. The service app must also be installed and enabled for the tenant. Human job/history/export views redact app-private instructions; Stellar workers receive them only through the fenced job claim.
- Persona memory must match tenant, user, source app, persona ID, and conversation. A memory-off invocation loads no prior context or turns and uses the do-not-remember retention path.
- If no inference route is available, developer surfaces return an explicit unavailable/degraded result; they never fabricate a Stella reply.

## Lifecycle

- Expose liveness and dependency-aware readiness separately.
- Report `starting`, `ready`, `degraded`, `draining`, and `unavailable` truthfully.
- Finish or checkpoint work before a lease ends.
- Support graceful drain and bounded shutdown.
- Define cold-start and idle behavior explicitly.
- Publish fresh, authenticated health/demand/capacity signals through the SPMT operations contract; never infer global fleet authority from app registration.
- An app may request lifecycle work only for its own workload and inside its approved `RuntimePolicyV1`; it never receives Fly credentials or direct authority over another app.
- A long-lived bot, provider socket, scheduler, or event consumer must hold a unique fenced lease so scaling or restart cannot create duplicate speakers, consumers, awards, or loops.
- Treat a Rotator/Fly accepted action as `starting` until dependency-aware readiness verifies the new capacity.
- Drain active jobs, rooms, sockets, sessions, and leases before scale-down or controlled restart.

## Standalone experience

- A direct URL works without navigating through SpaceMountain first.
- Authentication still comes from SPMT.
- The loading shell is real UI with safe cached/public content.
- Mutations are disabled or durably queued until their authority is ready.
- Failure exposes a retry/status path; it never fabricates success.

## Security

- No universal platform key.
- No provider token reused as internal authorization.
- No secrets in source, browser bundles, URLs, logs, documentation, or event payloads.
- Short-lived tokens, revocation, scope enforcement, rate limits, and audit records are required for privileged routes.
- Tenant isolation tests cover two distinct tenants and account switching.

## Observability and cost

Every request/job carries correlation ID, tenant ID, app/module ID, version, and outcome. Every worker and inference job records queue time, run time, resource class, provider, retry/fallback, and estimated cost. Logs must redact secrets and private content.

## Definition of done for one app

- contract tests pass against the new SPMT;
- current tenant data is inventoried and migration is repeatable;
- two-tenant isolation test passes;
- cold start, readiness, drain, and rollback pass;
- shared facts match the canonical source;
- no legacy auth or Firebase path is exercised;
- cost and latency budgets are measured;
- all four relevant surface modes pass their layout contract tests;
- theme switching recolors the same app-owned scene, the shared star/navigation layers are present on full app surfaces, and user background overrides remain reversible;
- shell-integrated sidebars, drawers, dialogs, menus/popovers, toast stacks, docks, editor controls, and portal roots pass header/safe-area collision tests at responsive and wrapped-header heights;
- the app uses the common `AppFrameV1`/`EmbedBridgeV1` rather than an app-specific workspace bridge;
- first-party integration calls are traceable to documented SDK/API/event/WebSocket contracts and pass the same scope/tenant checks as third-party calls;
- the app serves as a passing reference implementation for every developer-platform capability it claims;
- old app remains available until the observation gate closes.
