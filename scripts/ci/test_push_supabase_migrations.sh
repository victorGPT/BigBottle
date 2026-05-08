#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_SCRIPT="${ROOT_DIR}/scripts/ci/push_supabase_migrations.sh"

run_case() {
  local name="$1"
  local mode="$2"
  local expected_status="$3"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  local log_file="${tmp_dir}/calls.log"
  local count_file="${tmp_dir}/push-count"
  : >"${log_file}"

  cat >"${tmp_dir}/supabase" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${LOG_FILE:?}"
COUNT_FILE="${COUNT_FILE:?}"
MODE="${MODE:?}"

printf '%s\n' "$*" >>"${LOG_FILE}"

if [[ "$1 $2" == "migration repair" ]]; then
  exit 0
fi

if [[ "$1 $2" != "db push" ]]; then
  echo "unexpected supabase command: $*" >&2
  exit 2
fi

count=0
if [[ -f "${COUNT_FILE}" ]]; then
  count="$(cat "${COUNT_FILE}")"
fi
count=$((count + 1))
printf '%s' "${count}" >"${COUNT_FILE}"

case "${MODE}" in
  pass)
    exit 0
    ;;
  drift-then-pass)
    if [[ "${count}" -eq 1 ]]; then
      echo "Remote migration versions not found in local migrations directory." >&2
      echo "supabase migration repair --status reverted 20260508" >&2
      exit 1
    fi
    exit 0
    ;;
  fail)
    echo "unrecoverable push failure" >&2
    exit 1
    ;;
  *)
    echo "unknown MODE=${MODE}" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "${tmp_dir}/supabase"

  set +e
  PATH="${tmp_dir}:${PATH}" \
  LOG_FILE="${log_file}" \
  COUNT_FILE="${count_file}" \
  MODE="${mode}" \
  SUPABASE_DB_URL="postgres://example" \
  "${TARGET_SCRIPT}" >/dev/null 2>&1
  local actual_status=$?
  set -e

  if [[ "${actual_status}" != "${expected_status}" ]]; then
    echo "${name}: expected exit ${expected_status}, got ${actual_status}" >&2
    cat "${log_file}" >&2 || true
    exit 1
  fi

  case "${name}" in
    pass)
      diff -u <(printf 'db push --db-url postgres://example --include-all --yes\n') "${log_file}"
      ;;
    auto-repair)
      diff -u <(printf 'db push --db-url postgres://example --include-all --yes\nmigration repair --db-url postgres://example --status reverted 20260508\ndb push --db-url postgres://example --include-all --yes\n') "${log_file}"
      ;;
    unrecoverable-failure)
      diff -u <(printf 'db push --db-url postgres://example --include-all --yes\n') "${log_file}"
      ;;
  esac

  rm -rf "${tmp_dir}"
  trap - RETURN
}

run_case pass pass 0
run_case auto-repair drift-then-pass 0
run_case unrecoverable-failure fail 1

echo "push_supabase_migrations tests passed"
