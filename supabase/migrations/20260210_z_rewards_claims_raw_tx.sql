-- BigBottle (Phase 2 MVP): Persist raw delegated transaction for replay/diagnostics

alter table public.reward_claims
  add column if not exists raw_tx text;

