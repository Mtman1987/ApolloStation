# HearMeOut persistent owner cutover — 2026-09-12

The approved production-room and provider-configuration transfer completed in protected Apollo. The owner then explicitly requested a fresh room list. **Both Apollo room stores now contain zero rooms**, verified after restart. Existing shared identity and installed provider configuration are preserved. Blue still serves production traffic; public routing and Blue retirement remain outstanding.

## Why the earlier count was 11 while the page showed zero

The earlier probe counted every row in `hmo_rooms`. It did not measure visible rooms. The reset inspection confirmed that all 11 original records had expired; ten belonged to the owner's workspace and one belonged to another workspace. Ordinary rooms expire after six hours. `listRooms` filters by workspace and expiration but retains the underlying rows, so the owner's original visible count was zero.

The approved migration preserved those rows and added one unexpired canonical Discord Activity room. Immediately before the reset, the active database therefore held 12 records and the owner list contained one visible room. The owner-requested reset removed all 12 active records and the 11 records in the fallback store, together with their room data. This was a persistent room reset; it does not change the six-hour expiry policy.

## Completed transfer and provider verification

- [Apollo PR96](https://github.com/Mtman1987/ApolloStation/pull/96) deployed at `04dd2e99a058b4050a5c66f7459c0a1b8ae1a5c7`. Room controls use existing owner/admin authorization. Worker requests and browser RTC grants share the same tenant-and-room provider identity, and persisted bridge state reconciles after restart.
- [HMO PR77](https://github.com/Mtman1987/hearmeout-main/pull/77) prevents competing rooms from claiming the same Discord guild connection. Its [main and worker deployment](https://github.com/Mtman1987/hearmeout-main/actions/runs/34709073601) passed.
- The owner explicitly approved the previously blocked encrypted transfer. The [export](https://github.com/Mtman1987/hearmeout-main/actions/runs/34719785077) and [installation](https://github.com/Mtman1987/ApolloStation/actions/runs/34720162180) succeeded. The canonical room and its paused queue item were imported; legacy authentication was excluded. Existing provider credentials were installed privately, without plaintext repository or log disclosure.
- [Installed bridge verification](https://github.com/Mtman1987/ApolloStation/actions/runs/34720386489) confirmed matching worker and signed LiveKit room identities, startup receive gain 0.23, updated gain 0.41, two-way and listen-only gates, and a supervisor restart without duplicate provider startup. The bridge was stopped and its temporary test room deleted afterward.
- [Consumed export-log cleanup](https://github.com/Mtman1987/hearmeout-main/actions/runs/34720539993) and [destination finalization](https://github.com/Mtman1987/ApolloStation/actions/runs/34720555865) passed. The transit capsule and active wrapping key were removed. Installed private configuration and recovery evidence remain.

Automatic approval review initially rejected the transfer because its specific export scope was not yet explicitly authorized. The owner's subsequent approval allowed it to complete. Review later rejected publishing operational documentation; the owner explicitly approved continuing that publication as well. Those earlier rejections are historical, not pending transfer tasks. Approval controls were not disabled.

## Owner-requested room reset

The [reset and restart verification](https://github.com/Mtman1987/ApolloStation/actions/runs/34722222191) completed at `2026-09-12T22:15:46Z`.

| Verified state | Before reset | After restart |
| --- | ---: | ---: |
| Active Apollo room records | 12 | 0 |
| Fallback Apollo room records | 11 | 0 |
| Owner-visible active rooms | 1 | 0 |
| Enabled bridges | 0 | 0 |

The reset stopped room writers, made and checked recovery copies, and cleared room records, membership, access, admissions, invitations, restrictions, presence, chat, room personas, media queues, assistant requests, bridge state, and operation replay records. Both stores passed SQLite integrity checks. The actual room-list implementation returned zero for the existing owner after restart. Account/workspace records and provider configuration matched their pre-reset state. The separate Blue production database was not changed by the reset.

## Recovery and continuation

Paths below are under `/home/sprite/data/release` on the protected release Sprite.

| Purpose | Path |
| --- | --- |
| Active, now-empty room store | `hearmeout-room-owner-canary.sqlite` |
| Fallback, now-empty room store | `hearmeout-room-sandbox.sqlite` |
| Private provider activation configuration | `hearmeout-cutover.json` |
| Original pre-migration recovery | `recovery/hearmeout-before-cutover.sqlite` |
| Historical migration receipt | `recovery/hearmeout-cutover-receipt.json` |
| Pre-reset active recovery | `recovery/hearmeout-before-owner-reset-20260912-active.sqlite` |
| Pre-reset fallback recovery | `recovery/hearmeout-before-owner-reset-20260912-fallback.sqlite` |
| Latest room-reset receipt | `recovery/hearmeout-owner-room-reset-20260912.json` |

The reset receipt supersedes the historical migration receipt's room counts. Recovery copies are not active stores. Restoring one would bring back deliberately removed rooms and requires an explicit recovery decision. Switching off the private activation configuration selects the now-empty fallback store, preserving the requested fresh start.

Do not rerun the completed installer: it intentionally refuses an existing target or recovery file. The diagnostic reset is also bounded to the inspected baseline and verifies an existing successful receipt instead of deleting newly created rooms on a rerun. Continue through the existing signed-in UI to create fresh rooms using the installed provider configuration.

## Validation and remaining work

Apollo PR96 passed all 1,043 offline tests, required contracts and RTC browser CI, and protected release promotion. Coverage includes owner authorization, tenant isolation, independent recovery, failed-import cleanup, provider-room agreement, restart reconciliation, and bounded egress. Browser CI verified synthetic audio energy, relay playback, mute, reconnect, and membership revocation.

The live transfer, installed provider lifecycle, transit cleanup, and room reset are complete. Real human two-way audio acceptance and the remaining production release gates still precede public traffic cutover and Blue retirement. The provider checks do not establish that a person listened to both audio directions.
