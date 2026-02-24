-- VeBetterDAO ThorNode daily sync (owner + level only)
-- Scope locked to VeBetterDAO thorNodes; delegation is intentionally ignored.

create table if not exists public.vebetter_node_current (
  identifier bigint primary key,
  owner_address text not null,
  level integer not null,
  is_x boolean not null,
  sync_block_number bigint not null,
  sync_run_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint vebetter_node_current_owner_lowercase check (owner_address = lower(owner_address)),
  constraint vebetter_node_current_level_non_negative check (level >= 0)
);

create index if not exists vebetter_node_current_owner_idx
  on public.vebetter_node_current (owner_address);

create index if not exists vebetter_node_current_sync_block_idx
  on public.vebetter_node_current (sync_block_number desc);

create table if not exists public.vebetter_node_snapshot_daily (
  snapshot_date date not null,
  identifier bigint not null,
  owner_address text not null,
  level integer not null,
  is_x boolean not null,
  sync_block_number bigint not null,
  sync_run_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (snapshot_date, identifier),
  constraint vebetter_node_snapshot_daily_owner_lowercase check (owner_address = lower(owner_address)),
  constraint vebetter_node_snapshot_daily_level_non_negative check (level >= 0)
);

create index if not exists vebetter_node_snapshot_daily_identifier_idx
  on public.vebetter_node_snapshot_daily (identifier);

create index if not exists vebetter_node_snapshot_daily_owner_idx
  on public.vebetter_node_snapshot_daily (owner_address);

create index if not exists vebetter_node_snapshot_daily_sync_block_idx
  on public.vebetter_node_snapshot_daily (sync_block_number desc);

create or replace function public.bb_upsert_vebetter_node_current(
  p_identifier bigint,
  p_owner_address text,
  p_level integer,
  p_is_x boolean,
  p_sync_block_number bigint,
  p_sync_run_id uuid
)
returns void
language plpgsql
as $$
declare
  v_owner text;
begin
  if p_identifier is null or p_identifier <= 0 then
    raise exception 'p_identifier must be > 0';
  end if;

  v_owner := lower(trim(coalesce(p_owner_address, '')));
  if v_owner = '' or v_owner = '0x0000000000000000000000000000000000000000' then
    raise exception 'p_owner_address must be a non-zero address';
  end if;

  if p_level is null or p_level < 0 then
    raise exception 'p_level must be >= 0';
  end if;

  if p_sync_block_number is null or p_sync_block_number <= 0 then
    raise exception 'p_sync_block_number must be > 0';
  end if;

  if p_sync_run_id is null then
    raise exception 'p_sync_run_id is required';
  end if;

  insert into public.vebetter_node_current (
    identifier,
    owner_address,
    level,
    is_x,
    sync_block_number,
    sync_run_id,
    updated_at
  )
  values (
    p_identifier,
    v_owner,
    p_level,
    p_is_x,
    p_sync_block_number,
    p_sync_run_id,
    now()
  )
  on conflict (identifier)
  do update set
    owner_address = excluded.owner_address,
    level = excluded.level,
    is_x = excluded.is_x,
    sync_block_number = excluded.sync_block_number,
    sync_run_id = excluded.sync_run_id,
    updated_at = now();
end;
$$;

create or replace function public.bb_upsert_vebetter_node_snapshot_daily(
  p_snapshot_date date,
  p_identifier bigint,
  p_owner_address text,
  p_level integer,
  p_is_x boolean,
  p_sync_block_number bigint,
  p_sync_run_id uuid
)
returns void
language plpgsql
as $$
declare
  v_owner text;
  v_snapshot_date date;
begin
  v_snapshot_date := coalesce(p_snapshot_date, current_date);

  if p_identifier is null or p_identifier <= 0 then
    raise exception 'p_identifier must be > 0';
  end if;

  v_owner := lower(trim(coalesce(p_owner_address, '')));
  if v_owner = '' or v_owner = '0x0000000000000000000000000000000000000000' then
    raise exception 'p_owner_address must be a non-zero address';
  end if;

  if p_level is null or p_level < 0 then
    raise exception 'p_level must be >= 0';
  end if;

  if p_sync_block_number is null or p_sync_block_number <= 0 then
    raise exception 'p_sync_block_number must be > 0';
  end if;

  if p_sync_run_id is null then
    raise exception 'p_sync_run_id is required';
  end if;

  insert into public.vebetter_node_snapshot_daily (
    snapshot_date,
    identifier,
    owner_address,
    level,
    is_x,
    sync_block_number,
    sync_run_id,
    updated_at
  )
  values (
    v_snapshot_date,
    p_identifier,
    v_owner,
    p_level,
    p_is_x,
    p_sync_block_number,
    p_sync_run_id,
    now()
  )
  on conflict (snapshot_date, identifier)
  do update set
    owner_address = excluded.owner_address,
    level = excluded.level,
    is_x = excluded.is_x,
    sync_block_number = excluded.sync_block_number,
    sync_run_id = excluded.sync_run_id,
    updated_at = now();
end;
$$;

create or replace function public.bb_finalize_vebetter_node_current_sync(
  p_sync_run_id uuid
)
returns bigint
language plpgsql
as $$
declare
  v_deleted bigint;
begin
  if p_sync_run_id is null then
    raise exception 'p_sync_run_id is required';
  end if;

  delete from public.vebetter_node_current c
  where c.sync_run_id <> p_sync_run_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
