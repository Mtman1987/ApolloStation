#!/usr/bin/env bash
set -euo pipefail

: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"

# Create only the Node 3 Hostless app from ApolloStation's main branch.
# Hostless reads hostless.yaml for the app's free runtime configuration.
hostless create app Node3 \
  --repo Mtman1987/ApolloStation \
  --platform Github \
  --branch main \
  --yes \
  --wait \
  --json
