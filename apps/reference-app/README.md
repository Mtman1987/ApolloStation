# Reference App

**Workspace:** @spmt/reference-app  
**Location:** apps/reference-app  
**Role:** contract-conformance example and reusable reference implementation for third-party/first-party app developers. It is not a customer-facing Apollo product.

## 1. Purpose

Reference App demonstrates how an app should integrate with the SPMT ecosystem without creating its own identity or shared account authority.

It demonstrates:

- app-owned settings definitions, including encrypted write-only secret settings;
- SPMT SDK initialization;
- shared embed bridge setup and origin validation;
- theme, runtime, session and layout bridge messages;
- an overlay widget manifest;
- creation of a typed SPMT execution job with tenant, user, owner app, capability, metering, idempotency and correlation context.

It intentionally contains fixture behavior only. It is not a production provider integration or an example of storing real account data.

## 2. Main module

src/index.ts exports:

- REFERENCE_APP_SETTINGS — example app settings schema with a boolean notification preference and sensitive write-only provider secret;
- submitReferenceJob — example idempotent SPMT execution job request;
- startReferenceApp — installs shared surface styles, configures the surface root, creates the SPMT client, starts the parent/child bridge, and returns a non-interactive status widget manifest.

## 3. Security contract

- The app uses the SPMT session and SDK; it does not create a second login.
- Parent/child messages use the versioned SPMT embed protocol and an explicit allowed host origin.
- Sensitive settings are write-only and encrypted by the SPMT settings authority.
- The reference job includes ownerAppId, capabilityId, executionOwner, billed user, metered resource, target, idempotency key and correlation ID.
- The default execution target is hosted. Companion must be explicitly selected when the job is genuinely local.
- Do not place real credentials or personal account data in fixture payloads.

## 4. Dependencies

- @spmt/contracts — app settings, execution target, metering and overlay widget contracts.
- @spmt/embed — typed bridge and shell layout metrics.
- @spmt/sdk — SPMT client.
- @spmt/ui — shared surface styles, portal roots and surface configuration.

The reference app should remain small. It must not acquire provider SDKs, database drivers, media libraries or a production worker.

## 5. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/reference-app

Use this app as a contract example when changing the SDK, embed protocol, app settings, app catalog, job creation or overlay widget manifest. A reference example passing does not prove a real app's provider integration works.

## 6. Maintenance rules

- Keep examples aligned with current versioned contracts.
- Prefer hosted as the safe default; require explicit Companion target for local execution.
- Keep sample secrets fake and non-functional.
- Do not add a reference app to production app catalog unless a deliberate test/demo tenant requires it.
- Update this README when the contract example changes.
