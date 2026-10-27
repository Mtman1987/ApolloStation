# HMO-009.01 — Durable Watch request state (child of HMO-009, linked from P08)

Status: **OPEN — missing in Apollo.** Recorded from donor `main` `8401114` and Apollo `main` `12c4121`.

- **Donor source:** `src/lib/watch/watch-request-service.ts` keeps two in-memory Maps, `pendingRecommendations` (keyed `sessionId:userId`) and `seriesProgress` (keyed per user and series). Both are persisted as JSON to `WATCH_STATE_FILE` (default `/data/watch-state.json` when `FLY_APP_NAME` is set, else `./data/watch-state.json`) with a `.bak` copy. Load and save helpers are `loadWatchStateFromDisk` and `saveWatchStateToDisk`, around lines 181–240. Save points are around lines 531, 553, 997, 1014, 1070, 1116, 1146, 1264 and 1308.
- **Donor consumers:** an Internet Archive fallback stores a recommendation when no provider item matches (around line 996). Accepting a recommendation reads and deletes it (around line 1135). Series progress is written after a series episode plays, using the next season and episode numbers (around line 806). `worker/PROCESS_GROUP_CUTOVER.md` notes that Lounge selections also live in this file.
- **Apollo source:** missing. Movie playback sessions persist in `hmo_media_sessions` (`apps/hearmeout/src/room-media-core.ts`). Nothing in Apollo stores pending recommendations or series progress. `apps/hearmeout/src/xtream-provider.ts` accepts a `getProgress` callback, but no implementation is wired in.
- **Difference:** a restart drops pending recommendations and series resume points.
- **Decision:** port. Use a STRICT SQLite table following the `room-assistant-jobs.ts` pattern. Ship it together with its P08 consumer, because a store without a consumer is not parity. Add restart coverage in `tests/hearmeout-watch-state-restart.test.mjs`.
- **Verification:** pending. Not yet implemented.
