-- BigBottle: make receipt fingerprint hashing work when pgcrypto lives in the extensions schema.

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
      || '|'
      || coalesce(nullif(regexp_replace(coalesce(item->>'retinfoDrinkCapacity', ''), '[^0-9]', '', 'g'), ''), '0')
      || '|'
      || coalesce(nullif(regexp_replace(coalesce(item->>'retinfoDrinkAmount', ''), '[^0-9]', '', 'g'), ''), '1')
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
  else encode(extensions.digest((select v from payload), 'sha256'), 'hex')
end;
$$ language sql immutable;
