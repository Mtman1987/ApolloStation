# Apollo production and release path

Updated: 2026-11-19  
Purpose: define the safe path from the current Apollo source tree to a verified Hostless two-node release. This is a release policy, not a claim that production is already accepted.

## 1. Non-negotiable principles

1. ApolloStation is the source of truth for Apollo code and release configuration.
2. The active production target is Hostless Node 1 and Node 2 only.
3. Do not deploy to Fly.io, Sprites, or the retired Rotator donor.
4. Do not add Node 3. Split required work explicitly across Node 1 and Node 2.
5. SPMT owns cross-app/shared facts; each app owns its private product data.
6. No production data move without verified backup, integrity, restore, reconciliation, and rollback.
7. No provider credential or infrastructure secret in source, browser code, diagnostics, logs, or chat.
8. A green CI run is not a deployment. A deployment is not live acceptance.

## 2. Active topology

| Node | Responsibility | Release evidence required |
|---|---|---|
| Node 1 | SPMT authority, SpaceMountain integrated web host, owner sign-in and workspace | exact deployed SHA, readiness, owner browser sign-in, app catalog/launch, session continuity |
| Node 2 | Chat Gateway and co-located StreamWeaver/Nebula provider runtime | exact deployed SHA, worker readiness, provider/tenant configuration, no duplicate consumers, restart/reconnect |

The canonical Hostless workflow is currently named .github/workflows/hostless-three-node-deploy.yml. Its filename is historical; its deployment matrix targets Node 1 and Node 2. Do not rename it until all workflow dispatches, tests, filters, links and automation references are updated together.

## 3. Current release gate

Before any production deploy:

1. Validate the intended branch and exact commit.
2. Run npm ci, build, typecheck, full tests, and offline tests.
3. Run the production rollout and persistence/cutover audits.
4. Confirm required configuration is present by variable name and validation result only; never print secret values.
5. Confirm Node 1/Node 2 workload placement and the expected app/service list.
6. Verify persistence authority and recovery assumptions for every changed service.
7. Require all required validation jobs to pass before deploy jobs become eligible.
8. Deploy only the changed/approved nodes through the canonical workflow.
9. Verify deployed commit SHA and health on each node separately.
10. Run owner/browser and real provider acceptance for the affected capability.

A PR check that skips deployment is validation only. A workflow run that deploys Node 1 but fails Node 2 is not a successful two-node release.

## 4. Owner entry and shell acceptance

The owner must be able to open spacemountain.live, reach the SPMT bridge sign-in gate when no session exists, complete the supported sign-in path, and reach the workspace without a blank screen.

Acceptance includes:

- initial page works in normal and incognito browser sessions;
- anonymous session rejection shows the visible SPMT bridge recovery path;
- owner session maps to the correct user and tenant;
- app catalog loads and each permitted app launch resolves to the correct first-party route;
- navigation, workspace, dock profile, and universal appearance settings persist;
- no duplicate login-refresh bar or conflicting shell chrome;
- browser diagnostics are retrievable and redact session/token values;
- mobile viewport has usable scrolling and no clipped primary controls.

Do not weaken authorization to make the signed-out shell appear to work.

## 5. Persistence and recovery gate

The repository contains SQLite-backed domain stores and asynchronous Turso/libSQL components. Do not assume every app has migrated to remote storage merely because a Turso database or migration helper exists.

For every authoritative dataset, record:

- owning service/app and tenant scope;
- effective production adapter and exact database destination;
- schema and migration version;
- single-writer/lease behavior;
- source and target counts/checksums;
- backup artifact and integrity result;
- restore into an isolated destination and post-restore checks;
- restart/redeploy persistence test;
- rollback/reconciliation procedure.

Local /tmp paths are ephemeral. They are acceptable only for explicitly disposable staging/cache state, never as a silent fallback for required durable production data.

## 6. Provider and app acceptance

Provider-backed capabilities must be tested with the actual configured service credentials and an approved test tenant/channel. Offline mocks prove local behavior only.

### Chat Gateway

- connection records and SPMT provider grants resolve for the intended tenant;
- Twitch/Discord/Kick/YouTube/TikTok connections start and reconnect;
- cursors and dedupe prevent replay/duplicate messages;
- consumer leases/fencing prevent duplicate workers and duplicate output;
- Commlink, StreamWeaver, Nebula, and DSH receive only their registered events.

### StreamWeaver

- owner command, persona, reward, and provider workflows work through the Apollo worker;
- hosted Kokoro speech is audible in the browser/provider path;
- command output and event rewards are idempotent;
- settings, persona, and provider state survive restart/restore.

### Nebula Arcade

- game/Tag/Bingo/Quackverse behavior is verified in the real runtime;
- provider events and rewards reach the correct tenant/channel;
- Mosaic/art generation uses Apollo-owned configured services, not a retired donor endpoint;
- game state and art metadata survive restart/restore.

### Discord Stream Hub

- worker configuration and mounted runtime are effective;
- Discord/Twitch publishing, guest lifecycle and generated-media delivery work;
- role/reward receipts are attributable and idempotent;
- restart/restore does not duplicate bot output.

### HearMeOut

- configured-provider playback decodes and plays in the actual browser;
- pause/resume/seek remain synchronized;
- late join and reconnect recover the correct playback state;
- Discord audio is heard by both sides where intended;
- voice/RTC and media worker paths survive restart/restore.

## 7. Operator and terminal acceptance

Operator actions live in Apollo and use SPMT identity, owner scopes, typed operations, logs, audit events and bounded execution.

The terminal must be an Apollo-owned backend and an OverlayBay frame/panel. A frame alone is not an implementation. Before enabling it, define:

- allowlisted commands/actions and per-action scope;
- owner confirmation for mutations;
- session lifetime, cancellation, idle timeout and concurrency;
- output byte limits, streaming backpressure and redaction;
- filesystem/process boundaries;
- audit and correlation records;
- rollback or compensating action for writes.

No Rotator donor process, Fly control API, arbitrary shell, environment dump, secret retrieval, or unrestricted host filesystem access is acceptable.

## 8. Rollout order

1. **Foundation:** Node 1 shell/sign-in, SPMT authority, workspace/app launch, retrievable diagnostics.
2. **Node 2 service chain:** Chat Gateway readiness and configuration, then StreamWeaver/Nebula worker acceptance.
3. **Media/voice:** HearMeOut playback/RTC and Discord audio acceptance.
4. **Community workflows:** Discord Stream Hub publishing, Nebula games/rewards, StreamWeaver commands/rewards.
5. **Operator surface:** Apollo terminal, logs, approval and bounded controls.
6. **Broader onboarding:** only after tenant isolation, data ownership, provider grants, backup/restore and rollback are proven.

The order can change only when dependency evidence justifies it. Do not delay a safe owner-first release for cosmetic polish or unrelated donor parity.

## 9. Rollback

### Runtime rollback

- retain the last known-good image/revision and deployment metadata;
- stop rollout when any required node fails validation or readiness;
- restore the last known-good node revision through the canonical workflow;
- verify both node health and app-to-app connectivity;
- preserve sanitized logs and exact SHA evidence.

### Data rollback

- do not reverse a migration by guessing or restoring into a live writer;
- stop or fence writers;
- restore a verified backup into an isolated destination;
- compare counts, checksums, schema versions and ownership;
- reconcile any writes made after the backup;
- switch authority only after owner approval and recorded evidence.

## 10. Current blockers and evidence

The current state summary is docs/CURRENT_STATE.md. At the time of this update:

- Node 1 shell/sign-in recovery still requires live owner browser acceptance.
- Node 2 deployment/provider-worker readiness is not yet proven as part of one green two-node release.
- The actual SPMT runtime persistence adapter must be verified against the intended remote database; SQLite-backed services and /tmp fallbacks remain a concern.
- Residual Fly donor origins and Sprite/Fly execution-target defaults remain in source and require coordinated replacement.
- Real provider/media/voice acceptance remains distinct from offline tests.
- Apollo-native terminal backend and OverlayBay integration remain to be completed.

Do not convert any of these into a green status by changing documentation alone. Update the relevant implementation, tests, workflow and evidence.

## 11. Reporting format

For every release or recovery result, record:

- repository and branch;
- exact commit SHA;
- workflow/run URL and conclusion;
- Node 1 result and deployed SHA;
- Node 2 result and deployed SHA;
- health/readiness and persistence/restart evidence;
- owner browser journey result;
- real provider/media acceptance result;
- rollback state.

Use explicit labels: tested, validated, deployed, and live-accepted are different states.
