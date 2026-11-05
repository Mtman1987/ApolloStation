#!/usr/bin/env bash
set -euo pipefail

: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"

# Node 3 is a separate Hostless account. Its project already exists.
# Use the exact bootstrap commit on the dedicated branch so the first app
# reads the small, no-volume, single-replica free-tier hostless.yaml.
hostless create app Node3 \
  --project 6aecd3d98f9b6b3471dff17a \
  --repo Mtman1987/ApolloStation \
  --platform Github \
  --branch node3-bootstrap-free \
  --commit 10c36e525d9dfde5bc564e24c18802abf4d90544 \
  --yes \
  --json
