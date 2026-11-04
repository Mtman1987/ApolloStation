#!/usr/bin/env bash
set -euo pipefail

: "${APOLLO_DATA_HOST_PATH:?Set APOLLO_DATA_HOST_PATH to the mounted encrypted OCI block-volume directory}"
data_path="$(realpath -e "$APOLLO_DATA_HOST_PATH")"
mount_target="$(findmnt -rn -T "$data_path" -o TARGET | head -n1)"
mount_target="$(realpath -e "$mount_target")"

if [[ "$mount_target" != "$data_path" ]]; then
  echo "Refusing to prepare Apollo data: $data_path is not itself a mount point (active mount: $mount_target)." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this preflight as root so the volume can be assigned to container UID 1000." >&2
  exit 1
fi

chown 1000:1000 "$data_path"
chmod 0750 "$data_path"
for directory in data media config backups; do
  install -d -o 1000 -g 1000 -m 0750 "$data_path/$directory"
done
install -d -o 1000 -g 1000 -m 0750 "$data_path/caddy-data" "$data_path/caddy-config"

echo "Apollo data volume verified at $data_path."
echo "No databases, profiles or backups were created, copied or changed."
