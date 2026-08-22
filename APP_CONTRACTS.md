# App Contracts

Every rebuilt app and worker must satisfy these rules before it can join the new ecosystem.

`SURFACE_AND_DEVELOPER_CONTRACT.md` is normative. The app contracts below do not permit an app-specific workspace/embed/header solution or a private cross-app shortcut that contradicts that shared contract.

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

## Shared surfaces

- Declare one `SurfaceModeV1`: `shell`, `standalone`, `overlay`, or `popout`.
- Use the one shared `AppFrameV1`/`EmbedBridgeV1` workspace integration path; do not invent app-specific iframe/postMessage/localStorage bridges.
- Consume shared theme, identity, lifecycle, capability, and layout metrics through the canonical contracts.
- In `shell` mode, all content roots, sidebars, fixed/sticky regions, portal roots, dialogs, drawers, menus, popovers, toasts, docks, editor controls, and other interactive floating surfaces must honor the measured shared-header and safe-area inset.
- Never hard-code a duplicate header height or solve header collision with a one-off app padding value.
- `overlay` and `popout` surfaces that do not render the SpaceMountain header use zero shell-header inset plus any real device/output safe area.
- OBS/headless output routes do not include workspace/header chrome unless the output contract explicitly requires it.
- Use the shared semantic layer scale; do not escalate arbitrary z-index values to fight other ecosystem components.

## Shared workspace, messaging, and overlay ownership

- SPMT owns portable workspace/profile state; SpaceMountain owns the canonical workspace host/editor UI.
- SPMT owns shared Mail, Notifications, and App Event account data; StreamWeaver owns normalized live-chat runtime/feed behavior; SpaceMountain owns the combined Commlink presentation.
- SPMT owns canonical overlay scene/profile metadata and grants; SpaceMountain owns the general overlay editor; product apps publish `OverlayWidgetManifestV1` plus focused controls-free renderers.
- Apps may own product-specific room/chat/game/editor state where it is genuinely product-specific, but must not create a second authority for shared ecosystem state.

## Lifecycle

- Expose liveness and dependency-aware readiness separately.
- Report `starting`, `ready`, `degraded`, `draining`, and `unavailable` truthfully.
- Finish or checkpoint work before a lease ends.
- Support graceful drain and bounded shutdown.
- Define cold-start and idle behavior explicitly.

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
- shell-integrated sidebars, drawers, dialogs, menus/popovers, toast stacks, docks, editor controls, and portal roots pass header/safe-area collision tests at responsive and wrapped-header heights;
- the app uses the common `AppFrameV1`/`EmbedBridgeV1` rather than an app-specific workspace bridge;
- first-party integration calls are traceable to documented SDK/API/event/WebSocket contracts and pass the same scope/tenant checks as third-party calls;
- the app serves as a passing reference implementation for every developer-platform capability it claims;
- old app remains available until the observation gate closes.
