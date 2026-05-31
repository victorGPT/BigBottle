-- BigBottle: hidden blacklist for receipt fingerprints shared by 3+ wallet addresses.

create index if not exists receipt_submissions_computed_receipt_fingerprint_idx
  on public.receipt_submissions (
    public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list),
    user_id
  )
  where public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list) is not null;

drop function if exists public.bb_blacklist_shared_receipt_fingerprint(text);

create or replace function public.bb_blacklist_shared_receipt_fingerprint(
  p_receipt_fingerprint text,
  p_current_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  if p_receipt_fingerprint is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_receipt_fingerprint || ':shared_receipt_fingerprint_blacklist', 0)
  );

  with shared_wallets_from_submissions as (
    select distinct lower(u.wallet_address) as wallet_address
    from public.receipt_submissions s
    join public.users u on u.id = s.user_id
    where public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) = p_receipt_fingerprint
      and u.wallet_address is not null
  ),
  current_wallet as (
    select lower(u.wallet_address) as wallet_address
    from public.users u
    where u.id = p_current_user_id
      and u.wallet_address is not null
  ),
  shared_wallets as (
    select wallet_address
    from shared_wallets_from_submissions
    union
    select wallet_address
    from current_wallet
  ),
  qualified as (
    select wallet_address
    from shared_wallets
    where (select count(*) from shared_wallets) >= 3
  ),
  inserted as (
    insert into public.reward_claim_blacklist (wallet_address, reason, created_by)
    select
      wallet_address,
      'shared_receipt_fingerprint_3_wallets',
      'migration:202606010002_three_wallet_receipt_fingerprint_blacklist'
    from qualified
    on conflict (wallet_address) do nothing
    returning 1
  )
  select count(*) into affected from inserted;

  return affected;
end;
$$;

with shared_fingerprints as (
  select public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) as receipt_fingerprint
  from public.receipt_submissions s
  join public.users u on u.id = s.user_id
  where public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) is not null
    and u.wallet_address is not null
  group by public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list)
  having count(distinct lower(u.wallet_address)) >= 3
)
select public.bb_blacklist_shared_receipt_fingerprint(receipt_fingerprint)
from shared_fingerprints;

create or replace function public.bb_blacklist_shared_receipt_fingerprint_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_fingerprint text;
  old_fingerprint text;
begin
  new_fingerprint := public.bb_receipt_fingerprint(new.receipt_time_raw, new.dify_drink_list);
  if tg_op = 'UPDATE' then
    old_fingerprint := public.bb_receipt_fingerprint(old.receipt_time_raw, old.dify_drink_list);
  end if;

  if new_fingerprint is not null then
    perform public.bb_blacklist_shared_receipt_fingerprint(new_fingerprint, new.user_id);
  end if;

  if old_fingerprint is not null and old_fingerprint is distinct from new_fingerprint then
    perform public.bb_blacklist_shared_receipt_fingerprint(old_fingerprint);
  end if;

  return new;
end;
$$;

drop trigger if exists blacklist_shared_receipt_fingerprint on public.receipt_submissions;
create trigger blacklist_shared_receipt_fingerprint
after insert or update of receipt_time_raw, dify_drink_list, user_id
on public.receipt_submissions
for each row
execute function public.bb_blacklist_shared_receipt_fingerprint_trigger();
