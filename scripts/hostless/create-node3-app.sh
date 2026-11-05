#!/usr/bin/env bash
set -euo pipefail

: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"

# Create only Node 3 in the project resolved for the Node 3 token.
# Do not wait for or run a separate deployment/test workflow here.
hostless create app Node3 \
  --project 6aeb3dff5e8f6800ea0f67b8 \
  --repo Mtman1987/ApolloStation \
  --platform Github \
  --branch main \
  --yes \
  --json
