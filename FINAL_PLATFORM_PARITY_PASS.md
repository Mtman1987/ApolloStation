# Final SPMT + SpaceMountain Donor Parity Pass

Updated: 2026-08-21
Status: **SPMT completion gate passed; SpaceMountain is the next Green implementation phase**

Compared revisions:

- Green baseline before this final pass: `Mtman1987/ApolloStation` at `51be2560f03fd479760d24fa746bc56878ab8bdd`
- Blue `Mtman1987/spmt-live`: `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc`
- Blue `Mtman1987/spacemountain-live`: `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`

Final SPMT parity implementation was validated by the Green shared-contract CI suite on PR #14 after the OAuth, Commlink, webhook, context/capability, developer-surface and recovery-inventory additions. Those generic context/capability contracts are now named Stellar Core. D-31/D-40 subsequently named Stella as the app-neutral Community Assistant and restricted Athena to the owner's configured StreamWeaver persona. Blue remained untouched.

This document is a classification decision, not permission to delete Blue. Unclassified donor behavior still defaults to `VERIFY` under `PARITY_LEDGER.md`.

## Final SPMT classification

| Capability | Decision | Why |
|---|---|---|
| Canonical users/provider links | KEEP / GREEN READY | Immutable SPMT identity is the cross-app anchor. Green authority prevents provider-ID collision. |
| Scoped human/service auth | KEEP / GREEN READY | Green removes universal/shared-key auth and uses short-lived scoped tokens, tenant restrictions, rotation and replay-family revocation. |
| First-party OAuth authorization-code flow | KEEP / GREEN READY | Required for standalone apps and one-sign-in. Green preserves exact redirect validation, state round-trip, one-time codes and canonical userinfo and adds PKCE S256. |
| Username/password credential entry | KEEP FOR HUMAN ENTRY | Blue proves login/registration. Green keeps credentials hash-only; provider/recovery UX can remain an adapter over the same canonical user. |
| Legacy imported-account claim/grandfather routes | REPLACE / MIGRATION ONLY | Useful only while migrating Blue identities. Do not make them permanent Green identity paths. |
| App registry / installs / granted scopes / entitlements | KEEP / GREEN READY | Shipyard and third-party integrations need one registry and permission truth. Implemented in Green control plane. |
| App version history | DEFER | Useful for Shipyard publishing/release UX but not required to boot the first Green SpaceMountain shell. Add when publishing workflow is implemented. |
| Workspace/theme/background/three docks | KEEP / GREEN READY | Shared portable workspace is a flagship cross-app fact. Green owns it once in SPMT. |
| Legacy overlay-workspace blob | REMOVE AFTER MIGRATION | Replaced by versioned workspace + scene/widget contracts. Retain only as migration input until zero-use. |
| Canonical XP | KEEP / GREEN READY | Green append-only tenant-scoped ledger replaces competing balances. Never max/sum old ledgers automatically. |
| Platform events | KEEP / GREEN READY | Green event write + idempotency + transactional outbox is the canonical async boundary. |
| Commlink conversations/messages/notifications/search | KEEP / GREEN READY | Blue proves this is shared account data and SpaceMountain presents it. Provider-neutral live chat moves behind the Chat Gateway contract. |
| Developer webhooks | KEEP / GREEN READY | HTTPS registration, one-time secret display, encrypted-at-rest signing secrets, HMAC signatures and durable outbox/retry integration are implemented. |
| Stellar Core context/memory summaries | KEEP / GREEN READY | SPMT owns bounded useful creator/app context; model inference does not. Stella and configured personas consume it through scoped contracts and isolated memory policy. |
| Stellar Core capability catalog | KEEP / GREEN READY | SpaceMountain and developer tools can advertise only capabilities that really exist; unavailable capabilities carry an explicit reason. |
| Stella and configured-persona execution | DEFER TO STELLAR CORE/STREAMWEAVER WORKERS | Stella is the default app-neutral Community Assistant; Athena is only the owner's configured StreamWeaver persona. Runtime AI load and routing remain persona-neutral Stellar Core concerns. |
| Companion/device pairing/revoke/commands/relay | KEEP / DEFER TO COMPANION-MOUNTAINVIEW | The authority belongs in the ecosystem, but implementing it without the real device relay would create a fake stub. Build it with the device vertical and expose it through SPMT contracts. |
| Plugin/app submission workflow | VERIFY / DEFER | Keep discoverability and app manifests now. Rebuild submissions when there is a real review/publish workflow and active callers. |
| Universal `SYSTEM_API_KEY` and provider-token internal auth | REMOVE | Violates scoped service-identity contract and increases blast radius. |
| Firebase/Firestore paths | REMOVE | Explicitly retired; no Green compatibility requirement. |
| Duplicate authoritative DBs/local production fallbacks | REMOVE | Shared facts have one authority and Green fails honestly when authority storage is unavailable. |
| Duplicate tracked docs/spec mirrors/bootstrap patch files | REMOVE FROM GREEN | They are donor evidence, not a maintainable product architecture. Generate/publish docs from canonical sources later. |

## Final SpaceMountain classification for the next implementation phase

### KEEP / rebuild on Green contracts

- Dashboard/home shell.
- Shipyard app discovery, installed-app state and launch controls.
- Commlink presentation: Mail, Notifications and App Events from SPMT; Live Chat later from the provider-neutral Chat Gateway.
- Stellar Core panel backed by truthful context/capability APIs; Stella is the default Community Assistant and configured StreamWeaver personas remain tenant-specific.
- Docs/developer experience.
- Notifications.
- three RocketDock slots.
- portable creator workspace, themes and backgrounds.
- canonical overlay/workspace editor presentation.
- personal widgets and overlay previews.
- transparent Companion/desktop overlay surface and popouts.
- app cards/icons/catalog and permission display.
- help/settings routes.
- brand/theme visual language where assets are actually selected for the Green product.

### REPLACE

- Multiple workspace/embed implementations -> `AppFrameV1` + `EmbedBridgeV1`.
- `spmt-proxy` and private app shortcuts -> public SDK/API/events.
- SpaceMountain direct/local DB authority -> SPMT contracts.
- local workspace copies -> canonical SPMT workspace profile.
- hard-coded header/sidebar/modal offsets -> measured shared safe-inset and semantic layer tokens.
- ad-hoc overlay compatibility -> canonical overlay widget/scene contracts.
- local auth/bootstrap scripts -> SPMT session/OAuth restore.
- localStorage/iframe query identity or theme bridges -> shared embed/session/theme contracts.
- local or duplicate XP -> SPMT canonical XP.
- optimistic/fake system action success -> declared Stellar Core capability + real result/degraded/error state.

### REMOVE from Green product source

- duplicate `frontend/` legacy application if superseded by the Green app.
- duplicate root static application paths after parity proof.
- mirrored `docs/` + `public/docs/` and `spec/` + `public/spec/` source copies.
- concept/testing/preview HTML files used only during old design experiments.
- one-off patch/bootstrap scripts after their behavior exists in normal source and tests.
- SpaceMountain-local authoritative database.
- legacy auth bootstrap/fallback code.
- `canonical-overlay-compat.js` after zero-use evidence and migration checkpoint.
- unused concept/logo/image variants that are not selected assets.
- any Firebase/Firestore compatibility.
- retired `space-mountain-dashboard` deployment.

### VERIFY before deciding

- Arena / rocket gameplay / easter-egg surfaces: preserve if current usage or product intent justifies them; otherwise do not let them dictate shell architecture.
- Shop: preserve only if it maps to real catalog/entitlement/commerce behavior, not a decorative mock.
- Companion installer UI in SpaceMountain: preserve the install/discovery experience, but installer/update implementation belongs to Companion.
- plugin submission/review UI: preserve when backed by the real publishing workflow.
- legacy compatibility routes: instrument callers, migrate, then remove after zero-use window.

## New additions worth keeping

These are Green improvements derived from the flagship/developer-platform goal rather than Blue parity obligations:

1. **Developer capability explorer in Shipyard** — every capability can show SDK, raw API, CLI and MCP examples sourced from the same operation schema.
2. **Reference integration badge** — first-party apps that pass conformance tests are visibly marked as tested examples of the developer platform.
3. **Developer diagnostics panel** — show current app ID, tenant, granted scopes, surface mode, embed protocol version, readiness and recent bounded events without exposing secrets.
4. **CI-backed docs/examples** — publish examples tested against the same contracts first-party apps run, reducing documentation drift.
5. **Capability-to-example links** — every public developer capability points to at least one working flagship implementation.

## SPMT completion gate — PASSED

The final Green SPMT pass now has tested coverage for:

- canonical authority/storage/auth and encrypted recovery inventory;
- first-party OAuth/session restore with exact redirects, state, one-time codes and PKCE S256;
- app registry/install/entitlement paths through public developer contracts;
- canonical tenant/user-isolated Commlink account data;
- protected webhook registration/signing secrets and durable outbox delivery;
- bounded Stellar Core context and truthful capability catalog;
- API/SDK/CLI/MCP developer-facing paths;
- no production fallback DB and no universal internal key.

This is an implementation-complete Green foundation, not a production-cutover authorization. Blue stays authoritative until later migration/cutover gates pass.

## SpaceMountain completion gate before moving to the next product app

SpaceMountain is complete enough to move on only when a test user can:

1. establish/restore one SPMT identity;
2. load the shell immediately with honest loading/degraded behavior;
3. see and change the one canonical workspace/theme/background/docks;
4. discover/install/disable apps through Shipyard using public SPMT contracts;
5. open embedded apps through the one AppFrame/EmbedBridge path;
6. use Commlink shared account data and see Live Chat as a separately owned source when Chat Gateway is available;
7. see Stellar Core context/capabilities without fabricated actions and invoke Stella through the same scoped public contracts available to standalone apps, Commlink, StreamWeaver, CLI, and MCP;
8. render shell, sidebar, dialogs, popovers, editor and overlay previews without anything hiding behind the shared header;
9. open standalone/popout/headless overlay surfaces with the correct zero/nonzero shell inset;
10. pass desktop/mobile/tall-header, account-switch, tenant-isolation, cold/degraded-state and developer-conformance tests.

Only after this gate should Green move to Chat Gateway/StreamWeaver, DSH, HearMeOut, Nebula Arcade, or Companion implementation batches.
