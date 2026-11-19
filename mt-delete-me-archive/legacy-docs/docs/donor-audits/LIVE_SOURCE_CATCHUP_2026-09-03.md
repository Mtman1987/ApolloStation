# Live-source catch-up

Captured: 2026-09-03

Target: ApolloStation `main`

The current `main` of every counterpart repository was fetched and compared with the 2026-08-30 baselines. Features were implemented behind Apollo's existing app ownership and SPMT SDK/job boundaries. No live Fly application, provider account, volume, credential, DNS record, or external service was created or mutated.

## Result

| Live repository | Audited `main` | Apollo result |
|---|---:|---|
| `Mtman1987/spmt-live` | `df18ae6` | Restart-safe behavior is already provided by Apollo's supervised services, pinned workspace lockfile, and restart-durable stores. Donor bootstrap patching was not copied. |
| `Mtman1987/spacemountain-live` | `3dcb653` | Silent one-shot session recovery and transient-outage shell retention ported. Explicit logout cannot trigger recovery. |
| `Mtman1987/streamweaver` | `a29dd7e` | Card-pack event/render handoff, multi-provider image generation, SeaArt async image/video tasks, multi-image results, rich live groups, public HearMeOut persona/STT/TTS facade, and The Count rules ported. Existing bilateral BotShare and human relay remain intact. |
| `Mtman1987/DiscordStreamHub` | `d97af86` | Spotlight, channel nuke, Signal presentation/removal/repeat breadcrumbs, durable settings, one-at-a-time Nebula capture, card-pack renderer, message upgrade, and Quackverse art rendering ported. |
| `Mtman1987/hearmeout-main` | `c12415b` | Public persona gallery, exact typed/local wake routing, explicit eight-second browser Talk recorder, bounded STT, healthy worker presence, shared typed/spoken command path, TTS handoff, stale-presence cleanup, and final PCM-frame padding ported. Cloud ambient wake/STT is intentionally absent. |
| `Mtman1987/chat-tag` | `42cb640` | All 101 Quackverse canon groups, deterministic presentation and species locks, visual canon, SPMT art-render handoff, unified pack payload, static-first Discord send, same-message GIF edit, and terminal render-failure presentation ported under Nebula/DSH ownership. |
| `Mtman1987/fly-machine-rotator` | `01cc5d4` | Android foreground local-only Athena/Annie wake and Windows offline Athena wake ported to MountainView/Companion. Existing Apollo recovery, import rehearsal, fleet policy, and provider-grant boundaries remain authoritative. |

## Ownership boundaries

- Nebula Arcade owns Quackverse rules, collection state, canon, art direction, and pack presentation data.
- StreamWeaver owns persona execution, TTS/STT provider selection, image generation, overlays, and card-pack events.
- Discord Stream Hub owns Discord credentials, message create/edit/delete, capture workers, GIF publication, and Quackverse enhancement/animation.
- HearMeOut owns room membership, explicit browser microphone capture, presence validation, and audio transport.
- MountainView and Companion own device-local wake capture. Ordinary room audio is not uploaded for ambient wake detection.
- SPMT owns identity, scoped provider grants, durable metered jobs, events, and runtime/worker projections.

## Verification boundary

`tests/live-counterpart-catchup.test.mjs` exercises the new behavior without network access. The full offline suite remains the code-parity gate. Live provider credentials, Discord permissions, microphone/foreground-service behavior, FFmpeg/browser capture, TTS/STT providers, and physical multi-monitor/OBS behavior still require the owner's real-environment test; passing offline tests does not claim those external systems were exercised.

Production replacement remains blocked by the existing reconciliation, external rehearsal, backup/restart/rollback, runtime inventory, and owner-acceptance gates.
