-- BigBottle: retention helper for VeBetterDAO vote bonus staging data.

create or replace function public.bb_cleanup_vote_bonus_rounds(
  p_current_round_id bigint,
  p_retain_rounds integer default 4
)
returns table (
  deleted_bonus_eligibility integer,
  deleted_vote_mapping integer
)
language plpgsql
as $$
declare
  v_retain_rounds integer;
  v_min_effective_round bigint;
  v_min_source_round bigint;
begin
  if p_current_round_id is null or p_current_round_id <= 0 then
    raise exception 'p_current_round_id must be > 0';
  end if;

  v_retain_rounds := greatest(coalesce(p_retain_rounds, 4), 1);
  v_min_effective_round := p_current_round_id - v_retain_rounds + 1;
  v_min_source_round := v_min_effective_round - 1;

  delete from public.bigbottle_vote_bonus_eligibility
  where effective_round_id < v_min_effective_round;
  get diagnostics deleted_bonus_eligibility = row_count;

  delete from public.vote_wallet_mapping
  where round_id < v_min_source_round;
  get diagnostics deleted_vote_mapping = row_count;

  return next;
end $$;
