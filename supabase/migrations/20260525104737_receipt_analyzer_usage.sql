alter table if exists public.receipt_submissions
  add column if not exists analyzer_provider text,
  add column if not exists analyzer_model text,
  add column if not exists analyzer_usage jsonb,
  add column if not exists analyzer_image jsonb;

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_analyzer_provider_valid,
  add constraint receipt_submissions_analyzer_provider_valid
    check (
      analyzer_provider is null
      or analyzer_provider in ('dify', 'gemini', 'siliconflow', 'temporal')
    ) not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_analyzer_provider_valid;

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_analyzer_usage_object,
  add constraint receipt_submissions_analyzer_usage_object
    check (analyzer_usage is null or jsonb_typeof(analyzer_usage) = 'object') not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_analyzer_usage_object;

alter table if exists public.receipt_submissions
  drop constraint if exists receipt_submissions_analyzer_image_object,
  add constraint receipt_submissions_analyzer_image_object
    check (analyzer_image is null or jsonb_typeof(analyzer_image) = 'object') not valid;

alter table if exists public.receipt_submissions
  validate constraint receipt_submissions_analyzer_image_object;

create index if not exists receipt_submissions_analyzer_provider_created_at_idx
  on public.receipt_submissions (analyzer_provider, created_at desc);
