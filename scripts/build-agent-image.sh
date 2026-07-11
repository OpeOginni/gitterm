#!/usr/bin/env bash
# Build & push a single agent image to Docker Hub (local fallback for CI).
# Usage: ./scripts/build-agent-image.sh <name>
# Names: opencode | opencode-server | opencode-aws-server | t3code-server | cf-sandbox

set -euo pipefail

NS="${DOCKERHUB_NAMESPACE:-opeoginni}"
OPENCODE_VERSION="${OPENCODE_VERSION:-latest}"
T3_VERSION="${T3_VERSION:-latest}"
CACHE_BUST="${OPENCODE_INSTALL_CACHE_BUST:-$(date +%s)}"
CF_TAG="${CF_SANDBOX_TAG:-0.12.1}"
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
PUSH="${PUSH:-1}"

name="${1:-}"
if [[ -z "$name" ]]; then
  echo "Usage: $0 <opencode|opencode-server|opencode-aws-server|t3code-server|cf-sandbox>" >&2
  exit 1
fi

build_push() {
  local file="$1" context="$2" image="$3" tag="$4"
  shift 4
  local -a args=("$@")
  docker build --pull --no-cache --platform "$PLATFORM" \
    -f "$file" \
    -t "${NS}/${image}:${tag}" \
    "${args[@]}" \
    "$context"
  if [[ "$PUSH" == "1" ]]; then
    docker push "${NS}/${image}:${tag}"
  fi
}

case "$name" in
  opencode)
    build_push .docker/Opencode.Dockerfile .docker gitterm-opencode latest \
      --build-arg "OPENCODE_VERSION=${OPENCODE_VERSION}" \
      --build-arg "OPENCODE_INSTALL_CACHE_BUST=${CACHE_BUST}"
    ;;
  opencode-server)
    build_push .docker/Opencode.Server.Dockerfile .docker gitterm-opencode-server latest \
      --build-arg "OPENCODE_VERSION=${OPENCODE_VERSION}" \
      --build-arg "OPENCODE_INSTALL_CACHE_BUST=${CACHE_BUST}"
    ;;
  opencode-aws-server)
    build_push .docker/Opencode.Server.AWS.Dockerfile .docker gitterm-opencode-aws-server latest \
      --build-arg "OPENCODE_VERSION=${OPENCODE_VERSION}" \
      --build-arg "OPENCODE_INSTALL_CACHE_BUST=${CACHE_BUST}"
    ;;
  t3code-server)
    build_push .docker/T3Code.Server.Dockerfile .docker gitterm-t3code-server latest \
      --build-arg "T3_VERSION=${T3_VERSION}" \
      --build-arg "T3_INSTALL_CACHE_BUST=${CACHE_BUST}"
    ;;
  cf-sandbox)
    build_push \
      packages/api/src/providers/cloudflare/sandbox-worker/Dockerfile \
      packages/api/src/providers/cloudflare/sandbox-worker \
      gitterm-cf-sandbox "$CF_TAG"
    ;;
  *)
    echo "Unknown image: $name" >&2
    exit 1
    ;;
esac
