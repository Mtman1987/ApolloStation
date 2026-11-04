# Hostless three-node deployment readiness — 2026-11-04

**Status: not safe to deploy yet.** This note follows the repository's three-node topology. It records the code and configuration review completed against `main` at `521cc7b`; it is not a production inventory, account approval, or deployment record. No Hostless resources, accounts, databases, secrets, domains, production data, or traffic were changed.

## Correct deployment shape

The three Hostless accounts are logical ownership boundaries, not a simple web/API/worker split:

1. **Account 1 — canonical authority and public ingress.** SPMT is the only canonical identity/authority writer. SpaceMountain serves the public shell and OverlayBay surface, and routes to the service origins. These are two independently addressed web processes: `node apps/spmt-service/dist/provider-identity-start.js` and `node apps/spacemountain-web/dist/integrated-server.js`.
2. **Account 2 — live and game data plane.** Chat Gateway must keep its embedded StreamWeaver and Nebula provider runtimes in-process. The deployable processes include the Chat Gateway worker (`node apps/chat-gateway/dist/service-start.js`), StreamWeaver web (`node apps/streamweaver/dist/web-server.js`), and Nebula live server (`node apps/nebula-arcade/dist/nebula-arcade-live-server.js`). Do not split Chat Gateway from those embedded provider runtimes or move Nebula to Account 3.
3. **Account 3 — Discord/community delivery.** Discord Stream Hub web (`node apps/discord-stream-hub/dist/web-server.js`) and live worker (`node apps/discord-stream-hub/dist/live-worker-start.js`) remain one state owner. The Restream browser-control receiver is not a Hostless-ready service; its private TLS and durable signed-in browser profile remain separately gated.

These commands run from the repository root after `npm run build`. The monorepo build context must include the repository root because applications import sibling workspaces. Web services consume the Hostless-injected `PORT` and must bind to `0.0.0.0`. Chat Gateway and the DSH worker are background processes without their own HTTP health listener. Existing app/package scripts do not yet provide a complete per-account service supervisor or Hostless resource configuration.

## Code portability fixes in this increment

- SpaceMountain's integrated gateway already accepted a remote HTTPS SPMT origin, but its inner web host rejected that same origin as loopback-only. The inner host now accepts a credential-free HTTPS origin, while sandbox validation remains loopback-only. A regression test constructs and starts the integrated gateway with remote HTTPS SPMT.
- Nebula's standalone live service previously allowed arbitrary HTTP SPMT origins and URLs containing credentials or paths. It now accepts HTTPS, or loopback HTTP for local development, and rejects non-origin URL components before opening state.
- Nebula Mosaic generation previously defaulted to `https://streamweaver-new.fly.dev`. When generation is enabled it now requires an explicit, credential-free HTTPS `STREAMWEAVER_URL`; there is no silent Fly fallback. Tests cover missing, insecure, malformed, and explicit test origins.

## Validation

- `npm run build` passed after the source changes.
- The focused portability suite passed **21/21 tests**.
- The subsequent full offline run reported **1,522 passed and 2 failed out of 1,524**. Both failures were pre-existing test fixtures using remote HTTP SPMT origins; those fixtures were changed to HTTPS, and the two affected test files plus the new origin test then passed **22/22**. The full suite was not rerun after those fixture-only corrections, so a clean full-suite result is not claimed.

## Hostless configuration facts verified

The current Hostless documentation describes a `hostless.yaml` with build command, working directory, build context, start command, scaling bounds, health check, workers, and cron jobs. The default file path is the repository-root `hostless.yaml`, and an app can select a different file path in its settings. For this monorepo, any per-resource configuration must use repository root as build context. Hostless injects `PORT`, and its documentation requires web processes to bind to `0.0.0.0`. Environment variables and secrets are configured in the Hostless dashboard; they must not be placed in YAML, build arguments, or browser-visible frontend variables.

Hostless currently documents one shared allowance per account of **0.5 vCPU, 1 GiB RAM, and 512 MiB database storage**, shared by apps, workers, cron jobs, databases, and marketplace services. App temporary disk does not add durable database capacity. Hostless says builds are not charged, but runtime/database use above entitlement is billable; the spending limit is not a guaranteed maximum invoice. The public docs reviewed here do not settle whether a single owner may use three accounts to aggregate allowances. Confirm account eligibility and each account's actual dashboard limits before allocating anything.

References: [Hostless `hostless.yaml` configuration](https://docs.hostless.cloud/app/hostlessfile), [Hostless resource limits](https://docs.hostless.cloud/plans/limits), and [Hostless environment variables and secrets](https://docs.hostless.cloud/app/envvars).

## No-go gates before creating Hostless resources

1. **Durable state has no verified target.** ApolloStation's authoritative and app-owned stores directly use Node's synchronous `node:sqlite` `DatabaseSync` API and local absolute paths. A PostgreSQL or libSQL URL cannot replace those paths. Hostless temporary app disk is not a durable database, and its managed database allowance is not a drop-in SQLite adapter. Moving production stores requires an explicitly designed and tested adapter/refactor, or an owner-approved change to the storage/cost requirements. Do not start a production process against ephemeral SQLite files.
2. **SQLite cross-process ownership is not solved by account co-location.** Chat Gateway, StreamWeaver web/provider state, Nebula provider/live state, and DSH web/worker open app-owned SQLite stores. Separate Hostless resources do not automatically share durable files. Node 2 in particular has multiple processes that currently open the same configured StreamWeaver/Nebula database paths. A shared network-mounted SQLite file or unspecific shared volume is not an acceptable substitute for a transactional service API.
3. **Node 3's worker is not fenced by `SPMT_OUTBOUND_MODE=disabled`.** Repository review found remaining XP, cleanup, and suite-action paths that can still mutate state or publish/delete Discord messages. Do not use production SPMT or populated tenants for a first Hostless worker test. Add a complete write/egress fence and use synthetic tenants, isolated credentials, isolated databases, and empty queues.
4. **Resource fit and recovery are unmeasured.** The per-account free pool is small, and the assignments contain multiple web and worker processes. Measure CPU/RAM with representative isolated workloads. Before cutover, prove independent backups, restore, restart survival, write fencing, rollback, and cross-node idempotency.
5. **Account-specific setup is missing.** The repository does not establish which Hostless accounts/projects, custom domains, connected Git provider, or per-account policy apply. Do not send secrets in chat or commit them; configure secret values directly in Hostless after the design is approved.
6. **Cross-node acceptance is incomplete.** Health pages alone are not sufficient. A synthetic end-to-end test must prove shared identity/tenant authorization, a chat event through StreamWeaver/Nebula, Discord workflow behavior, OverlayBay persistence, process restarts, database restore, and no duplicate output.

## Readiness decision

The SpaceMountain and Nebula origin hazards and the silent Fly fallback are corrected and covered by focused tests. The Hostless YAML schema and injected-port requirements are now confirmed, so they are no longer unknowns. However, committing active Hostless deployment files or creating resources now would encourage a service launch with no safe durable-storage configuration, incomplete worker side-effect fencing, and unmeasured resource/cost fit. Keep this deployment gated until those blockers are resolved. No Hostless deployment or production cutover is claimed by the code or tests in this note.
