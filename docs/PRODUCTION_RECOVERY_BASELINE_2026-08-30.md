# Production Recovery Baseline — 2026-08-30

Status: evidence record for the Apollo production migration. This file records sanitized facts only. It is not authorization to mutate Blue production beyond an explicitly approved bounded operation.

## Purpose

Establish what recovery protection exists before any production cutover and define which recovery mechanism should be authoritative for migration.

The baseline uses two distinct layers:

1. **Application-consistent recovery point** — Apollo's SQLite online-backup and recovery-core pipeline is the preferred cutover artifact for SQLite authorities. It performs a SQLite backup, integrity/inventory verification, encryption, digest verification, and restore validation.
2. **Infrastructure rollback safety net** — Fly volume snapshots protect the surrounding volume and are valuable for disaster rollback, but an automatic filesystem/volume snapshot is not treated as proof of an application-consistent migration image by itself.

The initial inventory phase did not create snapshots, volumes, restores, Machine mutations, DNS changes, or traffic changes. A later owner-approved HearMeOut recovery/import rehearsal is recorded separately below.

## SPMT authority (`spmt-live`)

Live data-bearing Machine:
- Machine: `8d0274ce21e918`
- region: `lax`
- `/data` volume: `vol_vde2p30e6xo8d0k4`
- Fly volume capacity: 5 GB
- snapshot retention: 5

Live authority evidence from the corrected data-bearing-Machine probe at 2026-08-30T17:29:18Z:
- `/data/spmt.db`: 915,935,232 bytes
- `/data/spmt.db-wal`: 13,212,872 bytes
- `/data/spmt.db-shm`: 32,768 bytes
- SQLite `quick_check`: `ok`
- 39 application tables
- selected row counts: 563 users, 7 messages, 625,577 notifications
- health reports WAL journal mode and persistent writable storage

Automatic Fly snapshots present at capture:
- 2026-08-25T18:10:19Z
- 2026-08-26T18:11:19Z
- 2026-08-27T18:12:19Z
- 2026-08-28T18:12:49Z
- 2026-08-29T18:13:49Z

Decision:
- Preserve the automatic Fly snapshots as infrastructure rollback coverage.
- Do **not** use a raw copy of `spmt.db` while Blue is writing.
- Before SPMT authority movement, create and verify an application-consistent recovery point through Apollo's recovery pipeline or an equivalent SQLite online-backup operation.
- Restore that artifact into an isolated Green authority and verify integrity plus expected inventory before Green is permitted to write.
- Blue remains the writer until the single-writer handoff gate.

## HearMeOut main (`hearmeout-main`)

Live Machine:
- Machine: `d8d17d6c7e5068`
- region: `iad`
- `/data` volume: `vol_vlypz052m7d3x1d4`
- Fly volume capacity: 10 GB
- snapshot retention: 5

Durable/private state:
- `/data/app.db`: 2,383,872 bytes
- `/data/app.db.bak`: 2,383,872 bytes
- `/data/watch-state.json`: 72,681 bytes
- SQLite integrity: `ok`
- Blue DB schema: one Firestore-like `docs` table; 31 rows at capture

Sanitized Blue collection inventory at 2026-08-30T17:33:19Z:
- `config`: 1 row
- `rooms`: 1 row
- `rooms/discord-activity/users`: 1 row
- `users`: 28 rows

Classification:
- `users` is **not** HearMeOut private authority in Apollo. SPMT is the canonical identity authority. These 28 Blue rows are reconciliation evidence only and must not be copied into the Green HearMeOut database.
- `rooms` contains the single canonical `discord-activity` room. Green uses its normalized room contract and a deterministic transform rather than adopting the Blue document-store schema.
- `rooms/discord-activity/users` is runtime membership/presence-shaped data. Presence is rebuilt on Green. Any membership fact worth retaining must be resolved through SPMT identity before insertion; a raw nested Blue user document is not a migration primitive.
- `config` is retired legacy state: the current Blue runtime has no identified consumer of this collection, active service credentials come from the approved environment/secret path, and the migration bundle excludes the config body from active Green state. The original row remains recoverable from the preserved Blue recovery point.

Disposable/rebuildable state:
- `/data/watch-cache`: 278,526,361 bytes / 2 files
- `/data/watch-hls`: 1,608,724,113 bytes / 518 files
- `/data/music`: empty at capture

Automatic Fly snapshots present at the initial capture:
- 2026-08-25T19:16:01Z
- 2026-08-26T19:16:56Z
- 2026-08-27T19:16:56Z
- 2026-08-28T19:17:27Z
- 2026-08-29T19:18:26Z

Decision:
- Do not migrate the 10 GB volume wholesale.
- Preserve Blue and its Fly snapshots until post-cutover acceptance.
- Migrate only durable product state.
- HLS and replaceable cache are not migration inputs.
- The Blue `docs` database cannot simply replace the Apollo database because Apollo HearMeOut uses a normalized WAL SQLite authority (`hmo_rooms`, membership/access/invitations/admissions/presence/media sessions/operations). Migration therefore requires an explicit transform/import.
- Presence is runtime/ephemeral state and should normally be rebuilt rather than carried into Green.
- The importer rejects unknown Blue collections and noncanonical rooms instead of silently copying or discarding them.

### Owner-approved real-data recovery/import rehearsal — PASS

At 2026-08-30T18:12Z the owner-approved bounded HearMeOut rehearsal completed successfully while Blue remained the authoritative live runtime.

Infrastructure recovery point:
- source volume: `vol_vlypz052m7d3x1d4`
- snapshot: `vs_n05bl0aoMQ5tg4gQp9Yz14`
- snapshot status: `created`
- snapshot created: 2026-08-30T18:06:42Z
- stored snapshot bytes reported by Fly: 30,739,736

Application-consistent recovery point retained on Blue:
- path: `/data/recovery/apollo-hmo-2026-08-30T18-12-42-898Z.db`
- bytes: 2,383,872
- SHA-256: `f3f72be37b39be2d72695c2daa9883649ce2ed403eebdbef0c18bdf0d3da7d42`
- SQLite integrity: `ok`
- existing `/data/app.db.bak` preserved: yes
- backup bytes: 2,383,872
- backup SHA-256: `b8eb91e12f937ddb900e231594c1e8a502090d043a4f9a5a099e1d7eb149df6c`

Source classification reverified from the recovery copy:
- total documents: 31
- `config`: 1
- `rooms`: 1
- `rooms/discord-activity/users`: 1
- `users`: 28

Migration-bundle verification:
- bundle source SHA-256 exactly matched the application recovery point SHA-256
- 28 Blue user documents were classified for SPMT reconciliation, not copied into HMO authority
- 1 presence document was classified to rebuild
- 1 legacy config document was retained as recovery evidence and excluded from active Green state
- no unknown collection was observed

Isolated Green apply/reopen proof using the real copied Blue data:
- canonical Discord Activity room present after reopen
- 7 queued media items imported; expected count was 7
- playback state after import: `paused`
- voice-bridge desired configuration preserved
- voice bridge after import: `disabled`
- explicit handoff/start still required before any live effect
- temporary runner copy and temporary Green SQLite files were deleted when the rehearsal exited

Safety result:
- Blue remained authoritative throughout
- no provider traffic changed
- no DNS changed
- no Discord voice bridge was started on Green
- no DJ/media worker was started on Green
- no HLS/cache/media directory was copied into Green

This proves the real Blue database can be classified, transformed, written into isolated normalized Green stores, closed, reopened, and integrity-checked without activating Green. It does **not** authorize or prove the live canary handoff.

## HearMeOut DJ worker (`hmo-dj-worker`)

Live Machine:
- Machine: `85e204f4442908`
- region: `iad`
- 4 shared CPUs / 4 GB RAM

Volumes discovered:
1. `vol_rkgne6q1ooml5524` — `data`, 10 GB, attached
2. `vol_vlyw1nmy2w7pk3o4` — `data`, 10 GB, unattached
3. `vol_4ojp7nl276l6ke2r` — `dj_data`, 10 GB, unattached

Attached volume content at capture:
- `/data/watch-hls`: 2,210,155,122 bytes / 1,258 files
- `/data/music`: 5,378,647 bytes / 4 files
- YouTube cookie file exists; its content was not read or exposed.
- worker health OK; active DJs: 0 at capture

Snapshot history:
- attached `vol_rkgne6q1ooml5524`: 5 daily snapshots through 2026-08-30T02:26:41Z
- unattached `vol_vlyw1nmy2w7pk3o4`: 0 snapshots
- unattached `vol_4ojp7nl276l6ke2r`: 5 daily snapshots through 2026-08-30T16:31:23Z

Decision:
- The attached worker volume is predominantly disposable HLS output and must not define Green storage sizing.
- Keep both unattached volumes protected until provenance is established. Their snapshot histories differ, so they are not assumed to be interchangeable replicas.
- Do not migrate YouTube cookies as ordinary files. Credentials belong in the approved secret/configuration path.
- Green media workers should receive bounded scratch/cache capacity and recreate media output on demand.

## Recovery architecture retained from Apollo

Apollo already implements the primitives needed for the application-consistent layer:

- `packages/authority-sqlite/src/recovery.ts`
  - SQLite online backup using Node's SQLite backup API
  - source and snapshot integrity checks
  - authority epoch / journal sequence / inventory verification
- `packages/recovery-core/src/index.ts`
  - AES-256-GCM encrypted recovery points
  - SHA-256 plaintext/ciphertext integrity
  - atomic write/materialize flow
  - tamper rejection
- `packages/app-foundation/src/index.ts`
  - app-private SQLite with WAL, FULL synchronous mode, migrations and integrity checks
  - explicit WAL checkpoint support

The production design should operationalize these existing primitives instead of creating a parallel recovery format merely to satisfy an older `spmt-vault` topology idea.

## Remaining gates before a live HearMeOut handoff

The real-data rehearsal has now satisfied these prerequisites for HearMeOut:
- exact Blue authority and source volume identified;
- dataset classified into HMO-private durable state, SPMT reconciliation state, retired legacy state, and rebuildable state;
- deterministic transform tested offline and against a fresh real production copy;
- fresh infrastructure snapshot verified;
- application-consistent recovery point created, hashed, retained and integrity-checked;
- transformed state restored into isolated Green SQLite stores and reverified after reopen;
- Green live effects stayed disabled during the proof.

A live HearMeOut canary/handoff is still blocked until all of these are explicitly prepared and approved:
- the actual Green deployment/storage destination is identified and independently recoverable;
- Green runtime health and lifecycle behavior are proven in the integrated sandbox/runtime topology;
- the exact test tenant/cohort is selected;
- single-owner fencing prevents Blue and Green from emitting to the same Discord/provider surface at once;
- rollback steps are executable without dual writers;
- live-provider activation order is defined with Green initially inert;
- owner approval is recorded immediately before the first live canary/provider handoff.
