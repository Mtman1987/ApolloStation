# Temporary Clean Ecosystem Monorepo

Status: **staging only — no production deployment authorized**

This branch temporarily keeps the cleaned application bases beside the rebuild blueprint while the owner recovers normal GitHub access. It gives the rebuild one inspectable workspace without changing, deleting, or force-pushing any live repository.

## Safety boundary

- Production repositories and their default branches remain untouched.
- No Fly.io application, machine, volume, secret, route, or database is changed from this branch.
- Only files tracked by each clean base commit are imported. Nested `.git` directories, untracked files, local caches, and the quarantined broken Chat Tag recovery copy are excluded.
- The application folders are temporary. After GitHub access is restored, each approved app can move into its own clean repository while preserving this manifest as provenance.
- Secrets must remain in environment/Fly secret storage. Public runtime configuration belongs in approved configuration storage; application state belongs in its authoritative database.

## Imported bases

| Folder | Source commit | Files | Tracked bytes |
|---|---|---:|---:|
| `apps/spmt-live` | `deaf26ec3a696072caccbf2e21e492912e533c39` | 290 | 2,326,238 |
| `apps/spacemountain-live` | `498cb7fc6e79dcd73c5da32940a5b9f43b016de2` | 266 | 26,672,385 |
| `apps/streamweaver` | `31ac686e8cd8907a1e4d8ac110afe38be30c9ccb` | 1,384 | 116,764,730 |
| `apps/DiscordStreamHub` | `953f3a7dd504f8101e8fa7aeed253066a3037a25` | 459 | 4,660,062 |
| `apps/hearmeout-main` | `43b72fcce676ce5654c5ca1f1338e9f0677267d9` | 334 | 3,688,490 |
| `apps/chat-tag` | `6b67baaa2a9639116f104c758cec968a09e0b6a2` | 317 | 14,961,507 |
| `apps/fly-machine-rotator` | `184a07488d4250cce18c84e1c69dda4ffe64d8a7` | 175 | 4,723,432 |
| **Total** |  | **3,225** | **173,796,844** |

## Working rule

Cleanup work happens app by app, behind tests and explicit acceptance gates. Shared contracts are written in the blueprint first. A change is not promoted merely because it builds; it must have a named owner, observable health signal, rollback path, and evidence that it does not reintroduce retired architecture such as Firebase.

## Intended extraction after account recovery

1. Review and approve the blueprint decisions.
2. Create one destination repository per approved deployable app or service.
3. Export the corresponding `apps/<name>` tree, preserving this source commit record.
4. Configure protected default branches and required checks.
5. Migrate credentials through the approved secret path; never copy secrets from historical files.
6. Deploy beside production, verify tenant data and routes, then cut over using the rollback gates in `OPERATIONS.md`.
7. Archive this temporary branch only after every extracted repository is independently reproducible.
