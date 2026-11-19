# Apollo handoff — 2026-11-19

Status snapshot for the next agent. Supersedes the working notes in chat. Facts are marked with what was actually verified.

## Product intent (decided)

- Single sign-on across the whole ecosystem. Sign-in is required; it is the point. One login through SPMT should open every Shipyard app without re-login.
- The bar is "streamers can use it without know-how." Sign-in must not block the apps once a user is signed in.

## 1. SPMT XP → Turso import

Target: shared Turso DB, tables `spmt_*`. Scope: owner data only. Excluded: `aetherra` (Nebula), `mika-bot`, rotator cache, media files. Keep SPMT backups.

Verified:
- Export (`fly-machine-rotator` `edaa4c6`, run `44414720211`), artifact `spmt-xp-export`. SHA256 `08aa9be1…239a9d1`, `quick_check` ok.
- Source counts: `xp_ledger` 182,648; `users` 653; `workspace_profiles` 32; `user_settings` 0; `app_state_records` 56.
- Dry run `44415725035` matched the export exactly (PR #508).
- Private release `spmt-xp-export-2026-11-18` (id `450654585`) still holds the export. Delete after a verified import.

Failed / unknown:
- Apply `44416096223` cancelled at the 30-minute timeout during `xp_ledger`.
- Apply `44421403740` finished `success` at 00:42 UTC (about 11 minutes of import). Verified: Turso `spmt_*` counts match the export exactly (`xp_ledger` 182648, `users` 653, `workspace_profiles` 32, `user_settings` 0, `app_state_records` 56).
- Release `spmt-xp-export-2026-11-18` (id `450654585`) deleted.

Root cause (likely): one INSERT per row in 500-statement pipelines is too slow for 182k rows.

Fix merged to `main` as PR #510 (`60628356`):
- 100 rows per multi-row INSERT, 20 INSERTs per HTTP request.
- Log line per request with elapsed seconds.
- Syntax checked only. Not run against Turso.

Next: none for the import. Item 5 below is the only open token step.

Old next steps (done):
1. Confirm run `44421403740` ended. Done, success.
2. Done (PR #510 merged). The workflow runs from `main`.
3. Rerun with `apply=true` after run `44421403740` has ended, so two runs never write the same tables. Compare `spmt_*` counts to the table above.
4. Delete release `450654585`.
5. Revoke the leaked GitHub tokens `ghp_CCxq…` and `ghp_EP99…`. Rotate the token in `~/.github-token.env`.

## 2. Shipyard app launch ("image instead of app", then "unauthorized")

Verified:
- Anonymous `/v1/session` returns 403. That is the intended SSO gate.
- Apollo node-1 and node-2 share the `hostless.app` site. The SameSite=Lax session cookie should reach app frames. Cookies are not the likely cause.
- The "unauthorized" text comes from app APIs (`spmt-service` returns `401 {"error":"unauthorized"}` when no bearer token is sent). Likely a second issue once the frame loads.

Branch `shell-app-frame-fix` → PR #511 (open, not merged, not deployed):
- `tsc -p apps/spacemountain-web --noEmit` passes. Not yet run in a browser and not deployed.

Not verified:
- The real `launchUrl` for each of the five apps (StreamWeaver, HearMeOut, Discord Stream Hub, Stellar Core, Nebula Arcade). `/v1/apps` requires a signed-in token. The manifests come from the SPMT registry.
- Whether each app honours the session after the frame loads.

Next:
1. Read each app's `launchUrl` from the registry while signed in. Move any root-pointing app under `/apps/<id>` if that is cleaner.
2. Deploy the branch to node-1 only with owner approval. Then sign in and open each app from Shipyard.
3. If an app still says "unauthorized" inside the frame, trace how its API receives the session. The likely fix is a shell-issued short-lived token passed to the frame, not a cookie change.
4. The sign-in gate stays. Don't weaken it to fix the frame.

Also noted:
- The `/v1/session` 403 for anonymous users vs the client's `401` check in `apps/spacemountain-web/src/client.ts` (~line 188). Harmless today, but the client expects 401.

## Work order (as of 2026-11-19 00:45 UTC)

1. Launch bug: PR #511 open. Needs deploy approval and a browser check.
3. AI and TTS fallbacks: not started, scope not defined.
4. UI tweaks: not started, no specifics.
2. Bots missing from mtman1987 chat and StreamWeaver OAuth: not started. Blocked on item 1.

## Other not started

- AI and TTS fallbacks (work item 3). Scope not defined.
- Bots missing from the mtman1987 chat, and StreamWeaver OAuth reachability (work item 2). Depends on the launch fix.
- UI tweaks (work item 4). No specifics yet.
- Persistence: `scripts/hostless/start-node.mjs` sets `DATABASE_PATH` under `/tmp`. Needs write-through to Turso and restore on boot.
- Refresh loop: `watchWorkspace` in `client.ts` polls every 5 s. Needs live logs.

## Branches and PRs

- PR #510 (merged): importer batching and progress logging.
- PR #511 (open): shell frame headers for `surface=shell`, plus this doc.

## Files

- ApolloStation `main` includes PR #508 (XP importer, export-only workflow) and #509 (timeout and progress).
- `/home/user/work/xp/`: export DB, SHA256SUMS, run zips.
- `~/.github-token.env`: sandbox GitHub token. Never print it.
