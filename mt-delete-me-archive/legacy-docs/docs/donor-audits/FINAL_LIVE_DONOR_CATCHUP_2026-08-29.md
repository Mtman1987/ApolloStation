# Final live-donor catch-up

> Superseded on 2026-08-30 by `LIVE_SOURCE_CATCHUP_2026-08-30.md`. Frozen local mirrors and the pinned-head workflow were retired; future comparisons use remote `main` plus the running live slice.

Captured: 2026-08-29

Target: ApolloStation `work/final-live-donor-catchup-2026-08-29`

Purpose: re-read every known live donor at its current `main`, retain ApolloStation's visual system, and port the post-audit behavior changes before the final production test battery.

## Current donor heads

| Donor | Prior audited head | Current `main` | Catch-up disposition |
|---|---|---|---|
| `Mtman1987/spmt-live` | `bbd335ce8083b540ba9c7f8468edbfbfa46fc5d5` | `e8241ad` | Signal identity behavior retained in DSH; Commlink bootstrap patches are donor-deployment-specific and do not apply to Apollo's typed bootstrap. |
| `Mtman1987/spacemountain-live` | `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43` | same | No delta. Apollo visuals remain authoritative. |
| `Mtman1987/streamweaver` | `387acf70552f9a6a557a83e8804c328245932961` | `2079862` | Relay, two-way replies, bot-action routing, natural calendar commands, pinned Count identity, and complete AI replies retained. |
| `Mtman1987/DiscordStreamHub` | `e35a1b06479adf73565da9b3a7eff4dc27ebe38b` | `561598b` | Signal Seeker, ten-minute drops, role-aware GIFs, and DSH-owned bot actions retained. |
| `Mtman1987/hearmeout-main` | `686d237fbb5bfa56f2356dba9dfdb7c023d5ac23` | `37b6ef3` | Persona room audio plus authenticated room/media/voice bot-action boundaries retained. |
| `Mtman1987/chat-tag` | `c4b99179eff47e41e920603f96f6342b04390eee` | `7d762b8` | Nebula Arcade Discord identity, compact embed, animated 20-game showcase, and large preview retained. |
| `Mtman1987/fly-machine-rotator` | `66e66b8b8502a6cf1dd94aee0163c443459a6d08` | `9f92c0d` | Workflow-only cost guard. Apollo has no automatic LLM-worker deployment workflow, so no application code is required. |

Short SHAs above identify the fetched source commits. The frozen-hash guard was retired on 2026-08-30; current heads are recorded in `config/live-source-slices.v1.json`.

## Retained behavior

### Human relay and BotShare boundary

- Every non-bot community member may explicitly relay a message with deterministic `tell`, `send`, `pass`, `message`, `dm`, or `relay` language.
- Explicit human-directed relays never consult BotShare.
- Autonomous bot-to-bot delivery requires BotShare to be enabled for both the source and destination tenant; the default is disabled.
- Targets resolve through recently observed canonical, Discord, Twitch, or Kick identities. Ambiguous or unknown targets fail without guessing.
- Quoted spans are preserved byte-for-byte.
- Reply threads are durable, expire after ten minutes, accept `reply <message>` or `yes <message>`, close on `no`, and enforce the intended recipient before routing a response to its exact origin.
- Relay detection and replies run before conversational persona AI.

### Chat Tag / Nebula Arcade Discord dashboard

- The dashboard uses `Nebula Arcade · Chat Tag Live` with the Nebula Arcade webhook name and optional avatar URL.
- Current Tag, Recent Tags, and Top 3 occupy one compact inline row; up to three announcement fields occupy the next row.
- The embed links to all 20 equal games and uses the 800×450, 20-frame showcase GIF at 1450 ms per frame.
- The games page emits Open Graph and `summary_large_image` metadata when a public HTTPS origin is configured.
- Chat Gateway owns the Discord grant and webhook credential. Nebula stores only its durable message ID and transport, edits the existing message, and falls back to bot posting without persisting a webhook token.
- Apollo's existing Nebula page body, themes, navigation, and artwork remain unchanged.

### DSH Signal and banner improvements

- DSH owns the Signal Seeker opt-in role presentation and allows only that role in drop mentions.
- Drops expire after ten minutes; first claim wins through an atomic, provider/canonical identity-bound update.
- The reward explains the unlocked `!signal <message>` path without requiring app sign-in.
- Banner roles resolve to Commander only for the pinned owner identities, Crew only for Crew, and Mountaineer for everyone else.
- One seamless two-copy template uses a deterministic 960×100, 10 fps, 20-second animation. The GIF plan uses 96-color diff palettes and bounded Bayer dithering.
- Banner bytes are durable and reused only when both the role and generator version match.

### Suite bot actions and HearMeOut

- StreamWeaver exposes the 20 persona-neutral DSH, HearMeOut, and image action descriptors with minimum roles and explicit risk classes.
- Deterministic action recognition runs before AI. Natural DSH Admin Calendar entries, broadcasts, application decisions, media controls, tenant-bot room controls, and voice-bridge controls are represented.
- A shared dispatcher selects the app-owned adapter; provider tokens and mutations remain inside the owning app.
- HearMeOut rejects media requests without a room rather than leaking them into a global queue, restricts media controls to the safe set, filters private rooms, and reuses its canonical room/media and voice-bridge authorities.
- Tenant personas join with a service session, can publish bounded TTS audio to their LiveKit room track, and require room-owner/admin control.

### Provider and AI hardening

- The Count uses the shared encrypted provider credential authority with owner-only authorization, an immutable Twitch user/login pin, least-scope chat permissions, and short-lived downstream grants.
- Stellar Core detects token-limited or visibly incomplete provider output, requests at most two bounded continuations, removes overlap, aggregates usage, and refuses to publish a still-incomplete reply.

## Deliberately not copied

- Donor bootstrap scripts, protected-production patches, Firebase/file vaults, direct provider sockets, and app-private HTTP shortcuts were not copied. Apollo already owns these concerns through its supervised workers, SQLite authorities, Chat Gateway, provider grants, and app adapters.
- The rotator's manual-only LLM deployment change has no matching Apollo workflow: Apollo's Sprite promotion does not deploy a separate model worker.
- No donor UI was imported. ApolloStation remains the visual authority.

## Verification and cutover status

The implementation is covered by focused regression tests for relay/BotShare, DSH banners and Signal claims, suite bot actions, HearMeOut boundaries, pinned provider identity, complete Stellar replies, the Nebula dashboard, webhook update behavior, GIF timing, and social metadata. The full `npm test` merge gate passed on 2026-08-29 with 565 tests passing and zero failures.

Source merge does **not** retire a donor machine. Production cutover remains gated by provider-credential rehearsals, production data reconciliation, backup/restore, two-tenant live testing, DNS/promotion verification, and an explicit rollback checkpoint.
