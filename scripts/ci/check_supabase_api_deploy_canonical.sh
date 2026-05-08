#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CHECK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CANONICAL_SCRIPT="scripts/ci/deploy_supabase_api.sh"

cd "${ROOT_DIR}"

if [[ ! -f "${CANONICAL_SCRIPT}" ]]; then
  echo "missing canonical deploy script: ${CANONICAL_SCRIPT}" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  matches="$(
    rg -n --color never \
      --glob "!${CANONICAL_SCRIPT}" \
      --glob '!scripts/ci/check_supabase_api_deploy_canonical.sh' \
      --glob '!scripts/ci/test_*.sh' \
      'supabase functions deploy\s+api(\s|$)' \
      .github/workflows scripts || true
  )"
else
  matches="$(
    find .github/workflows scripts -type f \
      ! -path "${CANONICAL_SCRIPT}" \
      ! -path "./${CANONICAL_SCRIPT}" \
      ! -path 'scripts/ci/check_supabase_api_deploy_canonical.sh' \
      ! -path './scripts/ci/check_supabase_api_deploy_canonical.sh' \
      ! -path 'scripts/ci/test_*.sh' \
      ! -path './scripts/ci/test_*.sh' \
      -print0 |
      while IFS= read -r -d '' file; do
        grep -nE 'supabase functions deploy[[:space:]]+api([[:space:]]|$)' "${file}" |
          sed "s|^|${file#./}:|"
      done || true
  )"
fi

if [[ -n "${matches}" ]]; then
  echo "Found non-canonical Supabase API deploy commands in workflows/scripts." >&2
  echo "Use ${CANONICAL_SCRIPT} instead of raw 'supabase functions deploy api ...'." >&2
  echo >&2
  echo "${matches}" >&2
  exit 1
fi

echo "Supabase API deploy paths are canonical."
