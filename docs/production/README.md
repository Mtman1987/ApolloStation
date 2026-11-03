# ApolloStation production and parity handoffs

## Start here

[Current repo-first continuation — 2026-11-03](APOLLO_PARITY_CONTINUATION_RUNABLE_2026-11-03.md)

This records merged work, exact validation evidence, permission blockers and the next approved steps. Fetch current `main` before resuming.

- Private Xtream HLS authorization fix: PR #385, merged at `43df67a`.
- Full build/typecheck and 46 targeted tests passed locally on fetched remote source.
- Baseline Oracle report at `069c6dd`: 1,456 passed, zero failures; all four shards complete.
- Post-code-merge Oracle run [41710521401](https://github.com/Mtman1987/ApolloStation/actions/runs/41710521401) was rechecked and remains in progress. Its findings are not verified.
- [Tested upload workflow repair patch](patches/parity-artifact-upload-20261103.patch) is preserved on `main`; applying the active workflow change still requires workflow-write permission.

## Earlier snapshots

- [November 3 follow-up](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md): nightly three-donor provenance and historical workflow blocker.
- [November 3 architecture handoff](APOLLO_PARITY_HANDOFF_2026-11-03.md): implementation paths and production boundaries.
- [October 25 parity handoff](APOLLO_PARITY_HANDOFF_2026-10-25.md): earlier scope and approved package order.

Older snapshots are evidence at their recorded SHAs, not current statuses.
Apps remain offline. Fixture/CI success is not live-provider acceptance or production readiness.
