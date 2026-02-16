# Supabase Schema (Phase 1)

This folder contains SQL migrations for the MVP database schema.

## Apply

1. Open Supabase SQL editor (or psql) for your project
2. Run migrations in order:
   - `supabase/migrations/20260206_init.sql`
   - `supabase/migrations/20260208_receipt_dedup.sql`
   - `supabase/migrations/20260218_z_account_summary.sql`
   - `supabase/migrations/20260217_vote_mapping_and_bonus.sql`

## Tables

- `public.users`
- `public.auth_challenges`
- `public.receipt_submissions`
- `public.vote_wallet_mapping`
- `public.bigbottle_vote_bonus_eligibility`

## Edge Functions (API)

The web app expects a backend API base URL via `VITE_API_URL`.

If you deploy the backend as a Supabase Edge Function named `api`, the base URL is:

```text
https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api
```

Then configure Vercel:

1. Project `Settings` -> `Environment Variables`
2. Set `VITE_API_URL` to the value above (Production + Preview)

### Deploy (CLI)

If you use the Supabase CLI:

```bash
supabase functions deploy api --project-ref tbvkyvxdhrmfprcjyvbk
```

You must also configure secrets for the function (e.g. `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, AWS and Dify keys)
before the full flow can work.

Note: this function uses its own JWT (`JWT_SECRET`) and does not rely on Supabase Auth, so JWT verification is disabled
via `supabase/functions/api/config.toml` (`verify_jwt = false`).

Minimum secrets for auth endpoints:

- `BB_SUPABASE_URL` (example: `https://tbvkyvxdhrmfprcjyvbk.supabase.co`)
- `BB_SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` (min 16 chars)

Additional secrets for upload + verify flow:

- `AWS_REGION` (example: `ap-northeast-1`)
- `S3_BUCKET` (example: `bvefuturebigbottle2`)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (optional)
- `DIFY_MODE` (`mock` or `workflow`, default is `mock`)
- `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID` (required when `DIFY_MODE=workflow`)
- `DIFY_IMAGE_INPUT_KEY` should match a **file** input variable in the workflow (the API passes a `remote_url` image payload)
