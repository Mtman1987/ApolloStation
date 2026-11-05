#!/usr/bin/env bash
set -euo pipefail

: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"

# Node 3 starts with an empty Hostless account: create its free project first,
# then create the app inside that newly linked project. Do not deploy or test.
hostless create project Node3 --yes --json

hostless create app Node3 \
  --repo Mtman1987/ApolloStation \
  --platform Github \
  --branch main \
  --yes \
  --json
