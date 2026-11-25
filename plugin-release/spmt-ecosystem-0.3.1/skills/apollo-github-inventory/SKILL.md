---
name: apollo-github-inventory
description: Reference inventory of owner-supplied ApolloStation GitHub Actions secret names and workflow catalog; names only, never values.
---
# ApolloStation GitHub Actions inventory

This is the owner-supplied GitHub Actions secret-name inventory transcribed on 2026-11-23, plus the separately confirmed owner PAT added on 2026-11-25. It contains names only, not values. The pre-existing approved runtime secrets have already been migrated into Hostless app server secrets; the GitHub administration PAT is intentionally GitHub-Actions-only and is not a Hostless runtime secret.

## Rules

- Use the names already present in source/workflows; never ask the owner to paste them again.
- Never request, print, log, commit, package, or store secret values.
- Do not invent aliases, replacement names, or new credential requirements.
- Do not re-upload, re-copy, or repeat the one-time Hostless migration.
- GitHub secret presence alone is not runtime proof; inspect the relevant workflow mapping only when a concrete issue requires it.
- Historical `SPRITES_TOKEN` and Node 3 names are legacy inventory entries only. They do not authorize or imply Sprite, Fly, or Node 3 runtime use.
- `SPMT_GITHUB_ADMIN_TOKEN` is an owner-approved GitHub fine-grained PAT stored in GitHub Actions repository secrets in `Mtman1987/ApolloStation` and `Mtman1987/spmt-live`. It is not a Hostless app secret and must not be injected into app runtime.

## Environment secrets

| Name | GitHub Environment |
|---|---|
| `SPRITES_TOKEN` | `sprite-review` (historical) |
| `SPRITES_TOKEN` | `sprite-release` (historical) |
| `STREAMWEAVER_KEENTOOLS_API_KEY` | `sprite-release` (historical scope) |
| `STREAMWEAVER_MESHY_API_KEY` | `sprite-release` (historical scope) |

## Repository secrets

The owner-supplied inventory included these names. The new PAT secret is included at the end:

`ALLOW_DATA_FILE_IO`, `ANTHROPIC_API_KEY`, `APOLLO_PREVIEW_PASSWORD`, `BOSS_KEY`, `BOT_SECRET_KEY`, `BRB_BROWSER_SOURCE`, `BRB_SCENE`, `CHAT_GATEWAY_WORKER_CREDENTIAL`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_HEAD_UPLOAD_WEBHOOK`, `DISCORD_INVITE_LINK`, `DISCORD_PUBLIC_KEY`, `DISCORD_WEBHOOK_URL`, `DSH_SERVICE_SECRET`, `DSH_WORKER_CREDENTIAL`, `EDENAI_API_KEY`, `FREE_CONVERT_API_KEY`, `GAMBLE_OVERLAY_SCENE`, `GAMBLE_OVERLAY_SOURCE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_API_KEY`, `GOOGLE_GENAI_MODEL`, `HARDCODED_GUILD_ID`, `HOSTLESS_NODE1_TOKEN`, `HOSTLESS_NODE2_TOKEN`, `HOSTLESS_NODE3_TOKEN` (historical), `INTERNAL_API_BASE_URL`, `INWORLD_BASE64_API_KEY`, `INWORLD_JET_SECRET`, `INWORLD_JWT_API_KEY`, `KOKORO_AUTH_TOKEN`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `NEBULA_ARCADE_WORKER_CREDENTIAL`, `NEXT_DEFAULT_TTS_VOICE`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_DISCORD_CLIENT_ID`, `NEXT_PUBLIC_HARDCODED_GUILD_ID`, `NEXT_PUBLIC_STREAMWEAVE_PORT`, `NEXT_PUBLIC_STREAMWEAVE_URL`, `NEXT_PUBLIC_STREAMWEAVE_WS_HOST`, `NEXT_PUBLIC_STREAMWEAVE_WS_PORT`, `NEXT_PUBLIC_STREAMWEAVER_WS_URL`, `NEXT_PUBLIC_TWITCH_CLIENT_ID`, `NEXT_PUBLIC_USE_TTS_PLAYER`, `NEXT_PUBLIC_WEBSOCKET_URL`, `NGROK_AUTHTOKEN`, `NODE1_TURSO_AUTH_TOKEN`, `NODE2_TURSO_AUTH_TOKEN`, `NODE3_TURSO_AUTH_TOKEN` (historical), `OBS_WS_URL`, `OPENAI_API_KEY`, `POKEMON_COLLECTION_OVERLAY_SCENE`, `POKEMON_COLLECTION_OVERLAY_SOURCE`, `POKEMON_PACK_OVERLAY_SCENE`, `POKEMON_PACK_OVERLAY_SOURCE`, `POKEMON_TRADE_OVERLAY_SCENE`, `POKEMON_TRADE_OVERLAY_SOURCE`, `SHOTSTACK_API_KEY`, `SHOUTOUT_BROWSER_SOURCE`, `SHOUTOUT_SCENE`, `SPMT_PROVIDER_CREDENTIAL_KEY`, `SPMT_SESSION_BRIDGE_JSON`, `SPMT_WEBHOOK_KEY`, `STREAMWEAVER_KEENTOOLS_API_KEY`, `STREAMWEAVER_KEENTOOLS_API_KEY_SECOND`, `STREAMWEAVER_WORKER_CREDENTIAL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, `TWITCH_REDIRECT_URI`, `USE_TTS_PLAYER`, `VENICE_API_KEY`, `VIP_ENABLE_TEST_LIVE`, `WS_PORT`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `SPMT_GITHUB_ADMIN_TOKEN`.

## Runtime boundary

The historical Sprite and Node 3 entries are inventory history only. Active runtime is Hostless Node 1 and Node 2; no Sprite, Fly.io, or Node 3 operation is permitted.
