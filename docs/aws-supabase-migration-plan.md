# AWS Supabase Migration Plan

## Goal

Move the BigBottle backend dependency from Supabase hosted project `tbvkyvxdhrmfprcjyvbk` to AWS-owned infrastructure with the smallest reliable surface area.

The first production target is a self-hosted Supabase Docker stack on one AWS EC2 instance. This keeps the current API shape (`/functions/v1/api/...`) and Postgres schema while avoiding an immediate rewrite to native AWS services.

## Current Production Surface

- Frontend calls `https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api`.
- The Edge Function `supabase/functions/api/index.ts` owns auth, receipt upload/verification, points, and rewards claim APIs.
- Postgres stores users, auth challenges, receipt submissions, reward claims, reward claim sources, vote bonus data, achievement definitions, and VeBetter node data.
- AWS S3 already stores receipt images through presigned PUT/GET URLs.
- Receipt recognition currently uses SiliconFlow `Qwen/Qwen3-VL-30B-A3B-Instruct`.
- Rewards claim signing uses `REWARD_DISTRIBUTOR_PRIVATE_KEY`; this secret must never be committed.

## Target Architecture

- AWS EC2 instance running official Supabase self-hosted Docker Compose.
- EBS volume for Docker volumes and Postgres data.
- Reverse proxy with HTTPS in front of Supabase Kong/API gateway.
- Existing AWS S3 bucket remains the receipt image store.
- Existing VeChain node/fee delegation/SiliconFlow integrations remain external dependencies.
- Frontend `VITE_API_URL` moves to `https://<aws-supabase-domain>/functions/v1/api`.

## Required AWS Resources

- EC2 instance, Ubuntu LTS, Docker Engine and Docker Compose plugin installed.
- EBS volume sized for Postgres data and backups.
- Security group:
  - inbound `443` from public
  - inbound `80` only for ACME redirect/challenge if using Caddy/Certbot
  - inbound `22` restricted to admin IPs
  - no public Postgres port
- Route 53 DNS record for the Supabase API hostname.
- Optional ALB if we want AWS-managed TLS instead of host-managed Caddy/Nginx.

## Secrets To Recreate

Generate fresh self-hosted Supabase platform secrets:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `ANON_KEY`
- `SERVICE_ROLE_KEY`
- dashboard credentials
- any SMTP/Auth provider secrets if enabled later

Carry over BigBottle runtime secrets into the self-hosted functions service:

- `BB_SUPABASE_URL`
- `BB_SUPABASE_SERVICE_ROLE_KEY`
- `AWS_REGION`
- `S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_PRESIGN_EXPIRES_SECONDS`
- `RECEIPT_ANALYZER_PROVIDER`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_MODEL`
- `SILICONFLOW_API_BASE_URL`
- `SILICONFLOW_TIMEOUT_MS`
- `REWARDS_MODE`
- `VECHAIN_NETWORK`
- `VECHAIN_NODE_URL`
- `VEBETTER_APP_ID`
- `X2EARN_REWARDS_POOL_ADDRESS`
- `FEE_DELEGATION_URL`
- `REWARD_DISTRIBUTOR_PRIVATE_KEY`
- optional GM NFT / vote bonus sync settings

## Migration Steps

1. Provision EC2, attach EBS, install Docker.
2. Install the official Supabase self-hosted Docker stack on the EC2 host.
3. Configure `.env` for self-hosted Supabase and start the stack.
4. Restore production Postgres data from Supabase hosted to the AWS Postgres container.
5. Apply repository migrations against the AWS database.
6. Package the BigBottle Edge Function:
   - run `scripts/ci/package_self_hosted_supabase_api.sh`
   - copy the generated `volumes/functions/api` directory to the EC2 Supabase stack
   - configure function env vars from `deploy/aws-supabase/functions.env.example`
   - restart the self-hosted `functions` container
7. Smoke test on AWS:
   - `GET /functions/v1/api/health`
   - `POST /functions/v1/api/auth/challenge`
   - login signature exchange
   - receipt upload + verify
   - rewards quote
   - claim dry account path
8. Freeze writes on the hosted Supabase API.
9. Take final hosted DB dump and restore into AWS.
10. Repeat smoke tests against AWS.
11. Switch frontend `VITE_API_URL` and CORS origin.
12. Monitor receipt verification, claims, and function logs.

## Cutover Boundary

The only public contract the frontend should need to change is:

```text
VITE_API_URL=https://<aws-supabase-domain>/functions/v1/api
```

The API routes under `/health`, `/auth/*`, `/submissions/*`, `/account/*`, and `/rewards/*` should remain unchanged.

## Rollback

Rollback is DNS/config based as long as hosted Supabase writes remain frozen during cutover:

1. Point frontend `VITE_API_URL` back to hosted Supabase.
2. Restore hosted function secrets if changed.
3. Resume hosted traffic.

If AWS accepted writes before rollback, export the delta rows from AWS first:

- `users`
- `auth_challenges`
- `receipt_submissions`
- `reward_claims`
- `reward_claim_sources`

Then import or reconcile those rows before sending users back to hosted Supabase.

## Acceptance Criteria

- AWS endpoint returns `GET /functions/v1/api/health -> 200`.
- AWS endpoint returns `POST /functions/v1/api/auth/challenge -> 200`.
- A receipt upload reaches terminal `verified`, `rejected`, or `not_claimable`.
- New receipt rows include `analyzer_provider`, `analyzer_model`, and `analyzer_usage`.
- Rewards quote returns `b3tr_amount` as a string.
- No public Postgres port is reachable from the internet.
- Hosted Supabase rollback endpoint remains available until AWS has run cleanly through a production window.
