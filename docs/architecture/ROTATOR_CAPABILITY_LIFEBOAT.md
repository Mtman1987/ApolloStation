# Rotator capability lifeboat — ApolloStation port plan

Status: inventory and placement baseline; implementation is staged.
Donor: `Mtman1987/fly-machine-rotator`.
Destination: `Mtman1987/ApolloStation`.
Runtime target: Apollo's existing Hostless Node 1 and Node 2 only. Fly.io is not a production target. Node 3 is excluded.

## Product decision

Do not recreate or deploy a Rotator application. Extract reusable behavior from the donor and place it in the existing Apollo owners:

- Stella Core / operator workspace: operator experience, Athena workbench, coding/review workflows, system diagnostics.
- SPMT service and `@spmt/platform-ops`: authenticated typed operations, status aggregation, logs, repair/job lifecycle, audit evidence.
- Apollo MCP: expose the existing platform operations through Apollo's authenticated MCP/broker contract. Do not add a second tool registry or preserve the donor's standalone MCP server.
- Overlay Bay: Personal Bulletin and browser/app frames; terminal is a frame only when it is backed by a real approved Apollo terminal surface.
- Commlink / MountainView successor surfaces: phone/voice/glasses controls, command routing, memory and media integrations, using the existing Apollo identity and app-owned APIs.
- App-owned runtimes: preserve each app's own data, bots, workers, domain rules and provider integrations. Apollo remains the shared shell/control plane, not a replacement engine.

## Donor inventory and destination map

| Donor capability | Preserve | Apollo destination / replacement |
|---|---|---|
| Stella Coder isolated repair jobs, validation, exact diffs, artifacts, draft-PR publication | Job lifecycle, isolated workspaces, checks, review artifacts, publish gate | Existing Apollo coder job APIs and Stella Core operator workspace. Reuse `@spmt/platform-ops` coder operations; preserve validation-before-publication. |
| Athena workbench/provider controls | Useful operator workflows and provider health metadata | Stella Core / existing Athena and Stellar Core services. Permanent identity, memory and tool policy stay with their existing authority owners. |
| MCP control server and tool descriptions | Capability contracts and safe read/write classification | Apollo MCP package and existing broker. One registry, canonical SPMT OAuth identity, tenant scopes, source attribution. |
| Fly app/Machine status and health checks | Fleet-style summary, state normalization, health-check reporting | Hostless deployment/app status for Apollo Node 1 and Node 2; no Fly app/Machine identifiers or Fly API dependency. |
| Fly NATS log sampling and redaction | Bounded log sampling, redaction, errors-only filtering, source metadata | Hostless/Apollo deployment logs plus sanitized browser/server diagnostics. Keep bounded queries and redact before returning to tools/UI. |
| Machine rotation, leases, standby promotion, singleton protection | General principles: fencing, idempotency, health-before-cutover, no duplicate workers, rollback evidence | Replace with Hostless Node 1/2 health and deployment recovery policy. Do not port Fly Machine rotation calls. No automatic restart/traffic switch until the Hostless-specific operation and safety contract exist. |
| Worker status and provisioning (LLM/embeddings) | Worker health, readiness, provisioning intent, resource metadata | Existing Apollo worker/runtime contracts and Hostless app deployments. Do not carry Fly provisioner or Fly secrets across. |
| Athena repair audit, incident classification, MtFixIt handoff | Sanitized incidents, repair lifecycle, audit trail, validation outcome | Stella Core diagnostics + platform-ops/MtFixIt APIs. Preserve human approval for sensitive operations. |
| MountainView commands, voice router, memory and phone companion | User-facing capabilities and device workflows | Existing Commlink, Stellar Core, StreamWeaver and companion/mobile integrations. Port only after identifying current Apollo owner for each API and data store. |
| Quackverse art inventory / volume reads | Asset inventory, hashes, safe image-only retrieval | Nebula/ChatTag-owned asset service or media library. No arbitrary volume/path access. |
| Discord reports and notifications | Operational summaries and event notifications | Apollo notification/event delivery and existing Discord integrations. No donor webhook secrets or second notification policy. |
| Rotator home/fleet dashboard UI | Functional affordances only | Do not port standalone dashboard CSS/navigation. Use Stella Core, shared `@spmt/ui`, and Overlay Bay. |

## Required boundaries

1. **No Fly dependency in the destination.** Do not import Fly API clients, Fly NATS subscriptions, `fly.toml`, Fly deployment workflows, or Fly secret names into production Apollo code.
2. **Canonical identity.** All human operations use SPMT's existing OAuth/session and owner/admin scopes. Never restore donor-local identity, auth bypasses, browser action tokens, or MountainView-as-authority behavior.
3. **Typed operations, not arbitrary shell.** No generic shell, arbitrary file reads, environment dumps, or secret retrieval. A terminal frame must connect to an already approved bounded Apollo terminal service.
4. **Read before write.** Port read-only status/log/diagnostic functions first. Sensitive actions require explicit scoped confirmation, one-time expiry, audit events, idempotency and rollback evidence.
5. **Data ownership.** Keep existing Apollo app data and database ownership. Do not copy Rotator runtime DBs or donor volume state into Apollo without a separately reviewed data inventory and restore plan.
6. **Two-node topology.** Node 1 and Node 2 only. Keep workload placement explicit; never silently depend on Node 3 or Fly.
7. **No visual redesign.** Reuse the existing shared shell, workspace, Stella Core appearance and Overlay Bay controls.

## Port sequence

### L0 — Inventory and contracts
- Compare the donor's actual source modules and tests with existing Apollo implementations.
- Mark each capability as already present, partial, missing, obsolete (Fly-only), or blocked by an owning service.
- Record exact destination package/API and donor tests that define expected behavior.
- Keep this document as the source-of-truth placement map; update it as code lands.

### L1 — Read-only operator parity
- Aggregate Node 1/2 deployment status, health, build/release identity and bounded sanitized logs.
- Expose recent diagnostics and repair/job validation state through existing platform operations and Apollo MCP.
- Add source attribution and tests for redaction, bounded output, tenant/owner authorization and unavailable services.
- This stage must not restart, deploy, rotate, or mutate workloads.

### L2 — Coding and repair workflow parity
- Reuse existing Apollo isolated coder jobs and exact artifact retrieval.
- Fill only verified gaps: job lifecycle status, validation evidence, incident-to-job links, audit trail, and draft-PR publication after all checks pass.
- Never auto-merge or auto-deploy a repair.

### L3 — Controlled runtime operations
- Define Hostless-specific, allowlisted Node 1/2 operations with typed inputs.
- Add health-before-cutover, fencing/idempotency, bounded timeouts, rollback and explicit owner confirmation.
- Keep recovery actions separate from ordinary diagnostics and never emulate Fly rotation.

### L4 — Companion and app-specific capability placement
- Audit MountainView mobile/native bridge, voice, memory, media and command functions against Commlink/Stellar/StreamWeaver/Nebula owners.
- Port only missing behavior; preserve donor tests and device contracts where relevant.
- Reconcile durable user data separately from code.

### L5 — Personal Bulletin
- Add the Personal Bulletin as an Overlay Bay scene/preset using existing app/browser frame types and the approved terminal surface when available.
- Reuse all normal Overlay Bay controls and universal appearance settings.
- Keep it private by default. Do not create a Rotator app, separate dashboard, new workspace, or alternate visual system.

## Acceptance gates

- No production source or workflow references Fly for Apollo runtime operations.
- All operator reads are owner/admin-scoped, tenant-bound, bounded and redacted.
- Writes have typed allowlists, confirmation/audit/idempotency and rollback evidence.
- No secrets appear in logs, artifacts, UI, MCP responses or tests.
- Existing Apollo app engines, data ownership and user-facing routes remain intact.
- Node 1 and Node 2 deployment validation is green before release; no Node 3 or Fly deployment.
- Donor tests are adapted to Apollo contracts and run alongside existing Apollo tests.
- Deployment is reported only after release workflow, deployed commit and live health are verified.

## Initial donor findings

The donor README and its MCP-control contract document the following working groups: isolated Stella Coder jobs and draft-PR publication; sanitized Fly state/log snapshots; owner-only runtime operations; Athena repair audit; local LLM/embedding worker provisioning; MountainView phone/voice/glasses functions; and Quackverse asset inventory. The donor's own execution plan explicitly says not to create a second tool registry and to keep Athena identity, tenant mapping, memory policy and tool policy in their authority owners.

These findings are a source inventory, not proof that each capability is complete or production-safe. The source-to-source audit and tests determine what is reusable. Fly-specific execution is intentionally retired rather than copied.
