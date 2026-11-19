# Hostless runtime tooling

**Location:** scripts/hostless  
**Purpose:** deterministic Node 1/Node 2 process composition, Hostless app synchronization, runtime config preparation, private preview and release workflow triggering.

## 1. Active topology

Only two production node keys are supported:

- node1 — SPMT authority and SpaceMountain integrated web host/workspace.
- node2 — Chat Gateway with co-located StreamWeaver and Nebula provider-runtime chain.

The ensure-node-app script explicitly rejects unknown node keys. The retired Node 3 app-creation workflow, bootstrap script and package command were removed.

The canonical release workflow is .github/workflows/hostless-three-node-deploy.yml. Its filename is historical; its matrix currently deploys Node 1 and Node 2. It owns validation gates, deployment ordering, secret synchronization and release evidence. These scripts do not provide a separate deployment path.

## 2. Script inventory

| Script | Mode | Responsibility |
|---|---|---|
| start-node.mjs | Runtime bootstrap | Select Node 1/Node 2 process composition from APOLLO_NODE_ROLE, prepare versioned DSH/Nebula runtime config and spawn local services |
| ensure-node-app.mjs | Mutating Hostless API/CLI | Resolve the exact Hostless project/app, validate the intended node and commit, sync only mapped runtime secrets, and ensure the app is deployed |
| nebula-runtime-config.mjs | Pure helper | Merge saved Nebula tenant config with discovered Chat Gateway connections without duplicate provider/channel rows |
| trigger-release.mjs | Workflow marker | Side-effect-free marker used by the canonical main-branch workflow path; does not deploy directly |
| deploy-private-preview.mjs | Mutating preview provisioner | Resolve/create the isolated Hostless preview project, configure password protection and deploy the preview |
| run-private-preview.mjs | Local process runner | Start isolated sandbox SPMT and SpaceMountain Web processes with outbound mode disabled and fixture-only data |

## 3. Node 1 composition

start-node.mjs validates APOLLO_NODE_ROLE and launches the Node 1 authority/web composition. The current bootstrap supplies DATABASE_PATH with a /tmp fallback when no explicit value is present.

**Critical persistence caveat:** /tmp/apollo-spmt.sqlite is ephemeral. It must not be treated as durable production storage. A production release requiring durable SPMT data must provide a proven persistent adapter/path, or fail closed. A passing readiness check does not prove data survives Hostless restart/replacement.

The script can conditionally launch DSH web and live worker components when their runtime config is explicitly requested. Empty tenant config is logged as deferred rather than creating a fake provider connection.

## 4. Node 2 composition

Node 2 launches the Chat Gateway worker and its configured StreamWeaver/Nebula consumers. The worker config is assembled from:

- CHAT_GATEWAY_CONNECTIONS and the saved NEBULA_ARCADE_RUNTIME_CONFIG_JSON / PATH;
- DSH_RUNTIME_CONFIG_JSON / PATH and DSH live runtime enablement;
- explicit Node 2 SPMT origin and service worker credentials;
- app-specific database paths and provider runtime flags.

The Nebula config merger preserves saved tenant/channel configuration and adds only newly discovered connection/channel pairs. It must not overwrite owner settings or duplicate channel rows.

## 5. ensure-node-app behavior

The script requires:

- node key node1 or node2;
- an explicit commit SHA;
- HOSTLESS_TOKEN;
- Hostless API access to the exact project/app;
- the package-level hostless:node1 or hostless:node2 entrypoint;
- the supported secret bundle and synchronization policy.

It refuses to deploy the monorepo root without an explicit role-specific entrypoint. It normalizes exact project/app names, rejects ambiguous matches, and does not create a second app merely because a lookup response is unexpected.

The runtime secret synchronization path uses APOLLO_GH_SECRETS_JSON and the allowlisted Hostless mapping. Never log the bundle or print individual secret values. A secret name is not proof that its value is present or valid.

## 6. Environment variable groups

The scripts read these names; the exact effective values are supplied by GitHub Actions/Hostless secrets and repository configuration.

### Node selection and release

- APOLLO_NODE_ROLE
- GITHUB_SHA
- GITHUB_REF
- GITHUB_REF_NAME
- APOLLO_SYNC_ONLY
- APOLLO_SYNC_RUNTIME_SECRETS
- APOLLO_GH_SECRETS_JSON

### Hostless API

- HOSTLESS_API_URL
- HOSTLESS_TOKEN
- HOSTLESS_NODE1_TOKEN
- HOSTLESS_NODE2_TOKEN

### Node 1 and Node 2 runtime

- PORT
- DATABASE_PATH
- SPMT_ORIGIN
- DSH_DATABASE_PATH
- DSH_WEB_PORT
- DSH_WEB_ORIGIN
- DSH_RUNTIME_CONFIG_JSON / DSH_RUNTIME_CONFIG_PATH
- SPMT_DSH_LIVE_RUNTIME_ENABLED
- NEBULA_ARCADE_DATABASE_PATH
- NEBULA_ARCADE_PORT
- NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED
- NEBULA_ARCADE_PUBLIC_ORIGIN
- NEBULA_ARCADE_RUNTIME_CONFIG_JSON / NEBULA_ARCADE_RUNTIME_CONFIG_PATH
- NEBULA_ARCADE_WORKER_CREDENTIAL
- CHAT_GATEWAY_CONNECTIONS
- TWITCH_BOT_TOKEN
- TWITCH_BOT_USERNAME
- SPACEMOUNTAIN_TWITCH_CHANNEL

### Private preview only

- APOLLO_PREVIEW_PASSWORD
- APOLLO_PREVIEW_URL
- SPMT_PUBLIC_URL
- SPMT_WEBHOOK_KEY

Preview configuration sets SPMT_OUTBOUND_MODE=disabled, sandbox mode, fixture-only app data and an isolated SQLite database. It is not a production clone and must never be treated as production acceptance.

## 7. Safe operator workflow

1. Review the intended branch and exact commit.
2. Confirm package scripts and node role mapping.
3. Run build/typecheck/full tests/offline tests and the release/persistence audits.
4. Confirm the release workflow validation gate is green.
5. Confirm only Node 1 and Node 2 are in the matrix.
6. Verify required environment names and presence without exposing values.
7. Dispatch the canonical workflow; do not call Hostless APIs manually from a one-off script.
8. Inspect each node job, logs, deployment revision and health separately.
9. Confirm both nodes run the intended SHA.
10. Run owner browser and real provider acceptance before declaring the release accepted.

Never manually bypass the workflow's green-validation gate.

## 8. Troubleshooting

| Symptom | First checks |
|---|---|
| Unknown node key | Pass exactly node1 or node2; there is no Node 3 |
| ensure-node-app refuses to deploy | Check the package hostless:<node> script, explicit SHA, token scopes and exact project mapping |
| SPMT data disappears after restart | Inspect effective DATABASE_PATH and adapter; /tmp is not durable |
| Node 2 has zero consumers | Inspect CHAT_GATEWAY_CONNECTIONS, runtime JSON/PATH, worker credentials and tenant/channel mapping |
| Nebula channels duplicate | Check the merger key provider + connectionId + channelId and saved config |
| DSH worker deferred | Confirm valid DSH config has provisioned tenants and provider connections |
| Secret sync fails | Check allowlisted variable mapping and token scope; never paste the secret bundle |
| Workflow validates but does not deploy | Check branch/event conditions and deploy-job dependencies; PR checks intentionally skip production deployment |

## 9. Change and test checklist

- [ ] Node role is explicit and limited to Node 1/Node 2.
- [ ] New service has a package entrypoint and readiness contract.
- [ ] Runtime config schema is versioned and validated.
- [ ] Secrets are allowlisted and never logged.
- [ ] Persistent data does not default to ephemeral /tmp in production.
- [ ] Validation must pass before deploy eligibility.
- [ ] Node 1 and Node 2 deployed SHA are recorded separately.
- [ ] Restart/restore and provider reconnect are tested.
- [ ] Rollback path is documented.

The private preview scripts are optional developer tooling. They must not become a production dependency or bypass owner sign-in.
