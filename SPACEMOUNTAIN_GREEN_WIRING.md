# SpaceMountain Green wiring

Status: known-services shell plus the first canonical Commlink and Stellar Core account surfaces.

Blue donor inspected: `Mtman1987/spacemountain-live` at `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`.
Green foundation: ApolloStation main after SPMT onboarding cleanup.

## SpaceMountain role

SpaceMountain is the suite shell and presentation/orchestration layer. It does not own shared identity, workspace, app-install state, XP, Commlink account data, notifications, Stellar Core context/catalog, or cross-app authorization.

The Green shell consumes those facts through `@spmt/sdk`. It must not recreate the donor `/api/spmt` catch-all data proxy or a SpaceMountain-local authoritative database.

## Known inputs wired now

- SPMT human session/principal.
- canonical workspace profile including theme/background/docks.
- canonical XP balance.
- Shipyard app registry.
- tenant app installs and granted scopes.
- entitlements.
- tenant-scoped App Events.
- Commlink conversations.
- notifications.
- Stellar Core bounded context and capability catalog.
- Stella Community Assistant descriptor and truthful invocation state.
- first-time setup choices from the new SPMT onboarding contract.

Every source has an explicit `ready`/`degraded` state. Session or workspace failure makes the shell unavailable; optional panel failure degrades only that part of the shell.

## Known outputs wired now

- install/disable app through SPMT.
- workspace updates through SPMT revision checks.
- notification read state through SPMT.
- conversation detail/search/send through the public SPMT SDK controller boundary.
- app launch through a single `AppFrameV1`/`EmbedBridgeV1` target.

`buildAppFrameTarget()` deliberately keeps tenant identity, scopes, theme and session data out of iframe URLs. The URL supplies only the app location. Session/tenant/grants/layout/theme travel over the shared embed protocol.

## Deferred runtime adapters

These remain visible as separately owned sources instead of being faked inside SpaceMountain:

- provider-neutral Chat Gateway -> Commlink Live Chat presentation.
- Stellar Core generic inference -> bounded worker pool.
- Stella Community Assistant -> app-neutral SPMT developer contracts backed by Stellar Core.
- configured StreamWeaver personas, including the owner's Athena configuration -> StreamWeaver using the same Stellar Core contracts.
- Companion/MountainView device relay -> Companion surface.

Their absence must produce an honest degraded/unavailable panel state later, never fabricated data.

## Authentication boundary

Do not restore the donor catch-all `spmt-proxy` as the normal Green data path. Public app data uses SPMT SDK/API contracts.

SpaceMountain still needs a bounded auth/session adapter for production browser sign-in because `spmt.live` and `spacemountain.live` are different origins and refresh credentials must not be stored in localStorage. That adapter may hold the SpaceMountain web session/OAuth exchange, but it must not become a private replacement API for SPMT application data.

The first-time account setup flow remains owned by SPMT. SpaceMountain supplies the welcome-channel Discord interaction and the visual setup/sign-in experience.

## Visible UI now

- CosmicHeader with the measured shared safe inset.
- home/dashboard shell.
- RocketDock backed by canonical workspace slots.
- Shipyard backed by registry/install/entitlement data.
- separate Commlink Mail, Notifications, App Events, and honestly deferred Live Chat panels.
- Stellar Core context/capability panel with generic execution honestly deferred.

Mail, Notifications, and App Events consume the same scoped public SPMT contracts available to developer applications. App Events now have one read projection across HTTP, SDK, CLI, and MCP. The Live Chat panel does not synthesize messages while Chat Gateway is disconnected.

The former generic `/v1/athena/*`, SDK, CLI, MCP, scope, SQLite, and recovery names are handled as migration inputs or deprecated public aliases. New storage and product surfaces use Stellar Core. Those aliases may be removed only after caller instrumentation shows zero use and the normal compatibility rollback gate passes.

## Next UI wiring

The donor visual pieces can now be ported onto this model in this order:

1. Commlink conversation detail, composer, and search UI using the already exposed controller methods.
2. one Workspace/Overlay editor host.
3. AppFrame component for embedded flagship apps.
4. first-time setup/sign-in screens.
5. Green provider-neutral Chat Gateway adapter, with StreamWeaver as an ordinary scoped consumer.
6. Stellar Core worker adapter plus app-neutral Stella invocation through SDK/API/CLI/MCP/Commlink; configured StreamWeaver personas use the same execution path.

Arena follows D-38's local-score/capped-settlement model, Shop follows D-37's verified external-storefront model, and the nonfunctional Builder is removed under D-36. Those product surfaces still must not distort the shared shell architecture.
