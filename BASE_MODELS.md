# Application Base Models

Snapshot date: **2026-08-21**

These are isolated rebuild bases copied from the live repository heads. The source tags remain unchanged. No application branch in GitHub and no Fly.io production app was changed during this pass.

## Outcome

| Base | Source commit | Clean-base commit | Files | Bytes | Gate |
| --- | --- | --- | ---: | ---: | --- |
| SpaceMountain | `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43` | `ede8a2ea0e52773a47e6d34b1aa4f8450ef17168` | 266 | 26,666,084 | Code-green |
| SPMT | `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc` | `c1f94191da55d1c4eae5acdbc16297efc46074d0` | 286 | 2,297,084 | Code-green |
| StreamWeaver | `32a2de5659ce360411dfdcf97eb0c6ed8c8eadad` | `b78af81894be9b08608332879922e2c98e3988e2` | 1,384 | 116,764,649 | Code-green |
| DiscordStreamHub | `e35a1b06479adf73565da9b3a7eff4dc27ebe38b` | `c3acb9ba0585735355fb707dd09e14d3ea44712a` | 460 | 4,660,891 | Code-green on Node 22 |
| HearMeOut | `686d237fbb5bfa56f2356dba9dfdb7c023d5ac23` | `96992f8a1ab561f50fea0d6a3b5f26fce8630400` | 334 | 3,688,538 | Code-green; security-blocked |
| Chat Tag | `1d79f36c283f7b91cbda431eb7596108025e2e48` | `6b67baaa2a9639116f104c758cec968a09e0b6a2` | 317 | 14,961,507 | Code-green |
| Fly Machine Rotator | `66e66b8b8502a6cf1dd94aee0163c443459a6d08` | `184a07488d4250cce18c84e1c69dda4ffe64d8a7` | 175 | 4,723,432 | Code-green |

Across the seven active bases, tracked content fell from **409,334,244 bytes and 3,502 files** to **173,762,185 bytes and 3,222 files**: a reduction of **235,572,059 bytes (57.55%) and 280 files**. Build-applied runtime patches increased a few code files; the reduction is therefore net of the working code folded into the bases.

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
- **SPMT:** Repaired the three Commlink transformation contracts. TypeScript, server build, SDK compilation, and 132 startup/runtime contracts passed. The environment blocked the localhost smoke harness and SDK packaging command, so those two packaging checks remain to be rerun in an unrestricted local runner before deployment.
- **StreamWeaver:** Repaired plain-name tenant routing, authenticated Personal proxying, Signal build-patch ordering, and persistent private-message ingress ownership. All 299 isolation tests, persistence verification, project typecheck, and the optimized 234-route Next.js production build passed.
- **DiscordStreamHub:** Lockfile install on its declared Node 22 runtime, typecheck, 37 selected contract tests, and Next.js production build passed.
- **HearMeOut:** Typecheck, lint with zero errors (316 warnings), 4 selected contract tests, and Next.js production build passed. The build reports a broad file-tracing warning.
- **Chat Tag:** Typecheck, lint with zero errors (5 warnings), 30 tests, and Next.js production build passed.
- **Fly Machine Rotator:** 50 test files / 237 tests, typecheck, and production TypeScript build passed.

## Security block

The HearMeOut source snapshot contained tracked provider credential material. The clean base removes the file and moves browser-visible YouTube configuration into an environment variable, but a new commit does not erase older Git history. Rotate all affected credentials before deployment. Never copy the historical values into this repository, an issue, a log, or a replacement environment file.

## Local tags

- Code-green bases: `base-model-2026-08-21-code-green`
- Quarantined bases: `base-model-2026-08-21-quarantined`
- HearMeOut: `base-model-2026-08-21-security-blocked`
- Every source clone: `source-baseline-2026-08-21`

These tags and clean-base branches are intentionally local until separate clean GitHub repositories are available. Publishing them into the live application repositories would preserve isolation poorly and would create the clutter this rebuild is meant to eliminate.

## Next repair order

1. Rotate the HearMeOut credentials and record rotation evidence without recording secret values.
2. Rerun SPMT's localhost smoke harness and SDK packaging check in an unrestricted local runner.
3. Replace self-modifying build patch chains with normal committed source and idempotent migrations.
4. Create clean GitHub repositories, import only a verified clean-base commit, and protect `main`.
5. Build the SPMT authority and recovery plane before layering workers, bots, and tenant-facing apps on top.