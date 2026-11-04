# Production Storage Inventory — 2026-08-30

Status: read-only live inventory captured through the bounded Rotator inventory command. No production mutation was performed.

## Purpose

Record the minimum sanitized facts needed to design ApolloStation storage, recovery, cutover, and runtime placement without carrying forward stale Fly configuration assumptions.

## HearMeOut main (`hearmeout-main`)

- Runtime: 1 started Fly Machine in `iad`.
- Machine size: shared CPU, 1 vCPU, 1024 MB RAM.
- Persistent storage: 1 attached 10 GB volume mounted at `/data`.
- Snapshot retention reported by Fly: 5.
- Filesystem: about 1.89 GB used, about 8.00 GB free.
- `/data/app.db`: present, 2,383,872 bytes.
- `/data/app.db.bak`: present, same size.
- `/data/watch-state.json`: present, 72,681 bytes.
- `/data/watch-state.backup.json`: not present.
- `/data/watch-cache`: 2 files, 278,526,361 bytes.
- `/data/watch-hls`: 518 files, 1,608,724,113 bytes.
- `/data/music`: present and empty.
- SQLite quick check: `ok`.
- SQLite tables observed: 1 (`docs`).
- `docs` rows: 31.
- HTTP health: `ok`, production environment.

Interpretation: the old 3 GB storage assumption is stale. The dominant space use is generated/ephemeral HLS/cache material, not the application database.

## HearMeOut DJ worker (`hmo-dj-worker`)

- Runtime: 1 started Fly Machine in `iad`.
- Machine size: shared CPU, 4 vCPU, 4096 MB RAM.
- Fly volumes: 3 total, each 10 GB.
- Attached volume: one `data` volume mounted at `/data`.
- Unattached volumes: one additional `data` volume and one `dj_data` volume.
- Snapshot retention reported by Fly: 5 for all three volumes.
- Attached filesystem: about 2.22 GB used, about 7.68 GB free.
- `/data/music`: 4 files, 5,378,647 bytes.
- `/data/watch-hls`: 1,258 files, 2,210,155,122 bytes.
- `/data/watch-cache`: absent.
- `/data/youtube-cookies.txt`: present. Only presence/size was recorded; contents were not read or copied.
- HTTP health: `ok`; active DJs: 0 at capture time.

Interpretation: most attached-volume consumption is HLS output. The two unattached 10 GB volumes must be treated as unknown/recovery candidates until provenance is confirmed; do not delete them merely because they are unattached.

## SPMT core (`spmt-live`)

- Runtime: 3 Fly Machines in `lax`: 2 started, 1 stopped.
- The active data-bearing Machine is shared CPU, 1 vCPU, 1024 MB RAM and mounts `/data`.
- The other two Machines have no mounted persistent volume.
- Persistent storage: 1 attached 5 GB `spmt_data` volume.
- Snapshot retention reported by Fly: 5.
- Filesystem: about 1.29 GB used, about 3.71 GB free.
- `/data/spmt.db`: present, 915,935,232 bytes.
- WAL: present, 13,212,872 bytes.
- SHM: present, 32,768 bytes.
- SQLite quick check: `ok`.
- SQLite table count: 39.
- Selected counts captured read-only: users 562; messages 7; notifications 625,575.
- Health reports persistent-volume storage expected and ready, WAL mode, writable DB, and no degraded reasons.
- Health reported 18 users at capture time.
- OAuth client secrets: health reported 6/6 configured; secret values were not read.
- Discord identity lookup: configured.
- Twitch identity lookup: unavailable at capture time.
- Discord Stream Hub points dependency: configured.

Interpretation: SPMT's durable state is substantial and actively written. This database is a cutover-critical asset and should not be copied by casually snapshotting a live WAL database without an explicit consistency procedure.

## Immediate architecture consequences

1. Separate durable application state from generated media/cache. HearMeOut HLS/cache accounts for the overwhelming majority of its current volume use and should not dictate the permanent durable-database design.
2. Preserve SPMT's database as a first-class cutover asset with explicit backup, restore, WAL consistency, and rollback proof before ownership moves.
3. Do not delete the two unattached HMO worker volumes until their provenance/content is established or a documented recovery window expires.
4. Keep Fly volume snapshots/recovery available during migration even if Apollo ultimately moves runtime placement elsewhere.
5. Do not treat the current Fly Machine counts as the desired Apollo production topology. They are inventory facts, not architecture requirements.
6. Do not migrate `/data/youtube-cookies.txt` through source control or documentation. Re-establish any required credential through secrets/credential provisioning.

## Recommended next read-only work

- Identify whether the two unattached HMO volumes are stale replicas, prior generations, or deliberate recovery copies.
- Measure/write down which HearMeOut paths are durable source-of-truth versus reproducible HLS/cache.
- Verify SPMT backup/restore procedure against the currently active WAL database and record recovery point/recovery time expectations.
- Map these findings into Apollo runtime policies before any production storage mutation or data cutover.

No secrets, raw user records, OAuth tokens, cookies, message contents, notification contents, or credential values are included in this document.
