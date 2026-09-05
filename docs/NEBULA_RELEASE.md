# Nebula release build — 5 September 2026

This is a repository release, with no deployment performed. Main pushes run checks; Sprite promotion requires an explicit manual workflow dispatch. Keep the existing live service running until the launch operator switches it.

Compared against `Mtman1987/chat-tag` main `42cb6401b3adf87a8c008474787d05d1dcf757db`, the source revision observed in the successful live deployment. Apollo owns the implementation and assets; it does not need a checkout of the old application to run.

## Included behavior

| Live responsibility | Apollo implementation |
|---|---|
| Twenty games and native game displays | Existing game registry, native widgets, guide pages and Overlay Bay mixes |
| Command isolation and game aliases | Complete leading `spmt` token; compact/spaced names; active-game help/rules; `commands` alias |
| Participation across streams | Persistent player pool; per-game exclusions; canonical linked identities; recent channel counts |
| Cross-channel activity display | Optional personal/public mix activity box; 30-second visibility after `spmt` |
| Global channel/player exclusions | Durable administration and import; blocks gameplay, Tag targeting and automation; preserves scores |
| Tag | Live presence polling, automatic rotation, announcement fanout, passes, support-event rewards, monthly crowns, Pin counters, moderator controls |
| Cross-room Quackverse ownership | Shared collections, daily pack limits, owned-card decks, saved decks and match records; room-specific battles |
| Quackverse rules | Live ability/equipment/stat rules, fatigue, special resources, five formations, NPCs, seat control, draw/discard and turn flow |
| Bingo | Network-wide personal cards, editable shared phrases/center, one contribution per stream, claims and win rewards, reset, themed AI generation |
| Card art | 101-card catalog; 16 packaged image/animation files; fallback card faces; upload/delete, canon prompts, image jobs, batch ranges and cancellation |
| Pack presentation | Initial Discord pack message, durable render job, GIF update on that same message, failure presentation and delayed cleanup |
| Rendering | Concrete DSH SVG/image-to-GIF and enhancement workers using Resvg and ffmpeg; durable media URLs |
| Support | Durable private inbox, explicit private Discord destination, resolution and notification |
| Controls | Authenticated room selector, collections/decks/battle controls, Bingo controls, scores, blacklist, settings and Art Studio |
| Data migration | Fresh-database import of players, wallets, collections/decks, battles, Bingo, opt-outs, Pin counters, support, mixes and custom art volume |

The settings editor exposes appearance for all twenty games and the implemented native timer/capacity/category controls. Word Chain's live validator checks structure and repeated words; it has **no semantic dictionary**. Categories choose starter words. Native widgets still own their browser round state, as in the live source; separate browser instances can diverge. Card balance and remaining native mechanics are editable source files, not invented administration options.

## Build and verify

Use Node 22.16 or newer, npm and ffmpeg. Install the complete repository, including binary assets.

```sh
npm ci
npm run test:offline
npm run nebula:check
```

The check is local and does not contact providers or deploy anything. Focused coverage is in `tests/nebula-live-parity-build.test.mjs`, with existing command, provider, overlay, migration, simulation and DSH tests in the full suite.

## Preserve the live data

Take a consistent export of the live app state and its `quackverse-card-art` volume while writes are stopped or snapshotted. Retain those originals as the rollback source. Supply an identity map from old IDs to canonical SPMT user IDs; the importer does not guess identity by display name. Accounts must have their provider identities linked in SPMT for cross-provider recognition.

```sh
npm run nebula:import -- --source=/secure/app-state.json --tenant=YOUR_TENANT --identity-map=/secure/identities.json
npm run nebula:import -- --source=/secure/app-state.json --tenant=YOUR_TENANT --identity-map=/secure/identities.json --art-directory=/secure/quackverse-card-art --output=/srv/apollo/data/nebula.sqlite
```

Omitting `--output` is a dry run. An import refuses an existing target, writes a staging database, and renames it only after all imports succeed. Custom art referenced by the export requires the art directory. Tokens, sessions, provider grants, passwords and webhooks are excluded. Compare reported player/card/deck/board/ticket/art counts with the export before launch. Old overlay profiles retain their game selection and equivalent rotation/grid/focus layouts; issue their current OBS URLs through Overlay Bay.

## Configure the production services

Copy `config/nebula-release.env.example` and `config/nebula-arcade-runtime.production.example.json` into protected deployment configuration. Replace placeholders and add the matching Chat Gateway Discord connections. Browser and provider runtime **must use the same Nebula SQLite path**. Set `NEBULA_ARCADE_CHANNEL_ID` to a configured `stateChannelId`; the controls can select other configured rooms.

Register the same service credentials with SPMT and their workers. Enable `SPMT_NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED=1` and `SPMT_CHAT_GATEWAY_ENABLED=1` on SPMT. Nebula receives event, XP, runtime and execution-job scopes; Chat Gateway alone receives provider grants. Install the apps for the tenant and retain the existing SPMT execution/billing capability registrations.

The launch operator runs the existing supervised services with these entry points:

| Process | Entry point / requirement |
|---|---|
| SPMT | Existing production authority/identity service, with the reconciled Nebula identity |
| Nebula web | `npm run nebula:serve` — authenticated production host, default loopback port 3100 |
| Chat Gateway | `node apps/chat-gateway/dist/service-start.js` — Nebula consumer, presence, delivery and media-job reconciliation |
| DSH worker | `node apps/discord-stream-hub/dist/live-worker-start.js` — active mode, ffmpeg, public origin and configured tenants |
| DSH web | Existing DSH web service sharing the worker's `DSH_DATABASE_PATH`; serves `/apps/discord-stream-hub/api/media/*` |
| StreamWeaver image worker | Existing configured provider runtime with SeaArt token/model/version; needed for new AI card images |
| Stellar Core | Existing healthy chat worker; needed for themed Bingo generation |
| SpaceMountain | Existing front door with `NEBULA_ARCADE_ORIGIN=http://127.0.0.1:3100`; preserve the browser Host and cookies when proxying |

Set `DSH_MEDIA_SOURCE_ORIGINS` to the Nebula public origin and the exact image-provider output origins. Arbitrary render-source URLs and redirects are rejected. Pack GIFs/enhancements work without AI image generation; manual Bingo phrase editing works without Stellar.

Use a private administrator Discord channel for `supportChannelId`. `packChannelId` selects the pack destination. Both must match configured Discord connections. If no support destination is configured, tickets remain available in the authenticated inbox.

`autoJoinLivePlayers` defaults to false. Enabling it follows eligible live Tag players using the tenant's existing authorized Twitch bot account, excludes blacklisted channels, adds at most five connections per presence refresh, and caps dynamically followed channels at 100. Fresh presence is required; polling failure does not mean everyone is offline. Competitive seat/team choices remain separate from pool enrollment.

After loading the real environment, run `npm run nebula:check -- --production`. This validates configuration and database integrity without opening provider connections. Start services through the existing process manager only during the separately scheduled launch.

## Launch evidence still required

This build's offline results do not prove that production credentials, tenant grants, imported identities, public reverse-proxy paths, provider image output origins or OBS sources are correct. The launch operator must verify the real import counts, signed-in controls, two-stream commands, provider reconnect/restart, Discord update/cleanup and current OBS output. Keep the existing release and original data available for rollback. No production data was imported, no paid generation was requested, and no live message or deployment was performed during this build.
