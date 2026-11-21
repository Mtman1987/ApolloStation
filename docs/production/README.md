# Production and release documentation

This directory contains only maintained operational references. Dated execution reports and issue-specific handoffs are historical evidence and are preserved in the repository quarantine archive.

## Current operating sources

- [Final Apollo pause handoff](APOLLO_FINAL_HANDOFF_2026-11-19.md) — latest environment walkthrough, verified changes, explicit unknowns, and ordered resume checklist. This is a handoff snapshot, not production certification.

- [Current Apollo state](../CURRENT_STATE.md) — verified implementation, two-node deployment status, owner sign-in, persistence boundaries, and acceptance gaps.
- [Production path](../PRODUCTION_PATH.md) — risk-ordered release, recovery, and cutover policy.
- [Production rollout manifest](../../config/production-rollout.v1.json) — machine-checked rollout state.
- [Hostless release workflow](../../.github/workflows/hostless-three-node-deploy.yml) — historical filename; current matrix is Node 1 and Node 2.
- [Development tooling index](../development/README.md) — canonical validation, migration, and operator commands.

## Maintained technical references

- [Stella AI provider chain](AI_PROVIDER_CHAIN.md) — provider selection and failover behavior; verify current model/secret configuration before relying on any provider.
- [StreamWeaver local Kokoro TTS snapshot](STREAMWEAVER_LOCAL_KOKORO_TTS_2026-11-04.md) — retained implementation evidence pending consolidation into the StreamWeaver application README.

## Historical records

Older handoffs, provider canaries, data inventories, cutover snapshots, issue-specific test reports, branch inventories, and one-off patches have been moved to [the repository quarantine archive](../../mt-delete-me-archive/MANIFEST.md). They are not current deployment instructions.
