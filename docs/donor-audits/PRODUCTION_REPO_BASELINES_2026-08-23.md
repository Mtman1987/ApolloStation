# Production repository baselines

Captured: 2026-08-23

Purpose: freeze the current deployed donor code used for the complete Apollo parity rebuild. These repositories remain read-only Blue evidence. Green implementation happens only in ApolloStation.

| Product/authority | Donor repository | Audited head | Deploy/process evidence |
|---|---|---|---|
| SPMT authority | `Mtman1987/spmt-live` | `bbd335ce8083b540ba9c7f8468edbfbfa46fc5d5` | Fly app `spmt-live`; `app` and isolated `xbox` process groups |
| SpaceMountain front door | `Mtman1987/spacemountain-live` | `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43` | Fly app `spacemountain-live` |
| StreamWeaver | `Mtman1987/streamweaver` | `387acf70552f9a6a557a83e8804c328245932961` | Fly app `streamweaver-new`; web plus persistent WebSocket surface; desktop Companion source is inside this donor |
| Discord Stream Hub | `Mtman1987/DiscordStreamHub` | `e35a1b06479adf73565da9b3a7eff4dc27ebe38b` | Fly apps `discord-stream-hub-new` and `dsh-clip-worker`; Discord ingress/watch processes also require audit |
| HearMeOut | `Mtman1987/hearmeout-main` | `686d237fbb5bfa56f2356dba9dfdb7c023d5ac23` | Fly apps `hearmeout-main` and `hmo-dj-worker` |
| ChatTag / Nebula Arcade donor | `Mtman1987/chat-tag` | `8170c51b04598774cbaa67981888e30b0c51f2fd` | Fly apps `chat-tag-new` and `chat-tag-bot-new` |
| Rotator, MountainView and local LLM operations | `Mtman1987/fly-machine-rotator` | `66e66b8b8502a6cf1dd94aee0163c443459a6d08` | Fly apps `mtman-machine-rotator` and `spmt-llm-worker`; MountainView server/mobile code is inside this donor |

## Inventory boundary

Repository configuration currently proves eleven named Fly apps plus the separate SPMT `xbox` process group. The owner reports roughly thirteen live Fly apps. The remaining live app/Machine names must be captured from Fly before the production inventory can be called complete; they must not be guessed or silently omitted.

Companion and MountainView are real product capabilities even though their current source is nested inside StreamWeaver and Rotator rather than represented by independent donor repositories. Apollo gives them bounded app modules while preserving their working desktop/mobile/device behavior.

The connected GitHub account exposes 31 repositories owned by `Mtman1987`. The seven donor repositories above are the currently identified production sources; ApolloStation is the Green destination. The remaining 23 repositories are **not silently excluded**. They stay in the discovery queue until Fly configuration, current launch targets, imports, and owner confirmation classify each one as an active product, a data/asset dependency, a superseded generation, an experiment, or an approved removal.

| Classification | Repositories |
|---|---|
| Green destination | `ApolloStation` |
| Identified production donors | `spmt-live`, `spacemountain-live`, `streamweaver`, `DiscordStreamHub`, `hearmeout-main`, `chat-tag`, `fly-machine-rotator` |
| Separate worker or asset candidates requiring dependency verification | `hmo-dj-worker`, `spcmtn-pokemon_assets-prod`, `clipconvertetr` |
| Product/release candidates requiring live-use verification | `Cosmo`, `Nebula-Link`, `Cosmic-Forge`, `Avatar-Ace`, `lottie-ai-stream`, `CosmicRaid`, `SentientStudio-`, `fireforgeai`, `Injekt-Prompt-Manager` |
| Likely predecessor/experiment candidates; no removal without proof | `nexus-hub1.1`, `studio`, `cosmo2.0`, `cosmo2.0-main`, `StreamWeave`, `streamweaver-v2`, `streamweaver3.0`, `streamweaver4ev4`, `hearmeout`, `codespaces-blank` |
| Already archived | `space-mountain-dashboard` |

This GitHub catalog is repository evidence, not a Fly deployment inventory. A repository can contain several Fly apps/processes, while a nested product may have no repository of its own.

## Port rule

Every donor head above must be inventoried for pages/routes, APIs, commands, aliases, permissions, provider listeners, WebSockets/events, overlays, workers/process groups, scheduled jobs, auth, state, volumes, caches, external APIs, health, and recent fixes. File copying is not the objective: retain working user behavior, move shared facts behind SPMT public developer contracts, keep genuine app-private state private, and leave obsolete implementation paths behind only after their capability mapping is proven.

No app is marked ported merely because an Apollo package or manifest exists.
