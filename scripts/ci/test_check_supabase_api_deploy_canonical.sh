#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_SCRIPT="${ROOT_DIR}/scripts/ci/check_supabase_api_deploy_canonical.sh"

if [[ ! -f "${TARGET_SCRIPT}" ]]; then
  echo "missing target script: ${TARGET_SCRIPT}" >&2
  exit 1
fi

run_case() {
  local name="$1"
  local expected_status="$2"
  local setup_fn="$3"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  mkdir -p "${tmp_dir}/scripts/ci" "${tmp_dir}/.github/workflows"
  cat >"${tmp_dir}/scripts/ci/deploy_supabase_api.sh" <<'EOF'
#!/usr/bin/env bash
supabase functions deploy api --project-ref demo --no-verify-jwt --use-api
EOF
  chmod +x "${tmp_dir}/scripts/ci/deploy_supabase_api.sh"

  case "${setup_fn}" in
    no-bypass)
      cat >"${tmp_dir}/scripts/setup-supabase.sh" <<'EOF'
#!/usr/bin/env bash
bash scripts/ci/deploy_supabase_api.sh
EOF
      ;;
    script-bypass)
      cat >"${tmp_dir}/scripts/setup-supabase.sh" <<'EOF'
#!/usr/bin/env bash
supabase functions deploy api --project-ref demo --no-verify-jwt --use-api
EOF
      ;;
    workflow-bypass)
      cat >"${tmp_dir}/.github/workflows/setup.yml" <<'EOF'
name: bad
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: supabase functions deploy api --project-ref demo --no-verify-jwt --use-api
EOF
      ;;
    *)
      echo "unknown setup_fn=${setup_fn}" >&2
      exit 2
      ;;
  esac

  set +e
  output="$(CHECK_ROOT="${tmp_dir}" "${TARGET_SCRIPT}" 2>&1)"
  actual_status=$?
  set -e

  if [[ "${actual_status}" != "${expected_status}" ]]; then
    echo "${name}: expected exit ${expected_status}, got ${actual_status}" >&2
    printf '%s\n' "${output}" >&2
    exit 1
  fi

  case "${name}" in
    pass-when-only-canonical)
      grep -F "Supabase API deploy paths are canonical." <<<"${output}" >/dev/null
      ;;
    fail-on-script-bypass|fail-on-workflow-bypass)
      grep -F "Use scripts/ci/deploy_supabase_api.sh instead" <<<"${output}" >/dev/null
      ;;
  esac

  rm -rf "${tmp_dir}"
  trap - RETURN
}

run_case pass-when-only-canonical 0 no-bypass
run_case fail-on-script-bypass 1 script-bypass
run_case fail-on-workflow-bypass 1 workflow-bypass

echo "check_supabase_api_deploy_canonical tests passed"
