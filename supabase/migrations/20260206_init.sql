-- BigBottle MVP (Phase 1): Users, Auth Challenges, Receipt Submissions

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  created_at timestamptz not null default now(),
  constraint users_wallet_address_lowercase check (wallet_address = lower(wallet_address))
);

create table if not exists public.auth_challenges (
  id uuid primary key,
  wallet_address text not null,
  nonce text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_challenges_wallet_address_lowercase check (wallet_address = lower(wallet_address))
);

create index if not exists auth_challenges_wallet_address_idx on public.auth_challenges (wallet_address);
create index if not exists auth_challenges_expires_at_idx on public.auth_challenges (expires_at);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.receipt_submissions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  client_submission_id text not null,
  status text not null,
  image_bucket text not null,
  image_key text not null,
  image_content_type text,
  dify_raw jsonb,
  dify_drink_list jsonb,
  receipt_time_raw text,
  retinfo_is_availd text,
  time_threshold text,
  points_total integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists receipt_submissions_user_client_submission_id_key
  on public.receipt_submissions (user_id, client_submission_id);

create index if not exists receipt_submissions_user_id_created_at_idx
  on public.receipt_submissions (user_id, created_at desc);

drop trigger if exists set_receipt_submissions_updated_at on public.receipt_submissions;
create trigger set_receipt_submissions_updated_at
before update on public.receipt_submissions
for each row execute function public.set_updated_at();

