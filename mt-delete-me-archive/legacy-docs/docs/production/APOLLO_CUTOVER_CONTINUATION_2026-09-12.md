# Apollo cutover continuation — 12 September 2026

Continues the actual open work in PRs 90–94 at these heads:

| PR | Head | Preserved change |
| --- | --- | --- |
| 90 | 9ebcb580150fff730b0a39f09335bc074fb37266 | Parallel rollout plan, HearMeOut first and StreamWeaver last |
| 94 | 2f6032cec31aef4d3eefa55f9c2c0852281c29b5 | Complete rollout gate validation |
| 91 | f23635aca4fb90124cbf8137df4dddd32082caa1 | Discord ingress headroom |
| 92 | c73c09409e228b4a672a8a0184e381b2a5249cf1 | Account-bound egg retry queue |
| 93 | eb5e00807290380e4c124c53793425a6896238a4 | Concurrent session refresh overlap using the existing server key |

The combined source starts from main `64d540deb3d37cbcefb518e70e2fe20391c736b7`. Original branches remain available. This continuation does not claim that these PRs or this source are already running in production.

## Remaining code defects repaired

- Rollout progression now advances to the next incomplete app and permits completion after StreamWeaver. Retiring a Blue app requires that same app's Green replacement to be primary. Primary labels cannot hide a shadow-only runtime.
- `config/production-rollout.v1.json` is the single rollout state. Source inventory references it; release, cutover and Nebula checks consume it. Removed the inventory's second, permanently blocked production-state object. No gate is marked passed by this change.
- HearMeOut sends the chosen Discord gain at startup and on updates, requires the worker to acknowledge it, and reports worker `success: false` responses as failures. An older worker that starts without confirming gain is stopped so it cannot remain running outside Apollo's desired state.
- Egg retries rerun when a discovery arrives during a request. Confirmation uses the returned canonical event or an exact account/type history query. Busy tenant history can no longer hide old completions. Account changes halt subsequent writes; temporary failure retains retry intent. The existing stable reward event prevents duplicate achievement notifications.

## HearMeOut worker dependency

The inspected `Mtman1987/hearmeout-main` main at `4cc904f4d328efdecf2f5d36357b8d6236a460fa` did **not** accept `discordReceiveGain` or expose a gain setter. The companion worker change in [HearMeOut PR 74](https://github.com/Mtman1987/hearmeout-main/pull/74), commit `a223cb64a924d27403390b2b6eb1c690d47e2120`, adds the real contract:

- `POST /voice-bridge` accepts optional `discordReceiveGain`; omitted values keep 0.32.
- `POST /voice-bridge/receive-gain` accepts `roomId` and numeric `discordReceiveGain` with existing worker authorization.
- Gain is clamped to 0.05–1.0, reaches existing and future Discord PCM sources, and is returned as `status.discordReceiveGain`.

Deploy this worker change before directing the Apollo canary at that worker. No new credential is needed. The worker's existing Stage/audio-state build patch remains compatible and remains owned by its build script.

## Next real cutover work

HearMeOut remains the next canary. First reconcile current Blue room/media/private state into the chosen isolated Apollo data store and prove restart/restore. Then verify the updated worker with a controlled room, existing provider grants, real playback and reverse audio. Keep only one provider writer for that room. Permanent public ingress and live tenant routing still require implementation and verification.

The existing protected Release Sprite was last verified at main `64d540de` in sandbox mode with outbound disabled. Successful source tests do not change that runtime mode or move tenant traffic. The shared Windows UI/catalog consolidation and Athena/Stella host wiring are separate unfinished items from earlier handoffs; they are not completed by these fixes.

## Local verification

- Combined Apollo `npm run test:offline`: 1,037 passed, zero failures, skipped or cancelled. This includes the production TypeScript/browser build.
- HearMeOut worker: 18 focused route, PCM, jitter and privacy checks passed. The same 18 passed after applying the existing Stage/audio-state build patch. Worker JavaScript syntax checks passed.
- Release and cutover audits: structurally valid, HearMeOut remains next, no production traffic moved. They report the same outstanding app prerequisites and public-preview work.
- Nebula release check: 5/5 passed. This is a source/runtime-tools check, not live provider proof.
- No live Discord/LiveKit room, tenant migration, production route switch or public ingress change was exercised.
