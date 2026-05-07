-- BigBottle: enable additive receipt point bonuses for vote users and GM-NFT holders.

update public.achievement_definitions
set
  base_multiplier = 10.0000,
  updated_at = now(),
  updated_by = 'migration:20260508_bonus_multiplier_10x'
where key in ('vebetter_vote_bonus', 'gm_nft');

update public.bigbottle_vote_bonus_eligibility
set
  bonus_multiplier = greatest(bonus_multiplier, 10.0000),
  updated_at = now()
where bonus_type = 'vebetter_vote_bonus';

create or replace function public.bb_generate_vote_bonus_eligibility(
  p_source_round_id bigint,
  p_effective_round_id bigint default null,
  p_bonus_type text default 'vebetter_vote_bonus',
  p_bonus_multiplier numeric default 10.0000,
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
      computed_at = excluded.computed_at,
      updated_at = now()
    returning 1
  )
  select count(*) into affected from upserted;

  return affected;
end $$;
