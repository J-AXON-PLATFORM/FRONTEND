#!/usr/bin/env bash
set -Eeuo pipefail

frontend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="${JAXON_BACKEND_DIR:-${frontend_dir}/../backend}"
owner="jaxon-auth-e2e-$RANDOM-$$"
database_container="${owner}-postgres"
database_image="jaxon-postgres-pgvector-test:${owner}"
backend_port="${JAXON_E2E_BACKEND_PORT:-$((18000 + RANDOM % 1000))}"
frontend_port="${JAXON_E2E_FRONTEND_PORT:-$((13000 + RANDOM % 1000))}"
work_dir="$(mktemp -d)"
backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "${frontend_pid}" ]]; then kill -- "-${frontend_pid}" 2>/dev/null || true; fi
  if [[ -n "${backend_pid}" ]]; then kill -- "-${backend_pid}" 2>/dev/null || true; fi
  if [[ -n "${frontend_pid}" ]]; then wait "${frontend_pid}" 2>/dev/null || true; fi
  if [[ -n "${backend_pid}" ]]; then wait "${backend_pid}" 2>/dev/null || true; fi
  docker rm --force "${database_container}" >/dev/null 2>&1 || true
  docker image rm "${database_image}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT

test -f "${backend_dir}/pom.xml"
if curl --silent --max-time 1 "http://localhost:${backend_port}" >/dev/null 2>&1; then
  printf 'Backend test port %s is already in use\n' "${backend_port}" >&2
  exit 1
fi
if curl --silent --max-time 1 "http://localhost:${frontend_port}" >/dev/null 2>&1; then
  printf 'Frontend test port %s is already in use\n' "${frontend_port}" >&2
  exit 1
fi
docker build --file "${backend_dir}/docker/postgres-pgvector.Dockerfile" \
  --label "com.jaxon.resource-owner=${owner}" \
  --tag "${database_image}" "${backend_dir}"
docker run --detach --rm --name "${database_container}" \
  --label "com.jaxon.resource-owner=${owner}" \
  --publish 127.0.0.1::5432 \
  --env POSTGRES_DB=jaxon_e2e \
  --env POSTGRES_USER=jaxon_e2e \
  --env POSTGRES_PASSWORD="db-${owner}" \
  "${database_image}" >/dev/null

database_port="$(docker port "${database_container}" 5432/tcp | cut -d: -f2)"
export JAXON_E2E_USERNAME="E2E.Operator"
export JAXON_E2E_PASSWORD="E2e-$(tr -d '-' </proc/sys/kernel/random/uuid)-Aa9!"

export JAXON_DB_URL="jdbc:postgresql://localhost:${database_port}/jaxon_e2e"
export JAXON_DB_USERNAME=jaxon_e2e
export JAXON_DB_PASSWORD="db-${owner}"
export JAXON_IDENTITY_BOOTSTRAP_ENABLED=true
export JAXON_IDENTITY_BOOTSTRAP_USERNAME="${JAXON_E2E_USERNAME}"
export JAXON_IDENTITY_BOOTSTRAP_PASSWORD="${JAXON_E2E_PASSWORD}"
export JAXON_FRONTEND_ORIGIN="http://localhost:${frontend_port}"
export SERVER_PORT="${backend_port}"
setsid bash -c 'cd "$1" && exec ./mvnw --batch-mode --no-transfer-progress spring-boot:run' \
  _ "${backend_dir}" >"${work_dir}/backend.log" 2>&1 &
backend_pid=$!

for _ in $(seq 1 90); do
  kill -0 "${backend_pid}" 2>/dev/null || { cat "${work_dir}/backend.log" >&2; exit 1; }
  if curl --fail --silent "http://localhost:${backend_port}/actuator/health/readiness" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://localhost:${backend_port}/actuator/health/readiness" >/dev/null

export NEXT_PUBLIC_JAXON_API_URL="http://localhost:${backend_port}/api/v1"
export JAXON_E2E_BACKEND_URL="http://localhost:${backend_port}"
export JAXON_E2E_DATABASE_CONTAINER="${database_container}"
export JAXON_E2E_FRONTEND_URL="http://localhost:${frontend_port}"
setsid bash -c 'cd "$1" && npm run build && exec npm run start -- --hostname localhost --port "$2"' \
  _ "${frontend_dir}" "${frontend_port}" >"${work_dir}/frontend.log" 2>&1 &
frontend_pid=$!

for _ in $(seq 1 60); do
  kill -0 "${frontend_pid}" 2>/dev/null || { cat "${work_dir}/frontend.log" >&2; exit 1; }
  if curl --fail --silent "http://localhost:${frontend_port}/login" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://localhost:${frontend_port}/login" >/dev/null

cd "${frontend_dir}"
npm run test:e2e
