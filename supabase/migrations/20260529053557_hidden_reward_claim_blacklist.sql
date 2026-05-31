-- BigBottle: hidden reward-claim blacklist for wallets that exploited receipt timestamp duplicates.

create table if not exists public.reward_claim_blacklist (
  wallet_address text primary key,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'system',
  constraint reward_claim_blacklist_wallet_address_lowercase check (wallet_address = lower(wallet_address))
);

alter table public.reward_claim_blacklist enable row level security;
revoke all on table public.reward_claim_blacklist from anon, authenticated;

with normalized as (
  select
    s.id,
    u.wallet_address,
    s.status,
    s.rejection_code,
    s.points_total,
    s.created_at,
    public.bb_receipt_time_second(s.receipt_time_raw) as receipt_second
  from public.receipt_submissions s
  join public.users u on u.id = s.user_id
  where public.bb_receipt_time_second(s.receipt_time_raw) is not null
    and (
      (s.status = 'verified' and s.points_total > 0)
      or (s.status = 'rejected' and s.rejection_code = 'duplicate_receipt_time')
    )
),
ranked_verified as (
  select
    *,
    count(*) over (partition by receipt_second) as group_count,
    row_number() over (partition by receipt_second order by created_at asc, id asc) as row_rank
  from normalized
  where status = 'verified'
    and points_total > 0
),
exploit_wallets as (
  select wallet_address
  from ranked_verified
  where group_count > 1
    and row_rank > 1
  union
  select wallet_address
  from normalized
  where status = 'rejected'
    and rejection_code = 'duplicate_receipt_time'
)
insert into public.reward_claim_blacklist (wallet_address, reason, created_by)
select
  wallet_address,
  'receipt_time_duplicate_exploit',
  'codex:2026-05-29'
from exploit_wallets
on conflict (wallet_address) do update
set reason = excluded.reason,
    created_by = excluded.created_by;

create or replace function public.bb_is_reward_claim_blacklisted(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    join public.reward_claim_blacklist b on b.wallet_address = u.wallet_address
    where u.id = p_user_id
  );
$$;

create or replace function public.bb_user_points_locked(user_id uuid)
returns integer
language sql
stable
as $$
  select case
    when public.bb_is_reward_claim_blacklisted($1) then public.bb_user_points_total($1)
    else (
      select coalesce(sum(points_claimed), 0)::integer
      from public.reward_claims
      where reward_claims.user_id = $1
        and reward_claims.status in ('pending','submitted','confirmed')
    )
  end;
$$;

create or replace function public.bb_reward_claim_source_submissions(user_id uuid)
returns setof public.receipt_submissions
language sql
stable
as $$
  select s.*
  from public.receipt_submissions s
  where public.bb_is_reward_claim_blacklisted($1) = false
    and s.user_id = $1
    and s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'submitted', 'confirmed')
    )
  order by s.created_at asc;
$$;

create or replace function public.bb_reject_reward_claim_blacklisted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.reward_claim_blacklist b
    where b.wallet_address = new.wallet_address
  ) then
    raise exception 'no_claimable_points' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_reward_claim_blacklisted on public.reward_claims;
create trigger reject_reward_claim_blacklisted
before insert
on public.reward_claims
for each row
when (new.status in ('pending', 'submitted', 'confirmed'))
execute function public.bb_reject_reward_claim_blacklisted();
