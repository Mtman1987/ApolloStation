# ApolloStation staged Sprite handoff

Status: **two-stage Sprite promotion is defined; work branches target the isolated Review Sprite and `main` targets the protected Release Sprite**

This runbook describes the current Green deployment path. It supersedes older instructions that treated a single game module as a standalone catalog app.

## Promotion contract

| Tier | Git trigger | Purpose |
|---|---|---|
| Review Sprite (`mtman-new/web-terminal`) | Push to `work/**` | Rapid owner review with provider actions disabled |
| Release Sprite (`testing-968/web-terminal`) | Push/merge to `main` | Protected production-like verification of the approved Green commit |

`.github/workflows/sprite-promotion.yml` owns both routes. Automatic promotion runs only when repository variable `SPRITES_AUTODEPLOY_ENABLED=true` and the matching GitHub environment contains `SPRITES_TOKEN`.

Pinned targets:

| Tier | Sprite ID | Private URL |
|---|---|---|
| Review | `sprite-2249fee2-ecf3-4b10-8bc1-314f4b9e5bcc` | `https://web-terminal-bpp4n.sprites.app` |
| Release | `sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280` | `https://web-terminal-bvesa.sprites.app` |

Do not create a Sprite per branch. Do not make either URL public during Green verification.

## What promotion does

For either tier the deployment workflow:

1. verifies the exact organization, Sprite ID, name, and private URL mode;
2. creates a pre-deployment checkpoint;
3. installs the exact Git SHA into a versioned release directory;
4. runs `npm ci --ignore-scripts`, typecheck, and the complete test suite inside the target Sprite;
5. atomically switches the active release only after verification succeeds;
6. restarts the supervised Apollo service;
7. requires runtime health to report the expected SHA;
8. restores the previous release automatically when the new release fails health verification.

Review and Release use isolated data roots. They must never share a writable database.

## Current application model

The platform cohort contains the SPMT authority and SpaceMountain shell. First-party applications are discovered through the same registry contract used for future apps.

Nebula Arcade is the registered Games Hub application and the only current technical/product identity for this area. It owns the twenty-game catalog, game detail pages, command routing, saved multi-game overlay scenes, workers, integrations, and game-private state. Tagging behavior is its internal `tag` game; no separately named app, service, worker, route, or overlay owner exists.

Commlink, Stellar Core, Mission Control, and Nebula Arcade use the shared SpaceMountain viewport/theme/navigation contracts. The remaining donor apps are added through the same pattern rather than by expanding the shell with new hardcoded product paths.

## Already required by the Green baseline

- SpaceMountain browser host is exposed through the private Sprite HTTPS surface.
- SPMT remains loopback-only behind the browser host.
- Browser API access is same-origin and allowlisted.
- Login tokens stay in Secure, HttpOnly, SameSite cookies and are redacted from browser responses.
- Browser-supplied bearer tokens are discarded by the proxy.
- Provider, Fly, LiveKit, Firebase, and Sprite infrastructure credentials are rejected by sandbox startup guards where they do not belong.
- Provider/webhook egress remains disabled during isolated Green review.
- The app catalog is registry-driven; first-party apps are seeded/registered through the canonical app authority rather than hardcoded browser cards.
- Nebula Arcade starts only its own bounded game/runtime authorities and does not become a second SPMT identity, XP, workspace, or cross-app data authority.
- The shared shell uses one fixed content rectangle below the measured header. Home pages fit; long pages scroll internally and cannot slide behind the header.
- The shared surface-depth rule uses the fewest visible layers necessary and progressively lowers opacity for nested surfaces.
- Mission Control remains owner/operator-only; normal users do not inherit operations access.
- No deployment script changes Blue production DNS or shuts down a live donor app.

## Main verification after merge

When an approved review branch is merged to `main`:

1. Confirm the `main` SHA is the expected merge result.
2. Confirm the Green contract workflow passes on that exact main SHA.
3. Confirm the Release Sprite promotion targets only `testing-968/web-terminal` and the pinned Sprite ID above.
4. Confirm the release job creates a checkpoint before changing the active release.
5. Confirm typecheck and the full test suite pass inside the Release Sprite.
6. Confirm `/health/ready` reports the expected build SHA.
7. Open the private Release Sprite and click through SpaceMountain Home, Shipyard, Workspace, Settings, Commlink, Stellar Core, Mission Control, and Nebula Arcade.
8. Verify every home screen fits the common viewport; verify every longer page scrolls inside that viewport and never behind the header.
9. Exercise Nebula Arcade Games, game pages, Overlay Bay scene creation, stable overlay output URLs, Stats, and the connected game-module runtime.
10. Pull runtime logs, fix actionable errors, redeploy, and repeat until the release candidate is clean.

Passing CI is necessary but not sufficient for production. Browser interaction, runtime logs, provider/output tests, restart behavior, tenant isolation, and owner acceptance remain required.

## App-by-app plug-in rule

For each remaining donor app:

1. audit the live donor feature/state/output contract;
2. add the app as a bounded registered module using the existing SDK/API/event/workspace contracts;
3. give it app-owned scene art while reusing the shared star, theme, depth, navigation, and viewport behavior;
4. make its Home fit the canonical content rectangle and place long-page scrolling inside that rectangle;
5. expose only its own product-private state while consuming shared identity/XP/workspace/events from SPMT;
6. add direct, embedded, restart, tenant-isolation, migration, command/output, and visual regression tests;
7. verify it in Review before promotion to `main`.

## STOP conditions

Stop promotion immediately if any of these are true:

- the exact Git SHA is not published and reviewable;
- a deployment resolves either Sprite name to a different pinned ID;
- the Sprite URL is public instead of organization-authenticated;
- the network policy permits an unapproved provider destination during isolated testing;
- a command asks for a provider or production secret that the bounded app does not own;
- a new app creates duplicate SPMT identity, XP, workspace, authorization, or cross-app event authority;
- the shared page/document itself scrolls behind the header;
- tests fail, runtime health reports the wrong SHA, or rollback cannot restore the previous release.

## Deliberately not authorized by this runbook

- shutting down Blue production;
- changing production DNS;
- copying production volumes wholesale into a Sprite;
- making private Sprite URLs public;
- granting providers or users broader scopes merely to make a test pass;
- bypassing the Review -> main -> Release promotion path for ordinary feature work.
