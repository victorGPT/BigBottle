-- BigBottle: wallets that voted for BigBottle cannot remain hidden reward-claim blacklisted.

create or replace function public.bb_has_bigbottle_vote(p_wallet_address text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.vote_wallet_mapping m
      where lower(trim(coalesce(p_wallet_address, ''))) <> ''
        and m.voted_bigbottle = true
        and (
          lower(trim(m.passport_address)) = lower(trim(p_wallet_address))
          or lower(trim(m.voter_address)) = lower(trim(p_wallet_address))
        )
  );
$$;

create or replace function public.bb_skip_reward_blacklist_for_bigbottle_voters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.wallet_address := lower(trim(new.wallet_address));

  if public.bb_has_bigbottle_vote(new.wallet_address) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists skip_reward_blacklist_for_bigbottle_voters on public.reward_claim_blacklist;
create trigger skip_reward_blacklist_for_bigbottle_voters
before insert or update of wallet_address
on public.reward_claim_blacklist
for each row
execute function public.bb_skip_reward_blacklist_for_bigbottle_voters();

create or replace function public.bb_remove_reward_blacklist_after_bigbottle_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.voted_bigbottle = true then
    delete from public.reward_claim_blacklist b
    where b.wallet_address in (
      lower(trim(new.passport_address)),
      lower(trim(new.voter_address))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists remove_reward_blacklist_after_bigbottle_vote on public.vote_wallet_mapping;
create trigger remove_reward_blacklist_after_bigbottle_vote
after insert or update of voted_bigbottle, passport_address, voter_address
on public.vote_wallet_mapping
for each row
execute function public.bb_remove_reward_blacklist_after_bigbottle_vote();

delete from public.reward_claim_blacklist b
where public.bb_has_bigbottle_vote(b.wallet_address);
