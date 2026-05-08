-- BigBottle: production receipt limits and B3TR conversion rate.
--
-- Product rules:
-- - 1 point = 0.01 B3TR, stored as 100 points = 1 B3TR.
-- - Each user can create at most 6 receipt upload attempts per UTC day.
-- - Each user can have at most 3 successful verified receipts per UTC day.

update public.reward_conversion_rates
set points_per_b3tr = 100
where active;

insert into public.reward_conversion_rates (points_per_b3tr, active)
select 100, true
where not exists (select 1 from public.reward_conversion_rates where active);

create or replace function public.bb_enforce_daily_receipt_submission_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day_start timestamptz;
  day_end timestamptz;
  daily_total integer;
  daily_verified integer;
begin
  day_start := date_trunc('day', new.created_at at time zone 'UTC') at time zone 'UTC';
  day_end := day_start + interval '1 day';

  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || to_char(day_start, 'YYYY-MM-DD') || ':receipt_submissions', 0)
  );

  if tg_op = 'INSERT' then
    select count(*) into daily_total
    from public.receipt_submissions
    where user_id = new.user_id
      and created_at >= day_start
      and created_at < day_end;

    if daily_total >= 6 then
      raise exception using
        errcode = 'P0001',
        message = 'daily_upload_limit_exceeded';
    end if;
  end if;

  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select count(*) into daily_verified
    from public.receipt_submissions
    where user_id = new.user_id
      and status = 'verified'
      and created_at >= day_start
      and created_at < day_end
      and id <> new.id;

    if daily_verified >= 3 then
      raise exception using
        errcode = 'P0001',
        message = 'daily_verified_limit_exceeded';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_daily_receipt_submission_limits on public.receipt_submissions;
create trigger enforce_daily_receipt_submission_limits
before insert or update of status on public.receipt_submissions
for each row
execute function public.bb_enforce_daily_receipt_submission_limits();
