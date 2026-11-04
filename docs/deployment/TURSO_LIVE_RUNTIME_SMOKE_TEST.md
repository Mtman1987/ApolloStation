# ApolloStation live Turso runtime smoke test

This test proves a deployed Node process can reach the configured Turso database, create/use the shared JSON staging table, write a unique synthetic record, read it back, roll back a failed transaction, and read the committed record through a newly opened client.

It does **not** prove that existing synchronous Apollo domain stores have been migrated to Turso, nor does it import recovered player data. It is a connectivity/persistence gate before any production data cutover.

## Required server-side environment

Set these only in the Hostless server/workload secret environment (never in browser/client variables, repository files, command-line arguments, or logs):

- `TURSO_DATABASE_URL`: the existing Apollo Turso database URL.
- `TURSO_AUTH_TOKEN`: a database auth token with the minimum required read/write permissions.
- `APOLLO_TURSO_LIVE_TEST=1`: explicitly enables the destructive-write smoke test; it writes only a random synthetic namespace and removes its records afterward.

The test refuses to run unless all three are present. It does not print the URL or token.

## Run inside the deployed Node workload

```sh
npm run db:test:turso:live
```

A skipped test means the explicit enable flag or credentials are absent. A pass confirms a live connection, read/write/read-back, rollback, and visibility from a fresh client. A failure must block app cutover and be investigated before retrying.

## Data safety

- Uses a fresh random namespace and record key on each run.
- Writes synthetic test payloads only.
- Tests rollback by throwing inside a transaction.
- Reopens the database through a new adapter instance to verify persistence independent of the original connection.
- Attempts to delete its own records in a finally block.
- Never queries or modifies player, identity, points, cards, economy, Lounge, or recovered-data namespaces.

The adapter is HTTP/Hrana-based and asynchronous. Existing application stores that use Node's synchronous `DatabaseSync` are not automatically redirected by setting these environment variables. Each domain store and its callers still need an explicit async migration or a separately verified compatibility driver.
