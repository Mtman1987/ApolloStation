# Sources

## Repository evidence

The raw copies under `evidence/raw/` were captured from the current default branches on 2026-08-21:

- `Mtman1987/spacemountain-live` — commit `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`
- `Mtman1987/spmt-live` — commit `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc`

High-value source documents include:

- `spmt-live/docs/ecosystem/PRODUCTION_BASELINE.md`
- `spmt-live/docs/ecosystem/SPMT_PRODUCTION_INVENTORY.md`
- `spmt-live/docs/ecosystem/PRODUCTION_ROADMAP.md`
- `spmt-live/docs/ecosystem/production-manifest.json`
- `spmt-live/docs/ecosystem/auth-migrations.json`
- `spmt-live/docs/ecosystem/GATE_0_BACKUP_RESTORE.md`
- `spmt-live/docs/ecosystem/COSMO_COMMLINK_INTEGRATION_PLAN.md`
- `spmt-live/docs/platform/DATA_OWNERSHIP.md`
- `spmt-live/docs/platform/IDENTITY.md`
- `spmt-live/docs/platform/SECURITY_MODEL.md`
- `spmt-live/docs/platform/API_REFERENCE.md`
- `spmt-live/docs/developers/OAUTH_FLOW.md`
- `spacemountain-live/docs/ARCHITECTURE.md`
- `spacemountain-live/docs/VISION.md`

## Fly.io primary documentation checked

- Autostop/autostart Machines: https://fly.io/docs/launch/autostop-autostart/
- Managing Machines with the Machines API: https://fly.io/docs/machines/guides-examples/managing-machines-with-the-api/
- Autoscale based on metrics: https://fly.io/docs/launch/autoscale-by-metric/
- Fly Volumes overview: https://fly.io/docs/volumes/overview/
- Add volume storage: https://fly.io/docs/launch/volume-storage/

Relevant constraints from those sources:

- Fly Proxy starts and stops existing Machines; it does not create or destroy capacity automatically.
- Dynamic created/started Machine counts require an autoscaler or Machines API control.
- background work needs explicit lifecycle because returning an HTTP request may allow autostop to kill ongoing work;
- a Fly Volume belongs to one app, exists on one server, attaches to one Machine, and is not automatically replicated;
- stopped/suspended compute avoids CPU/RAM charges, but stopped root filesystems and storage can still cost money.

Fly GPU unavailability is an owner-supplied current constraint and is treated as non-negotiable in this proposal.
