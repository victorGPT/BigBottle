with expected as (
  select distinct passport_address
  from public.vote_wallet_mapping
  where round_id = (__EFFECTIVE_ROUND_ID__::bigint - 1)
    and voted_any_app = true
),
actual as (
  select distinct passport_address
  from public.bigbottle_vote_bonus_eligibility
  where effective_round_id = __EFFECTIVE_ROUND_ID__::bigint
    and bonus_type = 'vebetter_vote_bonus'
    and status = 'eligible'
)
select
  'missing_in_actual'::text as type,
  e.passport_address
from expected e
left join actual a using (passport_address)
where a.passport_address is null
union all
select
  'extra_in_actual'::text as type,
  a.passport_address
from actual a
left join expected e using (passport_address)
where e.passport_address is null
order by type, passport_address;
