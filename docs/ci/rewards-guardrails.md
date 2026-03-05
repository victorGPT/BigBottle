# Rewards CI + E2E Guardrails

This guardrail set focuses on one failure class:

- Rewards route mismatch (`not_found`)
- Rewards response contract mismatch (`b3tr_amount` non-string)
- frontend runtime crashes on `/rewards` (for example `split of undefined`)

## Workflows

### 1) Rewards Guardrails CI

File: `.github/workflows/rewards-guardrails-ci.yml`

Checks:

- Route smoke (unauthenticated)
  - `GET /rewards/quote`
  - `GET /rewards/claims`
  - `POST /rewards/claim`
  - policy: `401` is allowed, `404`/`not_found` is blocked
- Response contract
  - authenticated `GET /rewards/quote`
  - `quote.b3tr_amount` must be `string`
- Migration dry-run
  - `supabase db push --dry-run --db-url "$SUPABASE_DB_URL"`

Required repository secrets:

- `REWARDS_API_BASE_URL`
- `SUPABASE_DB_URL`

### 2) Rewards E2E

File: `.github/workflows/rewards-e2e.yml`

Inputs (manual dispatch / workflow_call):

- `preview_url` (optional override)
- `prod_url` (optional override)

If inputs are empty, workflow reads repository secrets:

- `REWARDS_E2E_PREVIEW_URL`
- `REWARDS_E2E_PROD_URL`

Checks on both `<preview_url>/rewards` and `<prod_url>/rewards`:

- page text must not contain `not_found`
- page must not render global crash fallback (`Something went wrong`)
- no uncaught runtime error (captured via `pageerror`)
- no runtime-like console errors (`TypeError`, `ReferenceError`, `split of undefined`, etc.)
- no visible red error blocks containing `error` or `not_found`

Additional repository secrets for E2E:

- `REWARDS_E2E_PREVIEW_URL`
- `REWARDS_E2E_PROD_URL`

## Local script entrypoints

- API smoke + contract:
  - `pnpm -C apps/api exec node ../../scripts/ci/rewards-api-smoke-contract.mjs`
- Rewards page E2E:
  - `E2E_BASE_URL="https://<preview-or-prod>" node scripts/ci/rewards-page-e2e.mjs`
