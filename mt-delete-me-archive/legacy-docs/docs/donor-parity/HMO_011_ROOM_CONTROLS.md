# HMO-011 continuation: room controls

## First batch merged and validated

The owner requested merge and continuation on 2026-10-28. PR #309 was squash
merged at `9ccf227b4000d9185980ce28e996e193d9b025df`, preserving the unrelated
avatar changes already on main. The existing main-push workflow started Oracle
automatically; no workflow was manually dispatched and no app was deployed.

[Oracle run 40671614065](https://github.com/Mtman1987/ApolloStation/actions/runs/40671614065)
completed **success**: all four test shards and the aggregate report succeeded.
This supersedes the execution-pending/merge-pending state in the first batch's
`HMO_011_UI_CONTRACTS.md`; its remaining gaps and parity limits still apply.

## Second batch

Baseline: `9ccf227`. File: `tests/hearmeout-room-control-contracts.test.mjs`.
Five additional mounted HTTP tests use temporary SQLite state and only a
loopback identity/Commlink stub. No local build, tsc or tests were run.

| Child | Contracts authored | Boundary / persistence / failure coverage | Status |
|---|---|---|---|
| HMO-011.06 | Room moderation POST; donor `room-admin` responsibilities adapted to Apollo, not a literal alias | Owner-only writes; mute/unmute state; ban/unban admission; kick removes membership; timeout expiry field; same-actor cross-tenant denial; room movement state; replay equality; changed-payload replay refusal without undoing move | Authored, pending this batch's Oracle execution |
| HMO-011.07 | Voice waiting queue GET/POST; browser `openVoiceQueue` and `voiceQueueAction` | Duplicate joins retain one entry; member sees only own entry; owner sees queue; others cannot admit/remove another user; failed Commlink delivery leaves an invitation marked pending; same-key admit replay; invitation enables private admission; join removes waiting entry | Authored, pending Oracle; live Commlink delivery and resend transport remain outside this batch |
| HMO-011.08 | Legacy room chat GET/POST | Nonmember denial; 201 legacy-room-chat write marker; 200 Commlink read marker; length/text/origin rejection leaves stored messages unchanged | Authored, pending Oracle; no new UI chat surface or claim of shared Commlink integration |
| HMO-011.09 | Radio GET/POST; donor `auto-radio` responsibilities adapted to Apollo | Member-only reads, owner-only disable; default state; enabled flag validation; missing media worker refuses enable; disabled update response | Authored, pending Oracle; radio worker selection, retry and history parity remain open |

The parent HMO-011 remains incomplete. Existing message-based error statuses,
strict-origin policy, complete donor aliases/callers, rate limits, session
revocation, and provider-side behavior still need work. In particular, a source
scan did not find a mounted `/api/watch/youtube/hls/...` handler in
`web-server-v3.ts` or `media-proxy-routes.ts`; `prepared-media.ts` uses a separate
worker path. Do not label donor YouTube HLS parity complete from helper existence.

`docs/hmo-handoff` remains unmerged and PR #306 is untouched. Donors remain
read-only; no production services, domains, credentials or redirect registration
were changed.
