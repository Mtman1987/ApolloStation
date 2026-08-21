# Chat Tag

Chat Tag is the cross-platform Twitch and Discord game in the Space Mountain suite. This clean base preserves the working application, bot, WebSocket service, command reference, and tests while removing obsolete migration utilities and superseded deployment notes.

## Local checks

```bash
npm ci
npm run typecheck
npm run build
node --check bot.js
```

The command behavior reference is in [`GAME_COMMANDS.md`](./GAME_COMMANDS.md).

## Architecture boundary

Authentication and shared tenant state belong to the SPMT control/data plane. App-local files are cache, queue, or strictly private state—not an independent source of truth for shared points, profiles, themes, or counters.

The ecosystem architecture and migration decisions live in the separate [SPMT Ecosystem Blueprint](https://github.com/Mtman1987/ApolloStation). This repository should document only code that currently exists here.

## Safety

Never commit credentials, service-account files, environment files, database dumps, or runtime volume contents. Production cutover is blocked until the clean base passes its gates and shared-state behavior has been verified against the blueprint contracts.
