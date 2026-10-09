#!/usr/bin/env bash
set -Eeuo pipefail

readonly IMAGE="${1:-jaxon-frontend:ci}"
readonly RUN_SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
readonly CONTAINER_NAME="jaxon-frontend-smoke-${RUN_SUFFIX}"

cleanup() {
  docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  printf 'Container verification failed: %s\n' "$1" >&2
  exit 1
}

cleanup

[[ "$(docker image inspect --format '{{.Config.User}}' "${IMAGE}")" == "10001:10001" ]] || \
  fail "frontend runtime user is not 10001:10001"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "${IMAGE}")" == "J-AXON Frontend" ]] || \
  fail "frontend OCI title is missing"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "${IMAGE}")" == "https://github.com/J-AXON-PLATFORM/FRONTEND" ]] || \
  fail "frontend OCI source is missing"

docker run --rm --entrypoint sh "${IMAGE}" -c \
  'test "$(id -u)" -ne 0 && command -v node >/dev/null && ! command -v npm && ! command -v npx && ! command -v corepack && ! command -v yarn && ! command -v pnpm && ! find /app \( -name ".env*" -o -name "*.pem" \) | grep -q .' || \
  fail "runtime identity, tools, or secret-file inspection failed"

docker run --detach \
  --name "${CONTAINER_NAME}" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  --publish 127.0.0.1::3000 \
  "${IMAGE}" >/dev/null

readonly APP_PORT="$(docker port "${CONTAINER_NAME}" 3000/tcp | awk -F: 'NR == 1 {print $NF}')"
[[ -n "${APP_PORT}" ]] || fail "frontend published port was not assigned"

for _ in {1..60}; do
  if HOME_PAGE="$(curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/" 2>/dev/null)"; then
    [[ "${HOME_PAGE}" == *"J-AXON"* ]] || fail "home page does not contain J-AXON"
    break
  fi
  sleep 1
done
[[ -n "${HOME_PAGE:-}" ]] || {
  docker logs "${CONTAINER_NAME}" >&2
  fail "frontend did not become ready"
}

readonly ROBOTS="$(curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/robots.txt")"
[[ "${ROBOTS}" == *"Disallow: /"* ]] || fail "robots.txt does not disallow crawling"

docker stop --timeout 20 "${CONTAINER_NAME}" >/dev/null
readonly EXIT_CODE="$(docker inspect --format '{{.State.ExitCode}}' "${CONTAINER_NAME}")"
[[ "${EXIT_CODE}" == "0" || "${EXIT_CODE}" == "143" ]] || fail "unexpected frontend exit code ${EXIT_CODE}"

printf 'Frontend container verification passed (exit code %s).\n' "${EXIT_CODE}"
