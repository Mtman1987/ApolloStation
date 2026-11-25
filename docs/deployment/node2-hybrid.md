# Apollo Node 2 hybrid app snapshot

Base: 584eebbf66672418999599ea5fe7ed830011f8a9

Complete ApolloStation monorepo snapshot. All application source, shared packages, contracts, adapters, backend services, assets, and tests are retained. The deployment configuration is pinned to Node 2.

## Node 2 runtime set
- Chat Gateway supervised provider/event worker
- StreamWeaver web/service runtime
- Nebula Arcade live server when its existing runtime config and credentials are present
- Stellar hosted worker when its existing credential and provider configuration are present
- HearMeOut room/voice web authority when its existing persistent database path is configured
- Node 2 ingress, including HearMeOut HTTP and RTC WebSocket forwarding

## Preserved source
HearMeOut, Discord Stream Hub, SpaceMountain, Companion, Restream Control, and all other application source remain in this complete monorepo. No donor repositories, databases, volumes, secrets, or media are deleted.

## Runtime caveat
HearMeOut's web authority is conditionally launched only when both `HEARMEOUT_ROOM_DATABASE_PATH` and the Node 1 `SPMT_ORIGIN` are supplied; the legacy Discord voice/media worker still requires its own worker deployment and authenticated origin. Restream Control remains a separate isolated service because it requires a mounted persistent browser profile, TLS files, and its dedicated existing credential. The Playwright migration is complete in source, but neither worker is claimed live until its runtime prerequisites and acceptance checks pass. Deployment uses `start-node2.mjs`.
