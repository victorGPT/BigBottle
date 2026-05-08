#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is empty. Please set repository secret SUPABASE_DB_URL." >&2
  exit 1
fi

AUTO_REPAIR_MISSING_REMOTE_MIGRATIONS="${SUPABASE_AUTO_REPAIR_MISSING_REMOTE_MIGRATIONS:-true}"

run_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
    return
  fi
  pnpm dlx supabase "$@"
}

repair_migration() {
  local version="$1"
  echo "Marking remote-only migration ${version} as reverted before pushing local migrations..."
  run_supabase migration repair \
    --db-url "${SUPABASE_DB_URL}" \
    --status reverted \
    "${version}"
}

extract_repair_versions() {
  sed -nE 's/.*supabase migration repair --status reverted ([0-9]+).*/\1/p' | sort -u
}

push_migrations_once() {
  run_supabase db push \
    --db-url "${SUPABASE_DB_URL}" \
    --include-all \
    --yes
}

if [[ -n "${REPAIR_MIGRATION_VERSION:-}" ]]; then
  repair_migration "${REPAIR_MIGRATION_VERSION}"
fi

set +e
push_output="$(push_migrations_once 2>&1)"
push_status=$?
set -e
printf '%s\n' "${push_output}"

if [[ "${push_status}" -eq 0 ]]; then
  echo "Supabase migrations applied."
  exit 0
fi

if [[ "${AUTO_REPAIR_MISSING_REMOTE_MIGRATIONS}" != "true" ]]; then
  exit "${push_status}"
fi

repair_versions="$(printf '%s\n' "${push_output}" | extract_repair_versions)"
if [[ -z "${repair_versions}" ]]; then
  exit "${push_status}"
fi

echo "::warning::Supabase remote migration history contains versions missing locally; repairing suggested reverted versions and retrying db push."
for version in ${repair_versions}; do
  repair_migration "${version}"
done

push_migrations_once
echo "Supabase migrations applied after migration history repair."
