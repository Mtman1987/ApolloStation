# Nebula Arcade canonical ownership

Status: **current architecture contract**

Nebula Arcade is the sole current Games Hub product, app, service, integration, worker, and public storage owner. Its canonical app ID is `nebula-arcade`. The historical `Mtman1987/chat-tag` repository name is donor provenance only and does not define a current app or service.

## Canonical identifiers

| Concern | Current identifier |
|---|---|
| App/source app | `nebula-arcade` |
| Tagging game | `tag` |
| Provider ingress worker | `nebula-arcade-provider-ingress` |
| Gateway consumer | `nebula.arcade.provider-ingress` |
| Tag API root | `/v1/nebula-arcade/tag` |
| Tag overlay widget | app `nebula-arcade`, widget `tag` |
| Event namespace | `nebula.arcade.*` |
| XP reason namespace | `nebula-arcade.*` |
| Runtime configuration | `NEBULA_ARCADE_*` |
| App-private tables | `nebula_tag_*`, `nebula_game_*`, `nebula_overlay_*` |

There is no public alias route, app ID, source-app ID, service identity, environment namespace, or separately registered worker for the former donor name.

## Runtime boundary

Nebula Arcade owns its game rules, game-private state, action feed, mixes, and renderers. SPMT remains canonical for human identity, app installation, authorization, XP, provider grants, shared events, usage, and workspace facts. Discord Stream Hub and other consumers filter events by `sourceAppId=nebula-arcade`.

## Data compatibility

Existing databases may contain identifiers created before this ownership correction. Startup performs an idempotent, one-way migration before current stores open:

- legacy app-private tables are renamed or merged into `nebula_tag_*` tables;
- stored event, XP, display, and outbox values are rewritten to Nebula Arcade namespaces;
- saved game runtime, overlay, mix, and action references normalize to game ID `tag`;
- current APIs return only canonical identifiers.

Frozen donor evidence and donor-repository baselines remain unchanged because they document historical source truth. They are not executable compatibility promises.

## Review guard

Every current-code change must prove that manifests, SDK producers, routes, workers, service identities, overlay grants, and documentation point to Nebula Arcade. The only executable awareness of historical identifiers belongs to the one-way migration module; it must never become a public alias.
