# SPMT Ecosystem — ApolloStation

ApolloStation is the source monorepo for the SPMT Ecosystem: the shared platform, SpaceMountain shell, first-party applications, runtime services, developer interfaces, and operational tooling.

This repository is the implementation—not a donor-app collection or a collection of deployment-specific copies. Product capabilities should be implemented once behind shared contracts, composed into the applications that need them, and kept independently testable.

## Start here

| If you are… | Read |
|---|---|
| New to the ecosystem | [Ecosystem overview](docs/README.md) |
| Building or changing the platform | [Architecture](docs/ARCHITECTURE.md), [application contracts](docs/APP_CONTRACTS.md), [shared surface and developer contract](docs/SURFACE_AND_DEVELOPER_CONTRACT.md) |
| Working on a specific application | The application README under `apps/<application>/README.md` |
| Working on a shared package | The package README under `packages/<package>/README.md` |
| Working on deployment or runtime operations | [Production path](docs/PRODUCTION_PATH.md), [current state](docs/CURRENT_STATE.md), and the relevant runbook under `docs/` |
| Working on development tooling | [Development tools index](docs/development/README.md) |
| Reviewing historical donor material | [Archive manifest](docs/archive/evidence/MANIFEST.md) |
| Reviewing quarantined legacy files | [Temporary cleanup archive](mt-delete-me-archive/README.md) |

## Ecosystem at a glance

- **SPMT authority** — canonical identity, sessions, tenants, app registry and installs, scopes and grants, shared workspace/profile facts, usage/entitlements, provider credential grants, jobs/events, and audit/runtime contracts.
- **SpaceMountain** — public product entry point, shell, workspace, app discovery/launch, shared navigation and visual integration.
- **First-party applications** — Commlink, Companion, Discord Stream Hub, HearMeOut, Mission Control, MountainView, Nebula Arcade, Stellar Core, and StreamWeaver.
- **Supporting services** — Chat Gateway and the isolated Restream control service.
- **Shared packages** — versioned contracts, authority/auth, app foundation, runtime, SDK, UI, data adapters, execution, recovery, operations, CLI, and MCP.
- **Development and operations tools** — build/test/validation, browser checks, migration and persistence audits, release checks, diagnostics, and Hostless node entrypoints.

The repository currently uses npm workspaces across `packages/*` and `apps/*`. TypeScript project references build the shared packages and application projects in dependency order.

## Runtime and deployment model

Apollo's current deployment target is **Hostless Node 1 and Node 2**. Node 3 is not part of the active deployment topology; its former workload is being consolidated across the two supported nodes. Do not add a Node 3 dependency or restore a retired hosting/donor platform as part of routine development.

- **Node 1:** canonical SPMT authority and SpaceMountain shell/workspace responsibilities.
- **Node 2:** Chat Gateway and the co-located StreamWeaver/Nebula provider-runtime chain.
- **Shared persistence:** use the configured canonical remote database authority and the documented app-private storage boundaries. Do not silently substitute an unmounted local database in production.
- **Operational boundary:** application code does not receive unrestricted infrastructure credentials. Runtime management and diagnostics must use the repository's supported, scoped interfaces.

Exact process membership, environment names, health checks, and deployment steps belong in the maintained Hostless operations documentation—not in assumptions embedded in application code. Check the live workflow and current configuration before changing placement.

## Repository layout

| Path | Responsibility |
|---|---|
| `apps/` | User-facing applications, platform services, and application workers |
| `packages/contracts/` | Shared versioned contracts and schemas |
| `packages/*` | Reusable platform capabilities and adapters |
| `services/` | Isolated supporting services with their own runtime boundary |
| `scripts/` | Build, audit, migration, validation, release, and operator tooling |
| `tests/` | Cross-package, application, contract, integration, and regression tests |
| `config/` | Versioned runtime, capability, rollout, and ownership configuration |
| `.github/workflows/` | CI, validation, deployment, diagnostics, and scheduled automation |
| `docs/` | Maintained architecture, contracts, product guides, runbooks, and development references |
| `mt-delete-me-archive/` | Temporary quarantine for reviewed obsolete documentation and files |

## Development quick start

Requirements: Node.js compatible with the repository's TypeScript/ESM toolchain, npm, and Python 3 where a specific helper script requires it. Use the Node version pinned or declared by the current project/workflow configuration; do not guess a different runtime.

```bash
npm ci
npm run build
npm run typecheck
npm test
```

Useful focused commands:

```bash
npm run test:offline       # build + test suite with external network blocked
npm run validate:local    # repository-local validation entrypoint
npm run release:audit     # validate the versioned production rollout manifest
npm run cutover:audit     # inspect live-slice cutover prerequisites
npm run persistence:audit # inventory tracked SQLite usage references
npm run nebula:check      # Nebula release validation
```

Do not treat a successful build, offline test suite, source audit, or CI workflow as proof of live provider acceptance or production deployment. Report each evidence class separately. For production changes, preserve the existing deployment, recovery, and rollback process.

## Engineering standards

1. **One authority per shared fact.** Apps consume shared facts through versioned SPMT contracts; app-private state remains owned by its application.
2. **Keep boundaries explicit.** Tenant, user/delegation, caller app, scope, capability, and correlation context must be validated at service boundaries.
3. **Prefer shared implementation.** Fix reusable platform behavior in the owning package instead of cloning it into multiple apps.
4. **Keep runtime paths lean.** Avoid duplicate bundles, redundant dependencies, repeated initialization, unnecessary polling, unbounded caches, and synchronous heavy work on request paths.
5. **Make background work durable and observable.** Use the established job/outbox/retry contracts where appropriate; return accepted job identifiers rather than claiming asynchronous work has completed.
6. **Treat persistence deliberately.** Every durable store needs an owner, schema/migration policy, retention, size boundary, backup, restore, and integrity checks.
7. **Keep secrets out of source and logs.** Use configured secret injection and redact diagnostics before persistence or publication.
8. **Preserve application identity.** Shared shell, navigation, settings, and design tokens should be consistent without flattening each app's own product purpose and artwork.
9. **Remove code with evidence.** Confirm imports, runtime composition, dynamic loading, scripts, tests, and workflows before deleting a module or asset.
10. **Document what runs today.** Dated reports are evidence snapshots, not current operating instructions. Update the canonical README/runbook when behavior changes.

## Documentation policy

The root README is the ecosystem entry point. The docs index links to the current architecture and operating references. Each maintained app, shared package, service, and major development tool should have one focused README that explains its purpose, ownership, dependencies, entrypoints, configuration, data, commands, tests, operational behavior, and failure modes.

Historical reports remain traceable but must not compete with current instructions. Reviewed obsolete material is moved—never silently discarded—to `mt-delete-me-archive/` with original paths and a manifest. Permanent deletion happens only after the owner has copied and verified the archive in the storage repository.

## Status and evidence

The authoritative operational status is maintained in [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) and the active deployment workflows/configuration. Older dated documents are historical evidence only. Never infer that an app is live, deployed, or fully functional from the presence of code or a passing offline test.

## License and third-party notices

Retain upstream license and attribution files with the assets or packages they govern. Repository cleanup must not remove required notices.
