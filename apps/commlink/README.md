# Commlink

**Workspace:** @spmt/commlink  
**Location:** apps/commlink  
**Role:** first-party app registration and live-chat surface contract for canonical desks, ChatSpaces, mail, notifications, and IRC-compatible chat.

## 1. What this package contains

The Commlink app package is intentionally small. It exports:

- a versioned app module manifest and catalog registration helper;
- the live-chat app integration module.

It does not contain a standalone HTTP server or a second messaging database. The shared Commlink domain implementation is in @spmt/commlink-core, the platform-owned APIs are mounted by SPMT Service, and browser/shell presentation is integrated through SpaceMountain.

Keep this package as the app identity/contract boundary. Do not move mail or shared messaging authority into an app-local SQLite file.

## 2. Product responsibility

Commlink is the ecosystem communication surface for:

- canonical desks and ChatSpaces;
- personal mail and conversation/message history;
- notifications and read state;
- provider-neutral live chat presentation;
- app events and cross-app message delivery under explicit SPMT contracts;
- IRC-compatible client behavior where supported by the live-chat adapter.

SPMT owns shared identity, tenant/membership, canonical messaging/notification records and shared events according to the platform contracts. Chat Gateway owns provider sockets and normalized provider ingress. Commlink presents and routes communication; it is not a second provider connection manager.

## 3. Runtime and dependencies

| Component | Responsibility |
|---|---|
| apps/commlink/src/index.ts | App manifest, catalog registration and live-chat export |
| apps/commlink/src/live-chat.ts | Commlink live-chat integration |
| packages/commlink-core | Shared mail, messages, conversations, read state, notifications, social streams, forums, forwarding, live-chat stores and consumers |
| apps/spmt-service | Authenticated Commlink API routes and shared platform authority |
| apps/chat-gateway | Provider sockets, normalized chat events and Commlink delivery consumer |
| apps/spacemountain | Shell/workspace presentation and Commlink entry points |

Declared app dependencies are @spmt/commlink-core and @spmt/contracts. The app should remain lightweight and should not acquire provider SDKs, database drivers, browser frameworks, or infrastructure clients.

## 4. Identity and access

- Human users sign in through SPMT.
- Tenant and desk membership are derived from SPMT authority.
- App callers use the Commlink read/write and notification scopes declared in the manifest.
- Provider events arrive through Chat Gateway and retain provider/source attribution.
- IRC-compatible access must use the supported authenticated session/adapter contract; it must not create a second password/session authority.
- A caller cannot read another tenant's conversations or private mail by changing a client-side tenant identifier.

## 5. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/commlink

Relevant regression coverage includes:

- tests/commlink-mail-parity.test.mjs
- tests/commlink-live-chat.test.mjs
- tests/chat-gateway-commlink-transport.test.mjs
- tests/developer-platform.test.mjs
- tests/workspace-consolidation.test.mjs

The app package compiles through TypeScript project references. Most behavior tests belong to Commlink Core, SPMT Service, Chat Gateway and SpaceMountain because those packages own the implementation.

## 6. Data ownership and recovery

Commlink uses the shared platform records and Commlink Core stores defined by the SPMT service contract. It must not introduce an app-local competing copy of:

- user identity or tenant membership;
- canonical mail/conversation/message history;
- personal read state;
- notifications and event receipts;
- shared workspace facts.

Any app-private UI preferences or local presentation caches must be explicitly non-authoritative and rebuildable.

Before changing message schemas, read-state semantics, notification delivery or provider message ingestion, update the shared contract, migration and recovery tests together.

## 7. Performance and reliability

- Keep the app module thin; shared behavior belongs in Commlink Core.
- Use bounded pagination for mail, conversations, message search and notification lists.
- Use durable event/outbox delivery and idempotency for provider messages and notifications.
- Avoid polling full conversation history when cursor-based updates are available.
- Do not open provider sockets from the Commlink browser.
- Keep provider ingress in Chat Gateway and use one normalized event path.
- Bound unread/read-state fan-out and notification history.
- Preserve source app, provider, tenant and correlation attribution.

## 8. Acceptance checklist

- [ ] Commlink is discoverable and launchable through the SPMT app catalog.
- [ ] Desks and ChatSpaces resolve for the signed-in tenant.
- [ ] Personal mail, conversation history and read state use canonical SPMT APIs.
- [ ] Notifications are tenant-scoped and read/unread state persists.
- [ ] Chat Gateway messages arrive once with provider/source attribution.
- [ ] IRC-compatible access uses the supported authenticated adapter.
- [ ] Cross-tenant/private mail access is rejected.
- [ ] Message and notification state survive restart/restore.
- [ ] No duplicate provider socket, duplicate message store, or app-local identity authority is introduced.
