#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_SCRIPT="${ROOT_DIR}/scripts/ci/ensure_supabase_public_auth_routes.sh"

if [[ ! -f "${TARGET_SCRIPT}" ]]; then
  echo "missing target script: ${TARGET_SCRIPT}" >&2
  exit 1
fi

run_case() {
  local name="$1"
  local mode="$2"
  local expected_status="$3"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  local log_file="${tmp_dir}/calls.log"
  : >"${log_file}"

  cat >"${tmp_dir}/check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
COUNT_FILE="${COUNT_FILE:?}"
LOG_FILE="${LOG_FILE:?}"
MODE="${MODE:?}"
count=0
if [[ -f "${COUNT_FILE}" ]]; then
  count="$(cat "${COUNT_FILE}")"
fi
count=$((count + 1))
printf '%s' "$count" >"${COUNT_FILE}"
echo "check:${count}" >>"${LOG_FILE}"

case "${MODE}" in
  pass)
    exit 0
    ;;
  fail-then-pass)
    if [[ "$count" -eq 1 ]]; then
      echo "simulated guard failure" >&2
      exit 1
    fi
    exit 0
    ;;
  fail-always)
    echo "simulated guard failure" >&2
    exit 1
    ;;
  *)
    echo "unknown MODE=${MODE}" >&2
    exit 2
    ;;
esac
EOF

  cat >"${tmp_dir}/deploy.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${LOG_FILE:?}"
echo "deploy" >>"${LOG_FILE}"
EOF

  chmod +x "${tmp_dir}/check.sh" "${tmp_dir}/deploy.sh"

  set +e
  COUNT_FILE="${tmp_dir}/count" \
  LOG_FILE="${log_file}" \
  MODE="${mode}" \
  CHECK_SCRIPT="${tmp_dir}/check.sh" \
  DEPLOY_SCRIPT="${tmp_dir}/deploy.sh" \
  "${TARGET_SCRIPT}" >/dev/null 2>&1
  local actual_status=$?
  set -e

  if [[ "${actual_status}" != "${expected_status}" ]]; then
    echo "${name}: expected exit ${expected_status}, got ${actual_status}" >&2
    cat "${log_file}" >&2 || true
    exit 1
  fi

  case "${name}" in
    pass-first-check)
      diff -u <(printf 'check:1\n') "${log_file}"
      ;;
    heal-after-failure)
      diff -u <(printf 'check:1\ndeploy\ncheck:2\n') "${log_file}"
      ;;
    fail-after-redeploy)
      diff -u <(printf 'check:1\ndeploy\ncheck:2\n') "${log_file}"
      ;;
  esac

  rm -rf "${tmp_dir}"
  trap - RETURN
}

run_case pass-first-check pass 0
run_case heal-after-failure fail-then-pass 0
run_case fail-after-redeploy fail-always 1

echo "ensure_supabase_public_auth_routes tests passed"
