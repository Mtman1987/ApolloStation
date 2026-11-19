# Discord Stream Hub

**Workspace:** @spmt/discord-stream-hub  
**Location:** apps/discord-stream-hub  
**Runtime surfaces:** authenticated web app plus supervised live worker.  
**Entrypoints:** src/web-server.ts and src/live-worker-start.ts.

## 1. Product responsibility

Discord Stream Hub (DSH) owns Discord community automation and delivery: live monitoring, member activity, spotlight/shoutouts, calendar, applications, moderation, forum forwarding, raid/pile and raid-train workflows, points presentation, Discord interactions, Nebula gameplay capture, media publication, and owner/operator controls for the DSH domain.

SPMT remains the shared identity, tenant, provider-grant, and XP authority. DSH owns its community-specific configuration, delivery state, media records and moderation/application workflows.

## 2. Runtime composition

| Module | Responsibility |
|---|---|
| src/index.ts | DSH manifest, catalog registration and exports |
| src/web-server.ts | Authenticated product web host and browser surfaces |
| src/web-controls.ts | DSH settings and owner control APIs |
| src/live-worker-start.ts | Supervised worker startup and graceful shutdown |
| src/live-worker.ts | Worker composition, tenant config, polling, Discord delivery and scheduled consumers |
| src/live-monitor.ts | Live member and stream state |
| src/twitch-live-poller.ts | Twitch Helix polling and live-member directory |
| src/discord-live-publisher.ts | Discord API delivery and durable message state |
| src/signal-seeker.ts, signal-discovery.ts, signal-control.ts, signal-presentation.ts | Signal discovery, drop/spotlight state and presentation |
| src/shoutout-groups.ts, shoutout-presentation.ts, shoutout-ui.ts | Group shoutouts and presentation |
| src/calendar.ts, calendar-sync.ts, calendar-delivery.ts, calendar-interactions.ts | Community calendar and scheduled delivery |
| src/applications.ts, application-flow.ts, application-decision.ts, application-controls.ts | Community application lifecycle and decisions |
| src/channel-moderation.ts and channel-cleanup.ts | Moderation and channel cleanup workflows |
| src/points.ts and points-event-router.ts | Community activity and canonical SPMT XP routing |
| src/suite-action-worker.ts and suite-action-operations.ts | Durable SPMT suite-action execution |
| src/nebula-gameplay*.ts | Nebula gameplay capture and media presentation |
| src/nebula-media-worker.ts | Nebula/Quackverse media processing and publication |
| src/quackverse-art.ts and quackverse-pack-publisher.ts | Quackverse art enhancement and pack publication |
| src/mtfixit-intake.ts and async-mtfixit-intake.ts | Repair/coder intake and asynchronous intake persistence |
| src/lounge-*.ts | Lounge host, avatar, program, state and overlay workflows |
| src/guest-shoutouts.ts, clip-acquisition.ts, clip-gif-library.ts | Guest/clip media acquisition and reusable clip library |
| src/raid-pile.ts, raid-pile-relay.ts, raid-train.ts | Raid coordination and relay behavior |

## 3. Web and worker separation

The web server provides the product UI, settings, authenticated browser controls and app surface. The live worker performs polling, provider delivery, scheduled work, durable suite actions, calendar updates and media jobs.

The worker starts through live-worker-start.ts, validates the runtime configuration, reports readiness, then runs the live monitor, suite-action worker, calendar worker and Nebula media worker. SIGTERM/SIGINT must stop loops and close owned stores.

Do not put long-running polling or browser capture in the web request path. Do not couple public web readiness to a background worker's transient provider failure.

## 4. Authority and data boundaries

- SPMT owns user identity, tenant membership, provider grants and canonical shared XP.
- DSH owns Discord community settings, member activity projections, application decisions, calendar state, spotlight/shoutout state, Discord delivery records, media state and DSH-specific worker data.
- Nebula Arcade owns game rules/state; DSH owns the capture/enhancement/publication work assigned by the art/gameplay contracts.
- StreamWeaver owns its own chat commands/personas/rewards; DSH does not duplicate StreamWeaver command authority.
- Shared communication/history uses the Commlink/SPMT contracts where specified.

Never create a second shared points balance or identity database in DSH.

## 5. Provider and delivery flow

1. Read validated tenant configuration.
2. Obtain scoped provider grants through SPMT.
3. Poll Twitch/Discord sources and reconcile current member/stream state.
4. Convert events into DSH-owned decisions (spotlight, shoutout, calendar, moderation, application, points or media).
5. Persist the decision/delivery state with idempotency.
6. Send Discord messages/interactions using the authorized publisher.
7. Record the provider message/result and reconcile incomplete polls/retries.
8. For suite actions, claim a fenced SPMT job, validate capability and tenant, execute the typed action, and report success/failure.

Duplicate messages, duplicate points, repeated announcements, or repeated media delivery after restart are release-blocking defects.

## 6. Configuration and secrets

The Hostless launcher and DSH worker configuration are the authoritative source for exact variable mapping. Names observed in the web/worker entrypoints include:

- DSH_DATABASE_PATH
- DSH_RUNTIME_CONFIG_PATH
- DSH_SERVICE_SECRET
- DSH_WORKER_CREDENTIAL
- DSH_DISCORD_CLIENT_ID
- DSH_DISCORD_PUBLIC_KEY
- DISCORD_CLIENT_ID
- SPMT_ORIGIN
- SPMT_PUBLIC_ORIGIN
- SPMT_OUTBOUND_MODE
- DSH_TURSO_DATABASE_URL and DSH_TURSO_AUTH_TOKEN
- DSH_MTFIXIT_STORE
- DSH_RAID_PILE_STORE
- DSH_MEDIA_SOURCE_ORIGINS
- NEBULA_ARCADE_PUBLIC_ORIGIN
- CHROMIUM_EXECUTABLE_PATH
- PORT and HOST
- BUILD_SHA

Worker configuration must be tenant-scoped and validated before polling or delivery. Credentials stay server-side. Never place bot tokens, service secrets, OAuth credentials, or raw provider payloads in browser variables or logs.

## 7. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/discord-stream-hub

Web start:

    npm run start:web --workspace @spmt/discord-stream-hub

Worker start:

    npm run start:worker --workspace @spmt/discord-stream-hub

Relevant tests cover DSH live runtime, Discord publishing, Twitch polling, calendar, member activity, shoutouts, moderation, points routing, suite actions, Nebula capture/media, and worker lifecycle.

## 8. Performance and dependency considerations

The package declares Playwright and resvg/font dependencies because DSH includes browser-based Nebula gameplay capture and image/banner rendering. These are heavier than normal web dependencies. Keep browser automation and image rendering on the worker side; do not bundle them into the browser client. A future split into a dedicated DSH media/capture worker package could reduce web install/runtime weight, but only after tracing package exports, workflows, tests and Hostless process composition.

- Bound Twitch polling, Discord API calls, calendar sync, media fetches and retries.
- Reuse Chromium sessions only under explicit lifecycle and resource limits.
- Avoid full member-directory scans on every request.
- Cap media input origins, image dimensions, rendered output and artifact retention.
- Keep background worker concurrency bounded and observable.
- Use async persistence for high-volume records only where the adapter and restore path are proven.

## 9. Security and reliability

- Every action is tenant-scoped and authorized through SPMT.
- Provider tokens remain in the SPMT grant broker; DSH uses short-lived access grants.
- Discord interactions validate signature/public-key and request origin requirements.
- Media fetches use explicit allowed source origins, redirect restrictions and size limits.
- Operational intake and logs are redacted before storage/model/tool use.
- Suite-action jobs validate owner app, execution owner, capability and typed input.
- Persist idempotency keys for announcements, XP awards, calendar sends and media publication.
- A provider outage must not take down the web UI; worker retry must be bounded.

## 10. Acceptance checklist

- [ ] DSH web app loads with the correct SPMT session and tenant.
- [ ] Worker starts with the expected configured tenant set and reports readiness.
- [ ] Twitch live monitoring and Discord delivery work with real test credentials.
- [ ] Spotlight/shoutout timing and role-aware presentation are correct.
- [ ] Calendar publish/refresh and member application lifecycle work.
- [ ] Moderation and forum forwarding obey tenant and role boundaries.
- [ ] Canonical SPMT XP receipts are idempotent and reconcile after restart.
- [ ] Guest/media lifecycle and generated media delivery work.
- [ ] Nebula gameplay capture and Quackverse art jobs publish once.
- [ ] Worker restart/restore does not duplicate bot messages or scheduled actions.
- [ ] Logs/artifacts contain no provider secrets or private user payloads.
