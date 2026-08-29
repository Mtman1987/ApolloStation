# Discord Stream Hub supervised live runtime

Status: implemented in Green; live tenant configuration and provider credentials remain cutover-gated.

## Ownership

Discord Stream Hub owns its tracked-member directory, live/offline projection, shoutout and spotlight state, Discord message IDs, and retryable delivery outbox. SPMT owns the service identity, app installation, encrypted Twitch/Discord credentials, refresh fencing, and short-lived provider grants. The worker receives no refresh secret and stores no provider token.

The Green worker is `apps/discord-stream-hub/dist/live-worker-start.js`. It authenticates as `discord-stream-hub`, which has only `providers:grant` and `runtime:write`. It does not reuse the Chat Gateway or StreamWeaver identity.

## Runtime flow

1. The supervised process reads `DSH_RUNTIME_CONFIG_PATH`, a versioned public configuration containing tenant IDs, provider-account references, branding, routing channel IDs, and tracked canonical members. Unknown fields fail validation so secrets cannot be slipped into this file.
2. Every configured tenant is polled on its declared 60–3,600 second cycle; the preserved donor interval is 600 seconds. Period-derived poll IDs make overlapping/restarted execution idempotent, and a late restart waits only until the next period boundary rather than adding a second full interval.
3. DSH requests a five-minute `dsh-live-monitor` Twitch grant from SPMT and performs Helix stream lookup in batches of at most 100 logins.
4. A complete poll enters the durable DSH live monitor. An incomplete or unauthorized poll cannot mass-mark members offline.
5. Live transitions create/update/remove shoutouts and rotate the all-group spotlight. Actions enter the SQLite outbox before Discord delivery.
6. Each Discord mutation obtains a five-minute `dsh-discord-live` grant. Message IDs are persisted so later polls edit or remove the same Discord messages.
7. DSH reports a bounded ready/degraded runtime projection to SPMT. Failure to write that projection does not invalidate an already completed provider cycle.

## Frozen donor mapping

| Frozen donor path | Green target | Treatment |
|---|---|---|
| `src/lib/twitch-polling-service.ts` | `live-worker.ts`, `twitch-live-poller.ts` | Preserve ten-minute scheduled monitoring, prevent overlap, batch Helix reads, and replace in-process tokens with SPMT grants. |
| `src/lib/shoutout-service.ts` | `live-monitor.ts`, `discord-live-publisher.ts` | Preserve routed live embeds and edit/remove behavior with a durable outbox and message IDs. |
| `src/lib/community-spotlight-service.ts` | `live-monitor.ts`, `discord-live-publisher.ts` | Preserve alphabetical all-group rotation, single-live-member behavior, offline clearing, and pinned replacement. |
| `src/lib/app-init.ts`, `src/lib/auto-startup.ts` | `live-worker-start.ts`, `run-supervised-sandbox.mjs` | Replace request-triggered singleton startup with one supervised process and graceful shutdown. |
| `data/runtime-config.json` | `DSH_RUNTIME_CONFIG_PATH` | Preserve public tenant/routing configuration in versioned JSON; reject secrets and unknown legacy fields. |
| direct Twitch/Discord environment tokens | SPMT provider credential authority | Do not port. Only ephemeral capability-scoped grants reach DSH. |

No donor authentication, Firebase access, hardcoded guild/admin identity, direct cross-app URL, or legacy app identity is carried into this runtime.

## Persistence and restart

`DSH_DATABASE_PATH` is an explicit absolute app-private SQLite path. It contains live member snapshots, poll receipts, spotlight cursor/state, pending delivery actions, and Discord message IDs. Poll replay in the same period returns the original result without reposting output. A failed delivery remains pending with its stable idempotency key and retries after restart.

On shutdown, the supervisor first stops future scheduling, then waits for the active provider cycle to finish before closing SQLite. This prevents a remote Discord success from racing a local state/outbox write against a closed database.

The public runtime configuration is not app state and contains no credential. Production must place it on controlled volume/config storage; secrets remain in SPMT and cohort environment credentials.

## Deployment boundary

The normal Sprite cohort starts DSH with `config/discord-stream-hub-runtime.sandbox.v1.json`, which contains zero tenants. Sandbox validation also requires outbound mode disabled, a sandbox-named SQLite file, and a sandbox-named configuration path. This proves build, service authentication, migrations, supervision, and shutdown without contacting Twitch or Discord.

Moving the route from `shadow` to Green primary still requires reconciled tenant/member/provider-account configuration, installed DSH scopes, controlled two-tenant Twitch/Discord proof, restart and reauthorization drills, Discord owner acceptance, and rollback evidence. The clip worker and donor media migration are separate later capabilities.
