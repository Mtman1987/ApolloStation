# HearMeOut live inventory

Updated: 2026-08-30
Status: read-only source inventory complete; live Fly runtime/filesystem inventory still required.

This is the first production-inventory slice under `PRODUCTION_PATH.md`. It records only facts proven from current GitHub source/configuration plus previously observed live facts. It does not authorize Blue mutation, DNS movement, credential changes, volume copies, or provider output.

## Source revisions

- `Mtman1987/hearmeout-main` main: `37b6ef3c2b4aabd6bf6624da8a4e38f74d5afbe4`
- `Mtman1987/hmo-dj-worker`: separate repository exists, but current `hearmeout-main` also contains and deploys `worker/fly.toml`; treat `hearmeout-main` as the current deployment source until live deployment evidence proves otherwise.

## Blue main app shape proven from source

`hearmeout-main/fly.toml` declares:

- Fly app: `hearmeout-main`
- primary region: `iad`
- 1 shared CPU / 1 GB memory
- HTTP port 3001
- minimum one running Machine; autostop disabled
- health route: `/api/health`
- persistent volume `data` mounted at `/data`, initial size 3 GB
- current public build URL still points at `https://hearmeout-main.fly.dev`
- worker URL points at `https://hmo-dj-worker.fly.dev`
- LiveKit endpoint is configured separately

The old Fly hostname is a migration source/configuration detail. Green's permanent product URL is `https://hearmeout.spacemountain.live`.

## Blue DJ worker shape proven from source

`hearmeout-main/worker/fly.toml` declares:

- Fly app: `hmo-dj-worker`
- primary region: `iad`
- 4 shared CPUs / 4 GB memory
- HTTP port 3002
- minimum one running Machine; autostop disabled
- health route: `/health`
- persistent volume `data` mounted at `/data`, initial size 10 GB
- `MUSIC_CACHE_DIR=/data/music`
- `WATCH_HLS_DIR=/data/watch-hls`
- HLS cache budget approximately 8 GiB
- worker calls back to `https://hearmeout-main.fly.dev`

This strongly indicates that a substantial portion of the 10 GB worker volume is designed as reconstructable media/HLS cache rather than canonical application authority. Do **not** clone the worker volume wholesale into Green without live filesystem verification.

## Main app durable database proven from source

The Blue application uses `sql.js` and a file-backed document table. `DB_FILE` defaults to `./data/app.db`; production must be checked to confirm whether an environment override points it at `/data/app.db`.

The database implementation:

- stores documents in a `docs` table keyed by logical path;
- maintains `app.db.bak` as the previous atomic generation;
- writes via temporary file + fsync + rename;
- runs SQLite `PRAGMA integrity_check` on startup;
- restores the backup generation when the primary cannot be opened;
- flushes on SIGINT/SIGTERM and before exit.

The repository includes a durability drill that deliberately corrupts the primary and verifies recovery from the previous backup generation.

### Important migration note

A source comment calls this the "same /data/app.db as DSH". That historical sharing claim must **not** be carried into Green as architecture. We must verify the actual live file and contents, then classify every collection by current ownership. Green already requires SPMT shared facts and HearMeOut-private facts to have separate canonical ownership.

## Data already classifiable from code

The Blue database contains or references at least these classes:

### HearMeOut private authority candidates

- `rooms`
- room voice-bridge configuration
- room-private membership/invitations/moderation state
- room playback/session state that is not reconstructable from provider state

These are candidates to migrate into HearMeOut's bounded private durable authority after live counts/schema are verified.

### Shared SPMT fact candidates

- user/provider identity references such as Discord/Twitch/SPMT IDs
- any shared XP/account/profile/entitlement facts found in the Blue DB

These must be reconciled into SPMT, not copied as a second HearMeOut authority.

### Ephemeral/rebuildable candidates

- `rooms/<id>/users` live presence rows
- worker `/data/music`
- worker `/data/watch-hls`
- generated HLS segments and transient media processing artifacts

Presence/cache/temp state should normally be rebuilt rather than migrated.

### Needs live inspection

- every other logical collection stored in `app.db`
- uploaded/recorded media under the main 3 GB `/data` volume
- any durable playlists/history/favorites/queue data
- any pending outbox/retry state
- orphaned old Firebase/export files
- whether `app.db`, `app.db.bak`, or other databases are actually on the mounted volume

## Deployment behavior proven from source

The current `hearmeout-main` GitHub Actions deployment:

- deploys the main Fly app on pushes to main;
- ensures `hmo-dj-worker` has one running Machine;
- creates a 10 GB worker volume when it cannot find an unattached volume matching its expected conditions;
- deploys the worker with an immediate strategy.

This means the old deployment path can mutate worker capacity/volumes. Do not use the deployment workflow as an inventory mechanism.

## Read-only live evidence still required

The following cannot be proved from GitHub source and is the next gate:

### `hearmeout-main`

- current Machine ID(s), state, region, image/release, CPU/RAM
- exact attached volume ID, region, size and used bytes
- actual `DB_FILE` environment destination (value only if non-secret; do not print secrets)
- top-level `/data` filenames and sizes
- `app.db` size, SQLite integrity result, logical collection names and row counts
- `app.db.bak` size/age
- durable media directories and sizes
- current health response
- current public Fly certificates/routes

### `hmo-dj-worker`

- current Machine ID(s), state, image/release, CPU/RAM
- exact attached volume ID, region, size and used bytes
- size of `/data/music`
- size of `/data/watch-hls`
- any other top-level `/data` paths
- current health response
- whether any data outside cache/HLS directories is authoritative

### provider dependencies

- current LiveKit project/room usage relevant to HearMeOut
- Discord bot/application identity used for the voice bridge
- any Twitch/provider credentials still used by Blue HearMeOut
- callback/redirect URLs that must move to the owned domain

Do not expose credential values while collecting this inventory.

## Candidate Green migration decision, pending live inspection

Current evidence points toward this shape:

1. migrate only HearMeOut-private room/config/history facts from Blue `app.db`;
2. reconcile any shared identity/account facts into SPMT instead of importing them as HearMeOut authority;
3. rebuild live presence;
4. discard/rebuild worker music/HLS caches unless specific user-owned media is found;
5. move durable user-owned media to an explicitly owned media store rather than worker cache;
6. keep Blue `app.db` and volume read-only through the rollback window;
7. connect Green to one controlled LiveKit/Discord test room before changing the production route;
8. move `hearmeout.spacemountain.live` only after persistence, restart, provider, and rollback proof.

This is a candidate decision, not final authorization. The live filesystem/database inventory is the evidence required to finalize it.

## Human/tool boundary

GitHub gives us source/configuration evidence but not authenticated Fly runtime/volume contents. The next missing information requires either:

- an authenticated Fly read-only inspection session, or
- a screenshot/paste of the relevant Fly machine/volume/runtime output.

No Blue mutation is required for that inspection.
