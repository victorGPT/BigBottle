#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-tbvkyvxdhrmfprcjyvbk}"
FUNCTION_SLUG="${SUPABASE_FUNCTION_SLUG:-api}"
API_BASE_URL="${SUPABASE_API_BASE_URL:-https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_SLUG}}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
    return
  fi
  pnpm dlx supabase "$@"
}

echo "Deploying function '${FUNCTION_SLUG}' to project '${PROJECT_REF}' with verify_jwt disabled..."
run_supabase functions deploy "${FUNCTION_SLUG}" \
  --project-ref "${PROJECT_REF}" \
  --no-verify-jwt \
  --use-api

functions_json="$(
  run_supabase functions list --project-ref "${PROJECT_REF}" -o json
)"

verify_jwt="$(
  node -e '
    const rows = JSON.parse(process.argv[1]);
    const slug = process.argv[2];
    const fn = rows.find((item) => item.slug === slug);
    if (!fn) {
      console.error(`Function ${slug} not found in function list.`);
      process.exit(2);
    }
    process.stdout.write(String(fn.verify_jwt));
  ' "${functions_json}" "${FUNCTION_SLUG}"
)"

if [[ "${verify_jwt}" != "false" ]]; then
  echo "Deploy completed but verify_jwt=${verify_jwt}. Expected false." >&2
  exit 1
fi

echo "verify_jwt=false confirmed for ${FUNCTION_SLUG}."
"${script_dir}/check_supabase_public_auth_routes.sh" "${API_BASE_URL}"
