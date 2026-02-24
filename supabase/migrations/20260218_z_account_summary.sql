-- BigBottle (Phase 1): Account summary helpers

-- Total points are derived from verified receipt submissions only.
create or replace function public.bb_user_points_total(user_id uuid)
returns integer as $$
  select coalesce(sum(points_total), 0)::integer
  from public.receipt_submissions
  where receipt_submissions.user_id = $1
    and receipt_submissions.status = 'verified';
$$ language sql stable;
