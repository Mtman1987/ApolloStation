# Recovered Fly Volume Data Inventory

Status: read-only inventory of the two recovered Library archives inspected on 2026-11-04. No source archive was modified. No data was uploaded to Turso or written into an Apollo database.

## Source archives

| Archive | Captured | Compressed size | Evidence |
|---|---:|---:|---|
| `recovered-user-data-verified-bundle.zip` | 2026-10-24 UTC | 117,173,406 bytes | README says recovery run `40070315949`; all 9 nested tarballs passed tar integrity validation and have SHA-256 receipts |
| `recovered-user-data-run-40072383161-supplement.zip` | 2026-10-24 UTC | 132,750,871 bytes | Supplementary recovery-run logs and archives; individual report records say `archive_created_integrity_checked` |

These are targeted file archives, not complete machine images or source-code backups. The verified bundle README says selected file types were collected from `/data`, `/app/data`, `/var/lib`, and `/home/node/.config`; cache, media, and `node_modules` directories were excluded.

## Confirmed application data

### Chat Tag / Nebula source

Archive: `chat-tag-new-d892e7ec137ed8.tar.gz`

- `data/app-state.json`: 155 `tagPlayers`, 682 `tagHistory` entries, 4,453 `chatTags` entries, 39 user records, 551 admin-history entries, 36 overlay-message profiles.
- `data/app-state.gameSettings.json`: game hub settings, overlays, and check-in award settings.
- `data/app-state.quackverse.json`: legacy Quackverse state and 42 player collection entries.
- `data/app-state.quackverseRooms.json`: 17 room states.
- Additional files include Quackverse pack-open history (772 entries), room state, game settings, and overlay/Discord message shards.
- This archive contains JSON state files, not a SQLite database. It needs a format-aware importer; the SQLite-to-Turso adapter alone cannot import it.
- The donor's legacy state is a shared/global Chat Tag snapshot with events carrying `streamerId`. Do not split it into tenant databases based only on the last stream seen; tenant ownership needs an explicit reconciliation rule.

### StreamWeaver

Archive: `streamweaver-new-080e967ea95558.tar.gz`

- 5,908 regular files (the recovery report records 5,909 entries including directory entries).
- 57 runtime tenant directories.
- 942 tenant data JSON files and 539 tenant config JSON files.
- 51 `chat-tag-checkins` receipt JSON files across 21 tenant directories.
- Also includes action/command definitions, global runtime data, tenant configs, tokens/configuration artifacts, and StreamWeaver runtime files.
- Treat tenant files as tenant-scoped state. Do not flatten or merge tenants. Secret-bearing token/config files require redaction and secure handling; never print their values or commit them.

### Discord Stream Hub

Archive: `discord-stream-hub-new-d895de5b227d28.tar.gz`

- `data/app.db`: 202,891,264 bytes. Read-only SQLite `PRAGMA quick_check` returned `ok`.
- Tables: `docs` (265,451 rows), `documents` (2 rows), `operation_leases` (1 row).
- Also includes a Firestore JSON export with 47 document records, runtime config, embeds, and clip metadata.
- Preserve the SQLite DB and Firestore export as distinct sources until their overlap and authority are mapped.

### SpaceMountain / OverlayBay / Lounge-adjacent data

The verified archive `spacemountain-live-8953d6a6dd5058.tar.gz` contains only one file. The supplemental recovery archive for the same machine contains a broader capture:

- `data/database.db`: 10,289,152 bytes. Read-only SQLite `PRAGMA quick_check` returned `ok`.
- Tables: `community_shoutouts` (160 rows), `community_tools` (8), `forwarded_forum_posts` (17,035), `internal_messages` (0), `user_preferences` (0), `users` (0).
- The supplemental tarball SHA-256 differs from the verified bundle tarball; retain both generations and do not silently replace one with the other.
- This confirms SpaceMountain data, but does not by itself prove that every OverlayBay scene/configuration or Lounge host state is present.

### Aetherra

Archive: `aetherra-080d0d5c556068.tar.gz`

- `data/aetherra.db`: 250,662,912 bytes. Read-only SQLite `PRAGMA quick_check` returned `ok`.
- 14 tables, including users, game saves, snapshots, achievements, and game ladders.
- Seven dated database backups are also present in `data/backups/`.
- Preserve this as its own app dataset until its role and relationship to Apollo's game systems are confirmed.

### SPMT / agent data

Supplemental `spmt-live` archives contain application/package files and documentation, but no `.db`, `.sqlite`, or `.sqlite3` files were found in those archives. The `spmt-agents` archive contains agent manifests, RAG indexes, training/evaluation JSONL, and tool registries; this is agent knowledge/configuration data, not an SPMT authority database.

### Lower-priority HearMeOut

The verified bundle contains a HearMeOut main archive and two DJ-worker archives. These remain intentionally last in the migration queue. Their existence does not make them higher priority than Chat Tag, StreamWeaver, Discord Stream Hub, OverlayBay, or Lounge.

## Integrity checks performed

- Verified bundle README reports all 9 nested tarballs passed `tar -tzf` integrity validation and records SHA-256 hashes.
- Local read-only SQLite `PRAGMA quick_check` returned `ok` for Discord Stream Hub, Aetherra, SpaceMountain, and both Mika Bot databases.
- No source archive was edited. Database inspection was read-only.
- No Turso token was created, no Turso destination was written, and no Apollo production data was changed.

## Migration order

1. Chat Tag / Nebula and StreamWeaver tenant data.
2. Discord Stream Hub (SQLite plus Firestore export, reconciled separately).
3. OverlayBay / SpaceMountain scene and configuration data, then Lounge state where present.
4. HearMeOut last.

SPMT authority remains a separate critical dependency: the inspected SPMT volume captures do not contain its authority database. A dedicated source/backup must be located before claiming SPMT identity/session/tenant data has been migrated.

## Import safety requirements

- Keep both original ZIP archives immutable as recovery copies.
- Create a second working copy for extraction and conversion.
- Record archive hash, nested archive hash, source path, source schema/version, record counts, and destination verification for every import.
- Import only into an empty or explicitly namespaced destination; never overwrite existing Turso data.
- Preserve original JSON exports and SQLite files until destination row counts, keyed digests, tenant ownership, and application-level invariants are verified.
- Never copy a live SQLite main file without a consistent backup method; the recovered archives are offline copies, but WAL/journal companions must be included when present.
- Never print or commit token values, OAuth credentials, webhook URLs, or user record contents.
