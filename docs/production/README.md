# Production and release documentation

This folder contains current handoffs and operational evidence references. Dated snapshots are not automatically current; always compare them with the active branch, deployment workflow, and versioned configuration.

## Current handoffs

- [Apollo handoff — 2026-11-19](APOLLO_HANDOFF_2026-11-19.md) — owner-first status, XP import evidence, shell app-frame diagnosis, and remaining operational work.
- [Apollo sign-in handoff — 2026-11-19](APOLLO_AUTH_HANDOFF_2026-11-19.md) — SPMT bridge/PKCE sign-in implementation and owner acceptance boundary.
- [Production readiness cleanup — 2026-09-06](READINESS_CLEANUP_2026-09-06.md) — historical branch-consolidation and hygiene record; not current deployment status.

## App-specific production references

- [HearMeOut live inventory](HEARMEOUT_LIVE_INVENTORY.md)
- [HearMeOut provider canary evidence](HEARMEOUT_PROVIDER_CANARY_2026-08-30.md)
- [SPMT live inventory](SPMT_LIVE_INVENTORY.md)
- [StreamWeaver local Kokoro TTS snapshot](STREAMWEAVER_LOCAL_KOKORO_TTS_2026-11-04.md)
- [HearMeOut / Discord Stream Hub parity implementation snapshot](HMO_DSH_PARITY_IMPLEMENTATION_2026-09-13.md)
- [HearMeOut single-video test snapshot](HMO_SINGLE_VIDEO_TEST_2026-09-14.md)
- [HearMeOut authority snapshot](HEARMEOUT_AUTHORITY_2026-09-23.md)

## Current sources of truth

- [Current repository state](../CURRENT_STATE.md)
- [Production path and cutover policy](../PRODUCTION_PATH.md)
- [Production rollout manifest](../../config/production-rollout.v1.json)
- [Canonical two-node Hostless release workflow](../../.github/workflows/hostless-three-node-deploy.yml) — historical filename; currently targets Node 1 and Node 2.

Superseded parity/continuation handoffs, the former three-node continuation, and the obsolete Oracle cutover proposal have been moved to the repository-root quarantine folder. See [the archive manifest](../../mt-delete-me-archive/MANIFEST.md).
