# Supabase Schema (Phase 1)

This folder contains SQL migrations for the MVP database schema.

## Apply

1. Open Supabase SQL editor (or psql) for your project
2. Run: `supabase/migrations/20260206_init.sql`

## Tables

- `public.users`
- `public.auth_challenges`
- `public.receipt_submissions`

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

Minimum secrets for auth endpoints:

- `SUPABASE_URL` (example: `https://tbvkyvxdhrmfprcjyvbk.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` (min 16 chars)
