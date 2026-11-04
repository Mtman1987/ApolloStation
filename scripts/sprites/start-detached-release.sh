#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ! "${BUILD_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BUILD_SHA must be a full Git commit SHA" >&2
  exit 1
fi

run_root="/home/sprite/data/release/deploy-runs/$BUILD_SHA"
status_file="$run_root/status"
log_file="$run_root/deploy.log"
mkdir -p "$run_root"
rm -f "$status_file" "$status_file.next" "$log_file"

nohup /bin/bash -c '
  set +e
  /bin/bash /tmp/deploy-sandbox-release.sh >"$1" 2>&1
  code=$?
  printf "%s\n" "$code" >"$2.next"
  mv -f "$2.next" "$2"
' detached-release "$log_file" "$status_file" </dev/null >/dev/null 2>&1 &

printf '%s\n' "$!"
