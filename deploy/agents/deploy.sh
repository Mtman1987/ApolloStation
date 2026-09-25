#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f $1 ]]; then
  echo "Usage: deploy.sh /absolute/path/Athena_Stella_Agent_Package_v3.zip" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
chmod 0700 "$work"
trap 'rm -rf "$work"' EXIT
cp "$here"/Dockerfile "$here"/server.py "$here"/fly.toml "$work"/
cp "$root"/scripts/agents/{bootstrap.py,openai_runner.py,package-lock.json} "$work"/
cp "$1" "$work/Athena_Stella_Agent_Package_v3.zip"
python3 "$work/bootstrap.py" "$work/Athena_Stella_Agent_Package_v3.zip" --root "$work/verified"
rm -rf "$work/verified"
flyctl_bin="${FLYCTL_BIN:-flyctl}"
"$flyctl_bin" deploy "$work" --remote-only --no-public-ips --ha=false --yes
