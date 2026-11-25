# Apollo Node 1 hybrid app snapshot

Base: 584eebbf66672418999599ea5fe7ed830011f8a9

Complete ApolloStation monorepo snapshot. All application source, shared packages, contracts, adapters, backend services, assets, and tests are retained. The node-specific baseline pins its deployment configuration to Node 1. The combined `main` manifest stays generic and receives the node role from the existing Hostless deployment workflow.

## Node 1 runtime set
- Apollo Bulletin / owner work-resumer
- SPMT authority and identity service
- Discord Stream Hub web surface and configured live worker
- SpaceMountain integrated web shell, proxying Nebula Arcade, StreamWeaver, and HearMeOut to Node 2

## Preserved source
StreamWeaver, Nebula Arcade, HearMeOut, Chat Gateway, Companion, Restream Control, and all other application source remain in this complete monorepo. No donor repositories, databases, volumes, secrets, or media are deleted.

## Runtime caveat
HearMeOut and Restream Control are not yet launched by the current supervised node launcher. They remain preserved source, not a claimed live service. Deployment uses `start-node1.mjs`.
