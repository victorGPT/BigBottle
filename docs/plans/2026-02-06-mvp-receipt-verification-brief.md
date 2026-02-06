# MVP Brief: Receipt Verification + Points (Phase 1, No On-Chain)

Date: 2026-02-06

Status: Approved (user acknowledged)

## Goal

Build a mobile-first web dApp that lets a user:

1. Log in with VeWorld wallet
2. Capture/upload a receipt photo
3. Verify the receipt via Dify
4. Compute points based on detected bottle capacity
5. Store the submission and results in Supabase

Phase 1 explicitly excludes on-chain token distribution.

## Non-Goals (Phase 2)

- B3TR on-chain distribution / claim transactions
- Fee delegation (sponsor gas) integration
- Staking / rewards / token balance sourcing
- Dispute handling / manual review process

## Actors

- End user (VeWorld wallet)
- App backend (Fastify API)
- AWS S3 (receipt images)
- Dify (verification + extraction)
- Supabase (source of truth for app data)

## Dify Output Contract (Authoritative)

Dify returns JSON shaped like:

```json
{
  "drinkList": [
    {
      "retinfoDrinkName": "BEYSU MADRAN",
      "retinfoDrinkCapacity": 500,
      "retinfoDrinkAmount": 1
    }
  ],
  "retinfoIsAvaild": "true",
  "retinfoReceiptTime": "2026-02-04 08:52:00",
  "timeThreshold": "false",
  "user_id": "d44f909f-98ac-42ba-a87b-94dbee61bcb4"
}
```

Semantics:

- `retinfoIsAvaild`: string `"true"` or `"false"`
- `timeThreshold`: string `"false"` means within validity window; `"true"` means out of window
- `user_id` is not trusted for auth. Auth identity comes from VeWorld login only.

## Verification Rules

A submission is considered:

- `verified` only when:
  - `retinfoIsAvaild === "true"` AND `timeThreshold === "false"`
- otherwise `rejected`

If `verified` but `total_points === 0`, the status is `not_claimable` (valid receipt, no rewardable info).

## Points Rules (Bottle Capacity Tiers)

Inputs:

- capacity_ml: parsed from `retinfoDrinkCapacity`
- amount: parsed from `retinfoDrinkAmount` (default 1 when missing or <= 0)

Rules:

- If capacity is missing/unknown/unparseable => 0 points
- If capacity_ml < 500 => 0 points
- If 500 <= capacity_ml < 1000 => 2 points per bottle
- If 1000 <= capacity_ml < 2000 => 10 points per bottle
- If capacity_ml >= 2000 => 15 points per bottle

Total points is the sum of `(tier_points * amount)` across `drinkList`.

## Status Machine

Statuses:

- `pending_upload`: created, presigned URL issued, image not yet confirmed uploaded
- `uploaded`: image uploaded (client confirms)
- `verifying`: Dify call in progress
- `verified`: verification success, points > 0
- `not_claimable`: verification success, points == 0
- `rejected`: verification failed or receipt invalid/out-of-window

Idempotency:

- `client_submission_id` is required on create/init and must be unique per user
- Replays of create/init with the same `client_submission_id` return the same submission
- Replays of verify return the final status if already final

## API (Phase 1)

Auth:

- `POST /auth/challenge` -> returns a nonce/message to sign
- `POST /auth/verify` -> verifies signature, returns `access_token`
- `GET /me` -> returns authenticated user info

Submissions:

- `POST /submissions/init` -> create (idempotent) and return S3 presigned upload URL
- `POST /submissions/:id/complete` -> mark uploaded (idempotent)
- `POST /submissions/:id/verify` -> run Dify, store outputs, compute points (idempotent)
- `GET /submissions` -> list current user's submissions
- `GET /submissions/:id` -> fetch one submission

## Data Model (Supabase)

`users`

- `id uuid pk`
- `wallet_address text unique not null` (lowercased)
- `created_at timestamptz not null default now()`

`auth_challenges`

- `id uuid pk`
- `wallet_address text not null` (lowercased)
- `nonce text not null`
- `expires_at timestamptz not null`
- `used_at timestamptz`
- `created_at timestamptz not null default now()`

`receipt_submissions`

- `id uuid pk`
- `user_id uuid not null references users(id)`
- `client_submission_id text not null`
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
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- unique `(user_id, client_submission_id)`

## Security Notes

- Backend must not trust `user_id` from Dify output.
- All write endpoints require authentication.
- All submission reads must be scoped to the authenticated user.
- S3 presign should restrict upload size and content type when possible.

## Verification Plan (Engineering)

- Unit tests for parsing + scoring rules (including tier boundaries and unknown capacity).
- Manual runbook:
  1. Login via VeWorld
  2. Capture/upload a receipt
  3. Trigger verify
  4. Observe status and points in UI
  5. Observe the persisted row in Supabase

## Phase 2 Backlog

- On-chain B3TR distribution and claim UX
- Fee delegation (sponsor gas) service integration
- Epoch-based configurable conversion rate (points -> token)
- Budget enforcement and rate limits
