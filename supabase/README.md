# Supabase Schema (Phase 1)

This folder contains SQL migrations for the MVP database schema.

## Apply

1. Open Supabase SQL editor (or psql) for your project
2. Run migrations in order:
   - `supabase/migrations/20260206_init.sql`
   - `supabase/migrations/20260208_receipt_dedup.sql`
   - `supabase/migrations/20260218_z_account_summary.sql`
   - `supabase/migrations/20260217_vote_mapping_and_bonus.sql`
   - `supabase/migrations/20260224_vechain_node_holder_daily.sql`

## Tables

- `public.users`
- `public.auth_challenges`
- `public.receipt_submissions`
- `public.vote_wallet_mapping`
- `public.bigbottle_vote_bonus_eligibility`
- `public.vechain_node_holder_daily`
- `public.vechain_node_holder_latest` (view)

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

## VeChain Node Holder Daily Sync

Workflow: `.github/workflows/vechain-node-holder-sync.yml`

Required:
- GitHub Actions Secret: `SUPABASE_DB_URL`

Optional repo vars:
- `VECHAIN_NODE_CALL_API_BASE` (default `https://call.api.vechain.energy/main`)
- `VECHAIN_NODE_LEGACY_CONTRACT_ADDRESS` (default `0xb81e9c5f9644dec9e5e3cac86b4461a222072302`)
- `VECHAIN_NODE_STARGATE_NFT_CONTRACT_ADDRESS` (default `0x1856c533ac2d94340aaa8544d35a5c1d4a21dee7`)
- `VECHAIN_NODE_SYNC_RPS` (default `3`)
- `VECHAIN_NODE_MAX_RETRIES` (default `5`)

Manual run supports:
- `snapshot_date` (YYYY-MM-DD)
- `max_legacy_token_id` (for partial/test runs)
- `max_stargate_items` (for partial/test runs)
