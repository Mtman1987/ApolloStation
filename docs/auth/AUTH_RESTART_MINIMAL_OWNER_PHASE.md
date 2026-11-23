# Apollo Authentication Restart — Minimal Owner-Development Phase

## Owner decision
During current private development, MT is the only interactive tester (or an explicitly authorized assistant test). Authentication must not be allowed to block basic app-shell, settings, navigation, or app reliability work.

## Phase 0: unblock development
- Keep the current Apollo UI, app shell, navigation, and universal settings unchanged.
- Use the simplest owner-only development sign-in/session path supported by the private deployment.
- No general-user onboarding, tenant selection, social-provider linking, role matrix, account recovery automation, refresh-token rotation, or multi-provider conflict resolution is required to begin app reliability testing.
- Never expose the development bypass to public/production mode. Explicit environment/runtime guard; default off outside private development.
- Missing local password is a setup state, not an error. Show a clear password setup prompt/flow, not a red failure.
- Do not create a second account when an existing Discord/Twitch identity/account can be matched.
- Preserve the old ecosystem on the preservation branch.

## Phase 1: basic authentication
- Owner can enter the private development environment and establish a browser session.
- Session restore works across reloads.
- Logout clears the session.
- Password setup is reachable from a missing-password state.
- Do not add social verification gates for the owner-only development path.

## Phase 2: app reliability
- Verify shell, universal settings, navigation, app catalog, and the primary apps work.
- Keep auth changes small and separate from UI redesign.
- Do not deploy automatically; validate branch and tests first.

## Later hardening (deferred)
After the apps are reliable and owner testing is complete, implement public-user authentication in stages: Discord/Twitch identity gate, community/tenant context, canonical SPMT identity mapping, username/password, provider linking, recovery, roles/scopes, tenant isolation, and full OAuth/session protections.

## Acceptance checklist
- [ ] Owner sign-in/setup works in private development without social identity prompts.
- [ ] Missing password opens password setup instead of displaying a red auth error.
- [ ] Browser session restores on reload.
- [ ] Logout clears session.
- [ ] UI shell, settings, navigation, and app views are unchanged.
- [ ] Tests cover the development-only bypass and ensure it cannot activate in production.
- [ ] No duplicate account is created.
- [ ] Branch diff reviewed; no deployment until green validation.
