-- BigBottle Anti-Cheat: reject repeated receipt timestamps per user at second precision.

create or replace function public.bb_receipt_time_second(receipt_time_raw text)
returns text
language sql
immutable
as $$
with matched as (
  select regexp_match(
    trim(receipt_time_raw),
    '([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})'
  ) as value
)
select case
  when receipt_time_raw is null then null
  when (select value from matched) is null then null
  else replace((select value[1] from matched), 'T', ' ')
end;
$$;

create index if not exists receipt_submissions_user_receipt_time_second_verified_idx
  on public.receipt_submissions (
    user_id,
    public.bb_receipt_time_second(receipt_time_raw),
    created_at,
    id
  )
  where status = 'verified'
    and public.bb_receipt_time_second(receipt_time_raw) is not null;

with ranked as (
  select
    s.id,
    first_value(s.id) over (
      partition by s.user_id, public.bb_receipt_time_second(s.receipt_time_raw)
      order by s.created_at asc, s.id asc
    ) as winner_id,
    row_number() over (
      partition by s.user_id, public.bb_receipt_time_second(s.receipt_time_raw)
      order by s.created_at asc, s.id asc
    ) as row_rank,
    exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'submitted', 'confirmed')
    ) as locked_by_active_claim
  from public.receipt_submissions s
  where s.status = 'verified'
    and s.points_total > 0
    and public.bb_receipt_time_second(s.receipt_time_raw) is not null
)
update public.receipt_submissions s
set
  status = 'rejected',
  points_base = 0,
  points_multiplier = 1,
  points_bonus_sources = '[]'::jsonb,
  points_total = 0,
  rejection_code = 'duplicate_receipt_time',
  duplicate_of = ranked.winner_id,
  verified_at = coalesce(s.verified_at, now())
from ranked
where s.id = ranked.id
  and ranked.row_rank > 1
  and ranked.locked_by_active_claim = false;

create or replace function public.bb_reject_duplicate_receipt_time_second()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_second text;
  winner_id uuid;
begin
  if new.status <> 'verified' then
    return new;
  end if;

  receipt_second := public.bb_receipt_time_second(new.receipt_time_raw);
  if receipt_second is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || receipt_second || ':receipt_time_second', 0)
  );

  select s.id
    into winner_id
  from public.receipt_submissions s
  where s.user_id = new.user_id
    and s.status = 'verified'
    and s.id <> new.id
    and public.bb_receipt_time_second(s.receipt_time_raw) = receipt_second
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

drop trigger if exists reject_duplicate_receipt_time_second on public.receipt_submissions;
create trigger reject_duplicate_receipt_time_second
before insert or update of status, receipt_time_raw, user_id
on public.receipt_submissions
for each row
when (new.status = 'verified')
execute function public.bb_reject_duplicate_receipt_time_second();
