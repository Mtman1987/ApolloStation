# HMO-011: first UI API contract batch

Date: 2026-10-28. Apollo baseline: `f7e05d678e2df3394e82ebd496fafc1a4f03b55e`.
Donor inspected read-only: `Mtman1987/hearmeout-main` at `8401114`.

## Status and safeguards

**ORACLE-VERIFIED (2026-10-28).** HMO-011 remains incomplete, but the mounted
contract batch and its follow-up repair work are verified on current `main`.
No local build, typecheck, or test execution was used; validation came only
from [Oracle run 40752588352](https://github.com/Mtman1987/ApolloStation/actions/runs/40752588352)
on main commit `ff8e31aa09857b08568108c870636d4b23bfcfc7`. All four shards
completed: 1,404 test cases passed, with zero failures, cancellations, or skips.
This is repository validation only; it is not a deployment claim.

`tests/hearmeout-ui-api-contracts.test.mjs` adds ten mounted HTTP tests.
It uses isolated temporary SQLite databases and a loopback SPMT session stub,
with same-tenant members, an outsider, and the same actor in another tenant.
No real provider credentials, donor execution or donor network calls are needed.
The tests import built `dist` modules, following the existing Oracle suite.
They are discovered as `tests/*.test.mjs`; no workflow changes are necessary.

## Child contract records (Oracle evidence recorded)

These records supplement the parent HMO-011 ledger row. Adaptation is not a
declaration that donor aliases can be removed. The route coverage checklist's
106 donor handlers still require individual dispositions and caller review.

| Child | Donor surface / inspected behavior | Apollo target and caller | Auth / request / response coverage | Disposition / evidence |
|---|---|---|---|---|
| HMO-011.01 | Donor room lifecycle/expiry responsibilities, including `room-expiry` maintenance handler; not a literal route alias | `GET/POST /api/hearmeout/rooms`, detail GET/DELETE, join/leave POST; embedded `HEARMEOUT_ROOM_BROWSER_JS` create, directory, preview and leave/delete consumers | 201 room identity/expiry; 200 directory/detail/join/leave; member and lobby shapes; owner deletion; 401 missing session, 503 failed authority; same-actor cross-tenant isolation; invalid name/JSON/body bounds | ADAPT. Tests `room create/list/detail/join/presence/leave`, `tenant boundaries`, `session failures`, `create rejects`. Expiry scheduler/warnings and complete donor lifecycle comparison remain outside this batch. |
| HMO-011.02 | Private admission belongs to HMO-001 donor room-access audit; no new compatibility alias claimed | Room list/detail/join, browser locked lobby and password form | Locked summaries omit people/activity; wrong/missing password cannot admit; correct password admits; password/hash/salt not returned | ADAPT. Test `private room summaries`. Current denial status is 400, recorded below, not marked correct parity. |
| HMO-011.03 | Donor `community-online` global presence is not the same as room heartbeat; donor `room-admin` POST checks session and creator/admin, and supports moderation actions | Room presence POST and room DELETE; browser `heartbeat` and `deleteRoom` | Presence belongs to authenticated member; connection ID returned; leave removes presence; non-owner deletion denied; cross-host writes leave state unchanged | ADAPT. Tests lifecycle, owner/tenant boundaries, outsider and origin tables. Global presence and room-admin moderation actions are not verified by these tests. Donor `UserCard.tsx` and `PersonaCard.tsx` still call `room-admin`. |
| HMO-011.04 | `music/session/request` accepts query/session/user metadata; control/state are aliases of canonical watch-session handlers | Room media/music POST and control POST; room detail contains lane state. Browser `renderMedia`, media client and `mediaControl` | URL item shape, 201 session, same-key replay equality/no duplicate, distinct key adds entry, owner pause/clear, outsider control/enqueue denied, bad URLs/duration/action rejected | ADAPT, not wire-identical. Tests `music enqueue replay`, `invalid media` and outsider table. The follow-up resolver HTTP test also checks that same-key replay does not repeat provider jobs and changed intent fails before resolution or queue mutation. Donor query/provider selection and canonical watch session aliases are not fully compared. |
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
- Resolver-backed music replay and same-key changed-intent behavior are covered
  by the follow-up HTTP regression in `tests/hearmeout-media-resolution.test.mjs`;
  fresh post-merge Oracle evidence for that change is pending.
- No claim of complete HMO-011, HMO-001, HMO-003 or P08 verification. Existing
  handoff gaps (YouTube HLS, queue/store ordering, session revocation, Twitch
  redirect registration) remain open.

## Verification evidence and next scope

- The room-control contract batch merged in `a8772f9f39874cc85caeeec8aef38eb6e047f46e`.
  Follow-up commits `ee213844da7e92720b35bf17d92fd12c4a4ee977` and
  `ff8e31aa09857b08568108c870636d4b23bfcfc7` corrected pre-existing diagnostic
  assumptions without changing the documented HMO-011 route semantics.
- Oracle run `40752588352` completed every assigned file in all four shards;
  its aggregate report records 1,404 passing test cases and no assertion
  failures.
- Continue route-by-route work from `HEARMEOUT_ROUTE_COVERAGE.md`, prioritizing
  remaining browser callers. The listed YouTube HLS, queue/store ordering,
  session revocation, and Twitch redirect-registration gaps remain open.
