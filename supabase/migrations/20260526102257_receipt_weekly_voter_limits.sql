-- BigBottle: enforce voter daily receipt limits and non-voter weekly receipt limits.
--
-- Product rules:
-- - VeBetterDAO voters can upload at most 2 receipts per UTC day and can have
--   at most 1 successful verified receipt per UTC day.
-- - Non-voters can upload at most 2 receipts per UTC week and can have at most
--   2 successful verified receipts per UTC week.
-- - Upload limits count every receipt submission attempt, including failures.

create or replace function public.bb_enforce_daily_receipt_submission_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day_start timestamptz;
  day_end timestamptz;
  week_start timestamptz;
  week_end timestamptz;
  quota_start timestamptz;
  quota_end timestamptz;
  upload_count integer;
  verified_count integer;
  is_voter boolean;
begin
  day_start := date_trunc('day', new.created_at at time zone 'UTC') at time zone 'UTC';
  day_end := day_start + interval '1 day';
  week_start := date_trunc('week', new.created_at at time zone 'UTC') at time zone 'UTC';
  week_end := week_start + interval '7 days';

  select exists (
    select 1
    from public.bigbottle_vote_bonus_eligibility e
    join public.users u on u.id = new.user_id
    where e.bonus_type = 'vebetter_vote_bonus'
      and e.status = 'eligible'
      and (e.user_id = new.user_id or e.passport_address = u.wallet_address)
  ) into is_voter;

  if is_voter then
    quota_start := day_start;
    quota_end := day_end;
  else
    quota_start := week_start;
    quota_end := week_end;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.user_id::text || ':' || to_char(quota_start, 'YYYY-MM-DD') || ':receipt_submissions',
      0
    )
  );

  if tg_op = 'INSERT' then
    select count(*) into upload_count
    from public.receipt_submissions
    where user_id = new.user_id
      and created_at >= quota_start
      and created_at < quota_end;

    if is_voter and upload_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'daily_upload_limit_exceeded';
    end if;

    if not is_voter and upload_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'weekly_upload_limit_exceeded';
    end if;
  end if;

  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select count(*) into verified_count
    from public.receipt_submissions
    where user_id = new.user_id
      and status = 'verified'
      and created_at >= quota_start
      and created_at < quota_end
      and id <> new.id;

    if is_voter and verified_count >= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'daily_verified_limit_exceeded';
    end if;

    if not is_voter and verified_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'weekly_verified_limit_exceeded';
    end if;
  end if;

  return new;
end;
$$;
