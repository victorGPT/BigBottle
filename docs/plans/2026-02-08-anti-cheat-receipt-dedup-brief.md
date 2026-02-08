# Anti-Cheat Brief: Receipt Dedup (Phase 1, Hard Reject)

Date: 2026-02-08

Status: Approved (user acknowledged)

## Goal

Detect and block receipt re-use across:

1. Same account uploads the same physical receipt multiple times (including re-photographing)
2. Multiple accounts upload the same physical receipt

Phase 1 decision: **hard reject duplicates** (mis-kills acceptable).

## Non-Goals

- Risk scoring / manual review queue
- Appeal/dispute flow
- Account-level rate limiting / device fingerprinting

## Actors

- End user (VeWorld wallet)
- Backend API (Supabase Edge Function `api` and local Fastify reference)
- Dify (receipt extraction)
- Supabase (source of truth)

## Single Source of Truth (SoT)

This document is the SoT for Phase 1 dedup rules and the meaning of rejection codes.

## Dedup Definition (Fingerprint v1)

Inputs (from Dify output):

- `receipt_time_raw`: parseable string like `YYYY-MM-DD HH:mm:ss`
- `drinkList[]` items with:
  - `retinfoDrinkName`
  - `retinfoDrinkCapacity`
  - `retinfoDrinkAmount`

Normalization:

- `time_minute`: truncate `receipt_time_raw` to minute: `YYYY-MM-DD HH:mm` (ignore seconds)
- For each drink item, build a normalized token:
  - `name`: `lower(trim(name))`, collapse internal whitespace to a single space
  - `capacity_ml`: parse digits to integer, default `0`
  - `amount`: parse digits to integer, default `1`
- Sort item tokens ascending, then join with `||`

Fingerprint:

```
sha256_hex("v1|" + time_minute + "|" + join(sorted_items, "||"))
```

Applicability:

- Dedup is enforced only when a submission is finalized as `verified` (i.e. `points_total > 0`).
- `not_claimable` does not occupy the global dedup key.

## Behavior

When verification would result in `verified`:

- Compute fingerprint
- If any existing submission has the same fingerprint and is `verified`, the current submission is rejected:
  - `status = rejected`
  - `rejection_code = duplicate_receipt`
  - `duplicate_of = <existing submission id>` when available
  - `points_total = 0`

## Data Model Additions

`public.receipt_submissions` adds:

- `receipt_fingerprint text`
- `rejection_code text`
- `duplicate_of uuid references receipt_submissions(id)`

DB constraint:

- Unique index on `receipt_fingerprint` for `status = 'verified'` (partial unique index).

## UI Requirement

When `status = rejected` and `rejection_code = duplicate_receipt`, show a dedicated message:

- "该小票已被使用，无法重复领取积分。"

## Verification Plan

Automated:

- Web: unit test for the `duplicate_receipt` UI branch

Manual:

- Submit the same physical receipt twice (same account or different accounts):
  - 1st time: `verified`
  - 2nd time: `rejected` with `duplicate_receipt`

