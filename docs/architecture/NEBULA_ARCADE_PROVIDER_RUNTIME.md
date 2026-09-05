# Nebula Arcade supervised provider runtime

Status: implemented in Green; production provider tenants remain explicit and empty by default.

## Ownership

Chat Gateway alone owns Twitch, Discord, and Kick sockets, short-lived provider grants, reconnect cursors, normalized ingress, and provider egress. Nebula Arcade is a logical consumer inside that supervised cohort. It owns only its app-private game state, command receipts, actions, overlay feeds, support state, and Tag outbox. SPMT remains the authority for canonical identity, service authentication, events, and XP.

The cohort authenticates `chat-gateway` and `nebula-arcade` independently. Provider credentials are never accepted by the Nebula configuration or written into Nebula databases.

## Command flow

1. Chat Gateway persists and normalizes a human provider message once.
2. The Nebula consumer accepts it only when tenant, provider, connection, and channel match the strict versioned configuration.
3. All game commands and continuation input require a complete leading `spmt` token. Global help/rules runs before game routing and lists only running games. Other bot commands and ordinary conversation never enter game handlers.
4. Ambiguous commands ask for `spmt N`, with the choice retained for 30 seconds across restarts. Safe team-color commands can fan out to both compatible games.
5. Command IDs are delivery-derived and retained in bounded app-private state. A retry cannot mutate scores, membership, or action feeds twice.
6. Replies return through Chat Gateway with a stable Nebula idempotency key and the original provider message as the reply target.

## Runtime and safety gates

`NEBULA_ARCADE_RUNTIME_CONFIG_PATH` is an absolute JSON path. Unknown fields, duplicate tenants/channels, unknown games, and credential-like extra fields are rejected. `NEBULA_ARCADE_DATABASE_PATH` is also absolute. Sandbox mode requires sandbox-named files and disabled outbound access. When shadow live ingress is explicitly enabled, configured provider tenants may run through Chat Gateway while game results are added to the room's `game` lane.

The Sprite cohort always starts and authenticates the Nebula consumer against a tracked zero-tenant sandbox configuration. This proves composition, migrations, service separation, and clean shutdown without opening a provider socket or sending an external message.

Automatic Tag rotation remains fail-closed until a fresh canonical presence snapshot is available. The runtime reports `presence-required`; it never converts absent or stale monitoring data into an empty live-user list. Production activation still requires the controlled two-tenant provider rehearsal, canonical presence projection, donor-state reconciliation, deployed overlay proof, and owner acceptance.

See [chat command behavior](NEBULA_CHAT_COMMANDS.md) and [settings/shared-policy audit](NEBULA_GAME_SETTINGS_AUDIT.md) for aliases, guides, recent channel activity, opt-outs and remaining gaps.
