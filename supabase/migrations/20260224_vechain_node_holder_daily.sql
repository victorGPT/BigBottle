-- VeChain Node Holder Daily Snapshot (Phase 3)
-- Purpose:
-- Persist daily snapshots of real VeChain Node NFT ownership
-- using on-chain read APIs (call.api.vechain.energy).

create table if not exists public.vechain_node_holder_daily (
  id bigserial primary key,
  snapshot_date date not null,
  token_id bigint not null check (token_id > 0),
  owner_address text not null,
  node_level integer not null check (node_level > 0),
  is_x boolean not null,
  source text not null default 'call.api.vechain.energy',
  contract_address text not null default '0xb81e9c5f9644dec9e5e3cac86b4461a222072302',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vechain_node_holder_daily_owner_lowercase check (owner_address = lower(owner_address)),
  constraint vechain_node_holder_daily_contract_lowercase check (contract_address = lower(contract_address))
);

create unique index if not exists vechain_node_holder_daily_snapshot_contract_token_key
  on public.vechain_node_holder_daily (snapshot_date, contract_address, token_id);

create index if not exists vechain_node_holder_daily_snapshot_idx
  on public.vechain_node_holder_daily (snapshot_date);

create index if not exists vechain_node_holder_daily_owner_idx
  on public.vechain_node_holder_daily (owner_address);

create index if not exists vechain_node_holder_daily_level_idx
  on public.vechain_node_holder_daily (node_level);

create or replace view public.vechain_node_holder_latest as
select distinct on (contract_address, token_id)
  token_id,
  owner_address,
  node_level,
  is_x,
  contract_address,
  snapshot_date,
  synced_at
from public.vechain_node_holder_daily
order by contract_address, token_id, snapshot_date desc;

drop trigger if exists set_vechain_node_holder_daily_updated_at on public.vechain_node_holder_daily;
create trigger set_vechain_node_holder_daily_updated_at
before update on public.vechain_node_holder_daily
for each row execute function public.set_updated_at();
