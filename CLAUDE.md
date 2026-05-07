# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo-Specific Rules (read first)

- `AGENTS.md` and `ARCHITECTURE.md` are authoritative engineering docs. If a rule there conflicts with anything else, those files win.
- **After every task, update `ARCHITECTURE.md`** to reflect any changes to public interfaces: HTTP routes, exported function/type signatures, React routes/visible behavior, DB schema/migrations/SQL functions, and new source files (registered under their module). Generated dirs (`dist/`, `node_modules/`) are tracked at directory level only.
- **VeWorld iOS login stability is fragile.** Do not regress the workaround in `apps/web/src/app/pages/AccountPage.tsx`:
  - After `connect()` succeeds, wait ~450ms before the next signing call.
  - Sign typed data via `useWallet().requestTypedData(domain, types, value, { signer: address })` — do not call the lower-level `signer.signTypedData(...)` directly.
  - Unit tests cannot prove "no native crash"; they only guard the call sequence/parameters. Real-device VeWorld iOS regression (10× cold-start logins) is required after touching this file.

## Common Commands

Repo uses pnpm workspaces (`pnpm@10.22.0`, Node ≥22). Root scripts fan out to packages with `pnpm -r --if-present`.

Root:
- `pnpm i` — install
- `pnpm dev` — run all apps in parallel (`apps/web` Vite + `apps/api` tsx watch)
- `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck` — workspace-wide

Per-app (preferred for tight loops):
- Web: `pnpm -C apps/web dev | build | test | typecheck` (Vitest + jsdom; tests in `apps/web/tests/**`)
- API: `pnpm -C apps/api dev | build | start | test | typecheck` (Vitest; tests colocated as `*.test.ts`)

Run a single test file: `pnpm -C apps/web exec vitest run tests/account-page.test.tsx` (or `pnpm -C apps/api exec vitest run src/scoring.test.ts`). Add `-t "<name>"` to filter by test name.

Required after touching the wallet login flow: `pnpm -C apps/web typecheck` plus the manual VeWorld iOS regression described above.

## Supabase Edge Function — canonical deploy

The `api` Edge Function is the production backend. Its deploy is guarded:

- **Only canonical deploy path:** `bash scripts/ci/deploy_supabase_api.sh`. It enforces `--no-verify-jwt --use-api`, then verifies `verify_jwt=false` via `functions list`, then probes `/health` and `/auth/challenge`.
- Do **not** add raw `supabase functions deploy api ...` calls anywhere in `scripts/` or `.github/workflows/`. `scripts/ci/check_supabase_api_deploy_canonical.sh` and `.github/workflows/supabase-api-deploy-guard-ci.yml` enforce this.
- Verify a deployed function without redeploying: `bash scripts/ci/check_supabase_public_auth_routes.sh`.
- The Edge Function uses its own `JWT_SECRET` (not Supabase Auth), which is why `supabase/functions/api/config.toml` sets `verify_jwt = false`.
- Edge runtime reserves the `SUPABASE_*` env namespace, so Supabase credentials are passed as `BB_SUPABASE_URL` / `BB_SUPABASE_SERVICE_ROLE_KEY`.
- Keep `CORS_ORIGIN='*'` (default) so frontend domain changes don't require a redeploy.

## Architecture (big picture)

BigBottle is a mobile-first dApp for receipt-based bottle-recycling rewards. The key non-obvious shape:

- **Two API implementations mirror the same routes.** `apps/api` (Fastify, local/reference) and `supabase/functions/api/index.ts` (Deno Edge Function, production gateway) expose the same endpoints. When changing public API behavior, update **both** — Phase 1 routes (`/auth/*`, `/me`, `/account/summary`, `/submissions/*`) and Phase 2 (`/rewards/*`).
- **Backend is the DB client, not Supabase Auth.** Both backends connect to Supabase Postgres with the service-role key and issue their own JWTs.
- **Receipt flow** (web client → backend):
  1. `compressReceiptImage()` (best-effort, JPEG ~200 KiB; HEIC fallback uploads original).
  2. `POST /submissions/init` → presigned S3 PUT URL (idempotent per `client_submission_id`).
  3. Client PUTs to S3, then `POST /submissions/:id/complete`, then `POST /submissions/:id/verify`.
  4. Backend presigns GET, calls Dify (`mock` or `workflow`), computes points (`apps/api/src/scoring.ts`), persists.
  5. Dedup is enforced by `bb_receipt_fingerprint(...)` + a partial unique index on `verified` rows; duplicates surface as `status=rejected, rejection_code=duplicate_receipt` in the UI.
  6. On `rejected`, S3 object deletion is best-effort.
- **Phase 2 rewards (points → B3TR, gasless)** lives in `apps/api/src/rewards-service.ts` (orchestration, idempotent claim) and `apps/api/src/vebetterRewards.ts` (VeChain delegated tx signing/broadcast via VIP-191 + VIP-201 sponsor URL). Backend holds `REWARD_DISTRIBUTOR_PRIVATE_KEY`; users do not sign claim txs. `client_claim_id` is the idempotency key; at most one in-flight claim per user is enforced by a partial unique index.
- **Dify trust boundary:** never trust `user_id` in Dify output for auth.

## Web client conventions

- Wallet bridge: `VeChainKitProvider` configured with `dappKit.allowedWallets = ['veworld', 'sync2', 'wallet-connect']` in `apps/web/src/main.tsx`.
- Auth state lives in `apps/web/src/state/auth.tsx`; access token persists in `localStorage` under `bigbottle.access_token`.
- Backend base URL: `VITE_API_URL` (default `http://localhost:5173`'s sibling `http://localhost:4000`). Use `apiGet`/`apiPost` from `apps/web/src/util/api.ts`.
- Protected routes wrap with `RequireLogin` (`/scan`, `/result/:id`, `/staking`, `/rewards`).
- Vite alias forces `@vechain/picasso` to its CJS build (the published "module" entry is broken).

## Database (source of truth = `supabase/migrations/`)

Apply in filename order. New schema/SQL functions go in a new dated migration; never edit historical ones. Wallet-address columns are constrained lowercase. See `ARCHITECTURE.md` for the full table/index/function index.

## Rewards CI guardrails

- Smoke + contract: `pnpm -C apps/api exec node ../../scripts/ci/rewards-api-smoke-contract.mjs` (asserts routes don't 404 and `quote.b3tr_amount` is a `string`).
- Page E2E: `E2E_BASE_URL="<preview-or-prod>" node scripts/ci/rewards-page-e2e.mjs` (fails on `not_found`, error fallback, runtime errors).
- Workflows: `.github/workflows/rewards-guardrails-ci.yml`, `.github/workflows/rewards-e2e.yml`. Required secrets are listed in `README.md` and `docs/ci/rewards-guardrails.md`.

## Source-of-truth briefs

Product/engineering rules live under `docs/plans/` — consult these before changing behavior they cover:
- `2026-02-06-mvp-receipt-verification-brief.md` (scoring, state machine)
- `2026-02-08-anti-cheat-receipt-dedup-brief.md` (dedup + rejection codes)
- `2026-02-08-client-image-compression-brief.md` (compression behavior)
- `2026-02-09-phase2-rewards-claim-brief.md` (rewards claim flow)
