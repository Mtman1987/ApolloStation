#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPO="Mtman1987/ApolloStation"
SOURCE_DIR="${APOLLO_SECRETS_DIR:-/root/.apollo-secrets}"
MODE="${1:---dry-run}"

case "$MODE" in
  --dry-run|--apply) ;;
  *) echo "Usage: $0 [--dry-run|--apply]" >&2; exit 2 ;;
esac

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Secret directory not found: $SOURCE_DIR" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it and run: gh auth login" >&2
  exit 1
fi
gh auth status >/dev/null
gh repo view "$REPO" >/dev/null

shopt -s nullglob dotglob
files=("$SOURCE_DIR"/*)
count=0
failed=0

for file in "${files[@]}"; do
  [[ -f "$file" && ! -L "$file" ]] || continue
  base="$(basename "$file")"
  # Ignore editor/OS artifacts; only immediate regular files are considered.
  [[ "$base" != ".DS_Store" && "$base" != *".swp" && "$base" != *"~" ]] || continue
  name="$(printf '%s' "$base" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9_]/_/g; s/_+/_/g; s/^_+//; s/_+$//')"
  if [[ ! "$name" =~ ^[A-Z_][A-Z0-9_]{0,99}$ ]]; then
    echo "SKIP: filename cannot become a valid GitHub secret name: $base" >&2
    continue
  fi
  if [[ ! -s "$file" ]]; then
    echo "SKIP: empty file: $base" >&2
    continue
  fi
  count=$((count + 1))
  if [[ "$MODE" == "--dry-run" ]]; then
    printf 'WOULD IMPORT  %s\n' "$name"
    continue
  fi
  printf 'IMPORTING     %s\n' "$name"
  if gh secret set "$name" --repo "$REPO" < "$file" >/dev/null; then
    printf 'STORED        %s\n' "$name"
  else
    printf 'FAILED        %s\n' "$name" >&2
    failed=$((failed + 1))
  fi
done

if [[ "$count" -eq 0 ]]; then
  echo "No eligible secret files found in $SOURCE_DIR" >&2
  exit 1
fi

if [[ "$MODE" == "--dry-run" ]]; then
  echo "Dry run: $count eligible file(s). No secrets were uploaded."
  echo "Review names, then run: $0 --apply"
elif [[ "$failed" -gt 0 ]]; then
  echo "$failed of $count secret upload(s) failed." >&2
  exit 1
else
  echo "Successfully uploaded $count secret file(s) to $REPO."
  echo "Values were never printed. Verify names with: gh secret list --repo $REPO"
fi
