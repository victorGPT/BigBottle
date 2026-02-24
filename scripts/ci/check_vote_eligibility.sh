#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [[ -z "${EFFECTIVE_ROUND_ID:-}" ]]; then
  echo "EFFECTIVE_ROUND_ID is required." >&2
  exit 1
fi

if ! [[ "${EFFECTIVE_ROUND_ID}" =~ ^[1-9][0-9]*$ ]]; then
  echo "EFFECTIVE_ROUND_ID must be a positive integer. Got: ${EFFECTIVE_ROUND_ID}" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
diff_sql="${repo_root}/scripts/sql/check_vote_eligibility_diff.sql"

if [[ ! -f "${diff_sql}" ]]; then
  echo "Missing SQL file: ${diff_sql}" >&2
  exit 1
fi

mismatch_count="$(
  psql -X "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v effective_round_id="${EFFECTIVE_ROUND_ID}" \
    -Atqc "
with expected as (
  select distinct passport_address
  from public.vote_wallet_mapping
  where round_id = ((:effective_round_id)::bigint - 1)
    and voted_any_app = true
),
actual as (
  select distinct passport_address
  from public.bigbottle_vote_bonus_eligibility
  where effective_round_id = (:effective_round_id)::bigint
    and bonus_type = 'vebetter_vote_bonus'
    and status = 'eligible'
)
select count(*)
from (
  select e.passport_address
  from expected e
  left join actual a using (passport_address)
  where a.passport_address is null
  union all
  select a.passport_address
  from actual a
  left join expected e using (passport_address)
  where e.passport_address is null
) mismatches;
"
)"

mismatch_count="$(printf '%s' "${mismatch_count}" | tr -d '[:space:]')"
if ! [[ "${mismatch_count}" =~ ^[0-9]+$ ]]; then
  echo "Unexpected mismatch_count value: ${mismatch_count}" >&2
  exit 1
fi

if [[ "${mismatch_count}" -gt 0 ]]; then
  echo "Vote eligibility mismatch detected for EFFECTIVE_ROUND_ID=${EFFECTIVE_ROUND_ID}."
  echo "Mismatch count: ${mismatch_count}"
  echo "Mismatch details:"
  psql -X "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v effective_round_id="${EFFECTIVE_ROUND_ID}" \
    -f "${diff_sql}"

  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "## Vote eligibility audit failed"
      echo ""
      echo "- effective_round_id: \`${EFFECTIVE_ROUND_ID}\`"
      echo "- mismatch_count: \`${mismatch_count}\`"
      echo "- result: mismatch detected"
    } >> "${GITHUB_STEP_SUMMARY}"
  fi

  exit 1
fi

echo "Vote eligibility audit passed for EFFECTIVE_ROUND_ID=${EFFECTIVE_ROUND_ID}. mismatch_count=0"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Vote eligibility audit passed"
    echo ""
    echo "- effective_round_id: \`${EFFECTIVE_ROUND_ID}\`"
    echo "- mismatch_count: \`0\`"
    echo "- result: expected and actual eligibility sets are consistent"
  } >> "${GITHUB_STEP_SUMMARY}"
fi
