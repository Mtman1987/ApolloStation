# Performance and dependency audit

Updated: 2026-11-19  
Scope: dependency graph and source-level performance risks in the ApolloStation workspace. Counts below are approximate workspace dependency-closure counts derived from package-lock.json, not measured install size, bundle size or runtime memory.

## 1. Executive findings

The monorepo is already separated into app/workspace packages, but several package boundaries still pull large product runtimes into services that should be thin.

The lockfile contains 240 package entries. Approximate transitive closure for selected workspaces:

| Workspace | Closure entries | Notable heavy dependencies in closure |
|---|---:|---|
| SpaceMountain Web | 29 | Playwright, sharp, @resvg/resvg-js (transitive through full app imports) |
| SpaceMountain UI package | 6 | None of the audited heavy dependencies |
| SPMT Service | 60 | Playwright, sharp, @resvg/resvg-js, LiveKit client/server SDKs |
| Discord Stream Hub | 26 | Playwright, sharp, @resvg/resvg-js |
| Chat Gateway | 105 | Playwright, sharp, @resvg/resvg-js, TikTok connector, LiveKit client/server SDKs |
| StreamWeaver | 27 | Playwright, sharp, @resvg/resvg-js through DSH |
| Nebula Arcade | 12 | sharp |
| HearMeOut | 27 | LiveKit client and server SDKs |

The important issue is not that every package is individually enormous. It is that a few dependency edges cause web/authority processes to inherit worker/media dependencies they do not need.

## 2. Highest-impact dependency problems

### P0 — SpaceMountain Web imports full product packages

apps/spacemountain-web/package.json directly depends on @spmt/nebula-arcade and @spmt/streamweaver. Its server imports:

- Avatar Studio page and StreamWeaver overlay renderer from StreamWeaver;
- Nebula Tag overlay, game widgets, stage renderer and Three.js asset from Nebula Arcade.

Those packages also depend on worker/data/media dependencies. The current dependency closure for the web host therefore includes Playwright, sharp and resvg through the app graph.

**Target:** extract pure browser renderers/manifests into small packages such as @spmt/nebula-widgets and @spmt/streamweaver-widgets. Keep the renderer packages limited to contracts, UI and static browser source. The product apps retain game/command/worker/media logic.

Acceptance: SpaceMountain Web no longer depends on the full Nebula Arcade or StreamWeaver runtime packages; shell startup and widget route tests pass; no browser bundle contains server/worker libraries.

### P0 — SPMT Service imports entire product apps

apps/spmt-service directly depends on StreamWeaver, Discord Stream Hub, HearMeOut and Nebula Arcade in addition to its shared authority packages. Its dependency closure includes Playwright, sharp, resvg and LiveKit SDKs even though the authority service should not need media capture, image processing or browser RTC clients.

**Target:** separate app catalog manifests and versioned registration metadata from product runtime implementations. SPMT Service should depend on a lightweight manifest/contract package, not whole application packages.

Acceptance: SPMT Service starts without Playwright, sharp, resvg or LiveKit client dependencies; app catalog registration and app identity tests remain green.

### P1 — Discord Stream Hub mixes web and media-worker dependencies

apps/discord-stream-hub includes Playwright, resvg and font dependencies in the same package that builds the web surface. These are needed for browser gameplay capture and image/banner rendering, not for normal web requests.

**Target:** move browser capture and image rendering into a dedicated DSH media/capture worker package or workspace. Keep the web app's dependency graph limited to contracts, SDK, UI and server dependencies.

Acceptance: DSH web starts without Chromium/Playwright or resvg/font dependencies; worker has explicit concurrency, memory, timeout and media limits.

### P1 — StreamWeaver directly depends on Discord Stream Hub

apps/streamweaver depends on @spmt/discord-stream-hub for Quackverse art enhancement/animation handoff. This pulls DSH's browser/image dependencies into StreamWeaver and creates an app-to-app package dependency.

**Target:** define a small versioned Quackverse art job contract in shared contracts or a focused integration package. StreamWeaver/Nebula submit the job through SPMT; DSH worker claims and executes it. Neither app imports the other's full implementation.

Acceptance: no direct StreamWeaver → DSH package dependency; job contract tests and single-delivery behavior pass.

### P2 — Chat Gateway is intentionally the large worker

Chat Gateway composes StreamWeaver, Nebula, DSH and HearMeOut consumers plus provider drivers. Its dependency closure is approximately 105 entries and includes browser/image/RTC dependencies transitively.

This is acceptable only if Chat Gateway remains a dedicated background worker and those dependencies are not installed/loaded into the public web process. A later split into provider ingress and app-specific consumers may reduce blast radius, but it must preserve single-consumer fencing and normalized event semantics.

### P2 — HearMeOut web and worker dependencies share one package

HearMeOut includes browser LiveKit client and server LiveKit SDK dependencies. The legacy worker is a separate nested package with a much larger voice/media stack.

Keep browser RTC code in its dedicated generated artifact and keep server/legacy worker dependencies out of the shell. Remove the legacy worker only after its voice bridge/persona audio behavior has a native Apollo replacement and live acceptance.

## 3. Source and bundle hot spots

- apps/spacemountain/src/shell-ui-base.ts is a large (~184 KB source) shell UI module. It is core product code, not dead code. Split by shell feature only after event wiring, state, navigation and accessibility tests exist.
- apps/discord-stream-hub has browser capture and image rendering code; these should be worker-only.
- apps/nebula-arcade uses sharp for image/media processing. Keep it on the worker/server path and out of browser/shell dependencies.
- apps/hearmeout has a separate legacy worker with Discord voice/Opus, native RTC/WebRTC, Puppeteer, HLS and YouTube tooling. It is still imported by the current adapter and is migration debt, not unused code.
- services/restream-control uses Puppeteer in a separate service package. It is not part of the shell dependency graph, but it is not yet launched by the Hostless Node 2 process map.

## 4. Asset audit

Large tracked assets include:

- a ~10 MB Nebula game hover GIF;
- several ~5 MB GLB model chunks;
- 1–2 MB SpaceMountain logo PNGs;
- multiple avatar reference images and product backgrounds.

These files must not be deleted based on size alone. The avatar model/reference assets are tied to the Avatar Studio/Meshy workflow. Verify all route manifests, dynamic asset lookup, build copy steps, game catalogs and browser network requests before removal.

For each candidate asset:

1. identify the owning app and user-visible feature;
2. search static and dynamic references;
3. inspect build/public copy rules;
4. measure actual transfer size and dimensions;
5. optimize to WebP/AVIF or compressed model formats only where fidelity and transparency allow;
6. preserve source/master files in the archive/storage repo;
7. verify mobile and desktop rendering.

## 5. Runtime performance targets

Measure rather than guess:

- shell cold-start time and first usable sign-in frame;
- browser JavaScript transfer/parse and total app-frame payload;
- Node 1/Node 2 RSS, CPU and startup duration;
- SPMT API p50/p95 latency and database query count;
- Chat Gateway message-to-consumer latency, queue depth and reconnect churn;
- worker concurrency, retries and duplicate-delivery rate;
- media generation/transcode duration, cache hit rate and output size;
- RTC connect success and playback/audio latency.

Avoid adding heavyweight browser or media dependencies to the global shell or authority service.

## 6. Recommended refactor order

1. **Renderer extraction:** create lightweight Nebula/StreamWeaver browser renderer packages; remove full app dependencies from SpaceMountain Web.
2. **Manifest extraction:** move app registration manifests to a small catalog package; remove product runtime imports from SPMT Service.
3. **DSH worker split:** move Playwright/resvg/fonts into a dedicated media/capture worker package.
4. **Art job contract:** replace StreamWeaver's direct DSH dependency with a versioned SPMT job/contract boundary.
5. **Worker packaging:** build dedicated Hostless images/workspace installs for Chat Gateway and media workers.
6. **HearMeOut worker migration:** port legacy voice bridge/persona audio into an Apollo-owned worker, then retire nested legacy-worker package.
7. **Asset optimization:** after dynamic usage inventory and before/after browser measurements.

Each step should be a separate pull request with focused tests, full validation, dependency-closure comparison, runtime measurements and rollback.

## 7. What not to remove

- Do not remove the 3D avatar reference/model assets until Avatar Studio and Meshy workflows are verified.
- Do not remove Playwright from DSH until gameplay capture is moved into a dedicated worker.
- Do not remove the HearMeOut legacy worker while the web server still imports its adapter.
- Do not remove Nebula sharp while art/media routes use it.
- Do not remove Restream Control Puppeteer while its service contract remains a planned capability.
- Do not delete app code based only on file age, low direct-import counts or donor provenance.

## 8. Validation for every optimization

Before and after:

- run build/typecheck/full/offline tests;
- inspect dependency closure from package-lock;
- verify workspace package imports and exports;
- compare built package sizes and install/runtime dependency graphs;
- run app-specific browser/worker tests;
- record cold start, memory, latency and throughput;
- verify deployed Hostless node membership and restart behavior;
- keep the previous package/image for rollback.

A smaller package is not an improvement if it moves hidden work to another process, breaks a worker, or loses a required product capability.
