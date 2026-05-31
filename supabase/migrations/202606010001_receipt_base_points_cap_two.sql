-- BigBottle: cap every receipt's base points at 2.

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_points_base_max,
  add constraint receipt_submissions_points_base_max check (points_base <= 2) not valid;

with unsettled_verified as (
  select
    s.id,
    least(s.points_base, 2)::integer as capped_base,
    floor((least(s.points_base, 2)::numeric * s.points_multiplier))::integer as capped_total
  from public.receipt_submissions s
  where s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'pending_review', 'submitted', 'confirmed')
    )
    and (
      s.points_base > 2
      or s.points_total <> floor((least(s.points_base, 2)::numeric * s.points_multiplier))::integer
    )
)
update public.receipt_submissions s
set
  points_base = unsettled_verified.capped_base,
  points_total = unsettled_verified.capped_total
from unsettled_verified
where s.id = unsettled_verified.id;
