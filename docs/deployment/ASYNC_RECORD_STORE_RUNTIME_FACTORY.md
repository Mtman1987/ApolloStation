# Async record-store runtime factory

The first production-selectable async persistence primitive lives at:

- `@spmt/async-json-store` — shared local SQLite / Turso record-store contract.
- `@spmt/async-json-store/factory` — runtime backend selection and mandatory service namespace scoping.
- `@spmt/turso-http` — remote Turso/libSQL HTTP pipeline and transaction transport.

## Configuration

Local development remains the default:

```js
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";

const store = createAsyncJsonRecordStore({
  service: "nebula-arcade",
  databasePath: process.env.DATABASE_PATH,
});
await store.initialize();
```

Hosted Turso must be an explicit opt-in. For the first Nebula Mosaic pilot, set `NEBULA_ARCADE_MOSAIC_STORE=turso`; the existing Mosaic runtime then initializes and awaits the async Turso store before serving commands or snapshots. All other Nebula stores remain on their existing SQLite implementations during this pilot:

```js
const store = createAsyncJsonRecordStore({
  service: "nebula-arcade",
  mode: "turso",
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await store.initialize();
const readiness = await store.health();
if (!readiness.ready) throw new Error("Turso persistence is not ready");
```

The factory accepts only `sqlite` or `turso`. Missing credentials fail startup. Do not silently fall back to local SQLite in production when Turso was requested.

## Three-node service scopes

The three Hostless nodes can share the existing Turso database during staged migration, while every repository call remains service-prefixed:

| Node | Service identifiers |
|---|---|
| Node 1 — SPMT authority / SpaceMountain / OverlayBay | `spmt-authority`, `spacemountain`, `overlaybay` |
| Node 2 — Chat Gateway / StreamWeaver / Nebula Arcade | `chat-gateway`, `streamweaver`, `nebula-arcade` |
| Node 3 — Discord Stream Hub / Lounge | `discord-stream-hub`, `lounge` |

Each service must use its own stable identifier and its own tenant ID for records. The prefix is applied by the wrapper, not supplied by callers. This prevents accidental key collisions in this generic store; it is not a substitute for service authorization or domain-level tenant checks.

## Important migration boundary

This factory is an adapter primitive, not a transparent replacement for `node:sqlite` or `DatabaseSync`. Its API is asynchronous. Existing synchronous stores must be migrated with their callers and domain tests; do not point their `*_DATABASE_PATH` variables at a Turso URL.

The initial pilot is Nebula Mosaic state only. Set `NEBULA_ARCADE_MOSAIC_STORE=turso` on the Nebula workload plus protected `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. The Mosaic runtime awaits store initialization before the live host starts, and all Mosaic reads, writes, and queue claims use the async transactional adapter. All other Nebula state (including player balances, cards, identity and game state) remains on its existing SQLite implementation. Do not move those domains, StreamWeaver economy, Chat Gateway receipts, SPMT authority, provider credentials, or Lounge live state until each has its own schema, transaction/idempotency parity tests, tenant isolation tests, and verified import/restore path.

## Live deployment smoke test

Set protected server-side `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `APOLLO_TURSO_LIVE_TEST=1`, then run:

```sh
npm run db:test:turso:live
```

The smoke test uses a random synthetic namespace under `apollo-live-smoke`, checks health/write/read/rollback/fresh-client persistence, and attempts to delete its own records. It does not read or change recovered player data.

A green smoke test proves the deployed process can reach Turso. It does not by itself prove that every application domain store has been migrated.


The Nebula live host uses the selected Mosaic backend for both chat/runtime state and the control/gallery project routes. Both runtime layers receive the same `NEBULA_ARCADE_MOSAIC_STORE`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN` configuration; the control/gallery store no longer silently remains on SQLite when the chat runtime uses Turso. Readiness reports `mosaicStoreReady`/`mosaicStoreMode` for the command runtime and `mosaicControlStoreReady`/`mosaicControlStoreMode` for the control/gallery runtime, plus Game Mix status. On Hostless Node 2, set `NEBULA_ARCADE_MOSAIC_STORE=turso`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NEBULA_ARCADE_TURSO_DATABASE_URL`, `NEBULA_ARCADE_TURSO_AUTH_TOKEN`, and `NEBULA_ARCADE_REQUIRE_TURSO=1`. The expected response has all three store modes set to `turso`, all three readiness flags true, and `ready: true`. With the requirement enabled, any SQLite fallback reports HTTP 503 rather than appearing deploy-ready. This does not migrate legacy SQLite rows; import and verify those rows before enabling the Turso gate.


The production gate `NEBULA_ARCADE_REQUIRE_TURSO=1` now requires **both** Nebula Mosaic and Game Mix to select Turso. Mosaic uses `NEBULA_ARCADE_MOSAIC_STORE=turso` with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Game Mix uses `NEBULA_ARCADE_TURSO_DATABASE_URL` and `NEBULA_ARCADE_TURSO_AUTH_TOKEN`. The readiness response exposes `mosaicStoreMode`, `gameMixStoreMode`, and `gameMixStoreReady`; it returns HTTP 503 if either remains on SQLite. The base Nebula host probes the Game Mix store, so a configured-but-unreachable Turso database fails readiness. This gate does not migrate existing Game Mix rows: import and verify any legacy mixes before enabling the Turso backend.


## Nebula Game Mix table import

The generic `db:migrate:turso` command requires a completely empty destination and must not be used against a Turso database that already contains Mosaic records. For Game Mixes, use the table-scoped importer instead. It reads only `nebula_game_mixes`, runs SQLite `quick_check`, preserves the existing tenant/mix keys and layer JSON, and verifies the destination row count and SHA-256 content digest. It permits unrelated tables such as Mosaic records to remain in the same Turso database, but refuses to overwrite or merge into a non-empty `nebula_game_mixes` table.

Dry-run (no Turso credentials or writes):

```sh
npm run db:migrate:nebula-game-mixes:turso -- --source /absolute/path/to/nebula.sqlite
```

Apply only after the dry-run report matches the intended source. Set `NEBULA_ARCADE_TURSO_DATABASE_URL` and `NEBULA_ARCADE_TURSO_AUTH_TOKEN` in the shell, then run:

```sh
npm run db:migrate:nebula-game-mixes:turso -- --source /absolute/path/to/nebula.sqlite --apply
```

The destination table must be empty. The source is opened read-only and is never modified. Do not enable `NEBULA_ARCADE_REQUIRE_TURSO=1` until the import reports `verified: true` and the deployed readiness endpoint reports all three stores ready in Turso mode.


## Nebula Tag Turso runtime and data import

The Nebula Tag command runtime, moderator control surface, direct Tag HTTP routes, and OBS overlay can use the asynchronous record store. SQLite remains the default. Do not enable the Turso mode until the legacy Tag data import has been verified.

Set these protected environment values on the Nebula Arcade workload:

- `NEBULA_ARCADE_TAG_STORE=turso`
- `NEBULA_ARCADE_TURSO_DATABASE_URL`
- `NEBULA_ARCADE_TURSO_AUTH_TOKEN`

The Tag store uses the `nebula-arcade` service namespace in the shared Turso database. The same URL/token pair can also be used by the Nebula Game Mix importer/runtime; Mosaic continues to use its separately documented `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` settings unless configured otherwise.

Build before running the importer because it loads the compiled async store:

```sh
npm run build
npm run db:migrate:nebula-tag:turso -- --source /absolute/path/to/nebula-arcade.sqlite
```

The default is a read-only dry run. It runs SQLite `quick_check` and reports each tenant's revision, player count, command receipt count, pending outbox count, and source digest. Apply only after reviewing that report:

```sh
npm run db:migrate:nebula-tag:turso -- --source /absolute/path/to/nebula-arcade.sqlite --apply
```

The importer preserves Tag state, command idempotency receipts, and pending delivery outbox records in one destination transaction per tenant. It refuses to overwrite a tenant that already has Tag state, commands, or pending deliveries. It verifies imported state/revision and pending outbox counts. The SQLite source is opened read-only and is never changed. Run this against the recovered SQLite database before turning on the Turso runtime.

Existing Tag points/immunity/rotation settings are also imported idempotently from the local `nebula_arcade_settings` table at startup. Subsequent moderator changes are written to the async Tag settings record.

The Nebula readiness response now includes `tagStoreReady` and `tagStoreMode`. With `NEBULA_ARCADE_REQUIRE_TURSO=1`, readiness requires Tag, Mosaic, Mosaic control, and Game Mix to report Turso mode and healthy stores. This is a readiness gate, not an automatic data migration.


## Nebula player/game runtime Turso caller integration

The provider ingress, authenticated moderator/control surface, and live HTTP host now select async game-runtime, action-history, and activity stores when NEBULA_ARCADE_GAME_RUNTIME_STORE=turso. Player enrollment, balances/leaderboards, game commands, check-in awards, game-action receipts/history, channel activity, player membership, and pending command choices await their selected stores. The default remains SQLite.

Set these protected environment values on the Node 2 Nebula workload only after the importer has reported verified=true:

- NEBULA_ARCADE_GAME_RUNTIME_STORE=turso
- NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL
- NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN

The game-runtime, action-history, activity, and game-input adapters share the nebula-arcade service namespace and the same Node 2 Turso credentials. They are separate from Tag, Mosaic, and Game Mix selection; do not assume enabling one enables the others. The async stores are initialized before provider ingress, moderator controls, or readiness-dependent work uses them. Missing credentials fail closed; there is no silent SQLite fallback after Turso is explicitly selected. NEBULA_ARCADE_REQUIRE_TURSO=1 retains its existing Tag/Mosaic/Game Mix readiness contract. Set NEBULA_ARCADE_REQUIRE_FULL_TURSO=1 as well when the Node 2 cutover is ready; the live host then additionally requires game runtime, action history, activity, and game input feed to report Turso mode.

Build, then dry-run the importer against the recovered SQLite source:

    npm run build
    npm run db:migrate:nebula-game-runtime:turso -- --source /absolute/path/to/nebula-arcade.sqlite

Review tenant/runtime-key counts and the source digest. Apply only to the intended empty Turso namespace:

    npm run db:migrate:nebula-game-runtime:turso -- --source /absolute/path/to/nebula-arcade.sqlite --apply

The importer preserves the normalized game runtime state, player balances/progress, score ledger, processed command IDs, and check-in bonus receipts. It refuses populated destination keys, verifies restored state, and never modifies the SQLite source. Do not enable the runtime until the report is verified and restart/read-after-write checks pass.

**Remaining Nebula SQLite domains:** tabletop/Bingo/Quackverse state (including atomic points awards and media outbox), network/enrollment/outbox state, Tag experience/support/overlay messages, dashboard message pointers, and Quackverse art still have separate SQLite stores. Action history and activity now have async adapters and an importer, but the new importer must pass CI and be executed against the recovered source before cutover. The remaining domains each require their own async contract, domain parity tests, safe importer/restore verification, and runtime caller migration.


### Game action and activity import

The action-history, activity, and game-input stores have a separate dry-run-first importer. It reads the legacy action, channel configuration, member activity, pending-choice, and sequenced game-input tables from the same SQLite source using a read-only connection, checks SQLite integrity, and reports counts plus a SHA-256 digest:

    npm run db:migrate:nebula-action-activity:turso -- --source /absolute/path/to/nebula-arcade.sqlite

After reviewing the report, apply only when the corresponding Turso namespaces are empty:

    npm run db:migrate:nebula-action-activity:turso -- --source /absolute/path/to/nebula-arcade.sqlite --apply

The importer verifies destination counts in each tenant namespace and never modifies the source SQLite file. It is independent of the game-runtime importer; run and retain both reports. Do not enable the production Turso cutover until both reports verify and restart/read-after-write checks pass.

## Nebula tabletop migration contract (not yet cut over)

The remaining SqliteNebulaTabletopRuntime is not a single independent state blob. Its SQLite transaction currently coordinates these records:

| SQLite source | Domain record namespace | Required key |
|---|---|---|
| nebula_tabletop | tabletop-state | channel_id + game_id (Bingo is normalized to @arcade) |
| nebula_tabletop_receipts | tabletop-command-receipts | input_id |
| nebula_quackverse_trade_receipts | quackverse-trade-receipts | actor_id + request_id |
| nebula_media_outbox | tabletop-media-outbox | provider:connectionId:messageId |
| nebula_game_runtime | existing game-runtime | default |

These are logical target namespaces; an implementation may choose a different physical record layout, but it must preserve the keys and atomicity. In particular:

- A shared Bingo claim/suggest/flip/free command updates shared-board state, the game-runtime player ledger/balance, and the command receipt in one transaction. The existing host's separate runtime.update() call after tabletop.execute() is not an acceptable Turso cutover design.
- A personal Bingo claim updates the personal board, player score/ledger, win record when applicable, and command receipt atomically.
- Quackverse pack commands update the player's collection, last-pack metadata, media outbox item, and command receipt atomically.
- Quackverse trades update both affected collections and the actor/request idempotency receipt atomically. Replaying the same request ID must return the stored result without transferring cards twice.
- succeeded() must read the durable receipt from the selected backend; observeBingo() and ingestBingoTranscript() must await their writes before the caller acknowledges or serves a snapshot.
- Legacy room consolidation (scope-v2) must be idempotent and retain original rows until the import/verification report is accepted. Do not silently merge or overwrite a populated destination.
- Media outbox records must preserve status and updated_at so pending deliveries can resume after a process restart.

The async tabletop adapter must be wired into both NebulaArcadeProviderRuntime and the live HTTP host, including snapshot, command execution, success/receipt checks, transcript ingestion, trade endpoints, and shutdown. Extend NEBULA_ARCADE_REQUIRE_FULL_TURSO=1 to report tabletop readiness and return 503 unless this adapter is selected and healthy. The importer must open the SQLite source read-only, run integrity validation, export all four tabletop/outbox tables plus the coupled game-runtime state, compute a deterministic digest, refuse non-empty destination keys, import in one transaction, and verify per-namespace counts and digest.

Until those conditions and restart/idempotency/rollback/recovery tests pass, tabletop remains SQLite-backed and the full Nebula Turso readiness gate must stay disabled. No source snapshot should be imported as part of code validation.

### Tabletop caller inventory (verified against the current branch)

The migration surface is wider than the provider ingress and live HTTP host. The current synchronous tabletop instance is also constructed or called by:

- `apps/nebula-arcade/src/control-surface.ts`: browser state snapshot, trade snapshot, trade mutation, Bingo/Quackverse play, and command receipt validation. Its surrounding game-runtime reads currently use the synchronous SQLite store.
- `apps/nebula-arcade/src/media-delivery.ts`: generated Bingo phrase completion writes through `execute()` and then checks `succeeded()`; this worker must await the selected tabletop backend.
- `apps/chat-gateway/src/simulation-runtime.ts`: preview snapshots instantiate the SQLite tabletop store directly. This is a simulation/preview path and must remain explicitly SQLite/synthetic or be given a compatible async preview path; it must never silently read production data from a local file during a Turso cutover.
- `apps/nebula-arcade/src/provider-runtime.ts`: provider ingress uses tabletop execution, receipt checks, Bingo observation/transcript ingestion, and media delivery; all readiness and shutdown paths must await tabletop initialization and close.
- `apps/nebula-arcade/src/nebula-runtime-host-base.ts`: the HTTP host uses tabletop snapshot and action execution, and its health endpoint must include tabletop mode/health in the full-Turso gate.

The async contract therefore needs async variants for `snapshot`, `execute`, `succeeded`, `tradeSnapshot`, `trade`, `ingestBingoTranscript`, `observeBingo`, `quackverseState`, and `importData` (or an explicit decision to keep migration-only import methods SQLite-only). The host and provider must await them at every call site. Keep the SQLite implementation as the default backend and parity oracle until all paths and migration tests pass.

A further atomicity rule: avoid a separate game-runtime update after a tabletop command. The adapter must read and write the existing `game-runtime/default` record through the *same* record-store transaction as the tabletop state and receipt. The generic record-store transaction API supports this; the implementation still needs contention, rollback, and replay tests against the selected backend.


### Cross-store mismatch found during caller audit

The current `NebulaControlSurface` is not yet aligned with the provider/live-host Turso selection: it constructs `SqliteNebulaGameRuntimeStore` unconditionally for `this.games`, and its state, trade-player lookup, running, spend, and play paths use that SQLite instance. It also constructs `SqliteNebulaTabletopRuntime` unconditionally. Therefore a green live-host readiness response for the provider's async game-runtime store does **not** prove that authenticated browser controls use the same durable game-runtime record. The control surface must select and initialize the async game-runtime store under `NEBULA_ARCADE_GAME_RUNTIME_STORE=turso`, await all reads/updates, close it, and share the same Turso service/tenant namespace as the provider and host before this gate can be considered end-to-end.

The Bingo phrase-generation worker in `media-delivery.ts` currently opens a fresh SQLite tabletop runtime to apply generated phrases. It must use the selected async tabletop backend or explicitly enqueue a durable command for the shared runtime; otherwise generated phrases can be written to a local file and disappear from the live Turso-backed board. The Chat Gateway simulation preview is a separate synthetic path and should be kept isolated from production credentials/data.


### Browser control game-runtime cutover follow-up

The browser control surface now selects `AsyncNebulaGameRuntimeStore` when `NEBULA_ARCADE_GAME_RUNTIME_STORE=turso`, initializes it before handling requests, awaits browser state/player reads and running/spend updates, and closes the selected store on shutdown. SQLite remains the default. This closes the game-runtime split described above, but **does not** make browser tabletop/Bingo/Quackverse state Turso-backed: the control surface still uses `SqliteNebulaTabletopRuntime`, and the tabletop atomicity/import/caller work remains a deployment blocker.



### Full-Turso readiness now fails closed on tabletop

The live host's `NEBULA_ARCADE_REQUIRE_FULL_TURSO=1` gate now explicitly checks tabletop persistence before the other newly migrated Nebula stores. Until an async tabletop adapter is implemented and selected, readiness returns HTTP 503 with a tabletop-specific reason; it must not report full persistence readiness while Bingo rewards, Quackverse trades, command receipts, and the media outbox still use SQLite. The health payload also reports `tabletopStoreReady`, `tabletopStoreMode`, and `tabletopStoreRequired`. A regression test exercises this failure mode. This is a safety gate, not a completed tabletop migration.



### Tabletop and arcade-network persistence are coupled

The additional source audit confirms that `nebula_media_outbox` is created and owned by `SqliteNebulaNetwork`, not solely by tabletop. The Quackverse pack path inserts into that shared outbox inside the tabletop transaction, while the provider/media workers read and update it through `network.pending()`, `network.jobs()`, and `network.updateJob()`. Moving only the tabletop command writes to Turso would strand queued work in the wrong store or break atomicity.

The network store also owns player enrollment, excluded-game preferences, tenant blacklist, game settings, presence, and the media outbox. Its blacklist transaction reaches across Tag state, Tag channels, arcade memberships, game-runtime player memberships, and Quackverse tabletop seats. Those side effects must be migrated as a coordinated transaction boundary, not left as SQLite-only writes after a Turso cutover. The full-Turso readiness gate now separately reports and requires `networkStoreMode: "turso"` as well as tabletop. Both intentionally remain `sqlite` until their adapters and caller migrations are implemented and tested.
