# Apollo Node 2 hybrid app snapshot

Base: 584eebbf66672418999599ea5fe7ed830011f8a9

Complete ApolloStation monorepo snapshot. All application source, shared packages, contracts, adapters, backend services, assets, and tests are retained. The deployment configuration is pinned to Node 2.

## Node 2 runtime set
- Chat Gateway supervised provider/event worker
- StreamWeaver web/service runtime
- Nebula Arcade live server when its existing runtime config and credentials are present
- Stellar hosted worker when its existing credential and provider configuration are present
- Node 2 ingress

## Preserved source
HearMeOut, Discord Stream Hub, SpaceMountain, Companion, Restream Control, and all other application source remain in this complete monorepo. No donor repositories, databases, volumes, secrets, or media are deleted.

## Runtime caveat
HearMeOut web/voice worker and Restream Control are not yet launched by the current supervised node launcher. Their source remains preserved and must be wired with existing runtime configuration, persistent storage, and browser/media resource limits before claiming full runtime parity. Deployment uses `start-node2.mjs`.
