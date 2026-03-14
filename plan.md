# Plan — Supabase API deploy canonicalization

## Goal
Close the recurring `Supabase API Public Routes Guard` regression by enforcing a single canonical deploy path for the `api` Edge Function inside repo workflows/scripts.

## Invariants
- `supabase/functions/api/config.toml` remains the source declaration for `verify_jwt = false`.
- `scripts/ci/deploy_supabase_api.sh` is the only allowed repo-managed deploy path for `api`.
- Post-deploy checks must still confirm `verify_jwt=false`, `GET /health -> 200`, and `POST /auth/challenge -> 200`.
- PR CI must catch raw `supabase functions deploy api ...` usage in `.github/workflows` and `scripts` before merge.

## Execution
- [x] Inspect current deploy paths, guard workflow, and docs.
- [x] Add a static canonical-deploy guard script for repo workflows/scripts.
- [x] Add shell coverage for the new guard.
- [x] Add a PR CI workflow to run shell tests and the static guard.
- [x] Route `scripts/setup-supabase.sh` through the canonical deploy script.
- [x] Update `supabase/README.md` and `ARCHITECTURE.md`.
- [ ] Run local verification commands and capture evidence.
