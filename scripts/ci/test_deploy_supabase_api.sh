#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_SCRIPT="${ROOT_DIR}/scripts/ci/deploy_supabase_api.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

log_file="${tmp_dir}/calls.log"
deploy_count_file="${tmp_dir}/deploy-count"
: >"${log_file}"

cat >"${tmp_dir}/supabase" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${LOG_FILE:?}"
DEPLOY_COUNT_FILE="${DEPLOY_COUNT_FILE:?}"
printf 'supabase %s\n' "$*" >>"${LOG_FILE}"

if [[ "$1 $2" == "functions deploy" ]]; then
  count=0
  if [[ -f "${DEPLOY_COUNT_FILE}" ]]; then
    count="$(cat "${DEPLOY_COUNT_FILE}")"
  fi
  count=$((count + 1))
  printf '%s' "${count}" >"${DEPLOY_COUNT_FILE}"
  if [[ "${count}" -eq 1 ]]; then
    echo "simulated transient bundle failure" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$1 $2" == "functions list" ]]; then
  printf '[{"slug":"api","verify_jwt":false}]\n'
  exit 0
fi

echo "unexpected supabase command: $*" >&2
exit 2
EOF

cat >"${tmp_dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${LOG_FILE:?}"
out_file=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -o)
      out_file="$2"
      shift 2
      ;;
    -w)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf 'curl\n' >>"${LOG_FILE}"
if [[ -n "${out_file}" ]]; then
  printf '{}\n' >"${out_file}"
fi
printf '200'
EOF

chmod +x "${tmp_dir}/supabase" "${tmp_dir}/curl"

PATH="${tmp_dir}:${PATH}" \
LOG_FILE="${log_file}" \
DEPLOY_COUNT_FILE="${deploy_count_file}" \
SUPABASE_DEPLOY_ATTEMPTS=2 \
SUPABASE_DEPLOY_RETRY_DELAY_SECONDS=0 \
SUPABASE_PROJECT_REF=test-project \
SUPABASE_FUNCTION_SLUG=api \
"${TARGET_SCRIPT}" >/dev/null

diff -u \
  <(printf 'supabase functions deploy api --project-ref test-project --no-verify-jwt --use-api\nsupabase functions deploy api --project-ref test-project --no-verify-jwt --use-api\nsupabase functions list --project-ref test-project -o json\ncurl\ncurl\n') \
  "${log_file}"

echo "deploy_supabase_api tests passed"
