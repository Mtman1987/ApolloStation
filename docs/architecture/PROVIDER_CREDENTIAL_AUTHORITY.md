# Provider credential authority

Status: implemented behind the shadow provider route. Production credentials are not enabled by this document or by deployment.

## Ownership boundary

SPMT is the only owner of provider access tokens, refresh tokens, client credentials, rotation state, and reauthorization state. Chat Gateway and first-party apps can request short-lived, capability-scoped access grants through the public SPMT API. They never receive a refresh token or provider client secret and must not persist an issued access grant.

The authority uses the existing SPMT SQLite database with a separate strict table. Access and refresh credentials are sealed together using AES-256-GCM, a random nonce, and the credential row ID as authenticated additional data. Tenant/provider/user identity, scopes, permitted apps/capabilities, expiry, revision, and state remain queryable projections; secrets do not.

The encryption key is supplied only as `SPMT_PROVIDER_CREDENTIAL_KEY` and must decode from base64url to 32 bytes. It is intentionally distinct from provider client secrets. Review Sprite sandbox startup rejects this key and all provider credentials.

## Rotation and fencing

`SqliteProviderCredentialAuthority` implements the source used by `ProviderGrantBroker`:

1. A valid access credential outside the refresh-skew window is returned to the broker.
2. An expiring/expired OAuth credential claims one SQLite refresh lease.
3. Other SPMT workers fail transiently while that lease is active; they do not issue a second refresh.
4. Twitch, Discord OAuth, or Kick returns both a new access token and a rotated refresh token. Both are atomically resealed under a revision fence.
5. A transient provider/transport response returns the record to `ready` for bounded retry. Invalid/revoked authorization becomes `reauthorization-required`.
6. A `replace-only` credential—such as a Discord bot token—never pretends to be refreshable. Provider rejection moves it directly to replacement/reauthorization.

The adapters follow the current provider refresh contracts: [Twitch refresh tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/), [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), and [Kick OAuth token refresh](https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md).

## Authentication rejection loop

Chat Gateway uses `SpmtChatProviderGrantSource`. It requests `/v1/provider-grants` with its scoped service identity. If a live driver later reports an authentication rejection, Chat Gateway calls `/v1/provider-grants/recover`; SPMT performs one fenced refresh and returns only `ready`, `unavailable`, or `reauthorization-required`. A successful recovery returns the connection to `pending` so it reconnects with a new grant. Permanent failures pause only that provider account.

Both endpoints require:

- a service access token carrying `providers:grant`;
- an app registered in SPMT;
- an enabled installation in the target tenant;
- a credential policy allowing that app, capability, and every requested provider scope.

Human sessions cannot issue grants or request refresh. Audits contain provider identity, app identity, result, and state only; tokens and provider error bodies are excluded/redacted.

## One-way donor import

`importLegacy()` accepts an already-extracted, explicitly authorized batch. It does not discover donor files, volumes, databases, or environment variables. The full batch is validated before `BEGIN IMMEDIATE`; every new secret is sealed before insertion. Existing Green links are skipped and never overwritten. A durable migration receipt makes replay return the original counts.

Before importing production data:

1. freeze and hash the approved donor export;
2. reconcile provider identities to canonical SPMT users and tenants—never by display name;
3. classify each Discord credential as OAuth or `replace-only` bot auth;
4. import into a recovery-tested copy and verify counts, tenant isolation, and raw-database secret absence;
5. import production once, retain the receipt and encrypted rollback point, and leave donor connections active until the live rehearsal passes.

## Controlled live rehearsal

`npm run provider:rehearse` is fail-closed. It requires `SPMT_PROVIDER_LIVE_REHEARSAL=1`, production runtime mode, an HTTPS SPMT origin, a scoped Chat Gateway service token, a unique rehearsal ID, and two to thirty credential-free connection definitions spanning at least two tenants. It uses the real Twitch IRC, Discord Gateway/REST, and Kick Pusher/REST adapters, waits 5–60 seconds, and succeeds only if every connection remains healthy.

The runner writes provider cursors and normalized messages only to a new temporary directory, removes it on exit, and prints aggregate tenant/provider/connection counts. It never prints the service token or provider grants. The rehearsal is intentionally not part of automatic CI or Sprite promotion because those environments do not own live provider credentials.

## Promotion gates

The shadow route can become Green primary only after all of the following are recorded:

- two distinct production-scoped tenants connect concurrently;
- Twitch, Discord, and Kick ingress and provider-neutral egress are verified where configured;
- forced access-token rejection proves refresh/reconnect without duplicate consumers;
- revoked refresh/bot credentials produce visible per-account reauthorization;
- process restart preserves cursors and encrypted credential state without persisting grants;
- recovery restore, secret rotation, audit redaction, and rollback are verified;
- owner acceptance is recorded before donor sockets are drained.
