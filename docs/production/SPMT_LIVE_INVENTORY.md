# SPMT live inventory

Updated: 2026-08-30
Status: source and historical recovery evidence collected; current live Fly runtime/filesystem inventory still required.

This file records production facts needed by HearMeOut's first canary because Green HearMeOut depends on SPMT identity, provider grants, app registration, shared account facts, and authorization.

## Blue source shape

Current `Mtman1987/spmt-live` main is recorded in Apollo's live-source manifest as `e8241ad1682cadafa7c867e560fdb27360f99a06`.

Current `spmt-live/fly.toml` declares:

- Fly app: `spmt-live`
- primary region: `lax`
- `app` process: Node service on port 3000
- `xbox` process: separate guarded Xbox worker on port 3003
- app process: 1 shared CPU / 1 GB memory
- Xbox process: 2 shared CPUs / 2 GB memory
- app minimum one running Machine; autostop disabled
- app readiness route: `/api/health/ready`
- persistent `spmt_data` volume mounted at `/data`
- volume configured to auto-extend from its initial size up to 20 GB

The current source still contains infrastructure-provider URLs for operational worker integration. Those are migration inputs, not permanent public product identity.

## Historical recovery evidence still useful

The donor recovery runbook records a verified 2026-07-28 isolated restore of Blue SPMT:

- canonical database: `/data/spmt.db`
- historical active volume ID: `vol_vde2p30e6xo8d0k4`
- historical region: `lax`
- historical observed volume size: 1 GB at that time
- isolated restore passed SQLite `quick_check`
- 31 tables were observed
- historical observed RPO: approximately 4.6 hours
- historical observed RTO: 184 seconds

This proves that a real restore path existed at that point. It does **not** prove the same volume ID, size, Machine, snapshot age, table count, or backup freshness today.

## SPMT facts required by the HearMeOut canary

Before HearMeOut can become authoritative, we need current proof for the SPMT capabilities it calls:

- canonical user/tenant lookup
- linked provider identity lookup
- HearMeOut app registration/install/grants
- service identity used by HearMeOut
- provider-grant issuance/revocation path for any LiveKit/Discord/Twitch integrations routed through SPMT
- shared account/profile/XP ownership boundaries
- audit/event path used by HearMeOut
- current health/readiness and persistence across restart

The Apollo implementation for these contracts is already covered by offline tests. This inventory is about Blue production data and migration/reconciliation, not re-proving the Green API design.

## Read-only live evidence still required

For `spmt-live`:

- current app Machine ID(s), process groups, state and region
- exact attached `spmt_data` volume ID, region, capacity and used bytes
- current `/data/spmt.db` size and modification time
- SQLite integrity result
- current table names/counts or schema fingerprint without printing private records
- current backup/snapshot freshness and most recent verified restore evidence
- current release/image identity
- readiness response
- any additional durable files under `/data`
- current public certificates/routes/callback dependencies

No secret values should be printed.

## Decision boundary

We do not need to decide SPMT's final physical storage provider before reading the current data. We do need current size/load/recovery evidence before moving production writes.

The likely decision tree is:

1. if current SPMT data remains small, single-writer, low-throughput and easy to snapshot/restore, Green may keep a simple bounded store initially with stronger independent recovery;
2. if current load, concurrency, cross-region availability, or migration complexity now exceeds that model, move the physical authority behind the same SPMT contracts to a managed/network database before broad tenant cutover;
3. in either case, first-party apps never regain direct database access.

The current live inventory is the missing evidence needed to choose between those options.
