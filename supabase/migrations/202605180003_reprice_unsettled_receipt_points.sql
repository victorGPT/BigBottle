with unsettled_verified as (
  select
    s.id,
    least(s.points_base, 20)::integer as capped_base,
    floor((least(s.points_base, 20)::numeric * s.points_multiplier))::integer as capped_total
  from public.receipt_submissions s
  where s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'submitted', 'confirmed')
    )
    and (
      s.points_base > 20
      or s.points_total <> floor((least(s.points_base, 20)::numeric * s.points_multiplier))::integer
    )
)
update public.receipt_submissions s
set
  points_base = unsettled_verified.capped_base,
  points_total = unsettled_verified.capped_total
from unsettled_verified
where s.id = unsettled_verified.id;
