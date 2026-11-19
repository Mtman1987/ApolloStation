# Apollo / SPMT Hostless control plane

## Decision

Use Apollo Node 1 and Node 2 as the production topology and make the SPMT service in Node 1 the shared application control authority. Stella Core plans and coordinates work; Stella Coder is the human-facing development surface; the Node 1 service enforces authorization, approval, execution and audit. Node 2 reports health and operational evidence to Node 1.

SPMT Helper is the external service entrance. It connects to Hostless's official remote MCP server using OAuth and should eventually connect to Apollo's own SPMT MCP endpoint after that endpoint is mounted and its authentication contract is verified. Both surfaces must use the same typed operations; neither gets a separate privileged implementation.

## Verified platform capabilities

Hostless documents:
- Public documentation MCP: \`https://mcp.hostless.app/mcp/docs\`.
- Authenticated platform MCP: \`https://mcp.hostless.app/mcp\`, supporting API key, JWT or OAuth.
- OAuth authorization code + PKCE for ChatGPT and other compatible AI clients.
- Typed platform tools for projects, apps, sites, workers, cron jobs, databases, deployments and logs.
- Scoped API keys and project-role enforcement. Read scopes are granted by default; write/delete scopes require explicit consent.
- REST API base: \`https://api.hostless.cloud/v1\`.

Initial SPMT Helper connection is read-only. Do not request \`secrets:read\`, write or delete scopes for initial inventory and diagnostics. Never place an admin token in the plugin, browser bundle, repository, issue, artifact or chat.

## Existing Apollo capabilities to reuse

The repository already has a typed SPMT operations model:
- \`packages/platform-ops\` includes \`operations.logs.publish\`, \`operations.logs.list\`, \`operations.coder.get\`, \`operations.coder.jobs.list\` and \`operations.coder.jobs.create\`.
- \`packages/mcp\` maps those operations into typed MCP tools, including \`spmt.operations.logs.list\` and \`spmt.operations.coder.jobs.create\`.
- \`packages/api-adapter\` exposes the corresponding \`/v1/operations/logs\` and \`/v1/operations/coder/*\` HTTP routes.
- Runtime projections already support reporting and listing app runtime states.
- Stellar Core already has a community-assistant invocation path, so Stella should be integrated through that existing contract rather than creating a second assistant identity.

The current SPMT service constructs \`PlatformOperations\` and \`PlatformApiAdapter\`. The MCP package is present and unit-tested, but the public HTTP service still needs a verified MCP transport mount and an external-client authentication/tenant-binding design before SPMT Helper can call Apollo tools directly. Do not invent a public MCP URL or claim that integration is live until deployed and tested.

## Intended tool surface

Read-only first:
- Node/app inventory and health/readiness.
- Hostless deployment history, commit SHA, build logs and bounded runtime logs.
- SPMT runtime-state projections and operations logs.
- GitHub Actions runs/jobs and the associated commit/deployment.
- Correlated browser/server/deployment incident timeline.

Bounded diagnostics next:
- Named diagnostic tasks with strict target allowlists, timeouts and output limits.
- No arbitrary shell, environment dumps, raw cookie/token values or unrestricted filesystem reads.
- Redact before issue publication and before artifact upload.

Approval-backed mutations last:
- Request deploy, restart or rollback with exact target, commit/deployment, expected impact and rollback plan.
- Require explicit owner approval and record request, approval, execution and result in the audit trail.
- Perform post-action verification against the exact target and deployed commit.

## Hostless credential model

- ChatGPT/SPMT Helper: Hostless OAuth connection, initially read-only.
- GitHub Actions: existing node-scoped Hostless CI credentials, kept in GitHub secrets.
- Node 1 control service: if direct Hostless API access is needed, create a separate least-privilege service key and store it only in Node 1's Hostless secret store.
- Node 2: report to Node 1 over an authenticated SPMT service identity; do not copy the admin key to Node 2.
- Never request or store \`secrets:read\` for diagnostics.

## First implementation tranche

1. Add reusable redaction for every text artifact before workflow artifact upload.
2. Apply it to both the dedicated runtime diagnostics collector and post-release log snapshots.
3. Remove Node 3 from the account diagnostics matrix.
4. Keep one canonical two-node release workflow; do not add a second deploy path.
5. Next, mount the existing SPMT MCP server through the Node 1 service using the current auth/tenant authority, add external OAuth only after its redirect, PKCE, token and tenant semantics are tested, and connect Stella and SPMT Helper to the same tool surface.

## Acceptance checks

- Sanitizer tests cover Hostless API keys, GitHub tokens, JWTs, authorization headers, cookies, query tokens and private keys.
- No raw diagnostic text artifact is uploaded before sanitization.
- Node 1 and Node 2 remain the only production targets.
- MCP calls are tenant-scoped, owner-authorized for cross-node operations, bounded and audited.
- A read-only end-to-end test verifies tool discovery, identity/scopes, project/app inventory, deployment history and logs before any write capability is enabled.
