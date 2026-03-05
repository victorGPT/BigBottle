#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${1:-${API_BASE_URL:-https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api}}"
SAMPLE_ADDRESS="${SAMPLE_ADDRESS:-0x0000000000000000000000000000000000000001}"

probe() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local payload="${4:-}"
  local tmp_file
  local status
  local response

  tmp_file="$(mktemp)"

  if [[ -n "$payload" ]]; then
    status="$(
      curl -sS \
        -o "$tmp_file" \
        -w "%{http_code}" \
        -X "$method" \
        "${API_BASE_URL}${path}" \
        -H "content-type: application/json" \
        --data "$payload"
    )"
  else
    status="$(
      curl -sS \
        -o "$tmp_file" \
        -w "%{http_code}" \
        -X "$method" \
        "${API_BASE_URL}${path}"
    )"
  fi

  response="$(cat "$tmp_file")"
  rm -f "$tmp_file"

  echo "${method} ${path} -> ${status}"

  if [[ "$status" != "$expected_status" ]]; then
    echo "Expected HTTP ${expected_status}, got ${status} for ${path}" >&2
    echo "Response: ${response}" >&2
    return 1
  fi
}

probe "GET" "/health" "200"
probe "POST" "/auth/challenge" "200" "{\"address\":\"${SAMPLE_ADDRESS}\"}"

echo "Supabase public auth routes guard passed for ${API_BASE_URL}"
