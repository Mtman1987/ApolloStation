# Mission Control

**Workspace:** @spmt/mission-control  
**Location:** apps/mission-control  
**Runtime entrypoint:** dist/index.js (library/module; no standalone server is defined here)  
**Role:** owner/operator capability module for consolidated operational evidence, fleet/workload projections, monetization summaries, and coder-job workflows.

## 1. What this package is today

Mission Control is currently a small TypeScript application-contract and projection package. It exports:

- a versioned app module manifest and catalog-registration helper;
- a deterministic fleet/workload summary projection;
- a deterministic tenant monetization and usage summary projection.

It does not currently contain its own HTTP server, browser UI, terminal emulator, shell process, or worker. The manifest declares shell and standalone surfaces, but those surfaces are hosted by the Apollo/SpaceMountain application layer.

Do not describe this package as a complete operational dashboard until the UI and runtime workflows are implemented and accepted.

## 2. Product direction

Mission Control is Apollo's owner/operator surface. It must use the authenticated SPMT identity and existing platform operations contracts. It must not depend on the retired Rotator donor application or a separate donor control plane.

The terminal belongs inside Apollo as an owner-scoped, bounded operator surface. A terminal frame is not permission to expose arbitrary shell execution, host filesystems, environment dumps, secret values, or unrestricted process control. Any terminal-backed action must be implemented through a real Apollo-owned service with explicit allowlisted commands, scope checks, audit records, timeouts, output bounds, and confirmation for mutating actions.

OverlayBay may host the terminal as an app frame/panel using its normal controls. OverlayBay itself should not implement a second terminal runtime.

## 3. Manifest and registration

src/index.ts exports the app manifest and missionControlCatalogRegistration(launchUrl). The manifest declares:

- app identity: mission-control;
- surfaces: shell and standalone;
- operational log and coder-job read/invoke scopes;
- coder job created/completed event types;
- connected identity/events and native operations integration.

The catalog helper creates the versioned app registration. Keep the stable app ID; do not create a second terminal app identity just to host the terminal frame.

## 4. Exported projections

### Fleet/workload summary

missionControlFleetView(projections) sorts the workload projection list by workloadId and derives:

- total workload count;
- ready/observed count;
- dry-run count;
- blocked/rolled-back count;
- currently applying count;
- summed healthy capacity;
- summed desired capacity;
- number of workloads for which production mutation is allowed.

It returns the sorted source projections as part of the result. It does not perform infrastructure actions, query a provider, or enable production mutation.

### Monetization summary

missionControlMonetizationView(tenants) derives:

- tenant count and monthly recurring revenue total;
- tenant counts by billing plan;
- 70%, 90%, and exhausted usage warning counts;
- aggregate hosted and Companion usage by metered resource.

The function is a pure projection over supplied values. It does not read billing data, charge users, alter plans, or change usage limits.

## 5. Dependencies and build

The package depends only on @spmt/contracts. It deliberately keeps the projection layer small and does not import provider SDKs, databases, shell libraries, or infrastructure clients.

From repository root:

    npm ci
    npm run build
    npm run typecheck

Package-local build:

    npm run build --workspace @spmt/mission-control

Relevant regression:

    node --test tests/mission-control-fleet-view.test.mjs

The root build includes Mission Control through TypeScript project references.

## 6. Related platform operations

The actual typed operations implementation lives in @spmt/platform-ops and is exposed through SPMT service/API adapter, SDK, CLI, and MCP packages. It contains the authorization-aware operations for logs, coder jobs, runtime state, jobs, device actions, and other platform capabilities.

Mission Control should consume these existing contracts. Do not add direct database access or a second operations API.

The operator capability placement plan is documented in docs/architecture/ROTATOR_CAPABILITY_LIFEBOAT.md. That document describes which donor capabilities are retained in Apollo owners and explicitly rejects a standalone Rotator runtime. It should be kept aligned with the Apollo-owned terminal and operator implementation.

## 7. Security requirements

- All human actions use the authenticated SPMT session and owner/admin scopes.
- Tenant identity and caller app are explicit and validated.
- Read-only status/log operations are separate from mutating operations.
- Mutating operations require allowlisted typed inputs, confirmation, idempotency, audit evidence, and rollback where applicable.
- Logs and command output are bounded and redacted before storage or display.
- No secrets, cookies, access tokens, private environment values, or arbitrary filesystem contents are exposed.
- The browser must not connect directly to infrastructure-provider control APIs.
- An absent terminal backend must be reported as unavailable; never render a fake terminal that implies commands ran.

## 8. Performance and implementation guidance

Keep the package as a pure, low-dependency model/projection layer. Do not move provider polling, large log processing, terminal sessions, or infrastructure mutations into these pure functions.

For the Apollo terminal implementation:

- use a single authenticated server-side session per user/workspace;
- stream output with bounded buffers and backpressure;
- enforce idle/session duration and per-command timeouts;
- cap output bytes and redact secrets before returning output;
- avoid polling when server-sent events or bounded streaming is appropriate;
- never keep a host shell process alive without explicit lifecycle policy;
- do not add a heavyweight terminal emulator to the global SpaceMountain shell bundle; load it only when the terminal panel opens.

## 9. Acceptance checklist

- [ ] Mission Control manifest and catalog registration remain valid.
- [ ] Fleet and monetization projections are deterministic and tested.
- [ ] Owner-only operations use SPMT authorization and tenant scope.
- [ ] Operational logs are redacted, bounded, and attributable to their source.
- [ ] Apollo terminal backend is implemented and its allowlist/security contract is tested.
- [ ] Terminal frame opens inside Apollo/OverlayBay and uses existing workspace controls.
- [ ] Terminal actions are audited and mutating actions require explicit confirmation.
- [ ] No Rotator donor, Fly API, Sprite, or separate control-plane dependency is required.
