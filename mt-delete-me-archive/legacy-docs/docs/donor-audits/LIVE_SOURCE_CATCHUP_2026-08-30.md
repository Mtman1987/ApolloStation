# Live-source catch-up and local-mirror retirement

Captured: 2026-08-30

Target: ApolloStation `work/live-slice-retirement-2026-08-30`

Every counterpart repository was fetched at current `main` and its newest two commits were reviewed. Future source checks use GitHub remote `main`; behavior checks use the running Fly slice. No running Fly app, volume, machine, credential, or deployment was changed by this catch-up.

## Result

| Live repository | Audited `main` | Result |
|---|---:|---|
| `Mtman1987/spmt-live` | `e8241ad` | No new delta since the prior Apollo catch-up. |
| `Mtman1987/spacemountain-live` | `1dc2c1f` | No new delta. Apollo visuals remain authoritative. |
| `Mtman1987/streamweaver` | `2079862` | No new delta. Human relay and BotShare hardening remain covered by regression tests. |
| `Mtman1987/DiscordStreamHub` | `36cb164` | New gameplay default-slot fix and its surrounding real-gameplay/clip-GIF changes were ported. |
| `Mtman1987/hearmeout-main` | `37b6ef3` | No new delta. Authenticated room/media/voice action boundaries remain covered. |
| `Mtman1987/chat-tag` | `0dd1dd8` | New public gameplay manifest and embed refresh path were ported under the Nebula Arcade identity. |
| `Mtman1987/fly-machine-rotator` | `9f92c0d` | No new applicable delta; Apollo has no automatic LLM-worker deployment workflow. |

## Ported changes

- Nebula exposes a public, credential-free manifest for all 20 games and dedicated 800×450 capture pages backed by Apollo's actual durable player, score, and action state.
- DSH durably stores gameplay GIFs, captures at most two missing games per reconciliation, serves the current rotation with the corrected default-slot behavior, and falls back to the lightweight Nebula GIF when no capture is ready.
- Gameplay capture remains 60 seconds at 10 fps, output width 480, with a bounded 128-color diff palette and Bayer dithering. The displayed game changes every 10 minutes.
- The general DSH clip library keeps the newest 10 GIFs per tenant/streamer and applies the same 60-second/10-minute policy.
- The Nebula Discord dashboard refresh signature includes the 10-minute slot, keeps an exact three-column status row and three-column announcement row, and uses the current player's provider avatar as the thumbnail.
- Discord and Kick avatar URLs now flow through normalized Chat Gateway identity into durable Tag player state with credential-free HTTPS validation.
- The 20-frame static banner is fallback-only and its frame duration is doubled from 1450 ms to 2900 ms.

## Preserved hardening

The prior human-relay and BotShare boundary remains unchanged: any person may explicitly relay a message; explicit human-directed delivery does not consult BotShare; autonomous bot-to-bot delivery requires both tenants to opt in; identity resolution fails closed on unknown or ambiguous targets; durable replies are recipient-bound and expire; and deterministic relay handling runs before persona AI.

## Retired workflow

The pinned frozen-source guard, donor cutover script, and local-clone requirement are superseded by `config/live-source-slices.v1.json`, `scripts/audit-live-slices.mjs`, and the running live slices. Production cutover remains blocked on real data reconciliation, credentials, backup/restore, two-tenant testing, inventory, owner acceptance, and rollback evidence—not on retaining old source clones.
