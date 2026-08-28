# Monetization foundation v1

The canonical launch prices and allowances live in `config/billing-plans.v1.json`. Product code must not duplicate these values. A pricing or cap change requires a new manifest revision and the same contract/test review as a runtime-policy change.

## Authority boundaries

- SPMT entitlements record the tenant's assigned plan and purchased features.
- The usage ledger records tenant-scoped monthly consumption with durable idempotency.
- Expensive work must call `MonetizationService.preflight` before it is queued and `consume` when capacity is committed.
- Hosted and Companion execution are accounted separately. Paid Companion-local processing does not consume hosted allowance; Free Companion use remains bounded by fair use.
- Current plans stop at their caps. Automated post-paid overages are not enabled. Prepaid packs may be added later as signed entitlements.

## Metering rules

Workspaces, connected providers, hosted rooms, and storage are gauges and may be released. Worker, AI, voice, and Xbox usage are monthly counters and cannot be decremented. Identical retries do not consume twice; reuse of an idempotency key for different usage fails closed.

Warnings are emitted at 70%, 90%, and 100%. Mission Control receives only bounded aggregate revenue, plan, warning, hosted-usage, and Companion-usage projections—never credentials or tenant identities.

## Rollout gate

The foundation is safe to deploy before checkout exists. Assigning paid plans, accepting payment, enabling prepaid packs, or turning on automatic overages requires verified checkout webhooks, refund/cancellation handling, tax review, and measured production cost telemetry.
