---
name: apollo-secret-reuse-and-readiness
description: Mandatory Apollo Hostless existing-secret reuse, workflow catalog, and readiness rules.
---
# Apollo Hostless secret reuse and readiness — mandatory

## Absolute rule: reuse existing secrets

The owner has already migrated the approved runtime GitHub Actions secret inventory into Hostless app server secrets. GitHub Actions injects the existing runtime values during deployment. NEVER ask the owner to upload, repeat, or redo that migration. NEVER create, request, invent, rename, or introduce another Hostless runtime secret or credential requirement without explicit approval for that exact new requirement.

The owner separately confirmed on 2026-11-25 that `SPMT_GITHUB_ADMIN_TOKEN` is saved as a GitHub Actions repository secret in both `Mtman1987/ApolloStation` and `Mtman1987/spmt-live`. This is a GitHub administration credential, not an application/runtime secret. Do not migrate or inject it into Hostless.

A credential's label is not its complete purpose. Inspect actual uses, trust boundaries, ownership, and rotation before deciding whether an existing credential is suitable. Do not weaken authentication or reuse credentials across incompatible boundaries.

When a feature appears to need a credential:
1. Inspect the implementation and exact operation needing authentication.
2. Inspect the workflow's existing mapping/injection into the exact Hostless Node 1 or Node 2 app, when it is a runtime credential.
3. Inspect existing credential use in Apollo and relevant historical source.
4. Reuse a suitable existing credential and adapt code/config mapping.
5. If no safe reuse exists, treat it as an architecture/code problem; do not ask for a new secret.
6. Never print, retrieve, log, or surface secret values.

## Readiness

For the exact Hostless target app:
- Trace feature code → config/env name → workflow mapping → Hostless app.
- Distinguish GitHub Actions source secrets from Hostless runtime injection.
- Use name-only metadata when a concrete readiness check requires it.
- Never claim runtime presence based only on a GitHub secret, build, write attempt, or old run.
- Do not repeat the completed one-time migration during ordinary deploys.

## Apollo architecture

ApolloStation is the source monorepo and control plane, not a donor-app collection.
- Node 1: SPMT authority, SpaceMountain shell/workspace, OverlayBay.
- Node 2: Chat Gateway, StreamWeaver, Nebula provider/runtime chain.
- Node 3 is inactive; redistribute its former workload across Node 1 and Node 2.
- No Fly.io, Sprite, or Node 3 runtime fallback.
- SPMT owns shared facts; apps own private state.
- `/tmp` SQLite is not durable production persistence.
- Offline tests do not prove deployment or provider acceptance.

## Workflow catalog

This inventory is a historical filename index, not proof every workflow body is active or audited. Inspect the live default branch before relying on a workflow name or behavior.

- apollo-donor-inventory.yml
- apollo-identity-discovery.yml
- apollo-local-chrome-proof.yml
- apollo-parity-inventory.yml
- apollo-parity-nightly.yml
- apollo-recovery-node1.yml
- avatar-studio-pr-check.yml
- cleanup-merged-branches.yml
- consolidate-reviewed-branches.yml
- dsh-parity-validation.yml
- hearmeout-legacy-worker-validation.yml
- hearmeout-room-player-browser.yml
- hosted-execution-target-validation.yml
- hostless-account-diagnostics.yml
- hostless-node-auth-logs.yml
- hostless-node2-disable-autodeploy.yml
- hostless-node2-fast-deploy.yml
- hostless-release-trigger.yml
- hostless-runtime-log-diagnostics.yml
- hostless-three-node-deploy.yml (historical filename; active topology is Node 1/2)
- import-recovered-json-to-turso.yml
- keentools-manual-reconstruct.yml
- meshy-avatar-build.yml
- mountainview-commander-validation.yml
- nebula-parity-tests.yml
- one-time-hostless-secret-migration.yml (completed one-time path; do not repeat)
- oracle-release-validation.yml
- oracle-terraform-validation.yml
- overlay-bay-build-validation.yml
- owner-session-recovery.yml
- pull-request-validation.yml
- quackverse-art-rebuild.yml
- rea-static-analysis.yml
- reference-context-linking-once.yml
- restream-control-validation.yml
- spmt-xp-to-turso.yml
- turso-migration-adapter.yml
- upload-head-views-to-discord.yml
- verify-node1-github-secrets.yml
- deploy-spacemountain-pages.yml (workflow reported added after earlier inventory snapshot)

## Exact reporting

Report separately what was inspected, mapped, run, validated, deployed, health-checked, and live-accepted. Never claim all secrets are present without a live exact-target inventory. Never list values. Never claim all workflow bodies were audited after only listing filenames.

## GitHub administration token

Follow `github-admin-token` for the owner-approved `SPMT_GITHUB_ADMIN_TOKEN`. It is a repository-scoped GitHub Actions secret in ApolloStation and spmt-live only; it is not part of the Hostless runtime secret inventory.
