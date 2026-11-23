# UI Port Visual Proof & Node Deployment Flow

Status: Scope narrowed by owner. This is a visual UI proof—not a full migration acceptance or resource-pool project. Do not deploy to live nodes from this document.

## Goal

Port the existing app UIs into Apollo's consolidated Node deployment structure, then produce a local browser screenshot showing the port visually works before deployment.

The legacy backends are already known to work; this phase is primarily consolidation and wiring. Do not spend days fixing unrelated backend behavior or running Apollo's 2,000-rule validation suite against legacy apps.

## Scope

- Preserve the original app UI, navigation, layout, styles, screens, and controls as closely as possible.
- Consolidate Node 1 apps into a single deployment flow.
- Create a targeted app-bundle validation/build path that does not run Apollo's extensive validation suite against apps that are structurally different from Apollo.
- Use fixture/mock responses or safely disabled external integrations as needed for local preview.
- Launch the integrated UI locally in a desktop browser.
- Capture screenshot proof and share it for owner review before deployment.

## Keep validation separate

- Apollo's own core validation remains unchanged.
- Migrated app bundle gets only relevant checks: required files/config, build/start, route or UI smoke checks, and basic integration wiring.
- Do not delete or weaken Apollo validation globally.
- Do not invent a new thousand-test acceptance burden for legacy app UIs.
- Do not require production credentials, live bots, OAuth writes, webhooks, or real user data to render the preview.

## Visual proof acceptance

1. The ported app screens load in the integrated shell.
2. Navigation and major routes render.
3. Original UI structure and styling are visibly retained.
4. Key controls are present and wired to safe preview behavior where practical.
5. Desktop browser screenshot is captured (mobile viewport is optional, not a blocker).
6. Screenshot artifact is available for owner review.
7. No production deployment or data changes occur during this proof.

## Deployment flow

- Node 1's consolidated apps are built and deployed through one dedicated app-bundle flow.
- The bundle flow is not gated by Apollo's full validation suite; it runs its own focused build/smoke checks.
- Node 2 follows the same consolidation approach for its assigned apps.
- Keep existing live deployments intact until screenshot review and explicit cutover approval.
- Do not deploy from this plan alone.

## Out of scope for this visual proof

- Full backend parity audit.
- Rewriting known-working backends.
- Full Apollo validation suite.
- Resource overflow scheduler, cross-node workload movement, load/chaos testing.
- Data migration, destructive cleanup, or production cutover.

## Immediate sequence

1. Inventory only the UI/app paths and existing Node deployment entrypoints needed for the port.
2. Port and consolidate the apps without redesigning their UIs.
3. Add a lightweight dedicated bundle build/smoke flow.
4. Start locally and open in a desktop browser.
5. Capture and review screenshot proof.
6. Continue wiring only the visible gaps identified by the screenshot.
7. Wait for explicit approval before deployment.
