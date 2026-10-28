# HMO-011: first UI API contract batch

Date: 2026-10-28. Apollo baseline: `f7e05d678e2df3394e82ebd496fafc1a4f03b55e`.
Donor inspected read-only: `Mtman1987/hearmeout-main` at `8401114`.

## Status and safeguards

**AUTHORED, NOT EXECUTION-VERIFIED.** HMO-011 remains incomplete. No local
build, typecheck or test execution; no Oracle dispatch; no deployment.
The owner explicitly requested continuation without Oracle this round.
`docs/hmo-handoff` stays unmerged; PR #306 is untouched.

`tests/hearmeout-ui-api-contracts.test.mjs` adds ten mounted HTTP tests.
It uses isolated temporary SQLite databases and a loopback SPMT session stub,
with same-tenant members, an outsider, and the same actor in another tenant.
No real provider credentials, donor execution or donor network calls are needed.
The tests import built `dist` modules, following the existing Oracle suite.
They are discovered as `tests/*.test.mjs`; no workflow changes are necessary.

## Child contract records (pending Oracle evidence)

These records supplement the parent HMO-011 ledger row. Adaptation is not a
declaration that donor aliases can be removed. The route coverage checklist's
106 donor handlers still require individual dispositions and caller review.

| Child | Donor surface / inspected behavior | Apollo target and caller | Auth / request / response coverage | Disposition / evidence |
|---|---|---|---|---|
| HMO-011.01 | Donor room lifecycle/expiry responsibilities, including `room-expiry` maintenance handler; not a literal route alias | `GET/POST /api/hearmeout/rooms`, detail GET/DELETE, join/leave POST; embedded `HEARMEOUT_ROOM_BROWSER_JS` create, directory, preview and leave/delete consumers | 201 room identity/expiry; 200 directory/detail/join/leave; member and lobby shapes; owner deletion; 401 missing session, 503 failed authority; same-actor cross-tenant isolation; invalid name/JSON/body bounds | ADAPT. Tests `room create/list/detail/join/presence/leave`, `tenant boundaries`, `session failures`, `create rejects`. Expiry scheduler/warnings and complete donor lifecycle comparison remain outside this batch. |
| HMO-011.02 | Private admission belongs to HMO-001 donor room-access audit; no new compatibility alias claimed | Room list/detail/join, browser locked lobby and password form | Locked summaries omit people/activity; wrong/missing password cannot admit; correct password admits; password/hash/salt not returned | ADAPT. Test `private room summaries`. Current denial status is 400, recorded below, not marked correct parity. |
| HMO-011.03 | Donor `community-online` global presence is not the same as room heartbeat; donor `room-admin` POST checks session and creator/admin, and supports moderation actions | Room presence POST and room DELETE; browser `heartbeat` and `deleteRoom` | Presence belongs to authenticated member; connection ID returned; leave removes presence; non-owner deletion denied; cross-host writes leave state unchanged | ADAPT. Tests lifecycle, owner/tenant boundaries, outsider and origin tables. Global presence and room-admin moderation actions are not verified by these tests. Donor `UserCard.tsx` and `PersonaCard.tsx` still call `room-admin`. |
| HMO-011.04 | `music/session/request` accepts query/session/user metadata; control/state are aliases of canonical watch-session handlers | Room media/music POST and control POST; room detail contains lane state. Browser `renderMedia`, media client and `mediaControl` | URL item shape, 201 session, same-key replay equality/no duplicate, distinct key adds entry, owner pause/clear, outsider control/enqueue denied, bad URLs/duration/action rejected | ADAPT, not wire-identical. Tests `music enqueue replay`, `invalid media` and outsider table. Donor query/provider selection and canonical watch session aliases are not fully compared. |
| HMO-011.05 | Donor `favorites` GET/POST/DELETE verifies userId equals session.uid; stores videoId records and may download/cache | Music library GET, favorites POST and DELETE; browser `openMusicLibrary` and save-current action | Favorites/recent/mostPlayed arrays; save a queued request; library isolation by actor and tenant; outsider cannot enqueue another user's saved item; deletion; invalid page offsets | ADAPT. Test `music enqueue replay` and invalid-media table. Donor download/cache, capacity, ordering and full alias/caller retirement remain open; no favorites callers found by literal scan in donor non-route sources. |

## Explicit current-contract gaps

- Legacy `requireSameOrigin` accepts missing Origin and compares only host, not
  scheme. Cross-host denial currently returns 400. Tests supply Origin for valid
  mutations and check cross-host denial; they do **not** prove a strict CSRF policy.
- Missing/wrong private password throws `Private HearMeOut room admission is
  required`; the message-based error classifier returns 400, not 403. Admission
  still fails. This tests-only batch does not change production status mapping.
- Unsupported `PUT /api/hearmeout/rooms` returns the current 404 not-found
  envelope, not 405. Unknown authenticated paths return the same envelope.
- Body-size tests cover the 64 KiB JSON limit; no rate-limit proof is added.
- Music idempotency coverage here uses direct URL enqueue; resolver-side
  duplicate work and changed-payload replay behavior need additional tests.
- No claim of complete HMO-011, HMO-001, HMO-003 or P08 verification. Existing
  handoff gaps (YouTube HLS, queue/store ordering, session revocation, Twitch
  redirect registration) remain open.

## Next verification gate

When the owner authorizes Oracle, dispatch `oracle-release-validation.yml` once
for the completed batch, inspect all four shards and the aggregate report, and
record the branch SHA/run URL and failures here. Until then this branch is
unverified and must not be merged as validated parity. Continue route-by-route
work from `HEARMEOUT_ROUTE_COVERAGE.md`, prioritizing remaining browser callers.
