# Application Base Models

Snapshot date: **2026-08-21**

These are isolated rebuild bases copied from the live repository heads. The source tags remain unchanged. No application branch in GitHub and no Fly.io production app was changed during this pass.

## Outcome

| Base | Source commit | Clean-base commit | Files | Bytes | Gate |
| --- | --- | --- | ---: | ---: | --- |
| SpaceMountain | `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43` | `ede8a2ea0e52773a47e6d34b1aa4f8450ef17168` | 266 | 26,666,084 | Code-green |
| SPMT | `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc` | `7e836f46b2283a2224c8de8c1383c4cb0e8d6c5c` | 286 | 2,297,079 | Code-green |
| StreamWeaver | `32a2de5659ce360411dfdcf97eb0c6ed8c8eadad` | `31ac686e8cd8907a1e4d8ac110afe38be30c9ccb` | 1,384 | 116,764,730 | Code-green; rotation required |
| DiscordStreamHub | `e35a1b06479adf73565da9b3a7eff4dc27ebe38b` | `953f3a7dd504f8101e8fa7aeed253066a3037a25` | 459 | 4,660,062 | Code-green on Node 22; rotation required |
| HearMeOut | `686d237fbb5bfa56f2356dba9dfdb7c023d5ac23` | `43b72fcce676ce5654c5ca1f1338e9f0677267d9` | 334 | 3,688,490 | Code-green; rotation required |
| Chat Tag | `1d79f36c283f7b91cbda431eb7596108025e2e48` | `6b67baaa2a9639116f104c758cec968a09e0b6a2` | 317 | 14,961,507 | Code-green |
| Fly Machine Rotator | `66e66b8b8502a6cf1dd94aee0163c443459a6d08` | `184a07488d4250cce18c84e1c69dda4ffe64d8a7` | 175 | 4,723,432 | Code-green |

Across the seven active bases, tracked content fell from **409,334,244 bytes and 3,502 files** to **173,761,384 bytes and 3,221 files**: a reduction of **235,572,860 bytes (57.55%) and 281 files**. Build-applied runtime patches increased a few code files; the reduction is therefore net of the working code folded into the bases.

## What was removed

- Generated workspace databases and repository-within-repository ZIP archives.
- Duplicate StreamWeaver avatar bundles while retaining the referenced originals.
- Unreferenced SpaceMountain concept and promotional images while retaining the referenced live background.
- HearMeOut raw FBX/VRM conversion sources, extracted Blender add-on, demo videos, conversion utilities, abandoned provider shims, obsolete deployment material, and the tracked credential-bearing deployment file.
- Chat Tag's obsolete provider setup, migration scripts, repair scripts, legacy bot utilities, and superseded deployment guides.
- Completed or abandoned readiness reports, rollback notes, temporary snapshots, and road-to-production lists from the worker/bot repositories.

No removal was accepted solely because a file looked old. Runtime references, package scripts, tests, build staging, and source imports were checked first. Central product and architecture evidence that is still served by SpaceMountain/SPMT was retained until the blueprint debate decides its replacement path.

## Verification record

### Code-green

- **SpaceMountain:** TypeScript check, 30-check workspace smoke, shell UI contract, Rocket contract, DSH resilience contract, Vite frontend build, and bundled server build passed. The frontend still reports a large-chunk warning.
- **SPMT:** Repaired the three Commlink transformation contracts and aligned the ownership smoke assertion. TypeScript, server build, SDK compilation, SDK packaging, 132 startup/runtime contracts, and all 237 localhost smoke checks passed. The generated SDK package exactly matches both published SDK archives by SHA-256.
- **StreamWeaver:** Repaired plain-name tenant routing, authenticated Personal proxying, Signal build-patch ordering, and persistent private-message ingress ownership. Removed embedded Twitch/Kick credential fallbacks and all browser-public Twitch-secret fallbacks. All 299 isolation tests, persistence verification, project typecheck, and the optimized 234-route Next.js production build passed.
- **DiscordStreamHub:** Removed the diagnostic route that returned a Discord token prefix. Lockfile install on its declared Node 22 runtime, typecheck, 13 rerun security-adjacent contracts (37 selected contracts in the earlier full pass), and the Next.js production build passed. The build still emits non-fatal `/data` directory warnings outside Fly.
- **HearMeOut:** Removed the browser-public Twitch-secret fallback. Typecheck, 29 tests (4 selected contracts in the earlier pass), lint with zero errors (316 warnings), and the Next.js production build passed. The build reports a broad file-tracing warning.
- **Chat Tag:** Typecheck, lint with zero errors (5 warnings), 30 tests, and Next.js production build passed.
- **Fly Machine Rotator:** 50 test files / 237 tests, typecheck, and production TypeScript build passed.

## Security block

The source snapshots contained tracked provider credential material, including HearMeOut deployment configuration and StreamWeaver maintenance scripts. DiscordStreamHub also exposed a token prefix through a development diagnostic route. The clean bases remove those paths, but a new commit does not erase older Git history. Rotate all affected credentials before any clean-base deployment: LiveKit, Discord, Twitch, Kick, the retired Firebase service-account key, and the old Google/YouTube API key. Follow `OWNER_ACTIONS.md`. Never copy historical values into this repository, an issue, a log, or a replacement environment file.

## Local tags

- Code-green bases: `base-model-2026-08-21-code-green`
- Quarantined bases: `base-model-2026-08-21-quarantined`
- HearMeOut: `base-model-2026-08-21-security-blocked`
- Every source clone: `source-baseline-2026-08-21`

These tags and clean-base branches are intentionally local until separate clean GitHub repositories are available. Publishing them into the live application repositories would preserve isolation poorly and would create the clutter this rebuild is meant to eliminate.

## Next repair order

1. Recover owner GitHub access and complete the ecosystem credential rotation in `OWNER_ACTIONS.md`.
2. Replace self-modifying build patch chains with normal committed source and idempotent migrations.
3. Create clean GitHub repositories, import only a verified clean-base commit, and protect `main`.
4. Build the SPMT authority and recovery plane before layering workers, bots, and tenant-facing apps on top.
