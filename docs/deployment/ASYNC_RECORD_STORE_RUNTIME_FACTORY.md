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
