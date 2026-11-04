# External database strategy for ApolloStation

Status: design decision and migration gate. As of 2026-11-04, the owner has created one Turso pilot database (`apollo-persistence-spike`, `aws-us-east-1`) and three Hostless accounts for the agreed Core / Live+Games / Discord roles. No recovered data has been imported, no production credential has been added to source control, and no Hostless app resource or production deployment has been provisioned.

## Decision

Hostless is a compute target, not the required home for durable data. The three Hostless accounts may run the ecosystem's application processes while authoritative databases live on separately managed database services. Hostless local disk should be limited to rebuildable caches, temporary media, and bounded logs unless a persistent volume is explicitly provisioned.

This removes Hostless storage quotas from the durable-data calculation. It does **not** remove database compatibility, write-concurrency, network, backup, cost, or availability constraints.

## Current ApolloStation compatibility facts

- Production persistence is currently built around Node's `node:sqlite` `DatabaseSync` API and absolute local database paths, not a generic database URL/driver abstraction.
- Separate owners include SPMT authority, Chat Gateway receipts/provider connections, StreamWeaver state, Nebula Arcade/game state, Discord Stream Hub state, and other app-owned stores. Keep those ownership boundaries and service identities.
- Chat Gateway currently constructs StreamWeaver and Nebula provider runtimes in-process. The Nebula live server also opens Nebula's database. Those runtimes may be co-located on one Hostless account while connecting to remote database services; moving the DB does not require splitting the runtimes.
- A remote database must be reachable over TLS from the Hostless runtime, enforce credentials and tenant boundaries, and support the transaction/locking behavior each store actually uses.

## Candidate services (free tiers checked 2026-11-04)

| Provider | Engine / free allowance | Fit for ApolloStation | Constraints / decision |
|---|---|---|---|
| Turso | libSQL; 100 databases, 5 GB storage, 500M row reads/month, 10M row writes/month; 1-day point-in-time restore | Best first *compatibility spike* for SQLite-owned stores; not a drop-in | Not a drop-in for Node `DatabaseSync`. Requires replacing direct local-file access with a tested libSQL driver/repository adapter. Verify transaction semantics, migrations, connection limits, export/restore and provider terms before production. |
| Neon | PostgreSQL; 1 GB per project, 100 CU-hours/project/month, up to 100 projects | Strong candidate for services whose persistence can be moved behind a Postgres repository layer | Requires SQL/driver migration; free compute scales to zero and has monthly compute/egress quotas. Cold starts and quota exhaustion are production availability risks. |
| Cloudflare D1 | SQLite semantics; 10 free databases, 500 MB/database, 5 GB/account total; 5M rows read/day and 100K rows written/day | Potential fit only for a service/API specifically hosted on Workers or an HTTP-backed adapter | Not a direct Node `DatabaseSync` replacement. Each DB is single-threaded; free daily limits cause queries to fail when exceeded. Per-database 500 MB cap. |
| Supabase | PostgreSQL; 500 MB/project, two active free projects | Useful secondary candidate for low-risk or non-critical datasets / integration prototype | Free projects can pause after 7 days of low activity; downloadable DB backups are not included on Free. Do not make it the only recovery copy for critical player/economy data. |

Provider limits are mutable. Recheck official pricing/limits at provisioning time. Links:
- Turso pricing: https://turso.tech/pricing
- Neon free-plan announcement: https://neon.com/blog/neon-free-plan-1-gb-per-project
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 free-tier enforcement: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Supabase pricing: https://supabase.com/pricing
- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod

## Recommended staged approach

1. **Do not change the live schema or production database paths yet.** First inventory every `DatabaseSync` construction, schema migration, transaction, pragma, lock assumption, and database file owner.
2. **Introduce an explicit persistence adapter boundary** behind existing store/repository interfaces. Keep current SQLite implementation as the reference and test fixture. Avoid a blanket global database abstraction that hides SQLite-specific semantics.
3. **Prototype Turso Cloud/libSQL with one low-risk store** (not SPMT authority, player balances, cards, or delivery receipts). Run the existing repository tests against local SQLite and the remote adapter; test concurrent writes, retry after disconnect, transaction rollback, duplicate delivery IDs, migration, export and restore.
4. **Prototype Postgres separately** for stores whose SQL can be ported cleanly. Keep one database/schema owner per service and use least-privilege credentials. Do not have unrelated services share unrestricted write credentials.
5. **Move durable media/object blobs separately** to an object-storage service only after classifying whether each file is user-owned, generated/rebuildable, or cache. Never store secrets or browser profiles in public buckets.
6. **Build automated encrypted exports and restore drills** before importing live data. Verify SQLite integrity / Postgres consistency, row counts, key digests, identity mapping, and application-level invariants. Preserve rollback snapshots.
7. **Measure real workload** (database size, write rate, peak concurrency, query/read volume, egress, idle periods) against provider free quotas. Add hard spend alerts/caps where available and a fail-safe that stops noncritical writes rather than silently dropping critical events.
8. **Only then provision and migrate**, with a documented cutover window, write fencing, final delta export, validation, and rollback plan. Do not create provider accounts or resources without the owner's explicit approval.

## Placement after externalizing data

- Node 1: SPMT authority + SpaceMountain/OverlayBay processes. Authority DB can be external Postgres after its repository/migration/restore work is proven.
- Node 2: Chat Gateway + StreamWeaver + Nebula provider runtime/web processes. Keep their service identities and separate DB owners; each can connect to its own external DB endpoint.
- Node 3: Discord Stream Hub web/worker and DSH-owned Lounge state. DSH's Nebula-media calls must use a scoped API, not direct Nebula DB credentials.
- Restream browser profile, if ported, needs private durable object/volume storage and must not be put in an ordinary SQL table or public bucket.

This is a logical deployment map, not proof of Hostless CPU/RAM fit or provider capacity.

## Release gates

- [ ] Persistence inventory covers all runtime database files and direct SQL access.
- [ ] Driver adapters pass existing tests and concurrency/idempotency tests.
- [ ] Every critical database has encrypted off-provider export and a successful isolated restore drill.
- [ ] Provider free-tier usage fits measured workload with headroom; no automatic paid overage is possible without owner approval.
- [ ] Tenant isolation, service identity, TLS, credential rotation, and least-privilege DB grants are tested.
- [ ] Cross-node synthetic ecosystem test passes with the external databases: login/roles, provider chat event, StreamWeaver effects, Nebula game state, Discord delivery, OverlayBay update, restart and state verification.
- [ ] Cutover/rollback and live data reconciliation are reviewed and approved.

Until these gates pass, external DB use is an implementation path—not a claim that the ecosystem is deploy-ready.
