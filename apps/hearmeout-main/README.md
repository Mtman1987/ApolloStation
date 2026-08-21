# HearMeOut

HearMeOut is the synchronized voice, room, media, and DJ application in the Space Mountain suite. This clean base preserves the Next.js app, its local database adapter, SPMT/DSH-backed session path, DJ worker, and tests while removing obsolete deployment plans, abandoned provider shims, raw conversion assets, and generated exports.

## Local checks

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm run test:workspace-theme
npm run test:discord-messaging
```

The DJ worker has its own operational notes in [`worker/README.md`](./worker/README.md).

## Required local configuration

Copy `.env.example` into an untracked environment file and provide the browser-side YouTube configuration only when that playback path is used. The `NEXT_PUBLIC_` value is intentionally visible to clients; it is configuration, not a server secret.

Authentication and shared tenant state belong to the SPMT control/data plane. App-local state is limited to cache, queue, room-runtime, or data that is genuinely private to HearMeOut.

The ecosystem architecture and migration decisions live in the separate [SPMT Ecosystem Blueprint](https://github.com/Mtman1987/ApolloStation). This repository should document only code that currently exists here.

## Security gate

The previous source snapshot contained tracked provider credentials. Removing them here does not erase Git history. Rotate every exposed credential before any clean-base deployment, then inject replacements through the deployment secret store.
