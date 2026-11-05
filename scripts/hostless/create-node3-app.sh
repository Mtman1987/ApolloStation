#!/usr/bin/env bash
set -euo pipefail

: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"

# Node 3's project already exists. Pin the request to that exact project and
# the dedicated bootstrap branch, whose hostless.yaml requests only 0.1 vCPU,
# 128 MB RAM, one replica, and no volume or database.
hostless create app Node3 \
  --project 6aecd3d98f9b6b3471dff17a \
  --repo Mtman1987/ApolloStation \
  --platform Github \
  --branch node3-bootstrap-free \
  --yes \
  --json
