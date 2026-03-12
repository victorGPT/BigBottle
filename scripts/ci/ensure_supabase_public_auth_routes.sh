#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${CHECK_SCRIPT:-${script_dir}/check_supabase_public_auth_routes.sh}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-${script_dir}/deploy_supabase_api.sh}"
API_BASE_URL="${1:-${API_BASE_URL:-https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api}}"

run_check() {
  "${CHECK_SCRIPT}" "${API_BASE_URL}"
}

echo "Checking Supabase public auth routes at ${API_BASE_URL}..."
if run_check; then
  echo "Public auth routes already healthy."
  exit 0
fi

echo "Public auth routes drifted out of public mode; attempting auto-heal deploy..."
"${DEPLOY_SCRIPT}"

echo "Re-checking Supabase public auth routes after deploy..."
run_check

echo "Public auth routes healed successfully."
