# Apollo Parity Engine v1

The parity engine centralizes inventory and evidence references for HearMeOut,
StreamWeaver, Nebula Arcade, Discord StreamHub, and their shared Apollo
contracts. The machine-readable source is
`config/apollo-parity-capabilities.v1.json`.

## Commands

- `npm run parity:audit` validates registry structure and referenced paths,
  then prints product status and open gaps.
- Update the registry when a capability is discovered, implemented, retired,
  or blocked. Keep source and test references close to each entry.
- Run the product's focused tests and the full Oracle release validation after
  implementation changes.

## Status discipline

- `verified`: passing automated evidence plus required acceptance proof.
- `ported-unverified`: implementation exists but required evidence is pending.
- `partial`: some behavior exists and known gaps remain.
- `missing`: required behavior is absent.
- `blocked`: a named dependency prevents progress.
- `retired`: owner-approved exclusion only.
- `unknown`: not inspected. Never treat unknown as complete.

The audit command deliberately does **not** mark code as verified, generate
synthetic passing tests, or infer live acceptance from source presence. Live
provider rehearsal, tenant isolation, migration, restart/restore, rollback,
and owner acceptance remain explicit evidence where required.

## Operating loop

1. Inspect donor behavior read-only and add a capability/gap with source
   references.
2. Check whether an Apollo shared contract already owns the behavior.
3. Implement the smallest app-owned adapter or missing behavior.
4. Add a focused regression at the real public boundary, including negative
   authorization and replay/error behavior where applicable.
5. Run focused validation, then the full Oracle release workflow.
6. Update status only from the evidence actually produced.

This first increment establishes the shared inventory and path-integrity
check. It does not claim the five products are at parity or automate code
changes without review.
