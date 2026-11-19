# SpaceMountain Web

**Workspace:** @spmt/spacemountain-web  
**Location:** apps/spacemountain-web  
**Runtime entrypoint:** dist/integrated-server.js  
**Role:** Apollo's integrated web host, public shell, sign-in experience, Shipyard/workspace surface, and same-origin gateway for hosted applications.

## 1. Responsibility and boundaries

SpaceMountain Web is the browser-facing composition layer for the SPMT ecosystem. It serves the SpaceMountain landing and authenticated shell; presents SPMT bridge and Apollo account sign-in; loads the shared workspace, app catalog, navigation, and application frames; applies shared theme and surface behavior; routes supported same-origin API, overlay, application, and media requests; serves explicitly allowlisted browser assets and documentation; and exposes readiness and bounded client diagnostics.

It is not the canonical identity or application-data authority. SPMT service owns identity, sessions, app registration, scopes, shared facts, and provider grants. Product applications own their product-private behavior and data. SpaceMountain Web must call those authorities through their contracts rather than creating shadow databases or private cross-app shortcuts.

## 2. Runtime composition

The server has two layers:

- integrated-server-base.ts — underlying SpaceMountain web host and shell routes.
- integrated-server.ts — production composition wrapper. It binds the base host to loopback, adds the integrated same-origin gateway/proxy routes, validates upstream origins, and coordinates configured app origins.

The production entrypoint is integrated-server.ts, compiled to dist/integrated-server.js. The Hostless Node 1 launcher starts this integrated server after the local SPMT authority and Discord Stream Hub web process are prepared.

The integrated gateway has explicit route families for SPMT API/overlay traffic, Nebula game actions/mixes, and configured first-party application origins. Do not add a broad arbitrary URL proxy. Keep route matching, destination selection, origin validation, response limits, timeout behavior, and error handling explicit.

## 3. Browser and server modules

| Module | Responsibility |
|---|---|
| src/client.ts | Shell bootstrap, SPMT client/session handling, app catalog/workspace wiring, browser diagnostics |
| src/page.ts | Initial HTML document and pre-module bootstrap diagnostics |
| src/server.ts | Base HTTP host, static asset allowlist, auth/product routes, bounded request/response handling |
| src/integrated-server-base.ts | Reusable base integrated-host implementation |
| src/integrated-server.ts | Production integrated gateway and upstream proxy composition |
| src/session-resilience.ts | Session failure classification and recovery gate |
| src/bounded-app-pages.ts and bounded-app-client.ts | Bounded first-party app pages and browser client |
| src/personal-overlay-client.ts | Personal Overlay interaction client |
| src/simulation-rooms-client.ts | Simulation Rooms browser client |
| src/egg-completion-retry.ts | Retry-aware browser completion coordination |
| src/rtc-upgrade-proxy.ts | HearMeOut RTC upgrade proxy support |
| src/splash-gate.ts | Splash/auth gate styling and presentation |
| src/developer-docs.ts | Developer quickstart page |
| src/ecosystem-docs.ts | Allowlisted ecosystem documentation renderer |

The web host also imports shared UI and rendering functionality from SpaceMountain, UI, Nebula Arcade, and StreamWeaver packages. This is intentional shared implementation; avoid copying those renderers into SpaceMountain Web.

## 4. Dependencies

Declared workspace dependencies:

- @spmt/contracts — versioned schemas and boundary validation.
- @spmt/sdk — browser/service client for SPMT APIs.
- @spmt/spacemountain — shell controller and shared SpaceMountain UI.
- @spmt/ui — shared design system and browser components.
- @spmt/nebula-arcade — Nebula game/overlay renderers consumed by the integrated host.
- @spmt/streamweaver — StreamWeaver avatar and overlay widget renderers.

Keep dependencies aligned with workspace package versions. Do not add a second copy of a dependency to solve workspace resolution problems.

## 5. Build and local development

From the repository root:

    npm ci
    npm run build

Package-local build:

    npm run build --workspace @spmt/spacemountain-web

The package start script runs node dist/integrated-server.js. The root build compiles this package as part of the TypeScript project-reference build before the Hostless launcher starts it.

Use the repository's local validation and browser test scripts for changes that affect shell startup, app framing, session recovery, navigation, or browser assets. See the Development and operator tooling index.

## 6. Configuration and deployment

The integrated server receives upstream origins and runtime settings from the owning Hostless node configuration. The launcher and deployment workflow are authoritative for exact environment variable names and defaults.

Operational rules:

- Node 1 hosts the SPMT authority and SpaceMountain integrated web host.
- Node 2 hosts the Chat Gateway and co-located StreamWeaver/Nebula runtime chain.
- Do not restore Node 3, Fly, Sprites, or Rotator as production dependencies.
- Configure service origins as credential-free HTTPS origins for remote services; loopback is reserved for services intentionally co-located in the same node.
- Never put bearer tokens, OAuth secrets, cookies, or provider credentials in browser configuration, URLs, HTML, client diagnostics, or logs.
- Keep provider credentials server-side and obtain app/service access through scoped SPMT grants.
- The integrated host readiness route is consumed by the Hostless health check. Preserve truthful readiness.

For current release behavior, inspect .github/workflows/hostless-three-node-deploy.yml (historical filename; the workflow currently deploys Node 1 and Node 2) and scripts/hostless/start-node.mjs. Rename only in a coordinated change that updates every dispatch, test, path filter, and link.

## 7. Security and reliability

- Keep browser-origin checks on state-changing requests.
- Keep iframe framing policy strict by default; allow same-origin shell framing only for explicitly recognized shell app requests.
- Do not weaken the anonymous session gate to hide a client-side recovery defect.
- Keep static assets on an explicit route allowlist; request paths must never select arbitrary filesystem paths.
- Bound request bodies, response sizes, diagnostics, and proxy timeouts.
- Diagnostics must be content-minimized and redacted. Never read or transmit cookie/session values or form contents.
- Proxy upstream origins must reject credentials, unexpected protocols, paths, queries, fragments, and non-approved hosts as required by the configured contract.
- Proxy failure should return a bounded error and must not crash shell startup.
- Browser diagnostic collection must never block sign-in or app startup.

## 8. Tests and acceptance

When changing this package, run the narrow relevant browser/unit tests and then repository validation:

    npm run typecheck
    npm test
    npm run test:offline

Relevant regression areas include signed-out initial page and SPMT bridge gate visibility; normal and incognito session bootstrap; app catalog loading and launch URL handling; shell iframe framing headers; upstream origin validation and proxy routing; browser diagnostic redaction; shared navigation, theme, workspace, and app-frame integration; and mobile layout/scroll containment.

A passing build or offline test is not proof of live SPMT authentication, live provider connectivity, or a deployed Node 1 release. Record the exact commit and evidence type when reporting acceptance.

## 9. Performance guidance

Keep this package as a thin composition layer:

- reuse shared UI, SDK, contract, and app renderers rather than bundling duplicate implementations;
- serve only required browser modules and avoid adding heavyweight client libraries to the global shell;
- lazy-load app-specific code when the user opens that app, where the current integration contract permits it;
- avoid repeated polling and duplicate session refresh loops;
- keep synchronous filesystem reads out of request handlers except for small, fixed documentation/assets where intentionally used;
- bound diagnostics and proxy response sizes;
- avoid expensive parsing or media work on the shell request path.

Measure bundle sizes, route latency, and startup behavior before removing assets or dependencies. Theme backgrounds, app icons, and overlay assets are product UI, not dead weight simply because they are images.

## 10. Troubleshooting

| Symptom | First checks |
|---|---|
| Blank shell | Fetch /health/ready; inspect server startup and browser bootstrap diagnostics; check asset routes and JavaScript module loading |
| Sign-in gate missing | Inspect initial HTML, client bootstrap, session response, and SPMT bridge tab visibility |
| App shows a broken image | Inspect registered launchUrl, shell framing headers, and whether the app route is supported |
| App loads but API says unauthorized | Trace the app's SPMT SDK/session credential path; do not weaken the auth gate |
| One embedded app fails | Check configured origin, readiness, proxy route allowlist, timeout, and same-origin checks |
| Mobile content clips | Check shared header/safe-area insets, nested scroll containers, portal roots, and app-frame height |
| Diagnostics absent | Check the diagnostics endpoint, rate limits, redaction, and sendBeacon/fetch behavior; diagnostics must remain non-blocking |

## 11. Change checklist

1. Identify whether behavior belongs in SpaceMountain Web, the shared SpaceMountain package, SPMT service, or the product app.
2. Prefer existing shared contracts and UI packages.
3. Update relevant unit/browser regression tests.
4. Confirm static asset and proxy allowlists remain explicit.
5. Confirm no secret or user session value can reach the browser or diagnostics.
6. Run build/typecheck and the focused browser test.
7. Record the tested commit and distinguish test evidence from deployment/live acceptance.
