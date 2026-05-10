-- BigBottle: keep backend-owned public tables private from Data API client roles.
--
-- The web client talks to the Supabase Edge Function API, and the API accesses
-- these tables with the service role. No browser path should read or mutate the
-- tables directly through anon/authenticated Data API roles.

alter table public.users enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.receipt_submissions enable row level security;
alter table public.reward_conversion_rates enable row level security;
alter table public.reward_claims enable row level security;
alter table public.vote_wallet_mapping enable row level security;
alter table public.bigbottle_vote_bonus_eligibility enable row level security;
alter table public.vebetter_node_current enable row level security;
alter table public.vebetter_node_snapshot_daily enable row level security;
alter table public.vechain_node_holder_daily enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.reward_claim_sources enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.auth_challenges from anon, authenticated;
revoke all on table public.receipt_submissions from anon, authenticated;
revoke all on table public.reward_conversion_rates from anon, authenticated;
revoke all on table public.reward_claims from anon, authenticated;
revoke all on table public.vote_wallet_mapping from anon, authenticated;
revoke all on table public.bigbottle_vote_bonus_eligibility from anon, authenticated;
revoke all on table public.vebetter_node_current from anon, authenticated;
revoke all on table public.vebetter_node_snapshot_daily from anon, authenticated;
revoke all on table public.vechain_node_holder_daily from anon, authenticated;
revoke all on table public.achievement_definitions from anon, authenticated;
revoke all on table public.reward_claim_sources from anon, authenticated;
