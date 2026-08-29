# StreamWeaver supervised provider runtime

Status: implemented in Green; live provider connections remain credential-gated.

## Ownership

Chat Gateway owns Twitch, Discord, and Kick sockets, provider grants, reconnect cursors, normalized ingress, and provider egress. StreamWeaver owns persona settings, summon state, commands, tenant currency, accepted Stellar jobs, and its reply outbox. SPMT owns canonical identity, scoped service authentication, usage admission, jobs, and XP.

The supervised host may carry both the `chat-gateway` and `streamweaver` cohort credentials, but it never substitutes one identity for the other. Provider grants and Commlink writes use the Chat Gateway token. Identity resolution, Stellar invocation, job reads, local-currency exchange, and runtime reporting use the StreamWeaver token.

## Runtime flow

1. Chat Gateway obtains an ephemeral SPMT provider grant and opens the configured provider connection.
2. It normalizes a human message, persists it once, and creates one delivery per accepting consumer.
3. Commlink receives the public live-history projection.
4. StreamWeaver routes donor commands, tenant currency, or the configured persona without opening another provider listener.
5. Persona work enters the metered Stellar job contract with a delivery-derived idempotency key.
6. The app-private reply outbox survives restarts and reconciles a terminal job into one provider-neutral reply to the originating message.
7. Bot-authored messages are rejected before StreamWeaver routing, preventing AI and command re-entry loops.

## Durable state

`CHAT_GATEWAY_DATABASE_PATH` contains normalized provider messages, delivery attempts, provider connection definitions, leases, and cursors. `STREAMWEAVER_DATABASE_PATH` contains only StreamWeaver-owned settings, summons, command receipts/cooldowns, currency wallets/settings/exchanges, and persona reply records. Both paths are explicit and absolute; sandbox paths must be sandbox-named.

## Deployment gates

The production Sprite starts this supervised runtime and authenticates both internal identities, but `CHAT_GATEWAY_CONNECTIONS` remains an explicit bounded array. An empty array opens no provider socket. Real credentials stay inside SPMT's encrypted authority and are issued only as short-lived Chat Gateway grants.

Green-primary provider traffic still requires the controlled concurrent two-tenant rehearsal, reconnect/drain evidence, donor data import, and owner acceptance. Commands whose external capability adapters are not connected return a truthful unavailable result; they do not fabricate success or call a donor privately.
