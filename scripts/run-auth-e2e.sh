#!/usr/bin/env bash
set -Eeuo pipefail

frontend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="${JAXON_BACKEND_DIR:-${frontend_dir}/../backend}"
automation_dir="${JAXON_AUTOMATION_DIR:-${frontend_dir}/../automation-collector}"
owner="jaxon-auth-e2e-$RANDOM-$$"
database_container="${owner}-postgres"
sftpgo_container="${owner}-sftpgo"
backend_container="${owner}-backend"
unavailable_backend_container="${owner}-backend-ai-unavailable"
mailbox_volume="${owner}-mailboxes"
tasks_volume="${owner}-tasks"
discovery_jobs_volume="${owner}-discovery-jobs"
discovery_results_volume="${owner}-discovery-results"
ai_storage_volume="${owner}-ai-storage"
database_image="jaxon-postgres-pgvector-test:${owner}"
backend_image="jaxon-backend:${owner}"
backend_port="${JAXON_E2E_BACKEND_PORT:-$((18000 + RANDOM % 1000))}"
unavailable_backend_port="$((backend_port + 1000))"
frontend_port="${JAXON_E2E_FRONTEND_PORT:-$((13000 + RANDOM % 1000))}"
work_dir="$(mktemp -d)"
backend_pid=""
frontend_pid=""
embedding_model_path="${JAXON_AI_EMBEDDING_MODEL_PATH:-}"
embedding_tokenizer_path="${JAXON_AI_EMBEDDING_TOKENIZER_PATH:-}"

cleanup() {
  if [[ -n "${frontend_pid}" ]]; then kill -- "-${frontend_pid}" 2>/dev/null || true; fi
  if [[ -n "${backend_pid}" ]]; then kill -- "-${backend_pid}" 2>/dev/null || true; fi
  if [[ -n "${frontend_pid}" ]]; then wait "${frontend_pid}" 2>/dev/null || true; fi
  if [[ -n "${backend_pid}" ]]; then wait "${backend_pid}" 2>/dev/null || true; fi
  docker rm --force "${database_container}" >/dev/null 2>&1 || true
  docker rm --force "${sftpgo_container}" >/dev/null 2>&1 || true
  docker rm --force "${backend_container}" >/dev/null 2>&1 || true
  docker rm --force "${unavailable_backend_container}" >/dev/null 2>&1 || true
  docker volume rm "${mailbox_volume}" >/dev/null 2>&1 || true
  docker volume rm "${tasks_volume}" >/dev/null 2>&1 || true
  docker volume rm "${discovery_jobs_volume}" >/dev/null 2>&1 || true
  docker volume rm "${discovery_results_volume}" >/dev/null 2>&1 || true
  docker volume rm "${ai_storage_volume}" >/dev/null 2>&1 || true
  docker image rm "${database_image}" >/dev/null 2>&1 || true
  docker image rm "${backend_image}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT

test -f "${backend_dir}/pom.xml"
test -f "${automation_dir}/pyproject.toml"
test -f "${embedding_model_path}"
test -f "${embedding_tokenizer_path}"
uv --project "${automation_dir}" lock --check
if curl --silent --max-time 1 "http://localhost:${backend_port}" >/dev/null 2>&1; then
  printf 'Backend test port %s is already in use\n' "${backend_port}" >&2
  exit 1
fi
if curl --silent --max-time 1 "http://localhost:${unavailable_backend_port}" >/dev/null 2>&1; then
  printf 'Unavailable backend test port %s is already in use\n' "${unavailable_backend_port}" >&2
  exit 1
fi
if curl --silent --max-time 1 "http://localhost:${frontend_port}" >/dev/null 2>&1; then
  printf 'Frontend test port %s is already in use\n' "${frontend_port}" >&2
  exit 1
fi
docker build --file "${backend_dir}/docker/postgres-pgvector.Dockerfile" \
  --label "com.jaxon.resource-owner=${owner}" \
  --tag "${database_image}" "${backend_dir}"
docker volume create --label "com.jaxon.resource-owner=${owner}" "${ai_storage_volume}" >/dev/null
docker run --detach --rm --name "${database_container}" \
  --label "com.jaxon.resource-owner=${owner}" \
  --publish 127.0.0.1::5432 \
  --mount "source=${ai_storage_volume},target=/jaxon-ai-storage" \
  --env POSTGRES_DB=jaxon_e2e \
  --env POSTGRES_USER=jaxon_e2e \
  --env POSTGRES_PASSWORD="db-${owner}" \
  "${database_image}" >/dev/null
docker exec --user 0 "${database_container}" sh -c \
  'chown 10001:10001 /jaxon-ai-storage && chmod 700 /jaxon-ai-storage'
"${backend_dir}/docker/sftpgo/build-local.sh"
docker volume create --label "com.jaxon.resource-owner=${owner}" "${mailbox_volume}" >/dev/null
docker volume create --label "com.jaxon.resource-owner=${owner}" "${tasks_volume}" >/dev/null
docker volume create --label "com.jaxon.resource-owner=${owner}" "${discovery_jobs_volume}" >/dev/null
docker volume create --label "com.jaxon.resource-owner=${owner}" "${discovery_results_volume}" >/dev/null
docker run --detach --rm --name "${sftpgo_container}" \
  --label "com.jaxon.resource-owner=${owner}" \
  --publish 127.0.0.1::2022 \
  --publish 127.0.0.1::8080 \
  --mount "source=${mailbox_volume},target=/srv/sftpgo/data" \
  --mount "source=${tasks_volume},target=/srv/sftpgo/tasks" \
  --mount "source=${discovery_jobs_volume},target=/srv/sftpgo/discovery-jobs" \
  --mount "source=${discovery_results_volume},target=/srv/sftpgo/discovery-results" \
  --env SFTPGO_COMMON__UMASK=0007 \
  --env SFTPGO_DATA_PROVIDER__CREATE_DEFAULT_ADMIN=true \
  --env SFTPGO_DEFAULT_ADMIN_USERNAME=jaxon-e2e-provisioner \
  --env SFTPGO_DEFAULT_ADMIN_PASSWORD="sftp-${owner}" \
  --env SFTPGO_SFTPD__ENABLED_SSH_COMMANDS= \
  --env SFTPGO_SFTPD__PASSWORD_AUTHENTICATION=false \
  --env SFTPGO_SFTPD__KEYBOARD_INTERACTIVE_AUTHENTICATION=false \
  jaxon-sftpgo:2.7.6-local >/dev/null

database_port="$(docker port "${database_container}" 5432/tcp | cut -d: -f2)"
sftpgo_port="$(docker port "${sftpgo_container}" 2022/tcp | cut -d: -f2)"
sftpgo_api_port="$(docker port "${sftpgo_container}" 8080/tcp | cut -d: -f2)"
for _ in $(seq 1 30); do
  if curl --fail --silent "http://localhost:${sftpgo_api_port}/healthz" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://localhost:${sftpgo_api_port}/healthz" >/dev/null
sftpgo_host_key="$(ssh-keyscan -p "${sftpgo_port}" -t ed25519 127.0.0.1 2>/dev/null | cut -d' ' -f2-3)"
test -n "${sftpgo_host_key}"
export JAXON_E2E_USERNAME="E2E.Operator"
export JAXON_E2E_PASSWORD="E2e-$(tr -d '-' </proc/sys/kernel/random/uuid)-Aa9!"

export JAXON_DB_URL="jdbc:postgresql://localhost:${database_port}/jaxon_e2e"
export JAXON_DB_USERNAME=jaxon_e2e
export JAXON_DB_PASSWORD="db-${owner}"
export JAXON_IDENTITY_BOOTSTRAP_ENABLED=true
export JAXON_IDENTITY_BOOTSTRAP_USERNAME="${JAXON_E2E_USERNAME}"
export JAXON_IDENTITY_BOOTSTRAP_PASSWORD="${JAXON_E2E_PASSWORD}"
export JAXON_FRONTEND_ORIGIN="http://localhost:${frontend_port}"
export JAXON_AI_DOCUMENT_STORAGE_ROOT=/srv/jaxon/ai-documents
export JAXON_SFTP_ENABLED=true
export JAXON_SFTPGO_ADMIN_API_URL="http://localhost:${sftpgo_api_port}/api/v2"
export JAXON_SFTPGO_ADMIN_USERNAME=jaxon-e2e-provisioner
export JAXON_SFTPGO_ADMIN_PASSWORD="sftp-${owner}"
export JAXON_SFTP_PUBLIC_HOST=127.0.0.1
export JAXON_SFTP_PUBLIC_PORT="${sftpgo_port}"
export JAXON_SFTP_PUBLIC_HOST_KEY="${sftpgo_host_key}"
export JAXON_COLLECTOR_MAILBOX_ROOT=/srv/sftpgo/data
export JAXON_COLLECTOR_TASK_PUBLICATION_ROOT=/srv/sftpgo/tasks
export JAXON_COLLECTOR_TASK_RECONCILIATION_INTERVAL=1s
export JAXON_DISCOVERY_JOB_PUBLICATION_ROOT=/srv/sftpgo/discovery-jobs
export JAXON_DISCOVERY_JOB_RECONCILIATION_INTERVAL=1s
export JAXON_DISCOVERY_RESULT_MAILBOX_ROOT=/srv/sftpgo/discovery-results
export JAXON_DISCOVERY_RESULT_STABILITY_AGE=0s
export JAXON_COLLECTOR_RESULT_STABILITY_AGE=0s
export JAXON_COLLECTOR_RECONCILIATION_INTERVAL=1s
export JAXON_COLLECTOR_SNAPSHOT_STABILITY_AGE=0s
export SERVER_PORT="${backend_port}"
docker build --tag "${backend_image}" "${backend_dir}"
docker run --detach --name "${backend_container}" \
  --label "com.jaxon.resource-owner=${owner}" \
  --network host \
  --group-add 65532 \
  --mount "source=${mailbox_volume},target=/srv/sftpgo/data,readonly" \
  --mount "source=${tasks_volume},target=/srv/sftpgo/tasks" \
  --mount "source=${discovery_jobs_volume},target=/srv/sftpgo/discovery-jobs" \
  --mount "source=${discovery_results_volume},target=/srv/sftpgo/discovery-results" \
  --mount "source=${ai_storage_volume},target=/srv/jaxon/ai-documents" \
  --mount "type=bind,source=${embedding_model_path},target=/srv/jaxon/ai-model/model.onnx,readonly" \
  --mount "type=bind,source=${embedding_tokenizer_path},target=/srv/jaxon/ai-model/tokenizer.json,readonly" \
  --env JAXON_DB_URL \
  --env JAXON_DB_USERNAME \
  --env JAXON_DB_PASSWORD \
  --env JAXON_IDENTITY_BOOTSTRAP_ENABLED \
  --env JAXON_IDENTITY_BOOTSTRAP_USERNAME \
  --env JAXON_IDENTITY_BOOTSTRAP_PASSWORD \
  --env JAXON_FRONTEND_ORIGIN \
  --env JAXON_AI_DOCUMENT_STORAGE_ROOT \
  --env JAXON_AI_EMBEDDING_MODEL_PATH=/srv/jaxon/ai-model/model.onnx \
  --env JAXON_AI_EMBEDDING_TOKENIZER_PATH=/srv/jaxon/ai-model/tokenizer.json \
  --env JAXON_AI_INDEXING_POLL_INTERVAL=100ms \
  --env JAXON_SFTP_ENABLED \
  --env JAXON_SFTPGO_ADMIN_API_URL \
  --env JAXON_SFTPGO_ADMIN_USERNAME \
  --env JAXON_SFTPGO_ADMIN_PASSWORD \
  --env JAXON_SFTP_PUBLIC_HOST \
  --env JAXON_SFTP_PUBLIC_PORT \
  --env JAXON_SFTP_PUBLIC_HOST_KEY \
  --env JAXON_COLLECTOR_MAILBOX_ROOT \
  --env JAXON_COLLECTOR_TASK_PUBLICATION_ROOT \
  --env JAXON_COLLECTOR_TASK_RECONCILIATION_INTERVAL \
  --env JAXON_DISCOVERY_JOB_PUBLICATION_ROOT \
  --env JAXON_DISCOVERY_JOB_RECONCILIATION_INTERVAL \
  --env JAXON_DISCOVERY_RESULT_MAILBOX_ROOT \
  --env JAXON_DISCOVERY_RESULT_STABILITY_AGE \
  --env JAXON_COLLECTOR_RESULT_STABILITY_AGE \
  --env JAXON_COLLECTOR_RECONCILIATION_INTERVAL \
  --env JAXON_COLLECTOR_SNAPSHOT_STABILITY_AGE \
  --env SERVER_PORT \
  "${backend_image}" >/dev/null

for _ in $(seq 1 90); do
  docker inspect "${backend_container}" >/dev/null 2>&1 || { docker logs "${backend_container}" >&2; exit 1; }
  if curl --fail --silent "http://localhost:${backend_port}/actuator/health/readiness" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://localhost:${backend_port}/actuator/health/readiness" >/dev/null || {
  docker logs "${backend_container}" >&2
  exit 1
}

docker run --detach --name "${unavailable_backend_container}" \
  --label "com.jaxon.resource-owner=${owner}" \
  --network host \
  --group-add 65532 \
  --mount "source=${ai_storage_volume},target=/srv/jaxon/ai-documents" \
  --env JAXON_DB_URL \
  --env JAXON_DB_USERNAME \
  --env JAXON_DB_PASSWORD \
  --env JAXON_IDENTITY_BOOTSTRAP_ENABLED=false \
  --env JAXON_FRONTEND_ORIGIN \
  --env JAXON_AI_DOCUMENT_STORAGE_ROOT \
  --env JAXON_AI_INDEXING_ENABLED=false \
  --env JAXON_SFTP_ENABLED=false \
  --env SERVER_PORT="${unavailable_backend_port}" \
  "${backend_image}" >/dev/null
for _ in $(seq 1 90); do
  docker inspect "${unavailable_backend_container}" >/dev/null 2>&1 || {
    docker logs "${unavailable_backend_container}" >&2
    exit 1
  }
  if curl --fail --silent "http://localhost:${unavailable_backend_port}/actuator/health/readiness" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://localhost:${unavailable_backend_port}/actuator/health/readiness" >/dev/null || {
  docker logs "${unavailable_backend_container}" >&2
  exit 1
}

export NEXT_PUBLIC_JAXON_API_URL="http://localhost:${backend_port}/api/v1"
export JAXON_E2E_BACKEND_URL="http://localhost:${backend_port}"
export JAXON_E2E_UNAVAILABLE_BACKEND_URL="http://localhost:${unavailable_backend_port}"
export JAXON_E2E_DATABASE_CONTAINER="${database_container}"
export JAXON_E2E_AI_STORAGE_ROOT=/jaxon-ai-storage
export JAXON_E2E_SFTPGO_CONTAINER="${sftpgo_container}"
export JAXON_E2E_FRONTEND_URL="http://localhost:${frontend_port}"
export JAXON_E2E_AUTOMATION_DIR="${automation_dir}"
export JAXON_E2E_AGENT_STATE_DIR="${work_dir}/agent-state"
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
