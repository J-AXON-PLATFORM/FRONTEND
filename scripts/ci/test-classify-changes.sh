#!/usr/bin/env bash
set -euo pipefail

readonly classifier="$(dirname "$0")/classify-changes.sh"
readonly work_file="$(mktemp)"
trap 'rm -f "${work_file}"' EXIT

assert_level() {
  local expected="$1"
  shift
  printf '%s\n' "$@" > "${work_file}"
  local actual
  actual="$(${classifier} "${work_file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Expected %s, got %s for: %s\n' "${expected}" "${actual}" "$*" >&2
    exit 1
  fi
}

assert_level DOCS_ONLY README.md
assert_level APPLICATION src/features/support/api.ts
assert_level APPLICATION src/app/globals.css docs/USER_GUIDE.md
assert_level PLATFORM_FULL .github/workflows/frontend-ci.yml
assert_level PLATFORM_FULL package-lock.json
assert_level PLATFORM_FULL Dockerfile
assert_level PLATFORM_FULL scripts/verify-container.sh
assert_level PLATFORM_FULL unknown/new-path.txt
assert_level PLATFORM_FULL
