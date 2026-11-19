# Repository scripts

Scripts are grouped by operational responsibility. The supported command index is [docs/development/README.md](../docs/development/README.md). Do not invoke a script directly in production unless its guide explicitly documents that workflow.

## Tool groups

| Location | Purpose | Safety class |
|---|---|---|
| scripts/hostless/ | Hostless Node 1/Node 2 bootstrap, app synchronization, runtime config, preview and release helpers | Mixed; see [Hostless guide](hostless/README.md) |
| scripts/agents/ | Local agent bootstrap, runner inspection, chat and tests | Local developer tooling |
| scripts/parity-*.mjs | Donor inventory, compare, REA analysis, audit and port preparation | Read-only or report generation; no automatic feature port |
| scripts/audit-*.mjs | Production rollout, live-slice and SQLite usage audits | Read-only audit |
| scripts/migrate-*.mjs and scripts/*-migration*.mjs | App-scoped data migration/recovery utilities | Potentially mutating; backup and explicit approval required |
| scripts/build-*.mjs | Browser/RTC build artifact generation | Build-time |
| scripts/validate-local.mjs | Local validation entrypoint | Validation only |
| scripts/offline-network-guard.mjs | Network guard for offline tests | Test harness |
| scripts/sprites/ | Supervised local test harness used by the serial test command | Local test runner; not production infrastructure |

## Operating rules

- Root package.json is the canonical list of supported npm commands.
- A script that can mutate a database, Hostless project, provider connection or user record must document its side effects and rollback.
- Never put secrets in command-line arguments, logs, artifacts or documentation.
- A report-generation script does not prove live production behavior.
- A parity inventory is evidence for review, not permission to copy donor code.
- A migration script is not a normal app startup step.
- Confirm package scripts, workflows, tests and dynamic invocations before removing or renaming a script.
- Keep app-specific behavior in the owning app; shared tooling should orchestrate rather than duplicate business logic.

## Adding a new tool

A new script must include:

1. one clear owner and purpose;
2. typed/validated arguments and environment inputs;
3. read-only versus mutating classification;
4. explicit side effects and output/artifact paths;
5. secret-redaction behavior;
6. timeout, retry and resource limits;
7. a focused test;
8. documentation in the relevant tool guide and docs/development index.

Do not create a second script for an existing task merely to work around a broken entrypoint. Fix the owning tool and its tests.
