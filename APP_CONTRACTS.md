# App Contracts

Every rebuilt app and worker must satisfy these rules before it can join the new ecosystem.

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

- Use `@spmt/sdk` as the default TypeScript boundary; use raw HTTP only for an unsupported runtime, diagnostics, or an explicit wire-contract test.
- Use the documented CLI and MCP tools for operator/agent workflows instead of private maintenance endpoints.
- Use versioned events, webhooks, WebSocket streams, or durable jobs for asynchronous cross-app work instead of reading another app's storage.
- Register the app and its capabilities through the same manifest, OAuth client, scopes, and review metadata expected from an approved external developer.
- Render every Apps/catalog/launcher surface from the canonical registry discovery contract; do not maintain a separate hand-coded app list.
- Use registry parent/module relationships and surface/category filters for apps that contain their own Apps pages or sub-app catalogs.
- Keep catalog approval/visibility separate from runtime readiness; a cold or degraded approved app remains discoverable with truthful status unless policy explicitly hides it.
- Subscribe to registry-change events for fast propagation and use revision/ETag refresh as the missed-event recovery path.
- Do not give first-party callers undocumented scopes, magic headers, database access, or tenant authority.
- Version all durable contracts.
- Validate payloads at the boundary.
- Require tenant context and least-privilege scope.
- Make retries safe.
- Use transactional outbox semantics when a database mutation must publish an event.
- Return accepted job IDs for asynchronous work; do not claim completion early.
- Make each important UI capability available through a documented developer contract unless the capability is inherently visual or local-only.
- Ship an executable example and a contract test for every newly introduced developer capability.

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
- all applicable developer-platform paths pass the parity matrix in `DEVELOPER_PLATFORM.md`;
- an approved fixture app appears on every applicable shared Apps surface without changing those surfaces' source code;
- registry health-state changes update visible status without accidentally deleting the approved listing;
- no first-party-only route or privilege exists without an approved, documented exception;
- the app contributes at least one executable example that an external developer can run against a test tenant;
- cost and latency budgets are measured;
- old app remains available until the observation gate closes.
