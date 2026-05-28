-- BigBottle: wallet blacklist for fraud/farmer enforcement.

create table if not exists public.wallet_blacklist (
  wallet_address text primary key,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'system',
  constraint wallet_blacklist_wallet_address_lowercase check (wallet_address = lower(wallet_address))
);

alter table public.wallet_blacklist enable row level security;
revoke all on table public.wallet_blacklist from anon, authenticated;

insert into public.wallet_blacklist (wallet_address, reason, created_by)
values (
  '0x7e5abb955ccacd9d2c686f6153bf3756bb327177',
  'farmer_suspected_no_vebetter_vote_bonus_eligibility',
  'codex:2026-05-28'
)
on conflict (wallet_address) do update
set reason = excluded.reason,
    created_by = excluded.created_by;
