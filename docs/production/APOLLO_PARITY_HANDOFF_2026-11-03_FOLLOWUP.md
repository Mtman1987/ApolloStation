# Apollo continuation follow-up — 2026-11-03

## Latest repo state — authoritative at handoff refresh

**Fetch main before making changes.** The latest observed main HEAD is
fe0a36d49cd5f9ad2d87174303a3e394b4db7842 (PR #397 merge).
The immediately preceding parity continuation merged PRs #388–#397. These are
already on main; do not recreate them or assume they are still open.

| PR | Merged change | Merge commit |
| --- | --- | --- |
| [#388](https://github.com/Mtman1987/ApolloStation/pull/388) | Restrict SpaceMountain !golive to Twitch ingress | 836ba9b41aa67f50fc2745aad49e0aeabfdfff9f |
| [#389](https://github.com/Mtman1987/ApolloStation/pull/389) | Wire production Go Live through existing authenticated Restream worker and Twitch verification | 402aec0544c45806aad27438632c952a761ec483 |
| [#390](https://github.com/Mtman1987/ApolloStation/pull/390) | Fix production Go Live handler to use resolved channel config; add production-path regression | a40b1c7f3893b1be8006ce3a8ec67b11a98d2f06 |
| [#391](https://github.com/Mtman1987/ApolloStation/pull/391) | Add durable Twitch reward EventSub delivery/idempotency regression coverage | 2960a998fe9ebf12c557db5dcf2d699df540aa8a |
| [#392](https://github.com/Mtman1987/ApolloStation/pull/392) | Complete Quackverse browser trade desk: offer/accept/decline/cancel, durable offers, atomic settlement, participant/deck guards, expiry and idempotency | 289882c1bb611fca50070c99a25d41b7038ba6aa |
| [#393](https://github.com/Mtman1987/ApolloStation/pull/393) | Add live Nebula Mosaic cards/progress to Discord dashboard | merged; inspect PR for exact SHA |
| [#394](https://github.com/Mtman1987/ApolloStation/pull/394) | Publish canonical Discord Stream Hub XP leaderboard cards and rank buttons | merged; inspect PR for exact SHA |
| [#395](https://github.com/Mtman1987/ApolloStation/pull/395) | Generate leaderboard PNGs for Discord publishing | merged; inspect PR for exact SHA |
| [#396](https://github.com/Mtman1987/ApolloStation/pull/396) | Credit Space Mountain front-seat winner 100 Nebula game points, with durable receipt and retry | cf63f42a55347295a778547b61441d78fae26de0 |
| [#397](https://github.com/Mtman1987/ApolloStation/pull/397) | Add persistent Stella ambient Twitch lounge host | fe0a36d49cd5f9ad2d87174303a3e394b4db7842 |

PRs #388–#397 were all confirmed merged/closed during this refresh. The open-PR
query returned none. The latest HEAD had no workflow-run records or combined
commit-status contexts visible through the connector at inspection. **Do not
claim CI passed** based on merge status alone. PR #396 and #397 descriptions
explicitly say CI had not reported results when merged.

### What the latest code actually does

- **StreamWeaver Go Live:** production Go Live now has Twitch-ingress scoping,
  authenticated Restream worker wiring, Twitch preflight/live verification, and
  a production-path regression for the resolved channel configuration. Verify
  runtime configuration and live-provider acceptance separately; no deployment
  or live rehearsal was performed.
- **Stella ambient host:** apps/streamweaver/src/stella-lounge-host.ts adds a
  persistent, tenant-scoped, leased 6–12 minute text host loop. It is restricted
  to the configured SpaceMountainLive Twitch connection, skips when Twitch is
  offline or a BRB program is active, uses existing check-in/watch-time/stream
  context, and sends only through Chat Gateway egress. It has cooldown/topic
  history and stable retry idempotency. This is **chat-only deterministic
  behavior**: donor AI conversation, TTS audio, avatar/overlay gestures and
  choreography are still open.
- **Nebula / Quackverse:** PR #392 supplies the actual browser trade workflow;
  the prior pure trade rules alone were not enough. PR #393 adds Mosaic cards
  to the Discord dashboard. PR #396 bridges the front-seat winner bonus into
  Nebula's game-point balance with durable retry.
- **Discord Stream Hub:** PRs #394–#395 add leaderboard publishing controls and
  PNG generation. These are specific verticals, not proof of complete DSH parity.

### Next AI: continue from this point, don't restart discovery

1. Fetch latest main and inspect current source/tests before changing anything.
2. Highest-value StreamWeaver follow-up: inspect the donor's Stella voice/AI,
   transcript/Commander listener, TTS and avatar/overlay behavior; compare with
   Apollo's actual mounted paths and implement only real missing behavior. Keep
   no-paid-AI constraints and route all provider writes through Chat Gateway.
3. Verify Go Live configuration/adapter construction from the production
   Chat Gateway entrypoint, then design an authorized live acceptance rehearsal.
   Do not claim it is operational merely because code is merged.
4. Continue Nebula/Mosaic and Discord Stream Hub parity from donor workflows,
   but first check what PRs #392–#395 already implemented. Do not duplicate
   Quackverse trading or leaderboard work.
5. Keep the user's requested priority order: StreamWeaver, Nebula/Chat Tag,
   Discord Stream Hub; then Lounge; HearMeOut last. Preserve Restream and
   OverlayBay behavior and regression-test them rather than rewriting them.
6. Each completed vertical should have focused tests, exact CI evidence, and be
   merged into main; avoid leaving a queue of unfinished feature branches/PRs.

### Hard boundaries

- GitHub repo-to-repo work only. **Do not use Fly.io, deploy, restart, or alter
  Fly secrets/volumes.** The user explicitly ruled Fly.io out.
- No production credential reads, secret edits, DNS changes, or provider writes
  without explicit authorized acceptance.
- A merged PR is not a passing test, live provider acceptance, or production
  readiness. Inspect actual workflow findings and test counts.
- Keep Lounge 24/7 continuity in mind; do not destabilize it during parity work.
- User wants concrete repo changes and a durable handoff, not terminal instructions
  or status-only narration.

---

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
