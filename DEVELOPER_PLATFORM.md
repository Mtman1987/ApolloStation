# First-Party Developer Platform Contract

Status: **accepted governing decision under D-29**

## Principle

The SpaceMountain application suite is the first customer, proof of concept, test fleet, and reference implementation for the SPMT developer platform.

First-party apps use every developer surface that is applicable to their job. They do not use a tool merely to advertise it, but they may not bypass a relevant public contract because direct coupling is faster to write. If an internal feature cannot be built cleanly with the developer platform, the platform is incomplete and must be improved.

## Supported surfaces

| Surface | Primary use | Required proof |
| --- | --- | --- |
| `@spmt/sdk` | Normal TypeScript application integration | Published version, typed method, validation, example, and contract test |
| Versioned HTTP API | Wire contract and unsupported runtimes | Schema, scoped auth, stable errors, idempotency where mutating, and request example |
| `spmt` CLI | Human operations, diagnostics, setup, migration, and automation | Noninteractive mode, structured output, safe exit codes, help text, and redaction |
| MCP server | Agent and tool-driven discovery and control | Typed tool schema, least-privilege scope, confirmation for dangerous actions, and audit record |
| Events and webhooks | Durable asynchronous integration | Versioned envelope, delivery ID, signature, retry policy, replay/dedupe guidance, and dead-letter visibility |
| WebSocket/SSE | Live updates and presence | Authenticated subscription, reconnect cursor, bounded replay, heartbeat, and tenant isolation |
| Durable jobs | Slow, costly, or wakeable work | Accepted job ID, status, cancellation, idempotency, lease/timeout, result, and cost attribution |
| App manifest/registry | Discovery, launch, scopes, callbacks, and capabilities | Validated manifest, review metadata, health URL, standalone URL, and version compatibility |
| Companion capability protocol | Authorized local CPU/GPU, OBS, device, camera, audio, and background execution | Device pairing, capability grant, revocation, heartbeat, local consent, and cloud fallback behavior |

## Non-negotiable rules

1. A first-party app receives no implicit tenant authority because SPMT owns it.
2. A service authenticates with its registered identity and requests only the scopes its deployable needs.
3. User actions retain the user's identity and authorization separately from the service identity.
4. Cross-app shared data is read and mutated only through versioned SPMT contracts.
5. Asynchronous work uses events, webhooks, streams, or durable jobs; it does not inspect another app's volume or database.
6. A UI-only feature is not a completed platform capability until its useful operation is reachable through a documented contract, except for inherently visual/local presentation behavior.
7. The SDK, HTTP API, CLI, MCP tool, and event definitions use one canonical schema source where they represent the same operation.
8. Errors, rate limits, quotas, correlation IDs, idempotency behavior, and audit records are consistent across surfaces.
9. Secrets, provider credentials, and raw tenant tokens never appear in examples, generated output, logs, URLs, or browser bundles.
10. Examples run against a test tenant and cannot mutate production accidentally.

## Allowed internal exceptions

Only these classes of internal implementation may bypass a public network surface:

- a same-process function call behind the same validated service contract;
- the storage authority's private database/index adapter;
- fenced backup, restore, promotion, and forensic operations;
- a narrowly measured performance optimization that preserves public contract semantics.

An exception must have an owner, threat model, reason, affected scope, tests, audit behavior, and removal/review trigger. It cannot become a general first-party bypass.

## Application proof matrix

Each product demonstrates a different part of the same platform while sharing identity, authorization, data, errors, and observability.

| Application | Required reference proof |
| --- | --- |
| SpaceMountain | Registry discovery, manifest rendering, OAuth launch/session restore, readiness-aware app launch, workspace read, and safe public snapshot |
| SPMT | SDK/API source of truth, OAuth and service-token authority, scopes, CLI, MCP, manifests, events, webhooks, jobs, audit, test tenant, and developer portal |
| Chat Tag | Small complete sample app: manifest, standalone OAuth, SDK points/theme/card reads, idempotent game outcomes, event publication, webhook consumption, and two-tenant tests |
| StreamWeaver | High-volume event/stream consumer, durable automation jobs, quota-aware inference, companion negotiation, overlays, CLI diagnostics, and reconnect/replay behavior |
| DiscordStreamHub | Provider linking, scoped bot operations, signed webhook/event ingestion, member/points projections, durable media jobs, and public integration examples |
| HearMeOut | Live room presence, WebSocket/event behavior, device/worker capabilities, durable media jobs, provider fallback, and standalone OAuth restore |
| Machine Rotator | MCP and CLI operations, Fly lifecycle jobs, approval boundaries, leases, idempotent repair execution, logs/artifacts, and cost/health reporting |
| Companion and MountainView | Device pairing, capability discovery, local consent, OBS/device control, background heartbeat, local AI execution, revocation, and cloud fallback |

This matrix describes minimum proof, not exclusive ownership. A capability may be demonstrated by multiple apps when that creates useful integration coverage.

## Feature delivery sequence

For every new cross-app capability:

1. Name the canonical operation, owner, data, scopes, and events.
2. Define one versioned schema and stable error model.
3. Implement the SPMT authority and authorization policy.
4. Generate or implement the SDK method and raw API contract.
5. Add CLI and MCP control when the operation is useful to a human operator or agent.
6. Add event, webhook, stream, or job behavior when work is asynchronous.
7. Add a test-tenant fixture, executable example, and negative authorization cases.
8. Build the first-party UI/worker using those same surfaces.
9. Run parity, two-tenant isolation, idempotency, retry, degraded-mode, and cost tests.
10. Publish documentation and compatibility information before marking the feature complete.

## Required developer experience

The developer portal must let an approved developer, without owner intervention:

- register an app and exact redirect URLs;
- request and understand scopes;
- obtain test credentials without seeing production secrets;
- inspect manifests, API/SDK versions, webhook deliveries, event schemas, job status, usage, quotas, and audit records;
- run copyable quickstarts and a conformance test;
- revoke credentials and delete test data;
- distinguish production, test, local companion, and degraded behavior.

The CLI and MCP server must expose discovery before mutation. Dangerous operations require explicit confirmation or an approval object; unattended automation uses narrowly scoped policy rather than a universal bypass.

## Release gate

A first-party feature is not done until all applicable answers are **yes**:

- Does it use a registered app/service identity and least-privilege scopes?
- Can an equivalent approved external app perform the operation through a documented contract?
- Do SDK and raw API contract tests use the same schema and error model?
- Are CLI and MCP available when operator/agent control is useful?
- Are async delivery, retries, deduplication, replay, and failure visible?
- Is there an executable test-tenant example?
- Do two-tenant and denied-scope tests pass?
- Are latency, provider use, and cost attributable?
- Are secrets and private data redacted?
- Is every internal exception documented and approved?

This gate turns the application suite into evidence. A working Chat Tag game proves points, identity, events, and standalone OAuth. A working Rotator proves MCP, CLI, approvals, jobs, and lifecycle control. A working Companion proves local capability delegation. Together the apps show developers what the environment can actually do rather than describing a platform that first-party code does not use.
