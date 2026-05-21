alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_points_base_max,
  add constraint receipt_submissions_points_base_max check (points_base <= 20) not valid;
