#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-${ROOT_DIR}/.tmp/self-hosted-supabase-api}"
TARBALL="${2:-${ROOT_DIR}/.tmp/bigbottle-self-hosted-supabase-api.tgz}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/volumes/functions/api" "$(dirname "${TARBALL}")"

cp "${ROOT_DIR}/supabase/functions/api/index.ts" "${OUT_DIR}/volumes/functions/api/index.ts"
cp "${ROOT_DIR}/supabase/functions/api/config.toml" "${OUT_DIR}/volumes/functions/api/config.toml"
if [[ -f "${ROOT_DIR}/supabase/functions/api/package.json" ]]; then
  cp "${ROOT_DIR}/supabase/functions/api/package.json" "${OUT_DIR}/volumes/functions/api/package.json"
fi

COPYFILE_DISABLE=1 tar --no-xattrs -C "${OUT_DIR}" -czf "${TARBALL}" volumes/functions/api

echo "Packaged self-hosted Supabase function bundle:"
echo "${TARBALL}"
