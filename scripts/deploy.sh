#!/usr/bin/env bash
#
# Local build & deploy script for Toque.
#
# Builds the container image on this machine, pushes it to Cloudflare's
# managed registry, and deploys the Worker — all from your local Docker.
#
# Usage:
#   ./scripts/deploy.sh              # build + push + deploy
#   ./scripts/deploy.sh --dev        # local dev mode (wrangler dev)
#   ./scripts/deploy.sh --build-only # build + push, no deploy
#   ./scripts/deploy.sh --rollback <image>  # deploy existing image
#
# Prerequisites:
#   - Docker (or Colima) running locally
#   - CLOUDFLARE_API_TOKEN env var set (or wrangler login done)
#   - npm dependencies installed (npm ci)

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="toque"
TAG="$(git -C "$PROJECT_ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo "local")"
WRANGLER_CONFIG="$PROJECT_ROOT/wrangler.jsonc"

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo -e "\033[1;34m▶\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
err()  { echo -e "\033[1;31m✗\033[0m $*" >&2; }
die()  { err "$*"; exit 1; }

check_docker() {
  log "Checking Docker..."
  if ! docker info >/dev/null 2>&1; then
    die "Docker is not running. Start Docker (or Colima) and retry."
  fi
  ok "Docker is running"
}

check_deps() {
  command -v npx >/dev/null 2>&1 || die "npx not found. Install Node.js first."
  [ -f "$WRANGLER_CONFIG" ] || die "wrangler.jsonc not found at $WRANGLER_CONFIG"
}

# Patch wrangler.jsonc: set the container image field
set_image() {
  local image_ref="$1"
  log "Patching wrangler.jsonc with image: $image_ref"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const raw = fs.readFileSync(path, "utf8");
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const json = JSON.parse(stripped);
    if (!json.containers || !json.containers[0]) throw new Error("No container config in wrangler.jsonc");
    json.containers[0].image = process.argv[2];
    fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  ' "$WRANGLER_CONFIG" "$image_ref"
  ok "wrangler.jsonc updated"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
do_build_and_push() {
  check_docker
  check_deps

  local full_tag="${IMAGE_NAME}:${TAG}"
  log "Building and pushing image: $full_tag"

  # wrangler containers build -p builds locally and pushes to Cloudflare registry
  # Output: registry.cloudflare.com/<ACCOUNT_ID>/<IMAGE>:<TAG>
  local registry_uri
  registry_uri=$(npx wrangler containers build -p -t "$TAG" . 2>&1 | tee /dev/stderr | grep -oE 'registry\.cloudflare\.com/[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+' | head -n1)

  if [ -z "$registry_uri" ]; then
    die "Could not extract registry URI from wrangler output. Check the build log above."
  fi

  ok "Image pushed to: $registry_uri"
  echo "$registry_uri" > "$PROJECT_ROOT/.last-image"
  set_image "$registry_uri"
}

do_deploy() {
  check_deps
  log "Deploying Worker to Cloudflare..."
  npx wrangler deploy
  ok "Deployed successfully"
}

do_dev() {
  check_docker
  check_deps
  log "Starting local dev session (wrangler dev)..."
  npx wrangler dev
}

do_rollback() {
  local image="$1"
  [ -z "$image" ] && die "Usage: ./scripts/deploy.sh --rollback <image>"
  log "Rolling back to image: $image"
  set_image "$image"
  do_deploy
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
MODE="deploy"
ROLLBACK_IMAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)         MODE="dev"; shift ;;
    --build-only)  MODE="build"; shift ;;
    --rollback)    MODE="rollback"; ROLLBACK_IMAGE="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

case "$MODE" in
  build)
    do_build_and_push
    ok "Build-only complete. Run ./scripts/deploy.sh to deploy."
    ;;
  deploy)
    do_build_and_push
    do_deploy
    ok "Full deploy complete."
    ;;
  dev)
    do_dev
    ;;
  rollback)
    do_rollback "$ROLLBACK_IMAGE"
    ;;
esac
