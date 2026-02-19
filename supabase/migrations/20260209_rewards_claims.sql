-- BigBottle (Phase 2 MVP): Reward conversion rates + on-chain reward claim tracking

-- Conversion rates (single active row)
create table if not exists public.reward_conversion_rates (
  id uuid primary key default gen_random_uuid(),
  points_per_b3tr integer not null check (points_per_b3tr > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enforce at most one active conversion rate.
create unique index if not exists reward_conversion_rates_one_active
  on public.reward_conversion_rates ((1))
  where active;

-- Seed a default rate if none is active.
insert into public.reward_conversion_rates (points_per_b3tr, active)
select 10, true
where not exists (select 1 from public.reward_conversion_rates where active);

-- Reward claims (idempotent + auditable)
create table if not exists public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  wallet_address text not null,
  client_claim_id uuid not null,

  conversion_rate_id uuid not null references public.reward_conversion_rates(id),
  points_per_b3tr_snapshot integer not null check (points_per_b3tr_snapshot > 0),
  points_claimed integer not null check (points_claimed > 0),
  -- B3TR amount uses 18 decimals; store in wei as numeric to avoid int overflow.
  b3tr_amount_wei numeric not null check (b3tr_amount_wei > 0),

  status text not null check (status in ('pending','submitted','confirmed','failed')),
  tx_hash text,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_claims_wallet_address_lowercase check (wallet_address = lower(wallet_address))
);

create unique index if not exists reward_claims_user_client_claim_id_key
  on public.reward_claims (user_id, client_claim_id);

-- At most one in-flight claim per user.
create unique index if not exists reward_claims_one_inflight_per_user
  on public.reward_claims (user_id)
  where status in ('pending','submitted');

create unique index if not exists reward_claims_tx_hash_key
  on public.reward_claims (tx_hash)
  where tx_hash is not null;

create index if not exists reward_claims_user_id_created_at_idx
  on public.reward_claims (user_id, created_at desc);

drop trigger if exists set_reward_claims_updated_at on public.reward_claims;
create trigger set_reward_claims_updated_at
before update on public.reward_claims
for each row execute function public.set_updated_at();

-- Helpers: locked points by reward claims (pending/submitted/confirmed)
create or replace function public.bb_user_points_locked(user_id uuid)
returns integer as $$
  select coalesce(sum(points_claimed), 0)::integer
  from public.reward_claims
  where reward_claims.user_id = $1
    and reward_claims.status in ('pending','submitted','confirmed');
$$ language sql stable;

create or replace function public.bb_user_points_claimed(user_id uuid)
returns integer as $$
  select coalesce(sum(points_claimed), 0)::integer
  from public.reward_claims
  where reward_claims.user_id = $1
    and reward_claims.status = 'confirmed';
$$ language sql stable;

