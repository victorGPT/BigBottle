-- BigBottle: make vote/GM-NFT users 100x and cap non-bonus receipts at 2 points.

update public.achievement_definitions
set
  base_multiplier = 100.0000,
  updated_at = now(),
  updated_by = 'migration:20260529_reward_multiplier_100_nonbonus_cap'
where key in ('vebetter_vote_bonus', 'gm_nft');

update public.bigbottle_vote_bonus_eligibility
set
  bonus_multiplier = greatest(bonus_multiplier, 100.0000),
  updated_at = now()
where bonus_type = 'vebetter_vote_bonus';

create or replace function public.bb_generate_vote_bonus_eligibility(
  p_source_round_id bigint,
  p_effective_round_id bigint default null,
  p_bonus_type text default 'vebetter_vote_bonus',
  p_bonus_multiplier numeric default 100.0000,
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

with unsettled_verified as (
  select
    s.id,
    least(s.points_base, 20)::integer as capped_base,
    least(s.points_base, 2)::integer as non_bonus_base,
    (
      s.points_multiplier > 1
      or exists (
        select 1
        from jsonb_array_elements(coalesce(s.points_bonus_sources, '[]'::jsonb)) source
        where source->>'type' in ('vebetter_vote_bonus', 'gm_nft')
      )
      or exists (
        select 1
        from public.bigbottle_vote_bonus_eligibility e
        join public.users u on u.id = s.user_id
        where e.bonus_type = 'vebetter_vote_bonus'
          and e.status = 'eligible'
          and (e.user_id = s.user_id or e.passport_address = u.wallet_address)
      )
    ) as has_bonus_privileges,
    coalesce(
      (
        select jsonb_agg(
          case
            when source->>'type' in ('vebetter_vote_bonus', 'gm_nft')
              then jsonb_set(source, '{multiplier}', '100'::jsonb, true)
            else source
          end
          order by ordinality
        )
        from jsonb_array_elements(coalesce(s.points_bonus_sources, '[]'::jsonb)) with ordinality as source(source, ordinality)
      ),
      '[]'::jsonb
    ) as rewritten_sources
  from public.receipt_submissions s
  where s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'submitted', 'confirmed')
    )
), repriced as (
  select
    id,
    case when has_bonus_privileges then capped_base else non_bonus_base end as points_base,
    case when has_bonus_privileges then 100.0000 else 1.0000 end as points_multiplier,
    case when has_bonus_privileges then rewritten_sources else '[]'::jsonb end as points_bonus_sources,
    case when has_bonus_privileges then floor(capped_base::numeric * 100.0000)::integer else non_bonus_base end as points_total
  from unsettled_verified
)
update public.receipt_submissions s
set
  points_base = repriced.points_base,
  points_multiplier = repriced.points_multiplier,
  points_bonus_sources = repriced.points_bonus_sources,
  points_total = repriced.points_total
from repriced
where s.id = repriced.id
  and (
    s.points_base is distinct from repriced.points_base
    or s.points_multiplier is distinct from repriced.points_multiplier
    or s.points_bonus_sources is distinct from repriced.points_bonus_sources
    or s.points_total is distinct from repriced.points_total
  );
