# Approved HMO and DSH implementation — 13 September 2026

All 58 review rows and all 33 work packages are approved. This record distinguishes authorization from working code and live deployment. No further batch approval is required.

Source baseline: Apollo `8ecd34b748bea47fbb718955a86c4d48509dc9bf`. The donor comparison and full authorization are in `docs/donor-audits/FEATURE_PARITY_REVIEW_2026-09-12.md`.

## Implementation evidence

| Package | Approval | Implementation status |
|---|---|---|
| P01 | Approved | Native room audio/video player implemented; two-browser audio, pause, seek, volume, mute, next, remount and access-revocation test passes. HLS/provider delivery remains P09. |
| P02 | Approved | Unban, persistent server mute/unmute, room move and People/room moderation controls implemented. Real relay enforcement, re-entry, move isolation and cleanup tests pass. Live cloud moderation still needs provider acceptance. |
| P03 | Approved | Native FIFO waiting queue, owner admission, five-minute invitations, removal/revocation and retryable Commlink notification implemented. Privacy, duplicate admission and expiry cleanup tested. Discord entry/delivery remains P10. |
| P04 | Approved | Screen capture, remote viewing and optional shared-system audio wired into existing cloud/peer RTC, including peer video alongside fallback voice. Reuses the established configurable SPMT relay capacity instead of the eight-connection override. GitHub browser acceptance passed in run 34729947698, including received screen pixels alongside fallback voice. |
| P05 | Approved | UI and suite actions now share title/artist search and YouTube resolution jobs; current capable worker selection replaces the fixed Fly assumption. Added yt-dlp search, tenant-scoped production catalogs, stable retry keys and query UI. API/provider-adapter tests pass. Live provider activation and media delivery remain unverified (P09/P33). |
| P06 | Approved | User-scoped saved music, removal, pagination, recent/most-played records and enqueue-from-favorites implemented. Saved music is reachable from the home page with zero rooms and survives room expiry. Isolation, replay counting and deletion tests pass; the real home-page browser test lists and removes favorites with zero rooms. Donor favorites data transfer remains P33. |
| P07 | Approved | Room-owned auto-radio controller, shared Stellar recommendation call, durable history, manual queue priority, controller leases and late-result fencing implemented. Checkpoint f36191b passed GitHub CI run 34731644459, including the radio concurrency tests and required RTC/media/console browser checks. Live provider acceptance remains outstanding. |
| P08 | Approved | Approved; implementation remains outstanding. |
| P09 | Approved | Approved; implementation remains outstanding. |
| P10 | Approved | Approved; implementation remains outstanding. |
| P11 | Approved | Production bot commands use the current shared public gallery/community descriptor and the same room persona store as the UI. An actual SPMT suite job adds/removes the UI persona by name/alias. Service reads expose public metadata only; speech/identity and deleted-room tests remain passing. |
| P12 | Approved | Approved; implementation remains outstanding. |
| P13 | Approved | Approved; implementation remains outstanding. |
| P14 | Approved | Approved; implementation remains outstanding. |
| P15 | Approved | Saved group routes, polling, templates and Spotlight enable/disable drive the running worker. Old-channel message cleanup and invalid-setting rollback tested. Signal and rendered-media setting consumers depend on P18/P19. |
| P16 | Approved | Web and suite decisions share templates, agreement offers and a durable DSH notification outbox. Failed delivery retries in the supervised worker; retry preserves the link/nonce. Concurrent delivery claims, restart, same-name command replay, agreement acceptance and simulation isolation tested. |
| P17 | Approved | Temporary guest targets now use the DSH monitor, existing live outbox and Discord message store. Shared Twitch grants resolve untracked creators without creating permanent members or fabricated identities. Offline posts expire after one hour; live guests refresh every ten minutes and expire after a continuous twenty-minute offline grace. UI and suite posting/removal, restart retries, concurrent delivery leases and late-message cleanup are wired and tested. Real provider production acceptance and media producers remain outstanding. |
| P18 | Approved | Approved; implementation remains outstanding. |
| P19 | Approved | Approved; implementation remains outstanding. |
| P20 | Approved | Approved; implementation remains outstanding. |
| P21 | Approved | Approved; implementation remains outstanding. |
| P22 | Approved | Typed hourly Raid Train reservations share the existing calendar and publication worker. Atomic claims, identity-bound cancellation, native web controls, shared suite actions, existing Discord button aliases and calendar artwork are implemented. Separate-process contention, restart publication, stale cancellation, tenant/guild isolation and web/chat/Discord integration tests pass. Live Discord acceptance remains outstanding. |
| P23 | Approved | Approved; implementation remains outstanding. |
| P24 | Approved | Approved; implementation remains outstanding. |
| P25 | Approved | Moderation controls under DSH Settings now create exact message selections through shared suite jobs and the real Discord grant adapter. Bot/all/until scopes, durable previews, selected-ID execution, resumable partial deletion, server validation and job/plan leases are wired. Simulation and runtime read-only modes cannot execute live deletion. Six integration tests cover scope, newer-message preservation, restart/retry, concurrency, adapter grants, shared jobs and authenticated web controls. No live channel cleanup was performed. |
| P26 | Approved | Approved; implementation remains outstanding. |
| P27 | Approved | Approved; implementation remains outstanding. |
| P28 | Approved | Approved; implementation remains outstanding. |
| P29 | Approved | Approved; implementation remains outstanding. |
| P30 | Approved | Approved; implementation remains outstanding. |
| P31 | Approved | Approved; implementation remains outstanding. |
| P32 | Approved | Approved; implementation remains outstanding. |
| P33 | Approved | Approved; implementation remains outstanding. |

## Validation

- `npm run test:offline`: 1,080 passing, zero failures (full offline suite after P17/P22/P25).
- `scripts/test-hmo-media-browser.mjs`: two independent Chromium contexts with actual decoded audio and canonical room state.
- Required contracts/RTC CI now includes the room-media browser test.
- Existing room expiry and donor-bridge recovery tests remain passing; deliberately deleted rooms were not reimported.

## Deployment

Implementation is saved in draft PR #99 (`approved-hmo-dsh-parity`). Checkpoint `a4359e0` passed required GitHub contracts and RTC/media browser CI in run `34729277608`. Checkpoint `6e40e87` passed run `34729947698`, including real screen pixels, decoded RTC/media audio and the actual home-page library. Checkpoint ae91c0b passed run 34731200815; f36191b passed run 34731644459. P17/P22 checkpoint a7e3801 passed all 1,074 local offline tests and required GitHub contracts/RTC/media/console browser checks in run 34736435460. P25 changes pass all 1,080 local offline tests; required GitHub browser checks follow the next checkpoint.

This implementation checkpoint has not replaced live HMO or DSH. Public traffic replacement follows completion and acceptance of the full approved parity scope. The existing production rollout also has shared core, ingress and companion-client work; StreamWeaver and Nebula Arcade are not the only unverified cutover items.

## Development checkpoint

`ae91c0b` passed required GitHub CI run `34731200815`; all 1,060 offline tests and RTC/media/console browser checks passed. Auto-radio was preserved and validated in f36191b after the development environment disconnected. On recovery, work resumed from that exact remote checkpoint in a separate checkout to preserve an unrelated local asset edit. P17/P22 add temporary guest shoutouts and hourly Raid Train reservations. P25 adds reachable moderation previews and selected-message cleanup through the existing shared job system. The expanded suite-action catalog remains inside the existing Stellar prompt budget by grouping repeated authority labels. No live deployment occurred.
