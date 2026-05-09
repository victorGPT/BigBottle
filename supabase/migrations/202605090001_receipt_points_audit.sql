alter table if exists public.receipt_submissions
  add column if not exists points_base integer not null default 0,
  add column if not exists points_multiplier numeric(12, 4) not null default 1,
  add column if not exists points_bonus_sources jsonb not null default '[]'::jsonb;

drop trigger if exists set_receipt_submissions_updated_at on public.receipt_submissions;

update public.receipt_submissions
set
  points_base = points_total,
  points_multiplier = 1,
  points_bonus_sources = case
    when points_total > 0 then '[{"type":"legacy_points_total","multiplier":1}]'::jsonb
    else '[]'::jsonb
  end
where points_base = 0
  and points_multiplier = 1
  and points_bonus_sources = '[]'::jsonb
  and points_total > 0;

create trigger set_receipt_submissions_updated_at
before update on public.receipt_submissions
for each row execute function public.set_updated_at();

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_points_base_nonnegative,
  add constraint receipt_submissions_points_base_nonnegative check (points_base >= 0) not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_points_base_nonnegative;

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_points_multiplier_valid,
  add constraint receipt_submissions_points_multiplier_valid check (points_multiplier >= 1) not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_points_multiplier_valid;

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_points_bonus_sources_array,
  add constraint receipt_submissions_points_bonus_sources_array check (jsonb_typeof(points_bonus_sources) = 'array') not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_points_bonus_sources_array;
