# Chat Gateway and Commlink transport

Status: implemented behind the provider cutover gate.

## Ownership

- SPMT owns human and service identity, tenant authorization, app installation, provider refresh credentials, and short-lived provider grants.
- Chat Gateway is the only first-party provider socket process. It owns connection leases, reconnect cursors, normalized ingress dedupe, provider-neutral egress, and per-consumer delivery retry.
- Commlink owns the user-facing communications experience. Its live feed reads a credential-free, tenant-scoped projection from SPMT alongside mail, notifications, and app events.
- Nebula Arcade and StreamWeaver consume the same normalized Chat Gateway contract. Neither owns a second provider connection or message authority.
- StreamWeaver's relay consumer records provider/canonical identities and routes explicit human messages without BotShare. Only autonomous bot-to-bot sharing requires bilateral BotShare.
- Nebula Arcade supplies its dashboard presentation to Chat Gateway; Chat Gateway keeps the Discord bot/webhook execution credential private and returns only the durable message ID and transport.

## Runtime path

1. The supervised Chat Gateway authenticates to loopback SPMT with a rotating internal service credential.
2. A desired provider connection is leased by one Chat Gateway worker.
3. The worker requests a short-lived, capability-scoped provider grant from SPMT. Refresh credentials never leave SPMT.
4. Twitch, Discord, or Kick messages are normalized and written to the durable Chat Gateway message/delivery store before any consumer call.
5. The `commlink-live-chat` consumer posts the normalized message to `POST /v1/commlink/live` through `@spmt/sdk`.
6. SPMT accepts that write only from the installed `chat-gateway` service with `commlink:live:write`, verifies the header tenant matches the message tenant, and deduplicates it durably.
7. A signed-in user reads only their authorized tenant through `GET /v1/commlink/live`. SpaceMountain combines this projection with canonical Commlink conversations, mail, notifications, and events.

The browser proxy exposes the read route only. It does not expose service-token, provider-grant, refresh, or live-ingestion routes.

## Persistence and replay

- `chat_messages` stores normalized provider ingress keyed by tenant, provider, connection, and provider message ID.
- `chat_deliveries` stores one retryable delivery per registered consumer.
- `provider_connections` stores desired state, lease, reconnect backoff, and provider resume cursor; it stores no access or refresh credential.
- `commlink_live_chat` stores the public projection and uses the same stable provider key for idempotent replay.

The SPMT recovery inventory counts `commlink_live_chat`, and the table is included in the encrypted authority snapshot. Chat Gateway's private SQLite file follows the app-private checkpoint/backup/restore contract; its deployment volume must be included in the fleet backup schedule before live provider cutover.

An ingest is acknowledged to the provider worker only after it is durable in Chat Gateway. A consumer failure leaves the delivery pending. Process restart reuses persisted connection cursors and delivery records, and replay cannot rewrite the first accepted message.

## Supervision and environment

The normal service entry point is `apps/chat-gateway/dist/service-start.js`.

Required production inputs:

- `SPMT_ORIGIN`: credential-free loopback HTTP origin.
- `CHAT_GATEWAY_DATABASE_PATH`: absolute durable SQLite path.
- `CHAT_GATEWAY_WORKER_CREDENTIAL`: at least 32 characters and matched by the SPMT cohort.
- `CHAT_GATEWAY_CONNECTIONS`: bounded JSON array of desired tenant/provider connections.

Optional Nebula Arcade dashboard inputs (valid only when `NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED=1`):

- `NEBULA_ARCADE_PUBLIC_ORIGIN` (or `SPMT_PUBLIC_ORIGIN`): credential-free HTTPS origin used for the games link, GIF, and large social preview.
- `NEBULA_ARCADE_WEBHOOK_NAME`: defaults to `Nebula Arcade`.
- `NEBULA_ARCADE_AVATAR_URL`: credential-free HTTPS webhook avatar; legacy Chat Tag avatar/name variables remain accepted for migration.

The dashboard store persists no webhook token. Human relay threads persist only normalized endpoints, bounded conversation text, expiry, and provider message IDs; BotShare defaults off and applies only to autonomous bot messages.

The Green Sprite starts this exact service with an empty connection array. Sandbox validation requires outbound mode disabled, a sandbox-named database, and zero live provider connections. This proves build, supervision, service authentication, migrations, and clean shutdown without granting provider access.

## Production gate

Production provider connections remain disabled until all of the following evidence exists:

- reconciled tenant/provider account IDs and installed Chat Gateway grants;
- controlled concurrent two-tenant Twitch, Discord, and Kick socket rehearsal;
- reconnect/resume proof after process replacement;
- external Commlink client read conformance and owner acceptance;
- credential rollback and reauthorization drill.

Enabling provider connections is a configuration cutover, not a code fork. Rollback removes desired connections and restarts the previous service cohort; persisted cursors and pending deliveries remain recoverable.
