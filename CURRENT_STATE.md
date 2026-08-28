# Current State

Status: evidence-backed working baseline, requiring live verification before migration.

## Functional foundation added on 2026-08-28

The current implementation now includes the shared scaffolding required before feature-by-feature wiring:

- one durable, metered execution-job envelope across Sprite, Fly, and Companion with leases, fencing, heartbeat progress, retries, cancellation, dead letters, idempotency, tenant isolation, and restart persistence;
- separate physical execution and Account metering targets so paid Companion-local work is unmetered against hosted caps while remaining visible in personal usage;
- a public job contract across HTTP, SDK, CLI, and MCP, plus a reference-app example;
- an SPMT provider-grant broker and public service-only endpoint with installed-app, capability, scope, expiry, audit, and human-denial rules;
- a versioned app Settings contract and isolated SQLite foundation with encrypted secrets, optimistic revisions, immutable migration checksums, checkpoints, integrity checks, and restart restore;
- `config/capability-wiring.v1.json`, which records every first-party owner, route mode, wiring state, migration note, machine target, metering category, and evidence.

`Account` is now the personal usage/plan/profile destination. App `Settings` remain owned by each app for its normal and advanced configuration. Production provider refresh adapters, real worker connections, data reconciliation, Fly mutation, and donor retirement remain cutover work rather than being fabricated by this scaffold.

## Stellar chat vertical added on 2026-08-28

The first full functional vertical now runs from the SpaceMountain Stella form through the public Community Assistant contract into a metered `ExecutionJobV1`, then through a service-authenticated Stellar worker to a loopback OpenAI-compatible Qwen process. The UI polls durable progress and terminal state, displays provider failures truthfully, and refreshes the signed-in user's Account usage. No browser-accessible Qwen proxy remains.

Hosted Qwen is the automatic Green-primary route. Paid users reach Companion only when an authenticated, tenant-compatible local worker has a fresh lease; an app-level runtime flag alone is insufficient. Free, stale, disconnected, or unavailable Companion requests visibly fall back to hosted. Companion usage is still recorded personally but does not fill the hosted allowance bar when the plan declares unmetered local processing. Model/provider controls remain owner-only, and Stellar Core remains persona-neutral behind the Stella presentation.

The capability manifest is now `green-primary-with-fallback` and `cutover-ready`. D-24 is enforced: seven-day remembered raw content, one-hour do-not-remember delivery retention, 30-day minimized metadata, and authenticated Account export/delete. Worker readiness is a 30-second lease carrying live provider health, cold-start, latency, throughput, success/failure, and memory evidence. The Sprite release gate waits for that live evidence before promotion. Companion remains an optional real local target and truthfully falls back until a paired worker connects; no local readiness is fabricated.

## What is working conceptually

- SPMT is already described as the canonical identity and platform contract owner.
- SpaceMountain is already described as the user-facing command bridge and suite shell.
- Workspace/background configuration is already capable of flowing through SPMT and appearing across apps. This is the strongest existing proof for a single-authority data model.
- Current documentation defines an SPMT OAuth authorization-code flow, canonical immutable user IDs, app-bound service authorization, events, workspace profiles, and an idempotent XP endpoint.

## What is broken or contradictory

### Shared facts have multiple answers

The same person can see materially different point balances in SpaceMountain, ChatTag, and Discord Stream Hub. Existing production notes also record a DSH account whose 1,971 events totaled 31,977 while a cached leaderboard held 13,601. This is not a display bug; it is evidence of competing authorities, incomplete migration, stale projections, or incorrect identity linking.

No new balance should be selected by summing or taking the maximum. The event sources, identity mapping, timestamps, award rules, migrations, and idempotency keys must be reconciled first.

### Authentication is half centralized

The intended model is one SPMT identity, but `auth-migrations.json` still lists active legacy platform keys, reused provider tokens, internal shared-key headers, compatibility sessions, and a blocked tenant-authorization redesign. A single human login does not mean one universal secret. The system still needs a small set of narrowly scoped machine identities and real third-party provider credentials.

### Storage is fragmented

The production inventory describes SPMT SQLite, SpaceMountain SQLite, DSH SQLite and media, StreamWeaver JSON/media, ChatTag state, HearMeOut state, and multiple Fly Volumes. That makes cross-app facts expensive to reconcile and makes scaling stateful processes difficult.

### Documentation contains incompatible eras

- 290 core document-like files were found across the two repositories under the review filter; 294 files were preserved when supporting documentation JSON was included.
- SpaceMountain has 66 mirrored documentation paths and 13 mirrored specification paths between source and public trees.
- At least 17 files are named as plans, roadmaps, TODOs, or checklists.
- Three active ecosystem documents still mention Firebase or Firestore. One says never to reintroduce Firebase; another still treats it as a possible authority or migration source.
- The production roadmap mixes verified observations, completed work, open work, historical incidents, product plans, and release evidence in one very large document.

## Constraints already settled

These are facts or owner requirements, not debate prompts:

- Firebase was removed roughly a year ago and must not appear in the new runtime, migration plan, compatibility plan, or canonical documentation.
- Fly.io GPU capacity is unavailable to this ecosystem; the Fly design is CPU-only.
- Old repositories and Fly apps stay live during the rebuild.
- Old repositories, apps, volumes, and duplicate files are removed only after verified cutover and rollback retention.
- SpaceMountain and SPMT are rebuilt first; inference/workers/bots follow; product apps follow the stable base.
- The parallel period has a cost clock even though the account has machine-count headroom.
- The new shared storage authority requires an independent recovery app with its own Machine and volume, scheduled verified backups, controlled promotion, and tested failback.

## Facts still requiring live capture

Before implementation, record these without exposing secret values or tenant content:

- all 13 current Fly apps, Machines, process groups, sizes, regions, checks, autostop settings, and monthly cost by resource;
- all volumes, attachments, sizes, snapshots, and actual data owners;
- live database engines, schemas, row counts, migration versions, and backup/restore evidence;
- current public routes, health behavior, cold-start time, p50/p95 latency, and error rate;
- all auth mechanisms by caller, callee, scope, and last observed use;
- all point producers, ledgers, cached projections, and displayed totals;
- all provider API calls and measured monthly cost;
- all workloads requiring persistent connections, high CPU, isolation, or local companion capability.

Until that capture exists, statements copied from old production documents are hypotheses, not live truth.

## Green production-app parity checkpoint

The active ApolloStation parity branch now contains the first donor-backed product implementation slices. Tagging behavior was audited against historical donor repository `Mtman1987/chat-tag` at commit `8170c51` and implemented as Nebula Arcade's internal `tag` game. The donor repository name is not a current app or service identity.

The implemented slice covers persistent tenant game state, join/leave, the current-it/free-for-all transition, local game scoring, immunity, sleep/wake, earned passes, moderator controls, command replay protection, restart snapshots, tenant-scoped SPMT events and XP awards, and Discord Stream Hub event consumption. It does not copy donor authentication, shared-secret, direct-call, Firebase, or shared-volume architecture.

The repository currently includes the two-player, two-tenant, restart, replay, immunity, pass, moderator, SPMT contract, and DSH projection cases plus the first audited SPMT identity-parity slice: active provider links can be listed and unlinked through the same human-only API/SDK/CLI/MCP contract, revocations remain durable across restart, and service identities cannot manage a person's linked accounts. SpaceMountain Settings now consumes that same public contract without browser-owned tokens or a private proxy authority. Nebula Arcade's tag-game vertical is ready for its private Sprite sandbox gate: normalized Twitch/Discord/Kick command planning, ordinary-chat activity wakeup, exact donor rotation timers, fixed monthly crowns, live/chatting player paging, Pin ranking, support tickets, overlay mode/messages, permanent channel opt-out, one-time donor import, and the visual browser source are implemented. Its standalone sandbox runs on port 8080 with provider credentials and egress rejected. Blue production remains authoritative until identity reconciliation, live-provider/output-gateway conformance, Sprite/OBS evidence, and owner acceptance are recorded.

The SPMT control plane now backs overlay-widget registration, owner-managed overlay-output grants, and runtime-health SDK calls with durable tenant-scoped authority. Authenticated apps can register only their own widgets and report only their own runtime state unless explicitly granted a maintenance scope. A signed-in tenant owner can issue, inventory, and revoke an opaque browser-source grant through API, SDK, CLI, or MCP; only its SHA-256 token hash is persisted, the URL is disclosed once, expiry/revocation fail closed, and an internal non-redirecting mount resolver produces a verified renderer principal. These operations are audited, survive SQLite reopen and recovery inventory, and deny app impersonation, service issuance, non-owner access, and cross-tenant access. A deployed output gateway and live OBS rendering proof remain incomplete.

Chat Gateway now exists as a bounded Green service with a normalized Twitch/Discord/Kick message contract, durable provider-message dedupe, per-consumer delivery and retry, tenant isolation, canonical SPMT identity when linked, provider-scoped fallback identity when unlinked, and provider-neutral egress. Its deterministic connection supervisor durably leases provider configurations across workers, obtains only ephemeral SPMT grants, resumes persisted cursors, pauses reauthorization failures, and applies donor-aligned Twitch/Discord/Kick reconnect backoff. Concrete Twitch IRC, Discord Gateway/REST, and Kick Pusher/REST drivers are implemented, and Nebula Arcade, StreamWeaver, and Commlink are real consumers. Production OAuth-refresh authority, credentialed multi-tenant socket rehearsal, and external/live-provider verification remain incomplete.

StreamWeaver now has a complete normalized-chat-to-Stellar result loop behind the shadow provider route. Versioned app-private settings select the persona presentation, aliases, owner identity, home channels, bounded instructions, and either `off` or persona-scoped `conversation` memory. A one-way importer preserves an existing tenant persona without overwriting newer settings. The owner can casually summon that presentation into another channel for an exact durable ten-minute window, while other users require an explicit mention and bots cannot re-enter the loop. SPMT derives presentation ownership from the authenticated StreamWeaver service, human callers cannot inject a presentation, and private instructions are redacted from human job/list/cancel/export responses. Stellar history must match tenant, billed user, conversation, source app, and persona ID; memory-off work loads neither context nor history and receives short raw-content retention. The app-private SQLite outbox still reconciles each accepted job into exactly one provider-neutral reply. Live provider I/O, TTS, research, broader capability routing, and full Companion separation remain active parity work.

Nebula Arcade now includes a controls-free visual browser source for its `tag` game, mounted behind a verified SPMT output principal whose app owner is `nebula-arcade`. The renderer includes donor-equivalent one-second polling, current-it/free-for-all status, tag/new-it/free-for-all broadcasts, leaderboard/history cycling, generated tones, confetti, crown-decorated text, transparent output, strict no-inline-script CSP, and no tenant/provider credential in its URL. A standalone Green Nebula Arcade sandbox exposes that renderer and a same-origin gameplay console while provider egress is disabled. Deploying the opaque output resolver and recording a real OBS capture remain production gates.

Discord Stream Hub now includes the first donor-backed live-monitoring slice: durable live/offline transitions, group-routed shoutout create/update/remove actions, ten-minute alphabetical all-group spotlight rotation, single-live-member spotlight behavior, offline clearing, replay protection, restart persistence, tenant isolation, and retryable Discord-output actions. Its Twitch Helix adapter obtains an ephemeral SPMT grant, batches the tracked community at Helix's 100-login limit, classifies reauthorization, and refuses to reconcile an incomplete provider poll as everybody offline; authoritative directory removals still clear correctly without a Twitch token. Discord embed/media delivery, clip-worker integration, member/config migration, scheduled deployment wiring, and live sandbox proof remain.

HearMeOut now includes its first donor-backed room/media authority slice. Ordinary rooms retain the deployed six-hour lifetime while admin-created system/Activity rooms do not expire; membership, separate movie/music sessions, immediate first-item playback, later-item queueing, playback position, host/admin controls, the bounded requester next/clear exception, expected-current protection, stable operation replay, restart persistence, and tenant isolation are durable in SQLite. Private-room passwords are now scrypt-hashed and enforced server-side instead of exposed to a browser comparison; invitation-only admission binds to an intended tenant user and accepted admission survives restart/rejoin. Tenant-scoped presence requires room membership and preserves the donor's 5-second-heartbeat/45-second-stale behavior. The LiveKit authorization core enforces tenant/room membership, expiry, microphone-only participants, listen-only subscribers, host/admin human media publishing, and capability-scoped Companion/HearMeOut service publishing without voice impersonation. A deployment signer adapter, actual LiveKit transport/session proof, Discord Activity sessions, Twitch/Discord adapters, provider search/resolution, TTS/auto-radio, DJ workers, HLS/cache, UI, and OBS outputs remain active parity work.

MountainView and Companion now include their first donor-backed cross-app slice. MountainView plans common voice intents without direct donor URLs: community-wide live status goes to DSH, Nebula Arcade game activity to Nebula Arcade, music to HearMeOut, stream actions to StreamWeaver, and OBS scenes only to a paired local Companion. SPMT is the sole pairing/revocation authority; Companion rejects wrong-source, cross-tenant, revoked, unknown, and over-capability commands, dedupes completed local work, and retains redacted retry evidence for temporary adapter failures. The mobile/BLE/camera/RDGlass bridge, complete command/profile/visual/QR catalog, public device APIs, desktop relay connection, real OBS adapter, local media/FFmpeg jobs, and installer remain active parity work.

The complete production donor baseline was refreshed on 2026-08-23 in `docs/donor-audits/PRODUCTION_REPO_BASELINES_2026-08-23.md`. Six flagship product manifests are present, but a manifest alone is scaffolding rather than a ported app. Nebula Arcade's first tag-game vertical reached the private Sprite sandbox gate; its production provider/output/import evidence and every broader Nebula Arcade module and worker remain active rebuild work.

The SpaceMountain deep audit is captured in `docs/donor-audits/SPACEMOUNTAIN_DEEP_AUDIT_2026-08-23.md`. It identifies the retained front-door journeys, 29-route primary server surface, legacy routes, local duplicate users/points/preferences, private DSH/HearMeOut/Chat Tag calls, source-patch debt, and the proof required before the donor can retire.
