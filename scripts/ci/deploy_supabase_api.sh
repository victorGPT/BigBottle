#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-tbvkyvxdhrmfprcjyvbk}"
FUNCTION_SLUG="${SUPABASE_FUNCTION_SLUG:-api}"
API_BASE_URL="${SUPABASE_API_BASE_URL:-https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_SLUG}}"
DEPLOY_ATTEMPTS="${SUPABASE_DEPLOY_ATTEMPTS:-3}"
DEPLOY_RETRY_DELAY_SECONDS="${SUPABASE_DEPLOY_RETRY_DELAY_SECONDS:-15}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
    return
  fi
  pnpm dlx supabase "$@"
}

echo "Deploying function '${FUNCTION_SLUG}' to project '${PROJECT_REF}' with verify_jwt disabled..."
deploy_function_once() {
  run_supabase functions deploy "${FUNCTION_SLUG}" \
    --project-ref "${PROJECT_REF}" \
    --no-verify-jwt \
    --use-api
}

for attempt in $(seq 1 "${DEPLOY_ATTEMPTS}"); do
  set +e
  deploy_output="$(deploy_function_once 2>&1)"
  deploy_status=$?
  set -e
  printf '%s\n' "${deploy_output}"

  if [[ "${deploy_status}" -eq 0 ]]; then
    break
  fi

  if [[ "${attempt}" -ge "${DEPLOY_ATTEMPTS}" ]]; then
    echo "Supabase function deploy failed after ${DEPLOY_ATTEMPTS} attempts." >&2
    exit "${deploy_status}"
  fi

  echo "::warning::Supabase function deploy failed on attempt ${attempt}/${DEPLOY_ATTEMPTS}; retrying in ${DEPLOY_RETRY_DELAY_SECONDS}s."
  sleep "${DEPLOY_RETRY_DELAY_SECONDS}"
done

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
