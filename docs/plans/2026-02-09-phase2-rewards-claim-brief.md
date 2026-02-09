# MVP Brief: Points -> B3TR Gasless Claim (Phase 2, On-Chain)

Date: 2026-02-09

Status: Implemented (user acknowledged + delivered)

## Goal

Enable a user to claim B3TR on-chain based on their off-chain points, with:

1. A clear and configurable conversion rate (e.g. `10 points = 1 B3TR`)
2. A **gasless** user experience (user pays no gas fee)
3. Strong idempotency/replay safety for user-triggered writes

## Non-Goals

- Staking
- Budget management / per-epoch caps
- Disputes and manual review
- Multi-wallet per user
- On-chain verification of receipt contents (this MVP uses a backend-managed proof string only)

## Actors / Trust Boundaries

- End user (VeWorld wallet)
- Backend API (`apps/api`) as the transaction origin (holds distributor private key)
- Supabase Postgres as the source of truth for points, conversion rates, and claim tracking
- VeChainThor network + VeBetterDAO contracts
- Fee delegation sponsor service (VIP-201-compatible)

## Key Decisions

### Claim Model (Backend Initiated)

- The backend signs and submits the distribution transaction.
- The user does not sign any transaction for claiming.
- The user still authenticates via the existing login flow (typed-data signature).

### Gasless Claim

- Transactions are sent as **delegated** transactions (VIP-191).
- Gas payer signature is obtained from a sponsor service URL (VIP-201 simple gas payer standard).

### Proof Policy

- Proof is submitted on-chain using:
  - `proofTypes = ["text"]`
  - `proofValues = ["bb:v1:claim:<claimId>"]`
- Do not include PII or receipt data on-chain.

### Conversion Rate Flexibility

- Conversion rate is stored in DB table `reward_conversion_rates`.
- Only one row is `active=true` (enforced by a partial unique index).
- Each claim stores a **snapshot**:
  - `conversion_rate_id`
  - `points_per_b3tr_snapshot`

## Data Model

Tables:

- `public.reward_conversion_rates`
  - `points_per_b3tr integer > 0`
  - `active boolean`
  - `created_at timestamptz`
- `public.reward_claims`
  - `user_id uuid` (FK to `users`)
  - `wallet_address text` (lowercase)
  - `client_claim_id uuid` (idempotency key per user)
  - `points_claimed integer > 0`
  - `b3tr_amount_wei numeric > 0` (18 decimals, stored in wei)
  - `status in ('pending','submitted','confirmed','failed')`
  - `tx_hash text` (VeChain tx id)
  - `raw_tx text` (persisted signed delegated tx for replay/diagnostics)

Functions:

- `public.bb_user_points_total(user_id uuid) -> integer`
- `public.bb_user_points_locked(user_id uuid) -> integer`
- `public.bb_user_points_claimed(user_id uuid) -> integer`

## Conversion

- Allow fractional B3TR (18 decimals).
- Compute: `b3trWei = floor(pointsAvailable * 1e18 / pointsPerB3tr)`

## API (Phase 2)

All endpoints require `Authorization: Bearer <token>`.

Quote:

- `GET /rewards/quote`
  - returns: `{ quote: { points_total, points_locked, points_available, points_per_b3tr, conversion_rate_id, b3tr_amount_wei, b3tr_amount } }`

Claim (idempotent):

- `POST /rewards/claim`
  - body: `{ client_claim_id: uuid }`
  - behavior:
    - If a claim exists for `client_claim_id`, return it.
    - If another in-flight claim exists (`pending`/`submitted`), return it.
    - Otherwise create a new claim, sign delegated tx, persist `tx_hash` + `raw_tx`, then broadcast.
  - returns: `{ claim: { ...status, tx_hash, b3tr_amount, ... } }`

Claim status:

- `GET /rewards/claims`
- `GET /rewards/claims/:id` (best-effort refresh from chain receipt; never blocks UI on receipt errors)

## Ops: Changing the Conversion Rate

To change the active rate (example `20 points = 1 B3TR`):

```sql
update public.reward_conversion_rates set active = false where active;
insert into public.reward_conversion_rates (points_per_b3tr, active) values (20, true);
```

## Environment Configuration (Backend)

Required for on-chain claim:

- `VECHAIN_NETWORK`: `testnet` | `mainnet`
- `VECHAIN_NODE_URL` (optional; defaults by network)
- `VEBETTER_APP_ID`: bytes32 hex string
- `X2EARN_REWARDS_POOL_ADDRESS`: contract address
- `FEE_DELEGATION_URL`: VIP-201 sponsor URL
- `REWARD_DISTRIBUTOR_PRIVATE_KEY`: origin private key for distribution calls

Local mock mode (no chain calls):

- Set `REWARDS_MODE=mock` to exercise quote/claim UI and DB state transitions without requiring VeBetterDAO or sponsor configuration.

## Verification (Engineering)

Automated:

- `pnpm -C apps/api typecheck`
- `pnpm -C apps/api test`
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web test`

Manual (testnet recommended first):

1. Configure env vars above.
2. Login in web.
3. Ensure you have points.
4. Open Rewards page -> Claim.
5. Observe claim status transitions:
   - `submitted` -> `confirmed`
6. Verify on-chain via tx hash and receiver address.

## References

- VIP-191 (Fee Delegation): https://github.com/vechain/VIPs/blob/master/vips/VIP-191.md
- VIP-201 (Simple Gas Payer): https://github.com/vechain/VIPs/blob/master/vips/VIP-201.md
