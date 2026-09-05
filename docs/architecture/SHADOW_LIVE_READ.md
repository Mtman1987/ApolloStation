# Live read with Simulation Rooms

Status: public production reads and provider ingress are enabled without a developer-created credential. Provider egress is replaced by durable, tenant-scoped Simulation Rooms.

## Boundary

The supervised Sprite continues to run with `SPMT_RUNTIME_MODE=sandbox` and `SPMT_OUTBOUND_MODE=disabled`. Each app web process authenticates the browser against the local SPMT session first, then reads approved public production projections from `https://spmt.live` on the server.

- No GitHub secret, pasted bearer token, token file, or feature token enables this mode.
- The offline network guard permits only `GET` requests to the exact configured HTTPS origin.
- The Sprite network policy permits only that production hostname in addition to build dependencies and still ends with a wildcard deny rule.
- A failed production read is shown as unavailable. It does not silently fall back and label sandbox data as live.
- Workers, SPMT, Chat Gateway, and the model runtime receive no production credential.

The `blue-v1` projection adapter reads the existing production API contracts that have a safe counterpart: apps/runtime, platform events, overlay workspace, XP, Athena capabilities, and the current identity. Sources with no production read counterpart remain explicitly unavailable.

## Voice Commander

StreamWeaver receives `operationMode=read-only` whenever outbound mode is disabled. Voice Commander remains visible and can capture a transcript in the browser. It applies the shared suite-action risk catalog as follows:

- `read` actions enter the local app-owned job pipeline and inspect current tenant state;
- `write` and `broadcast` actions enter that same pipeline with `source.simulation=true`; app-owned workers must preview them without changing provider, room, media, persona, or voice state;
- external image generation remains preview-only and does not create a provider job;
- free-form assistant invocations remain blocked so live chat is not disclosed to an external model;
- Twitch/Discord sends are accepted only as Simulation Room deliveries and never call a provider API;
- the UI displays `Live input · provider replies go to shadow rooms`.

This policy is enforced by the server. The UI label is explanatory, not the security boundary.

## Authentication boundary

Deployment always supplies the fixed `https://spmt.live` read origin. Public projections can therefore flow into Apollo immediately with no developer setup.

Private identity, XP, provider-link, and tenant projections still require real SPMT authorization. They must use the existing SPMT OAuth authorization-code flow and read-only scopes. Apollo must not create a parallel access token or ask a developer to paste one into GitHub. Until production registers Apollo's exact Sprite callback as a first-party/public OAuth client, those sources remain truthfully unavailable.

## Provider ingress

Chat Gateway also recognizes `SPMT_LIVE_INGRESS_MODE=enabled` with outbound disabled. In that mode it requests provider read scopes and starts the same StreamWeaver and Nebula consumers used by the active runtime. Discord Stream Hub applies the same flag to its Twitch live monitor and live Discord server/channel selectors. The only registered Twitch, Discord, and Kick chat senders are SQLite-backed shadow senders; the real provider sender objects are not registered with the gateway. DSH wraps its Discord client in a read-through/write-shadow transport: guild and channel lists remain live, while create, edit, delete, direct-message, shoutout, spotlight, calendar, and application delivery become exact Simulation Room previews. Each received provider message is also published as `spmt.simulation-room.event.v1`. Provider credentials come from the existing SPMT provider-grant authority; Apollo does not invent a second credential system.

Simulation Rooms are an ecosystem service rather than a Chat Gateway or StreamWeaver feature. The shared SDK publishes through the dedicated tenant-authorized `/v1/simulation-rooms/events` endpoint and reads the typed room event through the event API. The dedicated write endpoint accepts an existing signed-in tenant session or an app's existing `events:write` authority; it does not require a second development token and cannot publish arbitrary event types. Its lanes are `chat`, `overlay`, `game`, and `app`; its directions are `ingress`, `egress`, and `preview`. The contract rejects embedded credentials and bounds structured preview data.

The room viewer lives in the shared workspace footer beside Overlay Bay, Personal/Public output controls, and shared settings. It opens and closes over any app like the three persistent workspace slots. StreamWeaver publishes flow-builder and Voice Commander routes, Discord Stream Hub publishes exact selected-server/channel payloads, HearMeOut publishes safe command results, Overlay Bay publishes scene/alert previews, and Nebula Arcade publishes game results. Every app uses the same SDK contract rather than depending on StreamWeaver. Tenant authorization, not a caller-supplied room token, is the isolation boundary.

Native StreamWeaver economy and command-directory behavior remains built in and is not represented as downloadable community flow packages. Community packages begin outside every account and contain one primary command, any feature-specific add-on commands, their action nodes, and explicit `actionIds` wiring as one atomic JSON install unit.
