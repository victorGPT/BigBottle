# BigBottle Architecture (Public Interface Index)

This document is a maintained index of BigBottle's public interfaces and high-level system architecture.

Maintenance rule (DoD):
- After every task, update this file to reflect public interface changes:
  - HTTP routes (paths, auth, request/response shapes)
  - exported functions/types (signature and return shape changes)
  - React route components and their observable behavior
  - DB schema, migrations, SQL functions, and constraints
  - new source files added to the repo (listed under the relevant module)
- Generated artifacts (e.g. `dist/`, `node_modules/`) are tracked at directory level only.

## System Overview

BigBottle is a mobile-first receipt scanning dApp.

Runtime components:
- Web client: Vite + React (`apps/web`)
- Backend API:
  - Local/reference server: Fastify (`apps/api`)
  - Production gateway: Supabase Edge Function (`supabase/functions/api`)
- Data store: Supabase Postgres (`supabase/migrations`)
- Object store: AWS S3 (receipt images)
- Receipt extraction/verification: Dify (mock or workflow)
- Wallet login: VeWorld (typed-data signature)

High-level flow:
1. User logs in with VeWorld wallet (challenge-response typed-data signature).
2. User captures/uploads a receipt image (client compresses best-effort).
3. Backend issues a presigned S3 PUT URL (idempotent by `client_submission_id`).
4. Client uploads to S3, then marks the submission as uploaded.
5. Backend presigns a GET URL for the image, calls Dify, computes points, and persists results.
6. Verified receipts are deduplicated by a DB fingerprint (partial unique index).

Specs / single sources of truth for business rules:
- MVP receipt verification + scoring: `docs/plans/2026-02-06-mvp-receipt-verification-brief.md`
- Client image compression: `docs/plans/2026-02-08-client-image-compression-brief.md`
- Receipt dedup + rejection codes: `docs/plans/2026-02-08-anti-cheat-receipt-dedup-brief.md`
- Phase 2 rewards (points -> B3TR gasless claim): `docs/plans/2026-02-09-phase2-rewards-claim-brief.md`

## Repo Layout

Root docs:
- `ARCHITECTURE.md`: this document (public interface index)
- `AGENTS.md`: repo-specific engineering constraints for assistants/agents
- `README.md`: project overview and quick start

Apps:
- `apps/web`: Vite + React mobile web dApp
- `apps/api`: Fastify API server (local dev / reference implementation)

Backend:
- `supabase/functions/api`: Supabase Edge Function API gateway (production path)
- `supabase/migrations`: Postgres schema + SQL functions (DB source of truth)

Product/engineering briefs:
- `docs/plans`: approved briefs (requirements source of truth)

Design source:
- `designs`: Pencil `.pen` files

Generated artifacts (directory-level only):
- `apps/web/dist`: Vite build output
- `apps/api/dist`: compiled JS output
- `node_modules`: dependency tree

## Web Client (`apps/web`)

### Entrypoints and Providers
File: `apps/web/src/main.tsx`
- React root render
- Providers:
  - `DAppKitProvider` (VeWorld wallet bridge)
  - `AuthProvider` (token storage + `/me` validation)
  - `BrowserRouter`
  - `AppErrorBoundary`

### Routes
File: `apps/web/src/app/App.tsx`
- `/` -> `DashboardPage`
- `/account` -> `AccountPage` (login lives here)
- `/scan` -> `ScanPage` (requires login)
- `/result/:id` -> `ResultPage` (requires login)
- `/staking` -> `StakingPage` (requires login; placeholder)
- `/rewards` -> `RewardsPage` (requires login; points -> B3TR claim UI)

Auth gating:
- `apps/web/src/app/components/RequireLogin.tsx` wraps protected routes.

### Backend API Base URL
File: `apps/web/src/util/api.ts`
- Base URL: `VITE_API_URL` (default `http://localhost:4000`)

Public functions:
- `apiGet<T>(path: string, token: string | null): Promise<T>`
- `apiPost<T>(path: string, body: Record<string, unknown>, token: string | null): Promise<T>`

### Auth State (JWT in localStorage)
File: `apps/web/src/state/auth.tsx`
- Storage key: `bigbottle.access_token`

Public exports:
- `AuthProvider(props: { children: React.ReactNode }): JSX.Element`
- `useAuth(): { state: AuthState; setToken(token: string): void; logout(): void }`
- `exchangeWalletSignatureForToken(input: { address: string; signature: string; challenge_id: string }): Promise<{ access_token: string; user: ApiUser }>`

### Wallet Login (VeWorld) and iOS Stability Workaround
File: `apps/web/src/app/pages/AccountPage.tsx`

Login flow:
1. Force VeWorld source (`setSource('veworld')`) when available.
2. `connect()` via `@vechain/dapp-kit-react`.
3. Wait `450ms` before the next signing request (VeWorld iOS in-app browser stability).
4. `POST /auth/challenge` with `{ address }` to receive `{ challenge_id, typed_data }`.
5. `requestTypedData(domain, types, value, { signer: address })`.
6. `POST /auth/verify` with `{ challenge_id, signature }` to receive `{ access_token }`.

### Receipt Capture, Upload, Verify
File: `apps/web/src/app/pages/ScanPage.tsx`

Flow:
1. Compress image (best-effort) -> `compressReceiptImage(file)`.
2. Init submission: `POST /submissions/init` (idempotent per `client_submission_id`).
3. Upload to S3 with the presigned PUT URL (if provided).
4. Mark complete: `POST /submissions/:id/complete`.
5. Verify: `POST /submissions/:id/verify`.
6. Navigate to `GET /result/:id` screen.

### Receipt Result UI
File: `apps/web/src/app/pages/ResultPage.tsx`
- Shows a dedicated branch for duplicates:
  - `status = rejected` and `rejection_code = duplicate_receipt`

### Client Image Compression
File: `apps/web/src/util/receiptImageCompression.ts`

Public exports:
- `compressReceiptImage(originalFile: File, partial?: Partial<ReceiptImageCompressionOptions>): Promise<ReceiptImageCompressionResult>`

Behavior:
- Output format: JPEG (`image/jpeg`)
- Soft target: ~200 KiB (best-effort, guardrails)
- Fallback: if decode fails (e.g. HEIC), upload original file unchanged

### Web Tests
- `apps/web/tests/account-page.test.tsx`: login flow guardrails (including VeWorld signing sequence)
- `apps/web/tests/scan-page-compress.test.tsx`: compression + init content type behavior
- `apps/web/tests/result-page-duplicate.test.tsx`: duplicate receipt UI branch
- `apps/web/tests/rewards-page.test.tsx`: rewards quote + claim request guardrails

## Local API Server (`apps/api`)

### Entrypoint
File: `apps/api/src/index.ts`
- Fastify server with CORS and JWT auth (`Authorization: Bearer <token>`)
- Uses Supabase (service role) as the app database, not Supabase Auth
- Uses AWS S3 presigned PUT/GET for image upload and verification

### Config (Env Vars)
File: `apps/api/src/config.ts`
- `PORT` (default `4000`)
- `CORS_ORIGIN` (default `http://localhost:5173`)
- `JWT_SECRET` (min 16 chars)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AWS_REGION`
- `S3_BUCKET`
- `S3_PRESIGN_EXPIRES_SECONDS` (default `300`)
- `DIFY_MODE` (`mock` or `workflow`, default `workflow`)
- `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID` (required when `DIFY_MODE=workflow`)
- `DIFY_IMAGE_INPUT_KEY` (default `image_url`)
- `DIFY_TIMEOUT_MS` (default `20000`)

Phase 2 (Rewards / On-chain B3TR claim):
- `REWARDS_MODE` (`chain` or `mock`, default `chain`)
- `VECHAIN_NETWORK` (`testnet` or `mainnet`, default `testnet`)
- `VECHAIN_NODE_URL` (optional; defaults by network)
- `VEBETTER_APP_ID` (bytes32 hex)
- `X2EARN_REWARDS_POOL_ADDRESS`
- `FEE_DELEGATION_URL` (VIP-201 sponsor URL)
- `REWARD_DISTRIBUTOR_PRIVATE_KEY` (origin private key)

### Public HTTP API
Auth:
- `POST /auth/challenge` -> `{ challenge_id: string, typed_data: { domain, types, value } }`
- `POST /auth/verify` -> `{ access_token: string, user: { id, wallet_address } }`
- `GET /me` (auth) -> `{ user }`

Account:
- `GET /account/summary` (auth) -> `{ summary: { points_total: number, level: null } }`

Rewards (Phase 2):
- `GET /rewards/quote` (auth) -> `{ quote: { points_total, points_locked, points_available, points_per_b3tr, conversion_rate_id, b3tr_amount_wei, b3tr_amount } }`
- `POST /rewards/claim` (auth) -> `{ claim }`
  - request: `{ client_claim_id: uuid }`
- `GET /rewards/claims` (auth) -> `{ claims }`
- `GET /rewards/claims/:id` (auth) -> `{ claim }` (best-effort receipt refresh)

Submissions:
- `POST /submissions/init` (auth) -> `{ submission, upload: { method: 'PUT', url, headers } | null }`
  - request: `{ client_submission_id: uuid, content_type: string }`
- `POST /submissions/:id/complete` (auth) -> `{ submission }`
- `POST /submissions/:id/verify` (auth) -> `{ submission }`
- `GET /submissions` (auth) -> `{ submissions }`
- `GET /submissions/:id` (auth) -> `{ submission }`

Health:
- `GET /health` -> `{ ok: true }`

Rewards implementation (Phase 2):
- `apps/api/src/rewards-service.ts`: quote + idempotent claim orchestration
- `apps/api/src/vebetterRewards.ts`: VeChain delegated tx signing/broadcast + receipt polling
- `apps/api/src/rewards.ts`: points -> B3TR conversion helpers

### Idempotency and State Machine
Per brief: `docs/plans/2026-02-06-mvp-receipt-verification-brief.md`
- `client_submission_id` is unique per user
- init/complete/verify are safe under retries

Rewards claim idempotency:
- `client_claim_id` is the idempotency key (unique per user)
- At most one in-flight claim per user (`pending`/`submitted`)

### Points and Dedup
Per briefs:
- scoring rules: `docs/plans/2026-02-06-mvp-receipt-verification-brief.md`
- dedup rules and rejection codes: `docs/plans/2026-02-08-anti-cheat-receipt-dedup-brief.md`

Public exports (scoring):
File: `apps/api/src/scoring.ts`
- `parseCapacityMl(input: unknown): number | null`
- `parseAmount(input: unknown): number`
- `pointsForCapacityMl(capacityMl: number | null): number`
- `computeTotalPoints(drinkList: unknown): { totalPoints: number, items: ... }`

### Storage Policy
On `rejected`, backend best-effort deletes the receipt image from S3.

### API Tests
- `apps/api/src/scoring.test.ts`: scoring boundaries and parsing
- `apps/api/src/config.test.ts`: env validation
- `apps/api/src/s3.test.ts`: presign/head/delete helpers
- `apps/api/src/rewards.test.ts`: points -> B3TR conversion helpers

## Supabase Edge Function API Gateway (`supabase/functions/api`)

File: `supabase/functions/api/index.ts`
- Deno runtime Edge Function
- Mirrors the local Fastify routes under `apps/api` for Phase 1 and Phase 2
- Uses its own JWT (`JWT_SECRET`) and does not rely on Supabase Auth

Config:
- Function config: `supabase/functions/api/config.toml` sets `verify_jwt = false`
- Edge env vars reserve `SUPABASE_*`, so Supabase credentials are:
  - `BB_SUPABASE_URL`
  - `BB_SUPABASE_SERVICE_ROLE_KEY`
- For easy frontend domain changes, keep `CORS_ORIGIN='*'` (default).
- Phase 2 rewards env vars (same semantics as `apps/api`):
  - `REWARDS_MODE`
  - `VECHAIN_NETWORK`
  - `VECHAIN_NODE_URL`
  - `VEBETTER_APP_ID`
  - `X2EARN_REWARDS_POOL_ADDRESS`
  - `FEE_DELEGATION_URL`
  - `REWARD_DISTRIBUTOR_PRIVATE_KEY`

## Database (Supabase Postgres)

Migrations are the DB source of truth:

### `supabase/migrations/20260206_init.sql`
Tables:
- `public.users`
  - `id uuid pk default gen_random_uuid()`
  - `wallet_address text unique not null` (must be lowercase via check constraint)
  - `created_at timestamptz default now()`
- `public.auth_challenges`
  - `id uuid pk`
  - `wallet_address text not null` (must be lowercase via check constraint)
  - `nonce text not null`
  - `expires_at timestamptz not null`
  - `used_at timestamptz`
  - `created_at timestamptz default now()`
- `public.receipt_submissions`
  - `id uuid pk`
  - `user_id uuid not null references users(id) on delete cascade`
  - `client_submission_id text not null` (unique per user)
  - `status text not null`
  - `image_bucket text not null`
  - `image_key text not null`
  - `image_content_type text`
  - `dify_raw jsonb`
  - `dify_drink_list jsonb`
  - `receipt_time_raw text`
  - `retinfo_is_availd text`
  - `time_threshold text`
  - `points_total integer not null default 0`
  - `verified_at timestamptz`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

Trigger / function:
- `public.set_updated_at()` (trigger for `receipt_submissions.updated_at`)

Indexes:
- unique: `(user_id, client_submission_id)`
- list: `(user_id, created_at desc)`

### `supabase/migrations/20260208_receipt_dedup.sql`
Columns added to `public.receipt_submissions`:
- `receipt_fingerprint text`
- `rejection_code text`
- `duplicate_of uuid references receipt_submissions(id)`

Functions:
- `public.bb_receipt_fingerprint(receipt_time_raw text, dify_drink_list jsonb) -> text`

Constraints:
- partial unique index on `receipt_fingerprint` where `status='verified' and receipt_fingerprint is not null`

### `supabase/migrations/20260208_z_account_summary.sql`
Functions:
- `public.bb_user_points_total(user_id uuid) -> integer`

### `supabase/migrations/20260209_rewards_claims.sql`
Tables:
- `public.reward_conversion_rates`
  - `id uuid pk default gen_random_uuid()`
  - `points_per_b3tr integer > 0`
  - `active boolean`
  - `created_at timestamptz default now()`
- `public.reward_claims`
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid not null references users(id) on delete cascade`
  - `wallet_address text not null` (must be lowercase via check constraint)
  - `client_claim_id uuid not null` (idempotency key)
  - `conversion_rate_id uuid not null references reward_conversion_rates(id)`
  - `points_per_b3tr_snapshot integer > 0`
  - `points_claimed integer > 0`
  - `b3tr_amount_wei numeric > 0`
  - `status text in ('pending','submitted','confirmed','failed')`
  - `tx_hash text`
  - `failure_reason text`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

Indexes / constraints:
- at most one active conversion rate (`active=true` partial unique index)
- unique: `(user_id, client_claim_id)`
- at most one in-flight claim per user (`status in ('pending','submitted')` partial unique index)
- unique: `tx_hash` where not null

Trigger / functions:
- `public.set_updated_at()` trigger for `reward_claims.updated_at`
- `public.bb_user_points_locked(user_id uuid) -> integer` (pending/submitted/confirmed)
- `public.bb_user_points_claimed(user_id uuid) -> integer` (confirmed only)

### `supabase/migrations/20260209_z_rewards_claims_raw_tx.sql`
Columns added to `public.reward_claims`:
- `raw_tx text` (persisted signed delegated tx for replay/diagnostics)

## External Integrations and Trust Boundaries

VeWorld wallet:
- Login requires typed-data signing.
- iOS in-app browser stability: avoid back-to-back signing; wait before typed-data request and pass `{ signer: address }`.

VeChain / VeBetterDAO (Phase 2 rewards):
- Token distribution uses `X2EarnRewardsPool.distributeRewardWithProofAndMetadata(...)`.
- Gasless claim uses delegated transactions (VIP-191) with a VIP-201 sponsor service URL.
- Backend is the transaction origin (holds `REWARD_DISTRIBUTOR_PRIVATE_KEY`); users do not sign claim txs.

Dify:
- Backend must not trust `user_id` in Dify output for auth.
- Dify may run in `mock` mode for development.

AWS S3:
- Upload via presigned PUT.
- Verification fetch via presigned GET.
- On rejected submissions, object deletion is best-effort.
