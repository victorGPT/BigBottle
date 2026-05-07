-- BigBottle: link reward claims to verified receipt submissions used as claim sources.

create table if not exists public.reward_claim_sources (
  claim_id uuid not null references public.reward_claims(id) on delete cascade,
  submission_id uuid not null references public.receipt_submissions(id) on delete restrict,
  points_total integer not null check (points_total > 0),
  receipt_fingerprint text,
  dify_drink_list jsonb,
  created_at timestamptz not null default now(),
  primary key (claim_id, submission_id)
);

create index if not exists reward_claim_sources_submission_id_idx
  on public.reward_claim_sources (submission_id);

create index if not exists reward_claim_sources_claim_id_idx
  on public.reward_claim_sources (claim_id);

create or replace function public.bb_reward_claim_source_submissions(user_id uuid)
returns setof public.receipt_submissions as $$
  select s.*
  from public.receipt_submissions s
  where s.user_id = $1
    and s.status = 'verified'
    and s.points_total > 0
    and not exists (
      select 1
      from public.reward_claim_sources rcs
      join public.reward_claims rc on rc.id = rcs.claim_id
      where rcs.submission_id = s.id
        and rc.status in ('pending', 'submitted', 'confirmed')
    )
  order by s.created_at asc;
$$ language sql stable;
