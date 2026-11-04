#!/usr/bin/env bash
set -euo pipefail

: "${RESTREAM_PROFILE_HOST_PATH:?Set RESTREAM_PROFILE_HOST_PATH to the mounted OCI block-volume directory}"
profile_path="$(realpath -e "$RESTREAM_PROFILE_HOST_PATH")"
mount_target="$(findmnt -rn -T "$profile_path" -o TARGET | head -n1)"
mount_target="$(realpath -e "$mount_target")"

if [[ "$mount_target" != "$profile_path" ]]; then
  echo "Refusing to prepare Restream profile: $profile_path is not itself a mount point (active mount: $mount_target)." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this preflight as root so the mounted volume can be assigned to container UID 10001." >&2
  exit 1
fi

chown 10001:10001 "$profile_path"
chmod 0700 "$profile_path"
install -o 10001 -g 10001 -m 0600 /dev/null "$profile_path/.restream-profile-volume"

echo "Restream profile volume verified at $profile_path."
echo "The browser profile itself must be provisioned separately through the owner's secure process."
