# ApolloStation production and parity handoffs

## Start here

[Current Hostless continuation — 2026-11-04](APOLLO_HOSTLESS_CONTINUATION_2026-11-04.md)

Read the linked three-node/runtime/database plans. Main already contains the Hostless portability foundation and isolated Oracle Restream receiver. Preserve one canonical authority and Node 2's Chat Gateway/StreamWeaver/Nebula co-location. Durable external storage and measured free-account capacity remain release blockers. Fetch current `main` before resuming.

Historical media Oracle [41713920282](https://github.com/Mtman1987/ApolloStation/actions/runs/41713920282) is now inspected: **1,468 passed / 0 failed**, all four shards COMPLETE at **ebcf466**. This is not validation of later main changes or deployment. See the [media continuation](APOLLO_MEDIA_PROXY_CONTINUATION_2026-11-03.md).

## Earlier November 3 snapshot (historical)

[Repo-first continuation — 2026-11-03](APOLLO_PARITY_CONTINUATION_RUNABLE_2026-11-03.md)

- Private Xtream HLS authorization fix: PR #385, merged at `43df67a`.
- Full build/typecheck and 46 targeted tests passed locally on fetched remote source.
- Baseline Oracle report at `069c6dd`: 1,456 passed, zero failures; all four shards complete.
- Oracle run [41710521401](https://github.com/Mtman1987/ApolloStation/actions/runs/41710521401) later recorded 1,458 passes / 3 failures from stale HLS cache assertions. PR #386 repaired those assertions; the newer report above has zero findings.
- [Tested upload workflow repair patch](patches/parity-artifact-upload-20261103.patch) is preserved on `main`; applying the active workflow change still requires workflow-write permission.

## Earlier snapshots

- [November 3 follow-up](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md): nightly three-donor provenance and historical workflow blocker.
- [November 3 architecture handoff](APOLLO_PARITY_HANDOFF_2026-11-03.md): implementation paths and production boundaries.
- [October 25 parity handoff](APOLLO_PARITY_HANDOFF_2026-10-25.md): earlier scope and approved package order.

Older snapshots are evidence at their recorded SHAs, not current statuses.
Apps remain offline. Fixture/CI success is not live-provider acceptance or production readiness.
