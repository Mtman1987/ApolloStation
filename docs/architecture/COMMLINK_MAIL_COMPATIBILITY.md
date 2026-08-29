# Commlink Mail Compatibility

Commlink private mail is owned by SPMT and consumed through its public API and SDK. SpaceMountain is a presentation client; it does not keep a second mailbox, accept caller-selected user identities, or receive provider credentials.

## Preserved behavior

- A signed-in user can discover other members of the current tenant, compose private mail to one or more recipients, list inbox and sent history, open conversations, search canonical messages, reply to existing participants, and mark one or all conversations read.
- Recipient discovery excludes the caller and all users outside the authenticated tenant.
- Read state belongs to the authenticated user. A participant cannot inspect or mutate another member's read state.
- Compose accepts an idempotency key. An identical retry returns the original conversation and message; reuse with changed recipients, subject, or text returns a conflict.
- Mail, personal read state, and replay records share the authority database and survive process restart.

## Deliberate improvements

The browser never supplies the acting user ID. SPMT derives it from the human access token. Services cannot compose personal mail or update personal read state. New mail is distinct from the ChatSpace workspace organizer and from provider live-chat ingestion.

## Remaining cutover gate

Historical donor conversation and read-state records are not silently imported. The cutover rehearsal must inventory source records, reconcile canonical user IDs, compare row counts and checksums, prove two-tenant isolation and restore, and retain a rollback snapshot before Blue retirement.
