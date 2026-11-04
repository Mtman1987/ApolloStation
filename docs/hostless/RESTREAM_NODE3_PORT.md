# Hostless Node 3 — Restream control port

Status: implementation boundary identified; runtime port and acceptance remain open.

## Ownership

Restream browser control belongs with the Node 3 continuity runtime alongside Discord Stream Hub and its Lounge state. It must not be hidden inside the Chat Gateway process on Node 2: the browser is a long-lived stateful controller, not an ordinary provider adapter. StreamWeaver on Node 2 remains the authenticated client and calls the Node 3 control API over HTTPS.

The existing StreamWeaver client contract is already present in `apps/streamweaver/src/provider-runtime.ts` and is configured through `STREAMWEAVER_RESTREAM_CONTROL_ORIGIN` plus `STREAMWEAVER_RESTREAM_CONTROL_CREDENTIAL`. The client expects `POST /restream/start`; its environment validator requires the origin and credential together, rejects sandbox use, and requires a credential-free HTTPS origin and a 32+ character credential.

## Donor behavior that must be preserved

The legacy implementation is in `apps/hearmeout/legacy-worker/src/restream-control.js`, mounted by `apps/hearmeout/legacy-worker/src/server.js` when `RUN_LOUNGE` is enabled. Its authenticated worker routes are:

- `GET /restream/status`
- `POST /restream/start`
- `POST /restream/reset`

The browser controller:
- launches Chromium through Puppeteer under Xvfb;
- stores the signed-in browser profile under `RESTREAM_PROFILE_DIR`;
- restricts navigation and control to `restream.io` hosts;
- recognizes exactly one visible start/stop control before clicking;
- handles explicit confirmation dialogs;
- reports `live` only after the Restream UI transitions to a recognized live state;
- serializes start/reset operations and refuses ambiguous or unexpected UI states;
- keeps automation disabled unless `RESTREAM_AUTOMATION_ENABLED=true`.

Do not replace this with a new browser login, a fake status endpoint, or an API response that reports success merely because a click was sent.

## Hostless port requirements

1. Extract the Restream receiver into an independently supervised Node 3 process or a clearly isolated Node 3 process group. Do not start a second copy from both the Lounge web process and a worker entrypoint.
2. Preserve the existing three routes and their response semantics. Require a dedicated 32+ character service credential, compare bearer credentials without logging them, reject redirects, and bind only to the private service interface where Hostless supports it. The public SpaceMountain ingress must not expose these mutation routes.
3. Make `RESTREAM_PROFILE_DIR` mandatory for the Hostless runtime. It must resolve to the explicitly mounted persistent profile volume. Do not silently fall back to `os.tmpdir()`, a container layer, or a per-release directory.
4. Enforce a single browser-controller owner with a process lock/lease so rolling restarts or duplicate replicas cannot open the same Chromium profile concurrently.
5. Keep `RESTREAM_AUTOMATION_ENABLED` false by default. Enabling start/reset is an explicit production configuration change, not part of a build or health check.
6. Keep the browser profile private. Never expose cookies, local storage, profile paths, screenshots, page HTML, or browser debugging ports through status or logs. Status should return only bounded operational metadata (configured, automationEnabled, recognized state, and a sanitized error).
7. Add focused tests for missing/non-persistent profile configuration, auth failures, route methods, redirect rejection, concurrent starts/resets, profile-lock contention, browser disconnect/recovery, unknown/ambiguous controls, and verified state transitions.
8. Validate the container's actual Chromium/Xvfb dependencies and memory footprint on the selected Hostless plan before allocating or deploying. The donor Dockerfile installs Chromium, Xvfb, ffmpeg, PulseAudio, yt-dlp and native Discord voice dependencies; that full image is not automatically suitable for a small Node 3 allowance. Prefer a narrowly scoped Restream image/process rather than carrying unrelated HearMeOut dependencies.
9. Before cutover, verify the saved session survives a process restart and release replacement, then run a real owner-authorized Twitch start and reset rehearsal with Twitch live-state verification. Keep the current Lounge/Restream controller alive until that acceptance and rollback path are proven.

## Current decision

The existing donor browser controller is functional source to port, not proof of Hostless readiness. The current StreamWeaver client configuration is also not proof that a receiver is running. The remaining hard blockers are durable profile storage, exclusive controller ownership, an isolated receiver process, Hostless resource fit, and real Twitch acceptance. No Hostless resource, credential, production session, or live broadcast was changed as part of this port work.
