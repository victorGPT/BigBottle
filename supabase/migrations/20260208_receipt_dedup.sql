-- BigBottle Anti-Cheat (Phase 1): Receipt dedup via fingerprint (minute + drink list)

-- Columns
alter table if exists public.receipt_submissions
  add column if not exists receipt_fingerprint text;

alter table if exists public.receipt_submissions
  add column if not exists rejection_code text;

alter table if exists public.receipt_submissions
  add column if not exists duplicate_of uuid references public.receipt_submissions(id);

create index if not exists receipt_submissions_receipt_fingerprint_idx
  on public.receipt_submissions (receipt_fingerprint);

-- Fingerprint function (v1)
-- Returns sha256 hex for: v1|YYYY-MM-DD HH:mm|<sorted_item_tokens>
-- Item token: <normalized_name>|<capacity_int>|<amount_int>
create or replace function public.bb_receipt_fingerprint(receipt_time_raw text, dify_drink_list jsonb)
returns text as $$
with
  time_minute as (
    select case
      when receipt_time_raw is null then null
      when length(trim(receipt_time_raw)) < 16 then null
      else left(trim(receipt_time_raw), 16)
    end as v
  ),
  items as (
    select
      regexp_replace(lower(trim(coalesce(item->>'retinfoDrinkName', ''))), '\s+', ' ', 'g')
      || '|' ||
      coalesce(nullif(regexp_replace(coalesce(item->>'retinfoDrinkCapacity', ''), '[^0-9]', '', 'g'), ''), '0')
      || '|' ||
      coalesce(nullif(regexp_replace(coalesce(item->>'retinfoDrinkAmount', ''), '[^0-9]', '', 'g'), ''), '1')
      as token
    from jsonb_array_elements(coalesce(dify_drink_list, '[]'::jsonb)) as item
  ),
  payload as (
    select
      'v1|'
      || (select v from time_minute)
      || '|'
      || coalesce((select string_agg(token, '||' order by token) from items), '')
      as v
  )
select case
  when (select v from time_minute) is null then null
  else encode(digest((select v from payload), 'sha256'), 'hex')
end;
$$ language sql immutable;

-- Backfill: assign fingerprint to the first row per fingerprint group for existing verified submissions.
-- This keeps the migration resilient even if historical duplicates exist.
with candidates as (
  select
    id,
    public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list) as fp,
    created_at,
    row_number() over (
      partition by public.bb_receipt_fingerprint(receipt_time_raw, dify_drink_list)
      order by created_at asc, id asc
    ) as rn
  from public.receipt_submissions
  where status = 'verified'
    and points_total > 0
    and receipt_time_raw is not null
    and dify_drink_list is not null
)
update public.receipt_submissions s
set receipt_fingerprint = c.fp
from candidates c
where s.id = c.id
  and c.fp is not null
  and c.rn = 1
  and s.receipt_fingerprint is null;

-- Enforce global uniqueness for verified receipts
create unique index if not exists receipt_submissions_verified_receipt_fingerprint_key
  on public.receipt_submissions (receipt_fingerprint)
  where status = 'verified' and receipt_fingerprint is not null;

