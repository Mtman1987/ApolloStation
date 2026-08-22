# SpaceMountain Green wiring

Status: first known-services implementation slice.

Blue donor inspected: `Mtman1987/spacemountain-live` at `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`.
Green foundation: ApolloStation main after SPMT onboarding cleanup.

## SpaceMountain role

SpaceMountain is the suite shell and presentation/orchestration layer. It does not own shared identity, workspace, app-install state, XP, Commlink account data, notifications, Athena context/catalog, or cross-app authorization.

The Green shell consumes those facts through `@spmt/sdk`. It must not recreate the donor `/api/spmt` catch-all data proxy or a SpaceMountain-local authoritative database.

## Known inputs wired now

- SPMT human session/principal.
- canonical workspace profile including theme/background/docks.
- canonical XP balance.
- Shipyard app registry.
- tenant app installs and granted scopes.
- entitlements.
- Commlink conversations.
- notifications.
- Athena bounded context and command/capability catalog.
- first-time setup choices from the new SPMT onboarding contract.

Every source has an explicit `ready`/`degraded` state. Session or workspace failure makes the shell unavailable; optional panel failure degrades only that part of the shell.

## Known outputs wired now

- install/disable app through SPMT.
- workspace updates through SPMT revision checks.
- notification read state through SPMT.
- app launch through a single `AppFrameV1`/`EmbedBridgeV1` target.

`buildAppFrameTarget()` deliberately keeps tenant identity, scopes, theme and session data out of iframe URLs. The URL supplies only the app location. Session/tenant/grants/layout/theme travel over the shared embed protocol.

## Deferred runtime adapters

These remain visible as separately owned sources instead of being faked inside SpaceMountain:

- StreamWeaver live-chat transport -> Commlink Live Chat presentation.
- Athena model/persona/inference -> StreamWeaver/workers.
- Companion/MountainView device relay -> Companion surface.

Their absence must produce an honest degraded/unavailable panel state later, never fabricated data.

## Authentication boundary

Do not restore the donor catch-all `spmt-proxy` as the normal Green data path. Public app data uses SPMT SDK/API contracts.

SpaceMountain still needs a bounded auth/session adapter for production browser sign-in because `spmt.live` and `spacemountain.live` are different origins and refresh credentials must not be stored in localStorage. That adapter may hold the SpaceMountain web session/OAuth exchange, but it must not become a private replacement API for SPMT application data.

The first-time account setup flow remains owned by SPMT. SpaceMountain supplies the welcome-channel Discord interaction and the visual setup/sign-in experience.

## Next UI wiring

The donor visual pieces can now be ported onto this model in this order:

1. CosmicHeader + measured shared safe inset.
2. home/dashboard shell.
3. RocketDock backed by canonical workspace slots.
4. Shipyard backed by registry/install/entitlement data.
5. Commlink mail/notifications/app-events panels.
6. Athena panel using truthful command availability/context.
7. one Workspace/Overlay editor host.
8. AppFrame component for embedded flagship apps.
9. first-time setup/sign-in screens.

Arena/shop/easter-egg surfaces remain VERIFY items and should not shape the shell architecture until their product intent is confirmed.
