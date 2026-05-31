-- BigBottle abuse defense: queue reward claims for review and record abuse signals.

alter table public.reward_claims
  drop constraint if exists reward_claims_status_check;

alter table public.reward_claims
  add constraint reward_claims_status_check
  check (status in ('pending', 'pending_review', 'submitted', 'confirmed', 'failed', 'rejected'));

alter table public.reward_claims
  add column if not exists risk_score integer not null default 0 check (risk_score >= 0),
  add column if not exists risk_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_reasons) = 'array'),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

drop index if exists reward_claims_one_inflight_per_user;
create unique index reward_claims_one_inflight_per_user
  on public.reward_claims (user_id)
  where status in ('pending', 'pending_review', 'submitted');

create table if not exists public.abuse_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('submission_init', 'reward_claim')),
  user_id uuid references public.users(id) on delete cascade,
  wallet_address text,
  ip_hash text,
  user_agent_hash text,
  turnstile_required boolean not null default false,
  turnstile_passed boolean,
  risk_score integer not null default 0 check (risk_score >= 0),
  risk_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_reasons) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint abuse_events_wallet_lowercase check (wallet_address is null or wallet_address = lower(wallet_address))
);

create index if not exists abuse_events_created_at_idx
  on public.abuse_events (created_at desc);

create index if not exists abuse_events_wallet_created_at_idx
  on public.abuse_events (wallet_address, created_at desc)
  where wallet_address is not null;

create index if not exists abuse_events_ip_created_at_idx
  on public.abuse_events (ip_hash, created_at desc)
  where ip_hash is not null;

create index if not exists abuse_events_user_agent_created_at_idx
  on public.abuse_events (user_agent_hash, created_at desc)
  where user_agent_hash is not null;

alter table public.abuse_events enable row level security;
revoke all on table public.abuse_events from anon, authenticated;

create or replace function public.bb_user_points_locked(user_id uuid)
returns integer as $$
  select coalesce(sum(points_claimed), 0)::integer
  from public.reward_claims
  where reward_claims.user_id = $1
    and reward_claims.status in ('pending', 'pending_review', 'submitted', 'confirmed');
$$ language sql stable;

create or replace function public.bb_reward_claim_source_submissions(user_id uuid)
returns setof public.receipt_submissions as $$
  select s.*
  from public.receipt_submissions s
  where s.user_id = $1
    and s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'pending_review', 'submitted', 'confirmed')
    )
  order by s.created_at asc;
$$ language sql stable;
