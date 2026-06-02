-- BigBottle: receipt timestamp duplicates only count when receipt content matches too.

create index if not exists receipt_submissions_receipt_second_fingerprint_verified_idx
  on public.receipt_submissions (
    public.bb_receipt_time_second(receipt_time_raw),
    public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list),
    created_at,
    id
  )
  where status = 'verified'
    and public.bb_receipt_time_second(receipt_time_raw) is not null
    and public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list) is not null;

create or replace function public.bb_reject_duplicate_receipt_time_second()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_second text;
  computed_receipt_fingerprint text;
  winner_id uuid;
begin
  if new.status <> 'verified' then
    return new;
  end if;

  receipt_second := public.bb_receipt_time_second(new.receipt_time_raw);
  computed_receipt_fingerprint := public.bb_receipt_fingerprint(new.receipt_time_raw, new.dify_drink_list);
  if receipt_second is null or computed_receipt_fingerprint is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(receipt_second || ':' || computed_receipt_fingerprint || ':receipt_time_content', 0)
  );

  select s.id
    into winner_id
  from public.receipt_submissions s
  where s.status = 'verified'
    and s.id <> new.id
    and public.bb_receipt_time_second(s.receipt_time_raw) = receipt_second
    and public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) = computed_receipt_fingerprint
  order by s.created_at asc, s.id asc
  limit 1;

  if winner_id is not null then
    new.status := 'rejected';
    new.points_base := 0;
    new.points_multiplier := 1;
    new.points_bonus_sources := '[]'::jsonb;
    new.points_total := 0;
    new.rejection_code := 'duplicate_receipt_time';
    new.duplicate_of := winner_id;
    new.verified_at := coalesce(new.verified_at, now());
  end if;

  return new;
end;
$$;

with normalized as (
  select
    s.id,
    u.wallet_address,
    s.status,
    s.rejection_code,
    s.points_total,
    s.created_at,
    public.bb_receipt_time_second(s.receipt_time_raw) as receipt_second,
    public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) as receipt_fingerprint
  from public.receipt_submissions s
  join public.users u on u.id = s.user_id
  where public.bb_receipt_time_second(s.receipt_time_raw) is not null
    and public.bb_receipt_fingerprint(s.receipt_time_raw, s.dify_drink_list) is not null
    and (
      (s.status = 'verified' and s.points_total > 0)
      or (s.status = 'rejected' and s.rejection_code = 'duplicate_receipt_time')
    )
),
ranked_verified as (
  select
    *,
    count(*) over (partition by receipt_second, receipt_fingerprint) as group_count,
    row_number() over (
      partition by receipt_second, receipt_fingerprint
      order by created_at asc, id asc
    ) as row_rank
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
  select n.wallet_address
  from normalized n
  where n.status = 'rejected'
    and n.rejection_code = 'duplicate_receipt_time'
    and exists (
      select 1
      from normalized winner
      where winner.status = 'verified'
        and winner.points_total > 0
        and winner.receipt_second = n.receipt_second
        and winner.receipt_fingerprint = n.receipt_fingerprint
        and winner.id <> n.id
    )
)
delete from public.reward_claim_blacklist b
where b.reason = 'receipt_time_duplicate_exploit'
  and not exists (
    select 1
    from exploit_wallets e
    where e.wallet_address = b.wallet_address
  );
