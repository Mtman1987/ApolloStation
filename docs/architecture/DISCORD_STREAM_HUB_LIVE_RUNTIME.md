# Discord Stream Hub supervised live runtime

Status: implemented in Green; live tenant configuration and provider credentials remain cutover-gated.

Audit update, 7 September: see the [current deployed-source comparison](../donor-audits/DSH_LIVE_AUDIT_2026-09-07.md). The worker still reads static runtime routing rather than the app's saved delivery settings, and its optional spotlight media source is not connected. Signal, creator-media and channel-moderation helper exports are not runtime integration. The suite-action application decision also bypasses the web agreement/notification workflow. These are tracked implementation gaps, not new requirements for duplicate ecosystem services.

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

The normal Sprite cohort starts DSH with `config/discord-stream-hub-runtime.sandbox.v1.json`, which contains zero tenants by default. Sandbox validation requires outbound mode disabled plus sandbox-named SQLite and configuration files. A configured tenant is accepted only when `SPMT_LIVE_INGRESS_MODE=enabled`; Twitch reads and Discord server/channel reads then remain live while every Discord mutation is captured in tenant-scoped Simulation Rooms.

Moving the route from `shadow` to Green primary still requires reconciled tenant/member/provider-account configuration, installed DSH scopes, controlled two-tenant Twitch/Discord proof, restart and reauthorization drills, Discord owner acceptance, and rollback evidence. The clip worker and donor media migration are separate later capabilities.

## 6 September 2026: shoutout presentation and app controls

The app consumes the existing shared community feed without dropping its avatar,
image/GIF, video, banner, original Discord-message URL, description or timestamps.
Its streamer cards restore the donor's avatar/title, media, personal copy and
Viewers/Game/Updated layout, including the wide spotlight/VIP card. Playback uses
the actual saved video or a Twitch clip/live player with the current parent host.
Small containers scale a player with Twitch's minimum dimensions. Refresh updates
stats/copy in place and retains an active player. Missing stats remain unknown.

Owner generation requests validate the creator and event against the shared feed,
then use Stellar Core through SPMT. SQLite retains request/job state, prompts,
previous messages and normalized message fingerprints. Refresh/retry reuses the
same request; a new generation has its own request. Repeated output retries with
a changed prompt, then reports a failure rather than presenting repeated copy as
fresh. Generation uses public stream facts with conversation memory disabled.
It does not replace the established Discord embed descriptions.

The native publisher and explicit shoutout action now share the five original
`DiscordStreamHub@d97af86` tier payloads: cyan Crew, purple Partners, orange Honored
Guests, Twitch-purple Community, and teal Raid Pile. Crew retains a separate
banner embed when supplied; Partners retain their link buttons. Runtime branding
accepts `embedTemplates` overrides for the donor's crew/partners/community fields,
and members accept `bannerUrl` and `partnerDiscordUrl`. Twitch profile images are
looked up separately from stream thumbnails. Spotlight no longer rewrites a
member's tier footer. Manual app posting uses the durable suite-action queue and
the existing simulation transport in outbound-disabled mode.

The original deployed DSH service and its saved live templates/media are not
modified by this release. The native clip library/capture migration remains the
separate capability described above; no GIF URL is fabricated into an MP4 URL.
Custom live template values must be supplied in runtime branding for native
outbound parity. This release verifies the original source defaults and configured
overrides, not unseen live database values or authenticated phone rendering.

Validation: 819 repository tests pass, including canonical media retention,
authenticated generation/post routing, owner and source validation, all five tier
payloads, restart-safe generation and duplicate rejection. A DOM execution check
also verifies that stat/message refresh retains the same playing video element.

The same release includes the concurrent Commlink/named-room changes. A creator
from the shared feed can be previewed directly into a selected owned shadow room,
without adding a Discord provider account or tracked-member configuration. The
original tier payload and receipt are frozen per request so retries do not create
duplicate room events. Real Discord posting retains the durable worker route.

### Interrupted shoutout generation recovery

Refresh now resumes a pending generation whose assistant admission response was
lost before its job ID could be saved. It reuses the persisted attempt's
idempotency key, including after restart and during duplicate-copy retries.
Temporary admission failures remain visibly pending with a retry message; a
successful admission resumes normal job polling. This prevents a card from
remaining on “Writing message…” permanently after a transient outage.

Regression coverage simulates an accepted job with a lost response, repeated
unavailability, restart, tenant isolation, and interruption of a duplicate-copy
retry. It verifies that recovery uses the same attempt key and retrieves the
completed copy. Credentialed provider delivery and phone rendering are not
established by these offline checks.
