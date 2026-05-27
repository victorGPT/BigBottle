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
- Receipt extraction/verification: receipt analyzer provider (`dify` or `temporal`)
- Wallet login: VeChain Kit (`@vechain/vechain-kit`) with VeWorld / Sync2 / WalletConnect (typed-data signature)

High-level flow:
1. User logs in with a VeChain wallet (VeWorld/Sync2/WalletConnect, challenge-response typed-data signature).
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
- Initializes `apps/web/src/i18n.ts` before rendering.
- Providers:
  - `VeChainKitProvider` (wallet bridge with `dappKit.allowedWallets = ['veworld', 'sync2', 'wallet-connect']`)
  - `AuthProvider` (token storage + `/me` validation)
  - `BrowserRouter`
  - `AppErrorBoundary`

### Internationalization
File: `apps/web/src/i18n.ts`
- React i18next initialization for user-facing web copy.
- Default language: English (`en`).
- Supported languages: English (`en`), Simplified Chinese (`zh-Hans`), Traditional Chinese (`zh-Hant`), and Japanese (`ja`).
- Language preference is stored in `localStorage` under `bigbottle.language` when available.
- Also owns localized frontend display labels for statuses, multiplier values, and GM-NFT level names.

Files: `apps/web/src/i18n/locales/*.ts`
- Locale resources are split by language.
- `en.ts` is the source schema for required flat keys; non-English locale modules must satisfy that schema.

File: `apps/web/src/app/components/LanguageToggle.tsx`
- Shared compact flag language menu.
- Exposed from the Dashboard header as the primary language setting entry and reused from the Account header. The Dashboard header keeps the language entry compact and hides the wordmark on very narrow screens to preserve action space.

File: `apps/web/src/util/localizedDisplay.ts`
- Shared frontend display helpers for locale-dependent numeric/status labels:
  - `formatMultiplierValue(value, t): string`
  - `getGmNftLevelName(level, t): string`
  - `getSubmissionStatusLabel(status, t): string`

File: `apps/web/src/util/veworldWalletLink.ts`
- Browser-side VeWorld Wallet Link protocol helper for mobile Safari/Chrome without an injected `window.vechain`.
- Starts login with `https://www.veworld.com/api/v1/connect`, stores the NaCl keypair/session state under `bigbottle.veworld_wallet_link`, handles VeWorld callback payload decryption, and builds the follow-up `signTypedData` link.
- Mainnet/testnet genesis IDs are fixed constants matching VeChain public networks. Unsupported local/solo networks throw before opening VeWorld.

File: `apps/web/scripts/check-i18n.mjs`
- Runs through `pnpm -C apps/web i18n:check` and as part of `apps/web` build.
- Checks locale key parity, interpolation variable parity, and hardcoded JSX text in `apps/web/src/app`.
- The only allowed hardcoded brand literals in JSX are `BigBottle` and `Big Bottle`; other user-facing text must come from locale resources.

### Routes
File: `apps/web/src/app/App.tsx`
- `/` -> `DashboardPage`
- `/account` -> `AccountPage` (login lives here)
- `/veworld/callback/:event` -> `VeWorldCallbackPage` (VeWorld mobile Wallet Link connect/signature callback)
- `/scan` -> `ScanPage` (requires login)
- `/result/:id` -> `ResultPage` (requires login)
- `/rewards` -> `RewardsPage` (requires login; points -> B3TR claim UI; shows the B3TR reward distribution pool available for user claims)

Auth gating:
- `apps/web/src/app/components/RequireLogin.tsx` wraps protected routes.

### Brand Logo UI
File: `apps/web/src/app/components/BrandLogo.tsx`
- Shared BigBottle logo image component backed by `apps/web/public/bigbottle-logo-header.png`.
- Used in the Dashboard header and Account header.

Public exports:
- `BrandLogo(props: { className?: string, alt?: string }): JSX.Element`

### Claim Status UI
File: `apps/web/src/app/components/ClaimStatusPanel.tsx`
- Shared claim status panel used by Dashboard and Rewards for in-flight and terminal claim states.

Public exports:
- `ClaimStatusSnapshot`
- `getClaimButtonLabel(input): string` accepts optional localized `labels` for claim / claimed / processing states.
- `ClaimStatusPanel(props): JSX.Element`

### Backend API Base URL
File: `apps/web/src/util/api.ts`
- Base URL: `VITE_API_URL` (default `http://localhost:4000`)

Public functions:
- `apiGet<T>(path: string, token: string | null): Promise<T>`
- `apiPost<T>(path: string, body: Record<string, unknown>, token: string | null): Promise<T>`

### Auth State (JWT in localStorage)
File: `apps/web/src/state/auth.tsx`
- Storage key: `bigbottle.access_token`
- `setToken` and `logout` are stable callback references so auth state refreshes do not retrigger route effects that depend on auth actions.

Public exports:
- `AuthProvider(props: { children: React.ReactNode }): JSX.Element`
- `useAuth(): { state: AuthState; setToken(token: string): void; logout(): void }`
- `exchangeWalletSignatureForToken(input: { address: string; signature: string; challenge_id: string }): Promise<{ access_token: string; user: ApiUser }>`

### Wallet Login (VeChain Kit) and iOS Stability Workaround
File: `apps/web/src/app/pages/AccountPage.tsx`

Observable account behavior:
- Loads `GET /account/summary` and `GET /account/achievements` after login.
- Known achievement rows (`vebetter_vote_bonus`, `gm_nft`) use API fields for status, multiplier, and GM-NFT node level, but render user-facing titles/descriptions/tags/level names through `apps/web/src/i18n.ts` so the selected language controls the page copy.

Login flow:
1. If the user is on a mobile browser without injected VeWorld (`window.vechain` missing), start the VeWorld Wallet Link flow through `apps/web/src/util/veworldWalletLink.ts`.
2. Otherwise prefer VeWorld source (`setSource('veworld')`) when injected; keep Sync2/WalletConnect available.
3. `connect()` via `useDAppKitWallet` from `@vechain/vechain-kit`.
4. Wait `450ms` before the next signing request (VeWorld iOS in-app browser stability).
5. `POST /auth/challenge` with `{ address }` to receive `{ challenge_id, typed_data }`.
6. `requestTypedData(domain, types, value, { signer: address })`.
7. `POST /auth/verify` with `{ challenge_id, signature }` to receive `{ access_token }`.

VeWorld Wallet Link callback behavior:
- `VeWorldCallbackPage` processes each callback URL through a shared in-memory promise so auth initialization, React re-renders, or StrictMode remounts cannot submit the same `challenge_id` to `/auth/verify` more than once.

### Receipt Capture, Upload, Verify
File: `apps/web/src/app/pages/ScanPage.tsx`

Flow:
1. Compress image (best-effort) -> `compressReceiptImage(file)`.
2. Init submission: `POST /submissions/init` (idempotent per `client_submission_id`).
3. Upload to S3 with the presigned PUT URL (if provided).
4. Mark complete: `POST /submissions/:id/complete`.
5. Start background verification: `POST /submissions/:id/verify`.
6. Navigate to `GET /result/:id` screen while `uploaded` / `verifying` submissions show a processing state.

Observable scan behavior:
- The capture screen shows localized reward rule copy before upload:
  - VeBetterDAO voters: one successful chance per day within a week.
  - Receipt uploads: at most two receipt uploads per user, including failed attempts; after two unsuccessful attempts no more are processed.
  - Non-voters: at most two chances per week.

Receipt quota enforcement:
- `POST /submissions/init` rejects new uploads with `429` before issuing a presigned URL when quota is exhausted.
- `POST /submissions/:id/verify` rejects verification with `429` when the verified-receipt quota is exhausted.
- API error codes:
  - `daily_upload_limit_exceeded`: VeBetterDAO voter already used two upload attempts for the UTC day.
  - `daily_verified_limit_exceeded`: VeBetterDAO voter already has one verified receipt for the UTC day.
  - `weekly_upload_limit_exceeded`: non-voter already used two upload attempts for the UTC week.
  - `weekly_verified_limit_exceeded`: non-voter already has two verified receipts for the UTC week.
- The DB trigger `public.bb_enforce_daily_receipt_submission_limits()` is the final concurrency guard for these limits. Despite the historical function name, it now enforces voter daily limits and non-voter weekly limits.

### Receipt Result UI
File: `apps/web/src/app/pages/ResultPage.tsx`
- Shows a dedicated branch for duplicates:
  - `status = rejected` and `rejection_code = duplicate_receipt`
- Shows a per-receipt points audit breakdown when available:
  - `points_total`: final awarded points
  - `points_base`: receipt base points before achievement bonuses
  - `points_multiplier`: applied achievement multiplier
  - `points_bonus_sources`: JSON source snapshot such as GM-NFT, VeBetterDAO voter, or legacy final-points-only receipts
- Receipt verification stores analyzer telemetry on the submission row:
  - `analyzer_provider` / `analyzer_model`: model route used for receipt extraction
  - `analyzer_usage`: raw model token usage object when the provider returns one
  - `analyzer_image`: image bytes/content-type metadata used for cost debugging

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
- `apps/web/tests/veworld-callback-page.test.tsx`: VeWorld callback idempotency guard for duplicate rerenders
- `apps/web/tests/veworld-wallet-link.test.ts`: VeWorld Wallet Link URL generation and encrypted callback handling
- `apps/web/tests/scan-page-compress.test.tsx`: compression + init content type behavior
- `apps/web/tests/result-page-duplicate.test.tsx`: duplicate receipt UI branch
- `apps/web/tests/rewards-page.test.tsx`: rewards quote + claim request guardrails

## Local API Server (`apps/api`)

### Entrypoint
File: `apps/api/src/index.ts`
- Fastify server with CORS and JWT auth (`Authorization: Bearer <token>`)
- Uses Supabase (service role) as the app database, not Supabase Auth
- Uses AWS S3 presigned PUT/GET for image upload and verification
- Receipt verification persists the points audit snapshot (`points_base`, `points_multiplier`, `points_bonus_sources`) together with `points_total`.

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
- `RECEIPT_ANALYZER_PROVIDER` (`dify` or `temporal`, default `dify`)
- Supabase Edge Function supports direct `RECEIPT_ANALYZER_PROVIDER=gemini` or `RECEIPT_ANALYZER_PROVIDER=siliconflow` receipt analysis when bypassing the Dify-compatible bridge.
- `DIFY_MODE` (`mock` or `workflow`, default `workflow`)
- `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID` (required when `DIFY_MODE=workflow`)
- `DIFY_IMAGE_INPUT_KEY` (default `image_url`)
- `DIFY_TIMEOUT_MS` (default `20000`)
- `TEMPORAL_ADDRESS` (default `localhost:7233`)
- `TEMPORAL_NAMESPACE` (default `default`)
- `TEMPORAL_TASK_QUEUE` (default `bigbottle-receipt-verification`)
- `TEMPORAL_WORKFLOW_TYPE` (default `receiptVerificationWorkflow`)
- `TEMPORAL_WORKFLOW_TIMEOUT_MS` (default `20000`)
- `TEMPORAL_TLS` (default `false`)
- `TEMPORAL_API_KEY` (optional)
- `RECEIPT_MODEL_PROVIDER` (`gemini` or `siliconflow`, default `gemini`)
- `GEMINI_API_KEY` (required for `apps/api` Temporal worker)
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `GEMINI_API_BASE_URL` (default `https://generativelanguage.googleapis.com`)
- `GEMINI_TIMEOUT_MS` (default `20000`)
- `GEMINI_MAX_IMAGE_BYTES` (default `10485760`)
- `RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE` (default `1024`)
- `RECEIPT_MODEL_IMAGE_JPEG_QUALITY` (default `78`)
- `SILICONFLOW_API_KEY` (required when `RECEIPT_MODEL_PROVIDER=siliconflow`)
- `SILICONFLOW_MODEL` (default `Qwen/Qwen3-VL-30B-A3B-Instruct`)
- `SILICONFLOW_API_BASE_URL` (default `https://api.siliconflow.cn/v1`)
- `SILICONFLOW_TIMEOUT_MS` (default `30000`)
- `ANALYZER_BRIDGE_PORT` (default `8084`)
- `ANALYZER_BRIDGE_API_KEY` (optional bearer token for the Dify-compatible Temporal bridge)

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
- `GET /account/achievements` (auth) -> `{ achievements, summary }`; each achievement includes semantic `key`, `unlocked`, `multiplier`, optional round ids, and optional GM-NFT `node_name` / `node_level`. API-provided title/description/tag fields are fallback metadata; the web client localizes known achievement keys.

Rewards (Phase 2):
- `GET /rewards/pool` (auth) -> `{ pool: { b3tr_available_funds_wei, b3tr_available_funds, rewards_pool_address, app_id, network, updated_at } }`
- `GET /rewards/quote` (auth) -> `{ quote: { points_total, points_locked, points_available, points_per_b3tr, conversion_rate_id, b3tr_amount_wei, b3tr_amount } }`
- `POST /rewards/claim` (auth) -> `{ claim }`
  - request: `{ client_claim_id: uuid }`
  - On-chain broadcast failure marks the persisted claim `failed` with `failure_reason` so points are released for a later claim attempt.
- `GET /rewards/claims` (auth) -> `{ claims }`
- `GET /rewards/claims/:id` (auth) -> `{ claim }` (best-effort receipt refresh)
  - 503 error: `rewards_unconfigured` (may include missing env var names as `rewards_unconfigured:<CSV>`)

Submissions:
- `POST /submissions/init` (auth) -> `{ submission, upload: { method: 'PUT', url, headers } | null }`
  - request: `{ client_submission_id: uuid, content_type: string }`
- `POST /submissions/:id/complete` (auth) -> `{ submission }`
- `POST /submissions/:id/verify` (auth) -> `{ submission }`
  - Claims `uploaded -> verifying`, schedules receipt analysis in the background, and returns immediately with the current submission state.
- `GET /submissions` (auth) -> `{ submissions }`
- `GET /submissions/:id` (auth) -> `{ submission }`
  - Clients poll this route while status is `uploaded` or `verifying`.
- Successful receipt limit: each user can have at most 1 `status='verified'` receipt submission per UTC day. Extra successful verifications return `daily_verified_limit_exceeded`; failed, duplicate, rejected, or not-claimable submissions do not count as successful receipts.

Health:
- `GET /health` -> `{ ok: true }`

Rewards implementation (Phase 2):
- `apps/api/src/rewards-service.ts`: quote + idempotent claim orchestration
- `apps/api/src/vebetterRewards.ts`: VeChain delegated tx signing/broadcast + receipt polling
- `apps/api/src/rewards.ts`: points -> B3TR conversion helpers

Receipt analyzer implementation:
- `apps/api/src/receipt-analyzer.ts`: provider boundary for receipt extraction/verification; selects Dify or Temporal based on `RECEIPT_ANALYZER_PROVIDER`.
- `apps/api/src/dify.ts`: Dify workflow client plus payload extraction compatibility for `{ data: { outputs } }` responses.
- `apps/api/src/temporal-receipt-analyzer.ts`: Temporal client path; starts `TEMPORAL_WORKFLOW_TYPE` on `TEMPORAL_TASK_QUEUE` with `{ imageUrl, userRef, submissionId }` and expects the same receipt payload shape as Dify.
- `apps/api/src/temporal-worker.ts`: AWS/Node worker entrypoint; run `pnpm -C apps/api build && pnpm -C apps/api worker`.
- `apps/api/src/temporal-bridge.ts`: Dify-compatible HTTP bridge; runs a Temporal worker in-process and exposes `POST /v1/workflows/run` for the existing Supabase Edge Function integration path.
- `apps/api/src/temporal-workflows.ts`: exports `receiptVerificationWorkflow`.
- `apps/api/src/receipt-analysis-activities.ts`: activity implementation; fetches the presigned receipt image, normalizes it into a bounded JPEG for model input, calls the configured receipt model provider with the compact receipt-extraction prompt, rejects model payloads that contain no beverage items, logs model/image usage metrics, adds `timeThreshold` (`"true"` means the receipt time is inside the accepted window), and returns the Dify-compatible payload. It also exports the previous production prompt for regression/eval comparison.
- `apps/api/src/receipt-prompt-eval.ts`: local prompt and image-size comparison runner. Use `pnpm -C apps/api prompt:eval <receipt-image-path> [--edges=1600,1280,1024,768]` with `SILICONFLOW_API_KEY` to compare previous vs current prompt token usage, resized-image token/cost usage, and extracted fields on the same image.
- `apps/api/Dockerfile.temporal`: container image for the bridge/worker process.
- `deploy/temporal/docker-compose.yml`: EC2 Docker Compose stack for Temporal Postgres, Temporal server, Temporal UI bound to localhost, and the BigBottle Dify-compatible Temporal bridge on port `8084`.

### Idempotency and State Machine
Per brief: `docs/plans/2026-02-06-mvp-receipt-verification-brief.md`
- `client_submission_id` is unique per user
- init/complete/verify are safe under retries

Rewards claim idempotency:
- `client_claim_id` is the idempotency key (unique per user)
- At most one in-flight claim per user (`pending`/`submitted`)
- Reward transactions persist `tx_hash` and `raw_tx` before broadcast; if broadcast is rejected, the claim transitions to `failed` instead of remaining `submitted`.

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
- Base receipt scoring is capped at 20 points before bonus multipliers are applied.

### Storage Policy
On `rejected`, backend best-effort deletes the receipt image from S3.

### API Tests
- `apps/api/src/scoring.test.ts`: scoring boundaries and parsing
- `apps/api/src/config.test.ts`: env validation
- `apps/api/src/s3.test.ts`: presign/head/delete helpers
- `apps/api/src/rewards.test.ts`: points -> B3TR conversion helpers, reward pool balance reads, and reward claim broadcast failure handling

## Supabase Edge Function API Gateway (`supabase/functions/api`)

File: `supabase/functions/api/index.ts`
- Deno runtime Edge Function
- Mirrors the local Fastify routes under `apps/api` for Phase 1 and Phase 2
- Implements the production `/rewards/pool` chain read route for reward distribution pool balance display
- Mirrors reward claim broadcast failure handling from `apps/api`: persisted claims are marked `failed` when raw transaction broadcast is rejected.
- Imports VeChain SDK npm dependencies statically so the self-hosted Supabase Edge Runtime includes package constraints during function compilation.
- Uses its own JWT (`JWT_SECRET`) and does not rely on Supabase Auth

Config:
- Function config: `supabase/functions/api/config.toml` sets `verify_jwt = false`
- Edge env vars reserve `SUPABASE_*`, so Supabase credentials are:
  - `BB_SUPABASE_URL`
  - `BB_SUPABASE_SERVICE_ROLE_KEY`
- Deployment guardrails:
  - `scripts/ci/deploy_supabase_api.sh` is the canonical deploy path, enforces `--no-verify-jwt --use-api`, and verifies `verify_jwt=false` after deploy.
  - `scripts/ci/check_supabase_public_auth_routes.sh` probes `/health` and `/auth/challenge` as public routes.
  - `scripts/ci/check_supabase_api_deploy_canonical.sh` rejects raw `supabase functions deploy api ...` usage outside the canonical deploy script.
  - `scripts/setup-supabase.sh` delegates interactive deploys to the canonical deploy script instead of issuing a raw deploy directly.
  - `.github/workflows/supabase-api-public-routes-guard.yml` runs scheduled drift checks against the public API endpoint.
  - `.github/workflows/supabase-api-deploy-guard-ci.yml` runs the shell guard tests plus the static canonical-deploy check on PRs.
- AWS self-hosted migration assets:
  - `docs/aws-supabase-migration-plan.md`: EC2/Docker Compose self-hosted Supabase migration, cutover, and rollback plan.
  - `deploy/aws-supabase/README.md`: AWS host bootstrap and self-hosted function deployment notes.
  - `deploy/aws-supabase/functions.env.example`: BigBottle function secret checklist for self-hosted Supabase.
  - `scripts/ci/package_self_hosted_supabase_api.sh`: packages `supabase/functions/api` into a `volumes/functions/api` tarball for self-hosted Supabase.
  - Self-hosted Edge Runtime executes function source directly, so runtime imports that are not Deno std/Supabase HTTP imports use Deno `npm:` specifiers instead of `esm.sh` bundles that can expose missing `.d.ts` dependencies at worker boot.
- For easy frontend domain changes, keep `CORS_ORIGIN='*'` (default).
- Phase 2 rewards env vars (same semantics as `apps/api`):
  - `REWARDS_MODE`
  - `VECHAIN_NETWORK`
  - `VECHAIN_NODE_URL`
  - `VEBETTER_APP_ID`
  - `X2EARN_REWARDS_POOL_ADDRESS`
  - `FEE_DELEGATION_URL`
  - `REWARD_DISTRIBUTOR_PRIVATE_KEY`
  - `VEBETTER_CURRENT_EFFECTIVE_ROUND_ID` (optional; limits vote bonus lookup to the active effective round for receipt verification and achievement display)

## Database (Supabase Postgres)

Migrations are the DB source of truth:

Security boundary:
- The web client must not access Supabase tables directly through anon/authenticated Data API roles.
- `apps/web` calls the API gateway; `apps/api` and `supabase/functions/api` access database tables with the service role.
- `supabase/migrations/202605110001_harden_public_table_rls.sql` enables RLS on backend-owned public tables and revokes anon/authenticated table privileges while preserving service-role API access.

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
  - `analyzer_provider text`
  - `analyzer_model text`
  - `analyzer_usage jsonb`
  - `analyzer_image jsonb`
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

### `supabase/migrations/202605090001_receipt_points_audit.sql`
Columns added to `public.receipt_submissions`:
- `points_base integer not null default 0`
- `points_multiplier numeric(12, 4) not null default 1`
- `points_bonus_sources jsonb not null default []`

Backfill:
- Existing rows keep their final `points_total`; legacy positive rows set `points_base = points_total`, `points_multiplier = 1`, and a `legacy_points_total` source marker because historical bonus sources cannot be reconstructed.
- The migration temporarily drops and recreates the `updated_at` trigger around the backfill so historical `updated_at` values are not rewritten.

Constraints:
- `points_base >= 0`
- `points_multiplier >= 1`
- `points_bonus_sources` must be a JSON array

### `supabase/migrations/202605180001_daily_successful_receipt_limit.sql`
- Replaces `public.bb_enforce_daily_receipt_submission_limits()` so each user can have at most 1 successful `status='verified'` receipt submission per UTC day.
- Keeps the existing daily total upload attempt limit at 6.

### `supabase/migrations/202605180002_receipt_base_points_cap.sql`
- Adds a `points_base <= 20` database constraint for new/updated receipt submissions. The constraint is `not valid` so historical rows above the cap remain auditable while future writes are blocked.

### `supabase/migrations/202605180003_reprice_unsettled_receipt_points.sql`
- Reprices existing verified receipt submissions that have not been attached to a `pending`, `submitted`, or `confirmed` reward claim source. These unsettled receipts are recalculated with `points_base <= 20` while preserving their stored multiplier.

### `supabase/migrations/20260525104737_receipt_analyzer_usage.sql`
Columns added to `public.receipt_submissions`:
- `analyzer_provider text`
- `analyzer_model text`
- `analyzer_usage jsonb`
- `analyzer_image jsonb`

Constraints / indexes:
- `analyzer_provider` must be `dify`, `gemini`, `siliconflow`, `temporal`, or `null`
- `analyzer_usage` and `analyzer_image` must be JSON objects when present
- Index on `(analyzer_provider, created_at desc)` for usage/cost reporting

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

VeChain wallets (VeWorld / Sync2 / WalletConnect):
- Login requires typed-data signing.
- iOS in-app browser stability: avoid back-to-back signing; wait before typed-data request and pass `{ signer: address }`.

VeChain / VeBetterDAO (Phase 2 rewards):
- Token distribution uses `X2EarnRewardsPool.distributeRewardWithProofAndMetadata(...)` on the configured rewards pool (`X2EARN_REWARDS_POOL_ADDRESS`).
- Reward pool display reads the user-claim distribution pool from `X2EarnRewardsPool.rewardsPoolBalance(VEBETTER_APP_ID)`.
- Gasless claim uses delegated transactions (VIP-191) with a VIP-201 sponsor service URL.
- Backend is the transaction origin (holds `REWARD_DISTRIBUTOR_PRIVATE_KEY`); users do not sign claim txs.

Dify:
- Backend must not trust `user_id` in Dify output for auth.
- Dify may run in `mock` mode for development.

AWS S3:
- Upload via presigned PUT.
- Verification fetch via presigned GET.
- On rejected submissions, object deletion is best-effort.

## Task Notes

### 2026-05-07 — VeBetter proof payload + plastic impact baseline formula
- No code interface changes in this task.
- Product rule clarified for future implementation:
  - VeBetterDAO impact category should use `plastic` code (unit in grams by default minimum-unit guidance).
  - BigBottle baseline example for bottle-size normalization uses `500ml` as reference size.
  - For a counted batch, "unit ml plastic consumption decreases as bottle count increases" should be modeled as a monotonic function where per-ml plastic declines with quantity, while total plastic impact remains non-negative and auditable.

### 2026-05-07 — On-chain sustainability proof payload for reward claims
- Updated reward claim chain payload generation in `apps/api/src/rewards-service.ts`:
  - Reward claims now call VeBetterDAO `distributeRewardWithProofAndMetadata`.
  - Official proof fields are passed as contract arguments: `proofTypes=["text"]`, `impactCodes=["plastic"]`, and a description.
  - Extra BigBottle tx detail is emitted through the `RewardMetadata` event as JSON metadata instead of being nested inside the proof payload.
  - `impact.plastic` is populated for each claim using verified receipt source data.
- Added `apps/api/src/plastic-impact.ts`:
  - Exported `calculatePlasticReductionGrams(input)` to compute plastic reduction (grams) using a 500ml baseline and a monotonic decreasing per-ml plastic-intensity model as bottle count increases.
- Added `supabase/migrations/20260508_reward_claim_sources.sql`:
  - `reward_claim_sources` links reward claims to the verified receipt submissions used as claim sources.
  - `bb_reward_claim_source_submissions(user_id)` returns verified submissions not already locked by active reward claims.
