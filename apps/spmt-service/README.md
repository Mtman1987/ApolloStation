# SPMT Service

**Workspace:** @spmt/service  
**Location:** apps/spmt-service  
**Runtime entrypoint:** src/provider-identity-start.ts → dist/provider-identity-start.js  
**Primary responsibility:** canonical SPMT HTTP authority for identity, authentication, app catalog and installs, shared ecosystem facts, provider grants, jobs/events, account recovery, usage/entitlements, and platform APIs.

## 1. Service role

SPMT Service is the platform authority boundary. Applications should not create competing copies of ecosystem-wide facts or access another application's private database directly.

The service composes shared platform packages into one HTTP server. Its responsibilities include:

- human identity, tenant membership, authentication/session validation, and account recovery;
- app registration, catalog discovery, installation, and scope/grant enforcement;
- canonical shared workspace/profile/theme and shared reward/XP facts;
- provider-link state, OAuth client integration, credential authority, and short-lived provider grants;
- shared jobs, execution requests, usage/entitlement and billing-plan state;
- Commlink shared messaging, notifications, live-chat history and related platform-owned communication records;
- Stellar assistant invocation and privacy/retention contracts;
- platform health, audit, and bounded operations interfaces;
- app-facing versioned HTTP contracts used by the SDK, CLI, MCP, and first-party applications.

The service is not the SpaceMountain UI, not a provider bot worker, and not a general-purpose infrastructure terminal. It is the trusted backend authority used by those clients.

## 2. Runtime composition

The primary implementation is src/index.ts. It composes the platform services, API routes, stores, worker integrations, and HTTP server.

The production entrypoint is src/provider-identity-start.ts. It reads the runtime environment, validates required configuration, constructs the SPMT service with provider-identity routes, and starts the process.

src/provider-identity-host.ts wraps the normal SPMT service and mounts the provider identity adapter on the same HTTP server. Non-provider requests are delegated to the original request listener rather than duplicating the main API routing implementation.

Focused API modules include:

| Module | Responsibility |
|---|---|
| src/index.ts | Main service composition, platform APIs, HTTP routes and stores |
| src/provider-identity-host.ts | Provider identity route adapter mounted on the normal service |
| src/provider-identity-start.ts | Production process bootstrap and environment validation |
| src/human-reference-api.ts | Human-reference identity API |
| src/assistant-api.ts | SPMT assistant-facing API |
| src/public-persona-api.ts | Public persona API |
| src/social-stream-api.ts | Commlink social stream API |
| src/commlink-forum-api.ts | Commlink forum API |
| src/commlink-forum-forwarding-api.ts | Forum forwarding workflows |
| src/commlink-operator-api.ts | Commlink operator API |
| src/media-api.ts | Platform media API |
| src/output-gateway.ts | Scoped output gateway |
| src/twitch-bot-api.ts | Twitch bot role and API integration |
| src/youtube-oauth-api.ts | YouTube OAuth integration |

Keep route modules focused. Shared policy, identity, tenancy, and persistence belong in their owning packages, not in copied route-specific implementations.

## 3. Shared package composition

The service depends on the platform packages rather than owning every implementation internally.

| Package | Role |
|---|---|
| @spmt/contracts | Versioned schemas, identifiers, payload validation and public contract types |
| @spmt/auth-core | Authentication and authorization primitives |
| @spmt/authority-core | Canonical authority/domain services |
| @spmt/authority-sqlite | SQLite authority-store adapter and recovery adapter |
| @spmt/account-recovery-core | Account setup and provider identity recovery |
| @spmt/control-core | Control and policy services |
| @spmt/platform-data-core | Platform data services and OAuth client contracts |
| @spmt/platform-data-sqlite | SQLite platform data and media stores |
| @spmt/provider-grants-core | Provider credential authority and grant broker |
| @spmt/execution-core | Durable execution jobs |
| @spmt/outbox-core | Durable event/output dispatch |
| @spmt/monetization | Plans, usage, entitlements and metering |
| @spmt/platform-ops | Owner-scoped operations and coder/assistant runtime contracts |
| @spmt/api-adapter | HTTP adapter over shared platform operations |
| @spmt/runtime | Health/readiness registry |
| @spmt/commlink-core | Shared Commlink messaging and communication state |
| @spmt/stellar-core | Persona-neutral assistant, memory, privacy and speech capabilities |
| @spmt/streamweaver | StreamWeaver catalog and widget manifests |
| @spmt/discord-stream-hub | Discord Stream Hub catalog registration |
| @spmt/hearmeout | HearMeOut catalog registration |
| @spmt/nebula-arcade | Nebula Arcade catalog registration |

This is a large composition root by design, but it is also a performance and maintainability risk. Keep application-specific work in the application package, shared business logic in a single package, and route composition thin. Avoid adding another large subsystem directly to index.ts.

## 4. Data ownership and persistence

SPMT Service is the canonical authority for shared ecosystem facts. It must not become a universal owner of product-private state.

- SPMT-owned: identities, tenants, membership/roles, app registry/install/grants, shared workspace/profile facts, shared XP/rewards, provider links/grants, usage/entitlements, platform jobs/events/audit and shared communication records.
- App-owned: product-private room, game, bot, media-session, and tenant configuration data where the application is the legitimate owner.
- Non-authoritative: cache, staging, scratch, temporary files, and rebuildable projections.

The current service package declares SQLite-backed authority and platform-data adapters. The production bootstrap requires a database path and refuses to start without one; it does not itself establish a remote Turso-backed authority adapter. The Hostless launcher has historically supplied a /tmp path fallback. That path is ephemeral and must not be mistaken for durable production persistence.

The repository contains Turso migration and HTTP client tooling, but migration scripts or a populated remote database do not prove the live SPMT service is reading and writing that database. Before production authority is declared durable, verify the actual runtime adapter, connection configuration, write path, restart behavior, backup, integrity check, and isolated restore.

Never silently fall back to a local database when remote durable storage is required. Never allow two writers to own the same shared facts during migration.

## 5. Required and optional configuration

The exact production environment mapping is maintained by the Hostless release workflow and scripts/hostless/start-node.mjs. This list names variables only; never commit or paste their values.

### Core bootstrap

- PORT
- SPMT_RUNTIME_MODE
- SPMT_DATABASE_PATH or DATABASE_PATH
- SPMT_PUBLIC_URL
- SPMT_WEBHOOK_KEY
- BUILD_SHA

The webhook key must decode from base64url to exactly 32 bytes. Production must receive an explicit database path; the service does not create an implicit production database.

### Provider OAuth and credentials

Optional provider clients are assembled from complete credential pairs:

- TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET
- DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET
- KICK_CLIENT_ID and KICK_CLIENT_SECRET
- YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET
- SPMT_PROVIDER_CREDENTIAL_KEY

The provider credential key, when supplied, must decode from base64url to exactly 32 bytes. Provider secrets remain server-side and are never returned to app clients.

### Worker/service authentication

The bootstrap recognizes worker credentials and enable flags for Stellar Core, Chat Gateway, StreamWeaver, Discord Stream Hub, Nebula Arcade, and HearMeOut. Examples include STELLAR_WORKER_CREDENTIAL with SPMT_STELLAR_CHAT_ENABLED, CHAT_GATEWAY_WORKER_CREDENTIAL with SPMT_CHAT_GATEWAY_ENABLED, STREAMWEAVER_WORKER_CREDENTIAL with SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED, DSH_WORKER_CREDENTIAL with SPMT_DSH_LIVE_RUNTIME_ENABLED, NEBULA_ARCADE_WORKER_CREDENTIAL with SPMT_NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED, and HEARMEOUT_WORKER_CREDENTIAL with SPMT_HEARMEOUT_RUNTIME_ENABLED.

An enabled worker without its corresponding credential is a startup error. Keep worker identities distinct and scoped; do not reuse one universal token across services.

## 6. Build and local development

From repository root:

    npm ci
    npm run build
    npm run typecheck

Package-local build:

    npm run build --workspace @spmt/service

The package start script runs node dist/provider-identity-start.js. The root TypeScript project-reference build includes SPMT Service after its shared package dependencies.

For broad regression:

    npm test
    npm run test:offline

Do not run a production migration or provider rehearsal as part of routine local startup.

## 7. Security requirements

- Authenticate and authorize at the API boundary; validate tenant context, caller identity, delegation, scope, and capability.
- Use least privilege. A worker receives only the scopes required for its role.
- Keep provider credentials encrypted and brokered as short-lived, bounded grants.
- Never put credentials in job payloads, URLs, browser storage, logs, diagnostics, or error messages.
- Apply request-size and payload validation limits before parsing/dispatch.
- Make state-changing requests idempotent where retries are possible.
- Use transactional outbox behavior when a durable database mutation must publish an event.
- Keep app-private data out of SPMT unless it is genuinely shared platform authority.
- Do not expose unrestricted infrastructure credentials or arbitrary terminal execution through this service.
- Fail closed when required production configuration is missing or malformed.

## 8. Operational behavior and troubleshooting

| Symptom | Checks |
|---|---|
| Service will not start | Confirm PORT, SPMT_WEBHOOK_KEY format, runtime mode, and explicit database path |
| Anonymous session returns 401/403 | Confirm the caller is expected to be signed in; inspect session gate and bridge/session flow rather than weakening authorization |
| App catalog is empty | Check authority store integrity, canonical registration data, tenant install state, and caller scopes |
| Worker reports unauthorized | Confirm its distinct service credential, tenant binding, SPMT origin, and required scope |
| OAuth connection unavailable | Check complete client credential pair, callback configuration, provider grant state, and token refresh result |
| XP/workspace state differs across apps | Trace the canonical SPMT contract and actual backing store; do not repair by writing an app-local duplicate |
| Service restarts lose data | Inspect the effective database path and mounted/durable storage; /tmp is not durable |
| Jobs remain pending | Inspect worker lease, execution target, outbox/retry state, provider grant, and correlation IDs |

## 9. Performance and maintainability

- Keep the composition root readable by moving domain behavior into its owning packages.
- Avoid loading every app's heavy runtime in the request path when a lightweight catalog manifest or lazy boundary is sufficient.
- Reuse SDKs and shared adapters; do not clone serialization, authorization, or persistence logic.
- Bound HTTP bodies, query work, event fan-out, outbox batches, retry loops, and in-memory maps.
- Use indexes and bounded pagination for durable list APIs.
- Keep external provider calls off synchronous identity/session paths.
- Cache only rebuildable data and define invalidation/TTL behavior.
- Measure cold start, request latency, memory, database query count, and worker concurrency before optimizing.

## 10. Change checklist

1. Decide whether the behavior is shared SPMT authority or product-private app behavior.
2. Implement the rule in the owning shared package where possible.
3. Add boundary validation and tenant/scope tests.
4. Add migration, idempotency, and recovery coverage for durable data changes.
5. Update the relevant API/SDK contract and app integration tests.
6. Verify logs and diagnostics contain no credential or private payload.
7. Run typecheck, focused tests, full tests, and offline tests as appropriate.
8. For runtime changes, verify the actual Hostless node, effective environment, deployed SHA, restart persistence, and rollback evidence.
