# Apollo continuation follow-up — 2026-11-03

## Current continuation (read first)

[Repo-first continuation and merged work](APOLLO_PARITY_CONTINUATION_RUNABLE_2026-11-03.md) supersedes the pending/local-only statuses below.
PR #384 preserved the tested workflow repair patch on main at `069c6dd`; PR #385
merged private HLS delivery and final authorization at `43df67a`. Full build/typecheck
and 46 targeted tests passed. The inspected baseline Oracle report at `069c6dd`
has 1,456 passes and zero failures across four complete shards. Post-code-merge run
[41710521401](https://github.com/Mtman1987/ApolloStation/actions/runs/41710521401)
was rechecked and remains in progress; do not call its findings verified.
The workflow repair is now durable in the repository, but activation still requires
workflow-write access. See the linked continuation for its patch path and exact next steps.

## Earlier follow-up snapshot

The remainder records the earlier inspection and its exact evidence. Statements
about local-only work or pending runs are historical, not current authority.

This supersedes the pending-run statuses in
[`APOLLO_PARITY_HANDOFF_2026-11-03.md`](APOLLO_PARITY_HANDOFF_2026-11-03.md).
Keep its architecture, scope and live-provider boundaries. Fetch main before resuming.

## Repairs in this continuation

- PR [#382](https://github.com/Mtman1987/ApolloStation/pull/382) merged at
  `51ccaa7b51c8024e7dd59def11f1936fed51b5c4`. It fixes two stale REA filename
  assertions, without changing production JSON validation. Its Oracle run
  [41707040827](https://github.com/Mtman1987/ApolloStation/actions/runs/41707040827)
  was in progress at inspection; read actual findings before claiming success.
- The three manual sweeps failed after producing seven files: artifact upload
  rejected the slash-bearing `inputs.apollo_app` value in the artifact name.
  Runs: Discord Stream Hub [41706393191](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393191),
  HearMeOut [41706393224](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393224),
  StreamWeaver [41706393624](https://github.com/Mtman1987/ApolloStation/actions/runs/41706393624).
  No bundles were uploaded by these runs; this is not an REA failure.
- The follow-up changes only the upload name to
  `parity-evidence-${{ inputs.donor }}-${{ github.run_id }}`. Each dispatch has a
  unique run ID. The app path and exact commit remain in inventory/comparison/brief
  provenance; filesystem paths and all seven upload entries are unchanged.
  A regression checks the template, valid expanded names for all three donors,
  and preserved app-path provenance. **This repair is local/unmerged:** GitHub
  `push_files` returned HTTP 403 after attempting scope escalation when writing
  the workflow. The remote branch `fix/parity-artifact-name-2026-11-03` still points
  to `51ccaa7`; no workflow/test changes reached it. The prepared patch is delivered
  separately and requires an authorized workflow write. Do not merge the new test
  alone: it requires the companion workflow repair. Re-running the old failed run would
  reuse its broken workflow: dispatch fresh runs on repaired main instead.

## Nightly evidence sweep complete at its recorded SHA

Nightly run [41704852808](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808)
now completed/success. Downloaded and JSON-parsed all three bundles. Every row has
both inventories, comparison, both REA outputs, and JSON/Markdown port briefs.
Inventory/comparison/brief commit and app-path provenance agree on Apollo
`e3039342e10d2e0a5d2dc5d26ddea55732fc8664`; REA subject/input identifies each
mapped app's `dist`. This verifies bundle completeness/provenance consistency,
not functionality parity or an independent REA attestation of the Git commit.

| Donor | Donor commit | Apollo app | Artifact |
| --- | --- | --- | --- |
| HearMeOut | `840111480c09d0bf1fdd16cff446a3a868846720` | `apps/hearmeout` | [13265104222](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808/artifacts/13265104222) |
| StreamWeaver | `ad2e43fd27f03b4c11fdaa1585ee1ad7ff4fcf80` | `apps/streamweaver` | [13264644125](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808/artifacts/13264644125) |
| Discord Stream Hub | `535fb6c52ce3b4e0b95a52567a32a67328796eff` | `apps/discord-stream-hub` | [13264149182](https://github.com/Mtman1987/ApolloStation/actions/runs/41704852808/artifacts/13264149182) |

HearMeOut's generated gap list still lists browser decoding, synchronized
pause/resume/seek, late join/reconnect, media authorization and provider playback.
Browser fixture run [41705262124](https://github.com/Mtman1987/ApolloStation/actions/runs/41705262124)
already passed its two actual browser checks at `13cf2d22`: do not blindly port
that functionality again. Real configured-provider playback, full authorization
review and live acceptance remain distinct open work.

## Historical resume instructions (use current continuation above)

1. Confirm PR #382 on main and inspect Oracle reports. Baseline
   41705653182 had 1,454 pass / 2 fail even though diagnostic execution was green.
2. Obtain authorized GitHub workflow-write access, apply/review/merge the prepared
   artifact-name repair and its companion regression, then dispatch fresh manual
   sweeps. They have not been dispatched after repair because repair is unmerged.
   Record run IDs and verify seven uploaded files for each. Do not call queued runs green.
3. Use reviewed briefs as triage only. Next bounded capability target is the
   remaining HearMeOut room/tenant media authorization boundary: inspect current
   mounted handlers and existing membership/revocation tests before changing code.
4. Configured-provider and live Discord rehearsals require authorized access;
   no production credentials, donor secrets, deployments or DNS were changed here.
   No local builds, typechecks, tests or donor applications were run.
