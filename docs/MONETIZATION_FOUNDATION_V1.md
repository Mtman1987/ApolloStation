# Monetization foundation v1

The canonical launch prices and allowances live in `config/billing-plans.v1.json`. Product code must not duplicate these values. A pricing or cap change requires a new manifest revision and the same contract/test review as a runtime-policy change.

## Authority boundaries

- SPMT entitlements record the tenant's assigned plan and purchased features.
- The usage ledger records user-scoped monthly consumption inside the authorized tenant, with durable idempotency.
- Expensive work must call `MonetizationService.preflight` before it is queued and `consume` when capacity is committed.
- Hosted and Companion execution are accounted separately. Paid Companion-local processing does not consume hosted allowance; Free Companion use remains bounded by fair use.
- Current plans stop at their caps. Automated post-paid overages are not enabled. Prepaid packs may be added later as signed entitlements.

## Metering rules

Workspaces, connected providers, hosted rooms, and storage are gauges and may be released. Worker, AI chat, AI coding, image generation, voice, and Xbox usage are monthly counters and cannot be decremented. Identical retries do not consume twice; reuse of an idempotency key for different usage fails closed.

The signed-in user's Account view reads `/v1/usage/me`. That endpoint derives the user from the authenticated principal and ignores caller-supplied user IDs. It exposes the user's plan, hosted and Companion quantities, hard limits, warning state, and theme-colored percentage bars. Personal plan, usage, XP, and linked identities belong in Account; Settings is reserved for shared workspace behavior and advanced controls owned by each app.

Warnings are emitted at 70%, 90%, and 100%. Mission Control receives only bounded aggregate revenue, plan, warning, hosted-usage, and Companion-usage projections—never credentials or tenant identities.

## Rollout gate

The foundation is safe to deploy before checkout exists. Assigning paid plans, accepting payment, enabling prepaid packs, or turning on automatic overages requires verified checkout webhooks, refund/cancellation handling, tax review, and measured production cost telemetry.
