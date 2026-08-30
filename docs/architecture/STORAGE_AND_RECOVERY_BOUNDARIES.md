# Storage and Recovery Boundaries

Status: architecture rule derived from the 2026-08-30 read-only production inventory. This document defines migration and runtime ownership boundaries; it does not authorize production mutation.

## Principle

Apollo must separate durable source-of-truth state from reproducible runtime artifacts. Persistent volume size alone must never determine whether data is treated as durable.

## SPMT authority

SPMT durable state includes the primary SQLite database and its consistency state. The live service currently uses WAL mode, so `spmt.db`, `spmt.db-wal`, and `spmt.db-shm` must be treated as one active database state for cutover planning.

Rules:

- `spmt-authority` remains an anchored core workload with at least one authoritative instance.
- Only one writable authority may own a given production database at a time.
- No Blue/Green migration may expose two writable SPMT authorities against divergent copies.
- Backup/copy procedures must use a SQLite-consistent mechanism or a proven quiesce/checkpoint procedure; copying only `spmt.db` while writes continue is not an accepted production backup method.
- Cutover requires a restore drill and rollback proof before ownership moves.
- Fly volume snapshots may remain a recovery layer during migration, but snapshots are not a substitute for application-level consistency proof.
- Database contents, OAuth secrets, recovery codes, provider grants, and user records must never enter source control or diagnostic artifacts.

## HearMeOut durable state

Durable HearMeOut state is small relative to current media volume use.

Treat as durable/source-of-truth unless a later app-level audit proves otherwise:

- application database (`/data/app.db` in the current live runtime),
- intentional database backup copy,
- watch/session state that cannot be reconstructed from authoritative services,
- user-owned metadata/configuration,
- any persisted room or playlist state required across restarts.

Rules:

- Durable HMO state must have explicit backup/restore ownership independent of HLS/cache lifecycle.
- A worker may be destroyed/recreated without losing durable user state.
- Worker scale-out must not create multiple unsynchronized writable copies of the same durable state.

## HearMeOut reproducible/ephemeral state

The following current live paths are runtime artifacts and must not be treated as migration-critical merely because they consume persistent-volume space:

- `/data/watch-hls`,
- `/data/watch-cache`,
- equivalent generated segments, transcoding scratch, temporary downloads, and caches.

Rules:

- HLS/cache data may live on ephemeral Machine-local storage or bounded disposable worker storage when the workload permits it.
- It must have an eviction policy and size/time bounds.
- It must never be required for database recovery.
- Migration may discard it if active sessions are drained first.
- Capacity planning for durable storage must exclude reproducible HLS/cache bytes.

## HearMeOut media and credentials

Downloaded/user-owned media must be classified separately from generated HLS/cache. Do not assume `/data/music` is disposable merely because it is currently small.

Credential files such as the current YouTube cookies file are secrets/credentials, not application data:

- never commit them,
- never copy their contents into inventory/report artifacts,
- reprovision them through the approved secret/credential path,
- rotate them when migration changes the trust boundary if appropriate.

## Unattached Fly volumes

An unattached volume is not automatically unused.

Before deletion, each unattached volume must be classified as one of:

1. active recovery copy,
2. prior deployment generation with still-useful rollback data,
3. deliberate spare/replica,
4. stale orphan safe to remove.

Deletion requires provenance or a documented retention window plus a verified newer recovery point. Current HMO worker inventory contains two unattached 10 GB volumes; they remain protected until classified.

## Runtime policy relationship

Compute and storage lifecycles are separate:

- `hmo-media-workers` and `hmo-room-workers` may remain 0..N elastic workloads.
- Their destruction must not destroy authoritative user/application state.
- `spmt-authority` remains anchored even while stateless/product API capacity scales separately.
- Apollo's Rotator may manage Machine lifecycle, but application code never receives broad Fly credentials and may not delete recovery storage implicitly as part of worker scale-down.

## Production cutover gate

Storage ownership cannot move from Blue to Green until all applicable items are proven:

- source-of-truth paths identified,
- SQLite integrity check passes,
- consistency-aware backup completed,
- restore completed into an isolated target,
- restored data validated at application level,
- ephemeral media/cache explicitly excluded or deliberately drained,
- secrets reprovisioned through secret management rather than copied as files,
- rollback target retained and documented,
- single-writer ownership transition documented,
- owner acceptance recorded.

Until then, Blue/live remains authoritative.
