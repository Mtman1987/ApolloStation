# Development and operator tooling

This index covers the repository's supported developer commands and major tool families. Tool-specific READMEs should live beside complex tools when their flags, inputs, outputs, and safeguards warrant a separate guide.

## Standard local workflow

Run from the repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test

The root scripts compile TypeScript project references across shared packages and applications. npm test builds first, then runs the Node test files in tests/.

## Core commands

| Command | Purpose | Notes |
|---|---|---|
| npm run build | Build shared packages and applications in dependency order | Also builds the RTC browser bundle |
| npm run typecheck | TypeScript project-reference typecheck | Does not run runtime integration tests |
| npm test | Build and run the complete Node test suite | Report the actual result |
| npm run test:offline | Build and run tests with the external-network guard | Broad regression signal without live provider access |
| npm run test:sprite | Build and run tests serially | Useful where fixtures or resource contention matter |
| npm run validate:local | Run repository-local validation | Inspect script behavior before changing policy |
| npm run release:audit | Validate the production rollout manifest | Static policy audit, not a deploy |
| npm run cutover:audit | Audit live-source slices and cutover prerequisites | Evidence inventory, not live acceptance |
| npm run persistence:audit | Inventory tracked SQLite references | Source-reference report, not a database census |
| npm run nebula:check | Run Nebula release checks | Does not prove provider connectivity |
| npm run provider:rehearse | Run configured provider live rehearsal | Requires explicitly configured test credentials and scope |
| npm run setup:browser | Prepare local browser-test dependencies | Use only when browser tests require setup |
| npm run test:rtc-browser | Browser RTC regression | Requires browser setup |
| npm run test:hmo-media-browser | HearMeOut media browser regression | Requires browser setup and fixtures |
| npm run test:hmo-persona-browser | HearMeOut persona/audio browser regression | Requires browser setup and fixtures |
| npm run companion:obs | Run Companion OBS integration helper | Requires local OBS environment |
| npm run agents:inspect | Inspect installed agent runner configuration | Does not provision hosted model capacity |

## Tool families

### Build and validation

- Root package.json defines canonical npm commands.
- TypeScript project references define compilation order.
- scripts/build-rtc-browser.mjs produces the RTC browser artifact.
- scripts/validate-local.mjs is the local validation entrypoint.
- scripts/offline-network-guard.mjs blocks unapproved external networking during offline tests.
- tests/ contains unit, contract, integration, workflow-contract, and browser-related regression coverage.

### Production and cutover audits

- scripts/audit-production-rollout.mjs validates production rollout configuration.
- scripts/audit-live-slices.mjs audits declared live-source slices and migration/cutover state.
- scripts/audit-sqlite-usage.mjs inventories SQLite references from the committed source tree and classifies runtime, test, evidence, and tooling scope.

These tools are read-only audits unless their specific documentation says otherwise. Do not confuse a structural audit with a live host, database, or provider check.

### Hostless runtime and deployment

See [the Hostless tooling guide](../../scripts/hostless/README.md) for the two-node process map, exact script responsibilities, secret-synchronization boundary, persistence warning, and release troubleshooting.

- scripts/hostless/start-node.mjs is the node process supervisor/bootstrap entrypoint.
- scripts/hostless/ensure-node-app.mjs applies explicitly mapped runtime environment and ensures the target Hostless app exists.
- scripts/hostless/nebula-runtime-config.mjs prepares Nebula runtime configuration.
- scripts/hostless/trigger-release.mjs is a release trigger helper.
- scripts/release-trigger/trigger-hostless-release.mjs dispatches the canonical Hostless release workflow.

The active production topology is Node 1 and Node 2. The workflow filename hostless-three-node-deploy.yml is historical; its deployment matrix is two-node. Do not use old Node 3 bootstrap tooling. Deployment actions must run through the established workflow and its validation, persistence, and release gates.

### Data migration and recovery

The root scripts include explicit, app-scoped SQLite-to-Turso migrations and recovery staging/import helpers. Each migration is a one-off operational tool, not a normal app startup dependency.

Before running a migration:

1. identify canonical source and destination;
2. take and verify a recoverable backup;
3. confirm target schema and migration version;
4. perform a dry run or reconciliation when supported;
5. prevent concurrent writers;
6. capture counts/checksums and integrity results;
7. define rollback and restore steps;
8. never paste credentials or raw user data into logs or chat.

### Donor parity and provenance

- scripts/parity-donor-inventory.mjs inventories donor/source files.
- scripts/parity-rea.mjs performs repository REA-style evidence analysis.
- scripts/parity-compare-inventories.mjs compares inventories.
- scripts/parity-audit.mjs produces parity-oriented audit output.
- scripts/parity-prepare-port.mjs prepares a proposed port package.

These tools support review; a file-count match is not feature parity and a donor path is not permission to copy code. Use functional acceptance criteria for each application.

### Local browser and Companion helpers

Browser setup and app-specific browser checks live in scripts/. Companion's OBS runner is separate from cloud app deployment and requires a compatible local OBS environment.

### Agent tooling

scripts/agents/ contains Python helpers for bootstrap, OpenAI runner inspection, chat, and tests. Optional Python tools should not be required for normal app runtime or the standard TypeScript build.

## Detailed guides

- [Persistence audits and migrations](persistence-and-migrations.md) — SQLite inventory, Turso transfers, recovery archive imports, dry-run/apply semantics and restore gates.
- [Hostless runtime tooling](../../scripts/hostless/README.md) — two-node process composition and deployment script boundaries.

## Safety rules

- Never print or commit secret values.
- Never run a production migration or deployment as a side effect of a local audit.
- Do not disable validation merely to make a workflow green.
- Do not delete a script until references in package scripts, workflow YAML, tests, documentation, and dynamic invocation paths have been checked.
- Retain required third-party notices.
- Prefer one shared implementation over duplicated app-local helpers.
- Record the exact commit and command when reporting results.

## Tool README standard

For each major development tool, document purpose, owner, entrypoint, exact CLI/API inputs, environment variables by name only, outputs/artifacts, side effects, read-only versus mutating modes, safety/approval gates, failure modes, tests, and examples. Avoid copying credentials or machine-specific paths into docs.
