# Chat Gateway

**Workspace:** @spmt/chat-gateway  
**Location:** apps/chat-gateway  
**Runtime entrypoint:** src/service-start.ts → dist/service-start.js  
**Deployment role:** supervised Node 2 background worker; it is not the public Node 2 web process.

## 1. Responsibility

Chat Gateway is the provider-neutral connection and ingress layer for community chat. It owns provider connection lifecycle, normalized message delivery, deduplication/replay protection, reconnect cursors, provider presence, and controlled outbound sender adapters.

It currently supports Twitch, Discord, Kick, YouTube Live Chat and TikTok Live paths. Provider-specific drivers normalize external events into shared contracts. Product applications retain their own business rules and actions.

The gateway also supervises first-party consumers and related runtime modules for StreamWeaver and Nebula Arcade. This makes it a high-blast-radius worker: one bad configuration or duplicate process can create repeated messages, rewards, bot actions, or game events.

## 2. Runtime structure

| Module | Responsibility |
|---|---|
| src/service-start.ts | Process supervisor, SIGTERM/SIGINT handling, retry loop and bounded 10-second backoff |
| src/service.ts | Environment validation, worker composition, provider/consumer wiring and run lifecycle |
| src/index.ts | Chat Gateway manifest, normalized runtime, durable chat store and public exports |
| src/connection-supervisor.ts | Provider connection records, leases, reconnect/backoff, cursors and lifecycle projection |
| src/provider-drivers.ts | Twitch IRC, Discord Gateway, Kick and YouTube Live Chat adapters/senders |
| src/youtube-driver.ts | YouTube Live Chat driver |
| src/tiktok-live.ts | Read-only TikTok Live Webcast ingestion |
| src/spmt-provider-grants.ts | Short-lived provider grants and reauthorization via SPMT |
| src/canonical-identity.ts | Resolve existing provider identities to canonical SPMT users |
| src/simulation-runtime.ts | Simulation-room event runtime and controlled shadow ingress |

The worker starts the service, validates configuration, establishes provider/consumer readiness, and runs until shutdown. Transient SPMT/auth/database/provider errors are logged and retried; they should not crash the public Node 2 web process.

## 3. Data and authority boundaries

- SPMT owns canonical user identity, provider links, encrypted refresh credentials, provider grants, shared tenant/user facts and shared event authority.
- Chat Gateway owns provider connection lifecycle, normalized ingress state, dedupe/cursor/reconnect metadata and its bounded operational state.
- StreamWeaver owns its command/persona/reward/provider-specific product state.
- Nebula Arcade owns game/channel configuration, player/game state and game-specific event handling.
- Discord Stream Hub owns Discord community/publishing behavior.
- Commlink owns shared message presentation/history and notification state where defined by its contract.

The gateway must not create SPMT users from passive chat observations. The canonical identity resolver only maps existing linked provider identities. Unknown identities remain unlinked until the user completes the supported identity flow.

## 4. Provider and consumer flow

1. Load configured provider connection records and validate tenant/provider/account/channel fields.
2. Ask SPMT for a short-lived scoped provider grant.
3. Open the provider driver with the grant, metadata and optional resume cursor.
4. Normalize inbound events and attach canonical identity only when a known SPMT link exists.
5. Deduplicate and persist cursor/connection state.
6. Deliver the normalized contract to registered product consumers.
7. For outbound operations, use the approved sender/consumer contract and provider scope.
8. On disconnect, classify transport versus authentication failure, update state, and back off or request reauthorization.
9. On shutdown, stop connections and close stores cleanly.

Consumers must be uniquely leased/fenced. Scaling or restarting the worker must not produce two active speakers, duplicate awards, repeated bot messages, or overlapping game schedulers.

## 5. Dependencies

- @spmt/contracts — normalized messages, provider IDs, event types, execution targets and app manifest.
- @spmt/sdk — authenticated SPMT calls and provider grant APIs.
- @spmt/auth-core, @spmt/authority-core, @spmt/authority-sqlite — local runtime support and authority integration where required.
- @spmt/commlink-core — durable Commlink delivery.
- @spmt/platform-ops and @spmt/api-adapter — typed shared operations.
- @spmt/streamweaver — StreamWeaver provider runtime, command/action execution, avatar and image workers, TikTok state.
- @spmt/nebula-arcade — Nebula provider runtime and game event consumers.
- @spmt/discord-stream-hub and @spmt/hearmeout — first-party consumer contracts.
- tiktok-live-connector — TikTok Live Webcast client.

Keep provider SDKs isolated in this service. Do not import provider libraries into every app just to receive the same chat event.

## 6. Configuration

Exact Node 2 environment mapping is defined by scripts/hostless/start-node.mjs and the dedicated release workflow. The service validates the following variables by name; never commit or print their values.

### Core worker

- SPMT_RUNTIME_MODE
- SPMT_ORIGIN
- CHAT_GATEWAY_DATABASE_PATH (absolute path)
- CHAT_GATEWAY_WORKER_CREDENTIAL (32+ characters)
- CHAT_GATEWAY_WORKER_ID
- CHAT_GATEWAY_CONNECTIONS
- CHAT_GATEWAY_RECONCILE_MS
- SPMT_OUTBOUND_MODE
- SPMT_LIVE_INGRESS_MODE
- STELLAR_EXECUTION_TARGET

### Shared Twitch bot

- TWITCH_BOT_TOKEN
- TWITCH_BOT_USERNAME
- SPACEMOUNTAIN_TWITCH_CHANNEL

The worker may bootstrap the shared SpaceMountain Twitch bot connection when SPMT has not yet provisioned the connection record. This is an explicit compatibility path; it must not create a second bot identity or bypass provider grants.

### StreamWeaver runtime

- STREAMWEAVER_PROVIDER_RUNTIME_ENABLED
- STREAMWEAVER_WORKER_CREDENTIAL
- STREAMWEAVER_DATABASE_PATH
- STREAMWEAVER_GENERATION_STORE
- STREAMWEAVER_TURSO_DATABASE_URL
- STREAMWEAVER_TURSO_AUTH_TOKEN
- STREAMWEAVER_IMAGE_EXECUTION_TARGET
- STREAMWEAVER_SEAART_CLI_BINARY, STREAMWEAVER_SEAART_CLI_TOKEN, STREAMWEAVER_SEAART_MODEL_NO, STREAMWEAVER_SEAART_MODEL_VER_NO
- STREAMWEAVER_CLOUDFLARE_ACCOUNT_ID, STREAMWEAVER_CLOUDFLARE_API_TOKEN
- STREAMWEAVER_EDENAI_IMAGE_KEY, STREAMWEAVER_EDENAI_IMAGE_MODEL
- STREAMWEAVER_POLLINATIONS_API_KEY
- STREAMWEAVER_AVATAR_RIGGING_ENABLED, STREAMWEAVER_BLENDER_BINARY, STREAMWEAVER_AVATAR_GEOMETRY_SCRIPT
- STREAMWEAVER_RESTREAM_CONTROL_ORIGIN, STREAMWEAVER_RESTREAM_CONTROL_CREDENTIAL

### Nebula runtime

- NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED
- NEBULA_ARCADE_WORKER_CREDENTIAL
- NEBULA_ARCADE_DATABASE_PATH
- NEBULA_ARCADE_RUNTIME_CONFIG_PATH
- NEBULA_ARCADE_TENANT_ID
- NEBULA_ARCADE_WEBHOOK_NAME
- NEBULA_ARCADE_PUBLIC_ORIGIN
- NEBULA_GAMEPLAY_PUBLIC_ORIGIN
- NEBULA_ARCADE_AVATAR_URL

### TikTok

- TIKTOK_SIGN_API_KEY (optional signing integration for the Webcast connector)

The code currently parses STELLAR_EXECUTION_TARGET with a legacy default of sprite. Hostless must explicitly set the intended supported target; do not allow a missing variable to silently select a retired Sprite execution path. The shared execution-target enum still contains legacy fly/sprite values and is scheduled for coordinated cleanup.

## 7. Build, test and operation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Relevant focused tests include:

- tests/chat-gateway.test.mjs
- tests/chat-provider-supervisor.test.mjs
- tests/chat-provider-drivers.test.mjs
- tests/chat-gateway-commlink-transport.test.mjs
- tests/chat-gateway-canonical-identity.test.mjs
- tests/offline-network-guard.test.mjs

The dedicated Node 2 release workflow owns deployment. Hostless auto-deploy is disabled for this worker so a background-worker restart cannot be coupled to the public web process's readiness cycle.

## 8. Reliability and security

- Provider refresh credentials remain in SPMT; workers receive short-lived access grants.
- Each connection is tenant-bound and scoped to a provider account/channel.
- Validate provider configuration before opening sockets.
- Bound handshake, reconnect, retry, cursor, message and consumer work.
- Keep logs free of access tokens, refresh tokens, OAuth codes, cookies and message-private payloads.
- Distinguish transport failure from authentication expiry.
- Persist cursors and idempotency keys to prevent replay after restart.
- Use unique worker IDs and fenced leases for singleton consumers.
- Do not create users or provider links from passive chat events.
- Never let one provider failure take down unrelated web readiness.

## 9. Performance guidance

- Reuse one authenticated Twitch IRC socket for multiple desired channels where the connection contract allows it.
- Avoid reconnect storms with bounded exponential/backoff behavior and jitter where implemented.
- Batch provider reconciliation and message delivery without allowing unbounded queues.
- Keep provider-specific payload normalization at the edge.
- Do not create duplicate WebSocket connections for the same tenant/account/channel.
- Keep StreamWeaver and Nebula consumers modular; move heavyweight image/avatar work to durable jobs instead of blocking chat ingress.
- Measure event throughput, queue depth, reconnect churn, memory, SQLite lock time and duplicate-delivery rate.

## 10. Acceptance checklist

- [ ] Node 2 worker starts with the intended deployed SHA and configured consumers.
- [ ] SPMT grants are issued for the correct tenant/provider/account and expire as expected.
- [ ] Twitch/Discord/Kick/YouTube/TikTok ingress works for the approved test accounts.
- [ ] Reconnect resumes from the persisted cursor without duplicate delivery.
- [ ] Canonical identity resolves only existing linked users.
- [ ] StreamWeaver/Nebula/DSH consumers receive only their intended events.
- [ ] Restart and recovery do not create duplicate sockets, bots, awards or scheduled actions.
- [ ] Logs are bounded and secret-safe.
- [ ] Node 2 health and public web readiness remain independent.
