# Functional Foundation

Status: implemented on the ApolloStation functional-foundation branch; production credential and workload adapters remain gated by `config/capability-wiring.v1.json`.

This layer exists so application functionality can be connected without each app inventing jobs, metering, provider-token handling, settings storage, migrations, or operational evidence.

## Ownership

| Concern | Canonical owner | Contract |
|---|---|---|
| Personal profile, plan, billing and usage | SPMT Account | `PersonalUsageSummaryV1` |
| Advanced product configuration | The individual app | `AppSettingsDefinitionV1` / `AppSettingsDocumentV1` |
| Shared asynchronous execution metadata | SPMT | `ExecutionJobV1` |
| App-specific job input/result meaning | Owning app | `ownerAppId` + `capabilityId` versioned contract |
| Provider identity and credential source | SPMT | `ProviderGrantRequestV1` |
| Provider socket/session behavior | Capability worker, normally Chat Gateway | short-lived `IssuedProviderGrantV1` |
| App-private durable state | Individual app | `SqliteAppPrivateDatabase` plus dataset manifest |
| Usage caps and Account percentages | SPMT monetization authority | metering target + resource + idempotency key |
| Runtime placement and scaling | Runtime policies + Rotator | Sprite/Fly/Companion `executionTarget` |

`Account` is user-facing and personal. An app's `Settings` route is for that app's normal and advanced configuration. App settings never become a substitute billing/profile page, and Account never becomes a dumping ground for product toggles.

## Durable execution jobs

Apps submit work through `/v1/jobs`, the SDK, CLI, or MCP. The shared envelope records tenant, app, capability, billed user, plan, resource, usage quantity, machine target, billing target, correlation, progress, attempts, and a fenced lease.

- `executionTarget` is where work runs: `sprite`, `fly`, or `companion`.
- `meteringTarget` is how Account and plan limits treat it: `hosted` or `companion`.
- paid Companion-local work follows the billing manifest's unmetered-local rule while still appearing as Companion usage;
- Free Companion work remains fair-use bounded;
- idempotent job creation consumes usage once;
- payload keys resembling credentials, passwords, secrets, or tokens are rejected;
- workers claim by execution owner and target, heartbeat progress, and finish with the same lease ID and fencing epoch;
- stale leases cannot complete work; retryable failures requeue only inside the attempt bound, then dead-letter;
- every transition emits a content-minimized operations record without the job payload or provider credentials.

Coder-specific jobs remain a compatibility/product contract for Mission Control. New AI, image, media, Xbox, clip, and Companion work should use the shared execution envelope unless a documented specialized protocol is materially required.

## Provider grants

Only an installed service identity with `providers:grant` may call `/v1/provider-grants`. Human sessions are denied even if accidentally issued the scope.

The broker validates tenant, provider identity, app allowlist, capability allowlist, scopes, provider expiry, and a maximum five-minute grant lease. It returns the credential once to the authorized service. Audit receipts omit the credential entirely. Jobs, events, settings documents, URLs, and operations logs must never contain provider credentials.

Provider-specific OAuth refresh remains behind `ProviderCredentialSourceV1`; the broker does not duplicate provider identity or token authority.

## App Settings and private storage

Each app declares a versioned field definition and a subject (`user` or `tenant`). Public reads include defaults, revision, and the names of configured secrets, never secret values. Writes require an expected revision. Sensitive fields require the encrypted secret codec and are readable only by the app backend.

Every app-private database declares:

- app and dataset owner;
- classification: `private-authority`, `cache`, `staging`, or `outbox`;
- retention, maximum size, and recovery behavior;
- ordered migrations with immutable checksums;
- restart/restore and integrity-check evidence.

The shared SQLite kit standardizes WAL, full synchronous writes, transactions, migration history, checkpoints, and revision-safe settings. It does not create one shared application database.

## Capability wiring manifest

`config/capability-wiring.v1.json` is the machine-readable connection map. Every first-party owner has at least one capability row containing:

- user/runtime entry points;
- public contract;
- data and execution owners;
- surfaces and machine targets;
- metered resource when applicable;
- route mode: `green-only`, `shadow`, `green-primary-with-fallback`, or `disabled`;
- state: `scaffolded`, `wired`, `verified`, or `cutover-ready`;
- migration note and test evidence.

Changing a route mode is an explicit reviewed change. There are no hidden dual writes. `shadow` may observe and compare but may not mutate Blue production unless the capability's approved contract expressly permits it.

## Vertical wiring checklist

For each retained capability, connect one complete path before starting another:

1. map its donor entry point in the capability manifest;
2. authorize the tenant, user/service, app, and scopes;
3. load app Settings through the app-private service when configuration is needed;
4. request any provider credential through the grant broker;
5. execute synchronously only for bounded work, otherwise create a metered job;
6. persist the app-private or canonical outcome with an idempotency key;
7. publish the event/output and truthful UI state;
8. verify Account usage and Mission Control evidence;
9. pass duplicate, stale-lease, restart, two-tenant, dependency-failure, and migration tests;
10. advance the manifest state or route mode only with recorded evidence.

Production credentials, Fly mutation, donor retirement, and DNS promotion remain separate cutover authorities.
