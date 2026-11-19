# HearMeOut production authority

Effective 2026-09-23, ApolloStation is **not** a production HearMeOut authority.

- Production HearMeOut is `Mtman1987/hearmeout-main` at `https://hearmeout.spacemountain.live/`.
- Apollo's app catalog must launch the Live HMO URL, not `/apps/hearmeout`.
- Apollo must not poll, mirror, advance, or control the Live HMO Lounge queue.
- Apollo release environment wiring must not create `HearMeOutLiveLoungeBridge`.
- Apollo's network guard must block the retired Live HMO `/api/internal/lounge/media` endpoint.
- The Apollo HearMeOut implementation may remain as development/reference code, but it is not a fallback or production route.
- Replacing Live HMO requires a separate explicit atomic cutover; both implementations must never act as simultaneous production authorities.
