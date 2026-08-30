# ApolloStation main offline test checklist

Use this checklist for the final battery on `main`. It is designed for one operator, one assistant, and one local sandbox. It must not contact Discord, Twitch, Kick, YouTube, LiveKit, Fly, Sprites, GitHub, model hosts, or any other outside service.

## Test record

- [ ] Record the exact `git rev-parse HEAD` value.
- [ ] Confirm `git branch --format='%(refname:short)'` prints only `main`.
- [ ] Confirm `git status --short --branch` reports a clean `main` tracking `origin/main`.
- [ ] Record Node and npm versions with `node --version` and `npm --version`.
- [ ] Create a disposable data directory with `APOLLO_TEST_ROOT="$(mktemp -d /tmp/apollostation-test.XXXXXX)"` and remove only that validated path when testing is complete.

## Hard isolation rules

- [ ] Run the complete automated gate with `npm run test:offline`, not `npm test`.
- [ ] Treat any `OFFLINE_NETWORK_BLOCKED` error as a useful test failure that identifies an attempted outside call.
- [ ] Do not run `npm install`, `npm ci`, `npm run provider:rehearse`, `npm run cutover:audit -- --check-remote`, a deploy script, or a live provider command during this battery.
- [ ] Use only `localhost`, `127.0.0.1`, temporary SQLite files, fake adapters, deterministic clocks, and inert `.invalid` identifiers.
- [ ] Never paste production credentials into the sandbox. Sandbox startup strips unrelated environment variables and sets `SPMT_OUTBOUND_MODE=disabled`.

## One-command automated gate

Run:

```bash
npm run test:offline
```

- [ ] TypeScript builds every package and app.
- [ ] All tests pass with zero failures, skips, cancellations, or todos.
- [ ] The network guard proves an external HTTP request is stopped before opening a socket.
- [ ] The network guard proves loopback HTTP remains available to local integration tests.
- [ ] Save the final test count and elapsed time in the test record.

The full gate is authoritative. The focused groups below are useful for diagnosing failures and for guided acceptance testing after the full gate is green. Run `npm run build` once before using an individual `node --test` command.

## Platform, identity, security, and recovery

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/contracts.test.mjs tests/auth.test.mjs tests/authority-core.test.mjs \
  tests/authority-sqlite.test.mjs tests/recovery.test.mjs \
  tests/provider-grant-api.test.mjs tests/provider-credential-authority.test.mjs \
  tests/provider-grandfather-parity.test.mjs tests/overlay-output-grants.test.mjs
```

- [ ] Tenant boundaries reject cross-tenant reads and writes.
- [ ] Human, service, provider, and owner authority stay distinct.
- [ ] Refresh replay, recovery, revocation, audit, and restart behavior pass.
- [ ] Provider secrets and bearer URLs are never returned or persisted in user-facing state.

## SpaceMountain shell, Commlink, and visuals

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/spacemountain-web.test.mjs tests/spacemountain-shell-ui.test.mjs \
  tests/spacemountain-bounded-app-pages.test.mjs tests/bounded-app-product-ui.test.mjs \
  tests/first-party-app-focused-ui.test.mjs tests/product-ui-parity.test.mjs \
  tests/commlink-live-chat.test.mjs tests/commlink-mail-parity.test.mjs \
  tests/chat-gateway-commlink-transport.test.mjs
```

- [ ] ApolloStation keeps its shared header, themes, scene art, viewport bounds, and internal scrolling.
- [ ] Every registered first-party app opens inside the canonical shell without restoring donor visuals.
- [ ] Commlink chat and mail are private, durable, readable, and replay-safe.

## Chat Gateway and provider simulation

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/chat-gateway.test.mjs tests/chat-provider-drivers.test.mjs \
  tests/chat-provider-supervisor.test.mjs tests/chat-gateway-provider-identity.test.mjs \
  tests/provider-identity-convergence.test.mjs tests/provider-identity-operations.test.mjs \
  tests/app-provider-identity-resolvers.test.mjs tests/provider-live-rehearsal-gate.test.mjs
```

- [ ] Discord, Twitch, and Kick payloads are normalized through fake drivers only.
- [ ] Avatar URLs propagate without credentials.
- [ ] Resume cursors, grants, worker identity, and reconnect state survive restart.
- [ ] Live rehearsal remains fenced because no external provider was contacted.

## StreamWeaver, bot relay, and BotShare boundary

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/streamweaver-bot-relay-hardening.test.mjs \
  tests/streamweaver-chat-gateway.test.mjs tests/streamweaver-provider-runtime.test.mjs \
  tests/streamweaver-command-router.test.mjs tests/streamweaver-suite-bot-actions.test.mjs \
  tests/streamweaver-donor-command-runtime.test.mjs tests/streamweaver-economy-parity.test.mjs \
  tests/streamweaver-persona-memory.test.mjs tests/streamweaver-shoutout-runtime.test.mjs
```

- [ ] Any locally simulated human can explicitly relay information.
- [ ] A human-directed relay bypasses BotShare.
- [ ] Autonomous bot-to-bot relay requires bilateral BotShare.
- [ ] Replies are durable and bound to the intended recipient.
- [ ] Missing or mismatched identity fails closed.
- [ ] Commands, currencies, personas, shoutouts, and replay dedupe remain tenant-isolated.

The tests create multiple local identities in one process. They cover the two-person and two-bot cases without a second human or an outside chat service.

## Nebula Arcade, upgraded embed, gameplay GIFs, and banner

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/nebula-arcade-canonical-identity.test.mjs tests/nebula-tag-runtime.test.mjs \
  tests/nebula-tag-migration.test.mjs tests/nebula-tag-overlay-rotation.test.mjs \
  tests/nebula-game-runtime.test.mjs tests/nebula-game-runtime-store.test.mjs \
  tests/nebula-game-hub.test.mjs tests/nebula-runtime-parity.test.mjs \
  tests/nebula-discord-dashboard.test.mjs tests/dsh-nebula-gameplay-rotation.test.mjs \
  tests/dsh-clip-gif-library.test.mjs tests/dsh-banner-signal-upgrades.test.mjs
```

- [ ] Nebula Arcade is the only public/runtime identity; Tag remains an internal game.
- [ ] Tag state, migrations, commands, rotations, scores, players, and overlays survive restart.
- [ ] The dashboard embed contains exactly six inline fields in two rows.
- [ ] The current player avatar is the thumbnail and no secret is embedded in its URL.
- [ ] The current gameplay GIF is the main image; the static Nebula GIF is fallback only.
- [ ] The manifest contains 20 games, each capture represents 60 seconds, and selection changes on a 10-minute slot.
- [ ] The durable clip library keeps at most 10 GIFs per tenant/streamer.
- [ ] The generated banner uses 2,900 ms frame duration and the improved compact signal layout.

## Discord Stream Hub

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/dsh-live-monitor.test.mjs tests/dsh-twitch-poller.test.mjs \
  tests/dsh-supervised-live-runtime.test.mjs tests/dsh-discord-live-publisher.test.mjs \
  tests/dsh-application-flow.test.mjs tests/dsh-calendar.test.mjs \
  tests/dsh-points-event-router.test.mjs tests/dsh-production-points-parity.test.mjs \
  tests/dsh-shoutout-groups.test.mjs
```

- [ ] Local fixtures cover offline-to-live, live-to-offline, polling replay, and restart.
- [ ] Discord publication is captured by a fake adapter and never sent.
- [ ] Missions, applications, points, shoutout groups, and streamer state remain durable and isolated.

## HearMeOut

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/hearmeout-room-media.test.mjs tests/hearmeout-admission-presence.test.mjs \
  tests/hearmeout-livekit-grants.test.mjs tests/hearmeout-livekit-signer.test.mjs \
  tests/hearmeout-discord-activity.test.mjs tests/hearmeout-discord-interactions.test.mjs \
  tests/hearmeout-discord-receive-audio.test.mjs tests/hearmeout-voice-bridge-parity.test.mjs \
  tests/hearmeout-voice-bridge-resilience.test.mjs tests/hearmeout-watch-hls-policy.test.mjs \
  tests/hearmeout-bot-persona-actions.test.mjs
```

- [ ] Room admission, presence, roles, audio, music, cache, and persona actions use local stores and fakes.
- [ ] Signing and interaction tests validate payloads without calling LiveKit, Discord, or YouTube.
- [ ] Media and voice failure paths degrade safely and remain restart-durable.

## MountainView, Companion, Stellar, Mission Control, Rotator, and monetization

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/mountainview-command-parity.test.mjs tests/mountainview-device-runtime.test.mjs \
  tests/mountainview-companion.test.mjs tests/companion-donor-runtime.test.mjs \
  tests/companion-runtime-handlers.test.mjs tests/companion-media-jobs.test.mjs \
  tests/stellar-chat-vertical.test.mjs tests/stellar-production-gates.test.mjs \
  tests/stellar-completion-and-pinned-bot.test.mjs tests/mission-control-fleet-view.test.mjs \
  tests/runtime-fleet-policy.test.mjs tests/rotator-fleet-controller.test.mjs \
  tests/monetization-foundation.test.mjs tests/mission-control-monetization-view.test.mjs
```

- [ ] Device and companion traffic is simulated with local handlers and durable queues.
- [ ] Stellar uses fake inference and proves pinned bot identity, privacy, completion, restart, and rollback gates.
- [ ] Mission Control and Rotator actions remain owner-scoped and fenced.
- [ ] Usage and monetization calculations are deterministic, durable, and tenant-isolated.

## Local supervised sandbox walkthrough

Start the complete current catalog with fresh disposable storage and no model binary:

```bash
APOLLO_TEST_ROOT="$(mktemp -d /tmp/apollostation-test.XXXXXX)"
npm run sandbox:run -- \
  --catalog current \
  --candidate-app nebula-arcade \
  --public-url http://localhost:8080 \
  --data-root "$APOLLO_TEST_ROOT" \
  --build-sha local-offline-acceptance \
  --offline-network-guard 1
```

The supervisor sets outbound mode to disabled, preloads the loopback-only network guard into every Node child, creates empty provider connection lists, binds authorities to loopback, and omits hosted inference when no model binary is supplied.

- [ ] `curl -fsS http://127.0.0.1:8080/sandbox/health` reports `local-offline-acceptance`.
- [ ] Open `http://127.0.0.1:8080` and verify Home, Shipyard, Workspace, Settings, Commlink, Stellar Core, Mission Control, and every registered first-party app.
- [ ] Verify each home view fits the Apollo viewport and each long view scrolls inside it rather than behind the header.
- [ ] Open Nebula Arcade Games, a game detail, Overlay Bay, Stats, and the gameplay showcase route.
- [ ] Confirm the console says outbound provider actions are disabled and shows no reconnect loop or attempted external hostname.
- [ ] Press Ctrl+C once and confirm every supervised child stops.
- [ ] Start the same command again with the same data directory and confirm readiness, persisted local state, and no duplicate jobs or messages.
- [ ] Stop the cohort and remove only the recorded disposable directory: `case "$APOLLO_TEST_ROOT" in /tmp/apollostation-test.*) rm -rf -- "$APOLLO_TEST_ROOT" ;; *) echo "Refusing unexpected path" >&2; false ;; esac`.

## Source-only deployment and cutover checks

These checks inspect contracts without contacting GitHub or Sprites:

```bash
node --import ./scripts/offline-network-guard.mjs --test \
  tests/sprite-promotion.test.mjs tests/live-source-slices.test.mjs \
  tests/live-cutover-rehearsal.test.mjs tests/app-code-parity-completion.test.mjs
npm run cutover:audit
```

- [ ] Only `main` is configured for automatic CI and Release Sprite promotion.
- [ ] Review Sprite promotion is manual and uses the current selected commit.
- [ ] Deployment remains pinned, checkpointed, atomic, health-verified, and rollback-safe.
- [ ] The live-source ledger is structurally valid without fetching a remote source.
- [ ] High-level production gates remain explicit; an offline run does not pretend external rehearsal occurred.

## Completion

- [ ] Full offline suite green.
- [ ] Focused failures, if any, fixed and the full suite rerun.
- [ ] Local supervised walkthrough complete with no outside traffic.
- [ ] Restart pass complete with no duplicate or lost durable state.
- [ ] Apollo visuals, Nebula identity, upgraded embed, GIF/banner behavior, and bot relay/BotShare rules confirmed.
- [ ] Test record saved with commit SHA, versions, test count, failures, fixes, and final result.
