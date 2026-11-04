# Hostless Runtime Service Inventory

Status: initial static inventory from ApolloStation `main`; confirm against runtime tests before deployment. This file records observed entrypoints and persistence assumptions, not a complete deployment manifest.

## Shared monorepo

- Root npm workspaces: `packages/*`, `apps/*`.
- Root build compiles the shared contracts, SDK, runtime, authority/auth/control/data packages and the principal apps.
- Hostless must build with repository root as build context because apps consume sibling workspace packages.
- The existing Sprite supervisor is a development/sandbox cohort launcher, not a production Hostless process manager.

## Node 1 — canonical authority and gateway

| Process | Current entrypoint | Current state |
|---|---|---|
| SPMT authority/API/output gateway | `apps/spmt-service/dist/provider-identity-start.js` | Requires `DATABASE_PATH`, 32-byte webhook key, and optional provider/service credentials. Uses SQLite authority adapter. |
| SpaceMountain integrated web gateway | `apps/spacemountain-web/dist/integrated-server.js` | Requires SPMT origin; currently accepts app origins through a proxy that explicitly restricts targets to loopback HTTP. |

Important: SPMT's service process can bind to `0.0.0.0` via `SPMT_HOST`, but its authority store is SQLite. The existing storage policy requires a single writable authority. A Hostless deploy without a durable database path is not safe.

## Node 2 — streaming and media

| Process | Current entrypoint | Current state |
|---|---|---|
| Chat Gateway | `apps/chat-gateway/dist/service-start.js` | Worker/service config includes a local SQLite database path and SPMT origin. |
| StreamWeaver web | `apps/streamweaver/dist/web-server.js` | Reads `SPMT_ORIGIN`, `PORT`, `HOST`, optional `STREAMWEAVER_DATABASE_PATH` and worker credential. |
| Discord Stream Hub web | `apps/discord-stream-hub/dist/web-server.js` | App-owned SQLite stores and runtime config; separate live worker entrypoint. |
| Discord Stream Hub worker | `apps/discord-stream-hub/dist/live-worker-start.js` | Validates worker environment, runs live, suite, calendar, and Nebula media loops. |

The supervisor currently passes local SPMT and local app URLs. Those must become explicit remote HTTPS origins with service authentication. App-owned state must be classified individually; it cannot be left on ephemeral filesystem if it is authoritative.

## Node 3 — games and community

| Process | Current entrypoint | Current state |
|---|---|---|
| Nebula Arcade live server | `apps/nebula-arcade/dist/nebula-arcade-live-server.js` | Uses SPMT session/service-token APIs, but local SQLite network and Mosaic stores; requires tenant/channel, public origin, and service credential. |
| Lounge / OverlayBay / Restream | To be mapped from actual package and runtime entrypoints | Do not claim parity or assign workloads until exact code and state ownership are inventoried. |

## Cross-node incompatibilities confirmed

1. The Sprite supervisor assumes one host and wires most services through loopback origins.
2. The SpaceMountain integrated gateway's `proxyDirect` helper rejects any target except loopback HTTP. It cannot currently proxy Node 2/3 services over HTTPS.
3. SPMT authority and multiple app-owned stores use SQLite. Hostless temporary app disk is not a durable store; persistent volumes are separately priced.
4. Nebula's live server currently opens local SQLite stores directly, so it is not stateless simply because player identity comes from SPMT.
5. HearMeOut execution worker defaults to `fly` unless explicitly configured; it is not part of the first deployment slice and must never silently target Fly during Hostless work.

## Implementation order

1. Keep the existing local/Sprite supervisor intact.
2. Add a Hostless role entrypoint for the canonical authority only after a durable zero-cost data strategy is proven.
3. Refactor and test the SpaceMountain gateway to proxy only explicitly configured HTTPS service origins (retaining loopback HTTP for local development); strip hop-by-hop headers and preserve browser auth/cookies safely.
4. Add explicit Node 2 and Node 3 process entrypoints with no implicit localhost defaults.
5. Replace or externally centralize each app-owned SQLite store before moving that app to an ephemeral Hostless app filesystem.
6. Run all cross-node tests and restore drills before a deployment or traffic cutover.
