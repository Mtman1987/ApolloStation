# ApolloStation Oracle Cloud cutover

**Target:** Oracle Cloud Infrastructure (OCI), permanent host for ApolloStation.  
**Domains:** `spacemountain.live`, `spmt.live`, and approved application subdomains under `spacemountain.live`.  
**Current phase:** repository foundation only; Oracle account has not yet been created.

## Domain intent

Keep DNS ownership at the registrar/DNS provider selected by the owner. After OCI is provisioned, point the apex and `www` to the chosen public web entrypoint; point app subdomains to the same edge proxy unless a documented service boundary requires otherwise. Use DNS-01 ACME validation or an equivalent managed certificate flow for wildcard TLS. Do not publish wildcard records until the proxy routes and certificate automation are ready.

Proposed initial naming map (confirm each route before publishing):
- `spacemountain.live` — public SpaceMountain landing site.
- `www.spacemountain.live` — canonical redirect to the apex.
- `spmt.live` — short branded entrypoint/redirect.
- `api.spacemountain.live` — public API gateway only.
- `discord.spacemountain.live` — Discord Stream Hub web surface.
- `watch.spacemountain.live` — HearMeOut web surface.
- `chat.spacemountain.live` — Chat Gateway.
- `control.spacemountain.live` — Mission Control.
- `nebula.spacemountain.live` — Nebula Arcade.
- `companion.spacemountain.live` — Companion pairing/relay surface.

This is a proposed map, not evidence that each service is currently deployable at that hostname. Confirm app routes, auth, callback URLs and websocket requirements before DNS publication.

## Work sequence

1. **Code inventory:** every application, API, background worker, scheduled job, bot, callback and persistent store is classified as deployable, missing an entrypoint, or dependent on an external provider.
2. **OCI foundation:** account, compartment, region, quotas, IAM/API key, VCN, compute, block volumes, Vault, Object Storage and backup policy.
3. **Runtime packaging:** pin Node/runtime versions; add reproducible container entrypoints for each service; separate web processes from workers; configure health checks, restart policy, graceful shutdown and structured logs.
4. **Ingress:** one TLS edge proxy, explicit hostname-to-service routes, websocket upgrades, request/body limits, rate limits and security headers. Internal services remain private.
5. **Data:** identify every database and file store, migration order, ownership/tenant boundaries, export/import procedure, backup and restore proof. Do not copy secrets into Git.
6. **Provider connections:** migrate OAuth callback URLs, Discord/Twitch credentials, webhooks and provider allowlists to the new domains. Rotate secrets where appropriate.
7. **Release:** deploy in a private/staging route, reconcile tenant data, exercise critical live paths, verify monitoring and rollback. Switch DNS only after explicit owner approval.
8. **Retire donors:** only after Apollo has the required code and the production traffic/data migration is accepted.

## Production safety rules

- Never use a donor app as a permanent runtime dependency.
- Never expose databases, Redis, worker control ports or private service APIs directly to the internet.
- Keep credentials in OCI Vault or a similarly controlled secret store; use least-privilege service identities.
- Preserve current production data and credentials; do not overwrite tenant state during migration.
- Keep DNS cutover and donor retirement as explicit, reversible operations.
- Maintain an inventory of DNS records, OAuth callbacks, webhooks, outbound allowlists and certificate names.
- Treat provider playback/media URLs as sensitive; do not log signed URLs or credentials.

## Not yet complete

OCI account, tenancy and region; verified quotas/cost; deployed app containers; OCI Vault integration; Object Storage/backup; service-to-host mapping; TLS ingress; DNS records; provider callback updates; data reconciliation; live acceptance and rollback. The Terraform foundation in `infra/oracle` intentionally creates only a host/network baseline.
