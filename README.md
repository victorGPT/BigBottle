# BigBottle (MVP)

Mobile-first receipt scanning app for bottle recycling incentives.

## MVP Scope (Phase 1)

- VeWorld wallet login (challenge-response signature)
- Capture/upload receipt photo (AWS S3 presigned upload)
- Verify via Dify and calculate points
- Persist submissions in Supabase
- Mobile UI based on the Pencil design file in `designs/`

## Repo Layout

- `apps/web`: Vite + React (mobile web dApp)
- `supabase/functions/api`: Supabase Edge Function API (recommended for production)
- `apps/api`: Fastify API server (local dev / reference implementation)
- `docs/plans`: Single source of truth for product/engineering brief
- `designs`: Pencil `.pen` design source

## Quick Start

1. Install deps: `pnpm i`
2. Configure env:
   - `apps/api/.env` (see `apps/api/.env.example`)
   - `apps/web/.env` (see `apps/web/.env.example`)
3. Apply DB schema in Supabase:
   - Run `supabase/migrations/20260206_init.sql` in the Supabase SQL editor
4. Run dev: `pnpm dev`

## Notes

Phase 2 (out of MVP): on-chain B3TR distribution, claim flow, fee delegation (sponsor gas).

## Rewards Guardrails (CI + E2E)

To prevent Rewards regressions like `not_found` route mismatch or response-shape crashes:

- CI workflow: `.github/workflows/rewards-guardrails-ci.yml`
  - smoke checks route existence for:
    - `GET /rewards/quote`
    - `GET /rewards/claims`
    - `POST /rewards/claim`
  - contract check: `quote.b3tr_amount` must be a `string`
  - migration dry-run: `supabase db push --dry-run`
- E2E workflow: `.github/workflows/rewards-e2e.yml`
  - validates both preview + prod `/rewards` URLs in one run
  - fails on `not_found`, red error blocks, or uncaught runtime errors

Required GitHub secrets:

- `REWARDS_API_BASE_URL` (for Rewards API smoke/contract workflow)
- `SUPABASE_DB_URL` (for migration dry-run)
- `REWARDS_E2E_PREVIEW_URL` (optional default preview URL for E2E workflow)
- `REWARDS_E2E_PROD_URL` (optional default prod URL for E2E workflow)

Manual runs:

1. `Rewards Guardrails CI`: trigger via Actions tab (or on PR to `main`).
2. `Rewards E2E`: workflow dispatch with:
   - `preview_url` + `prod_url`, or
   - leave both empty and rely on `REWARDS_E2E_PREVIEW_URL` / `REWARDS_E2E_PROD_URL` secrets.

See also: `docs/ci/rewards-guardrails.md`.
