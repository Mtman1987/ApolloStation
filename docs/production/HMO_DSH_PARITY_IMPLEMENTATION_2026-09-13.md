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
| P07 | Approved | Approved; implementation remains outstanding. |
| P08 | Approved | Approved; implementation remains outstanding. |
| P09 | Approved | Approved; implementation remains outstanding. |
| P10 | Approved | Approved; implementation remains outstanding. |
| P11 | Approved | Production bot commands use the current shared public gallery/community descriptor and the same room persona store as the UI. An actual SPMT suite job adds/removes the UI persona by name/alias. Service reads expose public metadata only; speech/identity and deleted-room tests remain passing. |
| P12 | Approved | Approved; implementation remains outstanding. |
| P13 | Approved | Approved; implementation remains outstanding. |
| P14 | Approved | Approved; implementation remains outstanding. |
| P15 | Approved | Saved group routes, polling, templates and Spotlight enable/disable drive the running worker. Old-channel message cleanup and invalid-setting rollback tested. Signal and rendered-media setting consumers depend on P18/P19. |
| P16 | Approved | Web and suite decisions share templates, agreement offers and a durable DSH notification outbox. Failed delivery retries in the supervised worker; retry preserves the link/nonce. Concurrent delivery claims, restart, same-name command replay, agreement acceptance and simulation isolation tested. |
| P17 | Approved | Approved; implementation remains outstanding. |
| P18 | Approved | Approved; implementation remains outstanding. |
| P19 | Approved | Approved; implementation remains outstanding. |
| P20 | Approved | Approved; implementation remains outstanding. |
| P21 | Approved | Approved; implementation remains outstanding. |
| P22 | Approved | Approved; implementation remains outstanding. |
| P23 | Approved | Approved; implementation remains outstanding. |
| P24 | Approved | Approved; implementation remains outstanding. |
| P25 | Approved | Approved; implementation remains outstanding. |
| P26 | Approved | Approved; implementation remains outstanding. |
| P27 | Approved | Approved; implementation remains outstanding. |
| P28 | Approved | Approved; implementation remains outstanding. |
| P29 | Approved | Approved; implementation remains outstanding. |
| P30 | Approved | Approved; implementation remains outstanding. |
| P31 | Approved | Approved; implementation remains outstanding. |
| P32 | Approved | Approved; implementation remains outstanding. |
| P33 | Approved | Approved; implementation remains outstanding. |

## Validation

- `npm run test:offline`: 1,060 passing, zero failures.
- `scripts/test-hmo-media-browser.mjs`: two independent Chromium contexts with actual decoded audio and canonical room state.
- Required contracts/RTC CI now includes the room-media browser test.
- Existing room expiry and donor-bridge recovery tests remain passing; deliberately deleted rooms were not reimported.

## Deployment

Implementation is saved in draft PR #99 (`approved-hmo-dsh-parity`). Checkpoint `a4359e0` passed required GitHub contracts and RTC/media browser CI in run `34729277608`. Checkpoint `6e40e87` passed run `34729947698`, including real screen pixels, decoded RTC/media audio and the actual home-page library. Subsequent work needs its own validation.

This implementation checkpoint has not replaced live HMO or DSH. Public traffic replacement follows completion and acceptance of the full approved parity scope. The existing production rollout also has shared core, ingress and companion-client work; StreamWeaver and Nebula Arcade are not the only unverified cutover items.
