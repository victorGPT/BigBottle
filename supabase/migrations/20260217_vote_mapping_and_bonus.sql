-- BigBottle Voting Mapping (Phase 2)
-- Purpose:
-- 1) Persist VeBetterDAO vote wallet mapping (voter -> passport) by round.
-- 2) Persist BigBottle bonus eligibility using "round N vote => round N+1 bonus".

create table if not exists public.vote_wallet_mapping (
  id bigserial primary key,
  round_id bigint not null check (round_id > 0),
  voter_address text not null,
  passport_address text not null,
  user_id uuid references public.users(id) on delete set null,
  is_delegated boolean generated always as (voter_address <> passport_address) stored,
  voted_any_app boolean not null default true,
  voted_bigbottle boolean not null default false,
  apps_voted_count integer not null default 0 check (apps_voted_count >= 0),
  first_vote_at timestamptz,
  last_vote_at timestamptz,
  source text not null default 'vebetter_subgraph',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vote_wallet_mapping_voter_lowercase check (voter_address = lower(voter_address)),
  constraint vote_wallet_mapping_passport_lowercase check (passport_address = lower(passport_address))
);

create unique index if not exists vote_wallet_mapping_round_passport_voter_key
  on public.vote_wallet_mapping (round_id, passport_address, voter_address);

create index if not exists vote_wallet_mapping_round_passport_idx
  on public.vote_wallet_mapping (round_id, passport_address);

create index if not exists vote_wallet_mapping_round_voter_idx
  on public.vote_wallet_mapping (round_id, voter_address);

create index if not exists vote_wallet_mapping_user_id_idx
  on public.vote_wallet_mapping (user_id);

create index if not exists vote_wallet_mapping_is_delegated_idx
  on public.vote_wallet_mapping (is_delegated)
  where is_delegated = true;


create table if not exists public.bigbottle_vote_bonus_eligibility (
  id bigserial primary key,
  effective_round_id bigint not null check (effective_round_id > 0),
  source_round_id bigint not null check (source_round_id > 0),
  passport_address text not null,
  user_id uuid references public.users(id) on delete set null,
  bonus_type text not null default 'vebetter_vote_bonus',
  bonus_multiplier numeric(8,4) not null default 1.0000 check (bonus_multiplier >= 1.0000),
  status text not null default 'eligible',
  source text not null default 'vebetter_subgraph',
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bigbottle_vote_bonus_eligibility_passport_lowercase check (passport_address = lower(passport_address)),
  constraint bigbottle_vote_bonus_round_order check (effective_round_id > source_round_id)
);

create unique index if not exists bigbottle_vote_bonus_eligibility_effective_passport_type_key
  on public.bigbottle_vote_bonus_eligibility (effective_round_id, passport_address, bonus_type);

create index if not exists bigbottle_vote_bonus_eligibility_user_round_idx
  on public.bigbottle_vote_bonus_eligibility (user_id, effective_round_id);

create index if not exists bigbottle_vote_bonus_eligibility_passport_round_idx
  on public.bigbottle_vote_bonus_eligibility (passport_address, effective_round_id);

create index if not exists bigbottle_vote_bonus_eligibility_status_idx
  on public.bigbottle_vote_bonus_eligibility (status);


-- Keep user_id in sync by matching users.wallet_address = passport_address.
create or replace function public.bb_refresh_vote_mapping_user_ids(target_round_id bigint default null)
returns integer
language plpgsql
as $$
declare
  affected integer := 0;
begin
  with updated as (
    update public.vote_wallet_mapping m
    set
      user_id = u.id,
      updated_at = now()
    from public.users u
    where m.passport_address = u.wallet_address
      and (target_round_id is null or m.round_id = target_round_id)
      and m.user_id is distinct from u.id
    returning 1
  )
  select count(*) into affected from updated;

  return affected;
end;
$$;

create or replace function public.bb_refresh_bonus_eligibility_user_ids(target_effective_round_id bigint default null)
returns integer
language plpgsql
as $$
declare
  affected integer := 0;
begin
  with updated as (
    update public.bigbottle_vote_bonus_eligibility e
    set
      user_id = u.id,
      updated_at = now()
    from public.users u
    where e.passport_address = u.wallet_address
      and (target_effective_round_id is null or e.effective_round_id = target_effective_round_id)
      and e.user_id is distinct from u.id
    returning 1
  )
  select count(*) into affected from updated;

  return affected;
end;
$$;


-- Idempotent upsert helper for round-level wallet mapping.
create or replace function public.bb_upsert_vote_wallet_mapping(
  p_round_id bigint,
  p_voter_address text,
  p_passport_address text,
  p_voted_bigbottle boolean default false,
  p_apps_voted_count integer default 1,
  p_vote_at timestamptz default now(),
  p_source text default 'vebetter_subgraph'
)
returns public.vote_wallet_mapping
language plpgsql
as $$
declare
  v_voter text;
  v_passport text;
  rec public.vote_wallet_mapping;
begin
  if p_round_id is null or p_round_id <= 0 then
    raise exception 'p_round_id must be > 0';
  end if;

  if p_apps_voted_count is null or p_apps_voted_count < 0 then
    raise exception 'p_apps_voted_count must be >= 0';
  end if;

  v_voter := lower(trim(coalesce(p_voter_address, '')));
  v_passport := lower(trim(coalesce(p_passport_address, '')));

  if v_voter = '' then
    raise exception 'p_voter_address must not be empty';
  end if;

  if v_passport = '' then
    raise exception 'p_passport_address must not be empty';
  end if;

  insert into public.vote_wallet_mapping (
    round_id,
    voter_address,
    passport_address,
    user_id,
    voted_any_app,
    voted_bigbottle,
    apps_voted_count,
    first_vote_at,
    last_vote_at,
    source
  )
  values (
    p_round_id,
    v_voter,
    v_passport,
    (select u.id from public.users u where u.wallet_address = v_passport limit 1),
    true,
    coalesce(p_voted_bigbottle, false),
    p_apps_voted_count,
    p_vote_at,
    p_vote_at,
    coalesce(nullif(trim(p_source), ''), 'vebetter_subgraph')
  )
  on conflict (round_id, passport_address, voter_address)
  do update set
    user_id = coalesce(public.vote_wallet_mapping.user_id, excluded.user_id),
    voted_any_app = true,
    voted_bigbottle = public.vote_wallet_mapping.voted_bigbottle or excluded.voted_bigbottle,
    apps_voted_count = greatest(public.vote_wallet_mapping.apps_voted_count, excluded.apps_voted_count),
    first_vote_at = case
      when public.vote_wallet_mapping.first_vote_at is null then excluded.first_vote_at
      when excluded.first_vote_at is null then public.vote_wallet_mapping.first_vote_at
      else least(public.vote_wallet_mapping.first_vote_at, excluded.first_vote_at)
    end,
    last_vote_at = case
      when public.vote_wallet_mapping.last_vote_at is null then excluded.last_vote_at
      when excluded.last_vote_at is null then public.vote_wallet_mapping.last_vote_at
      else greatest(public.vote_wallet_mapping.last_vote_at, excluded.last_vote_at)
    end,
    source = excluded.source,
    updated_at = now()
  returning * into rec;

  return rec;
end;
$$;


-- Create/refresh bonus eligibility using "source round => next round" model.
create or replace function public.bb_generate_vote_bonus_eligibility(
  p_source_round_id bigint,
  p_effective_round_id bigint default null,
  p_bonus_type text default 'vebetter_vote_bonus',
  p_bonus_multiplier numeric default 1.0000,
  p_source text default 'vebetter_subgraph'
)
returns integer
language plpgsql
as $$
declare
  v_effective_round_id bigint;
  affected integer := 0;
begin
  if p_source_round_id is null or p_source_round_id <= 0 then
    raise exception 'p_source_round_id must be > 0';
  end if;

  v_effective_round_id := coalesce(p_effective_round_id, p_source_round_id + 1);

  if v_effective_round_id <= p_source_round_id then
    raise exception 'effective round (%) must be greater than source round (%)', v_effective_round_id, p_source_round_id;
  end if;

  with src as (
    select distinct
      m.passport_address,
      u.id as user_id
    from public.vote_wallet_mapping m
    left join public.users u on u.wallet_address = m.passport_address
    where m.round_id = p_source_round_id
      and m.voted_any_app = true
  ), upserted as (
    insert into public.bigbottle_vote_bonus_eligibility (
      effective_round_id,
      source_round_id,
      passport_address,
      user_id,
      bonus_type,
      bonus_multiplier,
      status,
      source,
      computed_at
    )
    select
      v_effective_round_id,
      p_source_round_id,
      s.passport_address,
      s.user_id,
      p_bonus_type,
      p_bonus_multiplier,
      'eligible',
      p_source,
      now()
    from src s
    on conflict (effective_round_id, passport_address, bonus_type)
    do update set
      source_round_id = excluded.source_round_id,
      user_id = coalesce(excluded.user_id, public.bigbottle_vote_bonus_eligibility.user_id),
      bonus_multiplier = excluded.bonus_multiplier,
      status = 'eligible',
      source = excluded.source,
      computed_at = now(),
      updated_at = now()
    returning 1
  )
  select count(*) into affected from upserted;

  return affected;
end;
$$;


drop trigger if exists set_vote_wallet_mapping_updated_at on public.vote_wallet_mapping;
create trigger set_vote_wallet_mapping_updated_at
before update on public.vote_wallet_mapping
for each row execute function public.set_updated_at();


drop trigger if exists set_bigbottle_vote_bonus_eligibility_updated_at on public.bigbottle_vote_bonus_eligibility;
create trigger set_bigbottle_vote_bonus_eligibility_updated_at
before update on public.bigbottle_vote_bonus_eligibility
for each row execute function public.set_updated_at();
