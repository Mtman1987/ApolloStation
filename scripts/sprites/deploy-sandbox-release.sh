#!/usr/bin/env bash
set -Eeuo pipefail

for name in DEPLOY_ROLE BUILD_SHA REPOSITORY_URL SPRITE_PUBLIC_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required deployment value: $name" >&2
    exit 1
  fi
done

if [[ "$DEPLOY_ROLE" != "review" && "$DEPLOY_ROLE" != "release" ]]; then
  echo "DEPLOY_ROLE must be review or release" >&2
  exit 1
fi
if [[ ! "$BUILD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BUILD_SHA must be a full Git commit SHA" >&2
  exit 1
fi
if [[ ! "$REPOSITORY_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ ]]; then
  echo "REPOSITORY_URL must be a GitHub HTTPS clone URL" >&2
  exit 1
fi
if [[ ! "$SPRITE_PUBLIC_URL" =~ ^https://[a-z0-9-]+\.sprites\.app$ ]]; then
  echo "SPRITE_PUBLIC_URL must be a credential-free Sprites HTTPS origin" >&2
  exit 1
fi

deployment_root="/home/sprite/apollo-${DEPLOY_ROLE}"
releases_root="$deployment_root/releases"
release_dir="$releases_root/$BUILD_SHA"
current_link="$deployment_root/current"
next_link="$deployment_root/current.next"
data_root="/home/sprite/data/$DEPLOY_ROLE"
service_name="apollo-sandbox"
bootstrap_service_name="webtmux"
llama_root="/home/sprite/runtime/llama-b6335"
llama_ref="b6335"
media_root="/home/sprite/runtime/ffmpeg-b6.1.1"
llama_archive_sha256="6ffee01c8fe2481faf8b614bbd8ca9bdaa563f47d4d9e00dc44f423962812d25"
previous_release=""
switched=0
bootstrap_service_removed=0

mkdir -p "$releases_root" "$data_root"
if [[ -L "$current_link" ]]; then
  previous_release="$(readlink -f "$current_link")"
fi

create_apollo_service() {
  local release_sha="$1"
  local enable_stellar="${2:-1}"
  local runner_args="scripts/sprites/run-supervised-sandbox.mjs,--app,platform,--candidate-app,nebula-arcade,--catalog,current,--public-url,$SPRITE_PUBLIC_URL,--data-root,$data_root,--build-sha,$release_sha,--owner-username,mtman1987,--offline-network-guard,1,--live-read-origin,https://spmt.live"
  if [[ "$enable_stellar" == "1" ]]; then
    runner_args="$runner_args,--llm-binary,$llama_root/build/bin/llama-server,--llm-cache,/home/sprite/models"
  fi
  sprite-env services create "$service_name" \
    --cmd "$media_root/run-node" \
    --args "$runner_args" \
    --dir "$current_link" \
    --http-port 8080 \
    --duration 15s
}

# The media renderer and its tests need the same verified FFmpeg on the Sprite.
provision_media_runtime() {
  mkdir -p "$media_root"
  if [[ ! -x "$media_root/ffmpeg" ]]; then
    local archive="$media_root/ffmpeg.gz"
    curl -fsSL --retry 2 "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz" -o "$archive"
    echo "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa  $archive" | sha256sum --check --strict
    gzip -dc "$archive" > "$media_root/ffmpeg.next"
    chmod +x "$media_root/ffmpeg.next"
    mv "$media_root/ffmpeg.next" "$media_root/ffmpeg"
    rm -f "$archive"
  fi
  echo "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99  $media_root/ffmpeg" | sha256sum --check --strict
  if [[ ! -f "$media_root/LICENSE" ]]; then
    curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.LICENSE" -o "$media_root/LICENSE"
  fi
  echo "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903  $media_root/LICENSE" | sha256sum --check --strict
  cat > "$media_root/run-node" <<'RUNNER'
#!/usr/bin/env bash
export PATH="$(dirname -- "$0"):$PATH"
exec node "$@"
RUNNER
  chmod +x "$media_root/run-node"
  export PATH="$media_root:$PATH"
  ffmpeg -version >/dev/null
}

provision_llm_runtime() {
  mkdir -p "$(dirname "$llama_root")" /home/sprite/models
  if [[ ! -x "$llama_root/build/bin/llama-server" ]]; then
    rm -rf "$llama_root.next"
    mkdir -p "$llama_root.next"
    archive="$llama_root.next/llama.zip"
    curl -fsSL "https://github.com/ggml-org/llama.cpp/releases/download/$llama_ref/llama-$llama_ref-bin-ubuntu-x64.zip" -o "$archive"
    echo "$llama_archive_sha256  $archive" | sha256sum --check --strict
    python3 -m zipfile -e "$archive" "$llama_root.next"
    rm -f "$archive"
    chmod +x "$llama_root.next/build/bin/llama-server"
    rm -rf "$llama_root"
    mv "$llama_root.next" "$llama_root"
  fi
}

stop_orphan_app_web_processes() {
  local pattern='apps/(discord-stream-hub|streamweaver|hearmeout|mountainview|companion)/dist/web-server\.js'
  pkill -TERM -f "$pattern" 2>/dev/null || true
  for _ in {1..40}; do
    if ! pgrep -f "$pattern" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  pkill -KILL -f "$pattern" 2>/dev/null || true
}

verify_app_web_cohort() {
  local short_sha="${BUILD_SHA:0:12}"
  local app body
  for app in discord-stream-hub streamweaver hearmeout nebula-arcade stellar-core; do
    body="$(curl -fsS --max-time 3 -D - "http://127.0.0.1:8080/apps/$app")" || {
      echo "App web verification failed: $app did not render through common ingress" >&2
      return 1
    }
    if [[ "$app" == "nebula-arcade" ]]; then
      if ! grep -Fiq "x-spmt-build-sha: $BUILD_SHA" <<<"$body"; then
        echo "Nebula Arcade is not serving build $BUILD_SHA" >&2
        return 1
      fi
    elif ! grep -Fq "Build $short_sha" <<<"$body"; then
      echo "App web verification failed: $app is not serving build $short_sha" >&2
      return 1
    fi
  done
  local headers theme asset
  for app in companion mountainview; do
    headers="$(curl -fsS --max-time 3 -D - -o /dev/null "http://127.0.0.1:8080/apps/$app")" || return 1
    if ! grep -Eiq "^location: /downloads/$app" <<<"$headers"; then
      echo "Companion download redirect verification failed: $app" >&2
      return 1
    fi
  done
  if ! curl -fsS --max-time 3 http://127.0.0.1:8080/assets/spacemountain/shell-ui-base.js | cmp -s - "$current_link/apps/spacemountain/dist/shell-ui-base.js"; then
    echo "Workspace navigation is not serving the current compiled shell" >&2
    return 1
  fi
  for theme in solar-flare nebula-purple oceanic-blue aurora-green; do
    for asset in "themes/$theme-spmt.png" "app-icons/$theme/mission-control.png"; do
      if ! curl -fsS --max-time 3 "http://127.0.0.1:8080/assets/product/$asset" | cmp -s - "$current_link/apps/spacemountain-web/assets/$asset"; then
        echo "Home or Settings icon verification failed: $asset" >&2
        return 1
      fi
    done
  done
}

rollback() {
  status=$?
  if (( status != 0 && switched == 1 )) && [[ -n "$previous_release" && -d "$previous_release" ]]; then
    echo "Deployment failed; restoring $previous_release" >&2
    ln -sfn "$previous_release" "$next_link"
    mv -Tf "$next_link" "$current_link"
    sprite-env services stop "$service_name" || true
    sprite-env services delete "$service_name" || true
    stop_orphan_app_web_processes
    create_apollo_service "$(basename "$previous_release")" 0 || true
  fi
  if (( status != 0 && bootstrap_service_removed == 1 )) && [[ -z "$previous_release" ]]; then
    echo "Deployment failed; restoring bootstrap service $bootstrap_service_name" >&2
    sprite-env services stop "$service_name" || true
    sprite-env services delete "$service_name" || true
    sprite-env services create "$bootstrap_service_name" \
      --cmd /usr/local/bin/webtmux \
      --args '-w,--no-auth,tmux,new-session,-A,-s,main' \
      --http-port 8080 \
      --duration 15s || true
  fi
  exit "$status"
}
trap rollback EXIT

if [[ ! -d "$release_dir/.git" ]]; then
  if [[ -e "$release_dir" ]]; then
    echo "Refusing to replace non-Git release path $release_dir" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$REPOSITORY_URL" "$release_dir"
fi

git -C "$release_dir" fetch --depth=1 origin "$BUILD_SHA"
git -C "$release_dir" checkout --detach --force "$BUILD_SHA"
actual_sha="$(git -C "$release_dir" rev-parse HEAD)"
if [[ "$actual_sha" != "$BUILD_SHA" ]]; then
  echo "Checked-out SHA $actual_sha does not match requested SHA $BUILD_SHA" >&2
  exit 1
fi
if [[ -n "$(git -C "$release_dir" status --short)" ]]; then
  echo "Release checkout is not clean" >&2
  exit 1
fi

cd "$release_dir"
provision_media_runtime
npm ci --ignore-scripts
npm run typecheck
NODE_OPTIONS="--import=$release_dir/scripts/sprites/supervisor-test-port-isolation.mjs" timeout --signal=TERM --kill-after=15s 10m npm test

provision_llm_runtime

ln -sfn "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"
switched=1

pkill -TERM -f 'scripts/sprites/run-supervised-sandbox\.mjs' 2>/dev/null || true
services_json="$(sprite-env services list)"
mapfile -t http_services < <(
  jq -r '
    (if type == "array" then . else (.services // []) end)
    | .[]
    | select(.http_port != null)
    | .name
  ' <<<"$services_json"
)
for stale_service in "${http_services[@]}" "$service_name" "$bootstrap_service_name" spmt-qwen; do
  [[ -n "$stale_service" ]] || continue
  if sprite-env services get "$stale_service" >/dev/null 2>&1; then
    sprite-env services stop "$stale_service" || true
    sprite-env services delete "$stale_service"
    [[ "$stale_service" == "$bootstrap_service_name" ]] && bootstrap_service_removed=1
  fi
done
stop_orphan_app_web_processes
for _ in {1..30}; do
  if ! curl -fsS --max-time 1 http://127.0.0.1:8080/sandbox/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
create_apollo_service "$BUILD_SHA"

ready=0
for _ in {1..1260}; do
  if health="$(curl -fsS --max-time 2 http://127.0.0.1:8080/sandbox/health 2>/dev/null)"; then
    if grep -Fq "$BUILD_SHA" <<<"$health" && verify_app_web_cohort; then
      ready=1
      break
    fi
  fi
  sleep 0.5
done
if (( ready != 1 )); then
  echo "The deployed release or one of its app-owned web surfaces did not report the expected build SHA" >&2
  exit 1
fi

# Owner-approved one-time test credit, after the Green release is healthy.
if [[ "$DEPLOY_ROLE" == "release" ]]; then
  SPMT_RUNTIME_MODE=sandbox DEPLOY_ROLE=release node scripts/sprites/credit-green-test-xp.mjs
fi

printf 'Deployed %s commit %s\n' "$DEPLOY_ROLE" "$BUILD_SHA"
printf 'Active release: %s\n' "$(readlink -f "$current_link")"
sprite-env services get "$service_name"
trap - EXIT

