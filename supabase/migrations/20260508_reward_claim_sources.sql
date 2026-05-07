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

-- Conservative compatibility backfill for reward claims created before this table existed.
-- If a legacy claim has no source rows yet, link it to the oldest currently unlinked
-- verified submissions until the claim's points are covered. This prevents those
-- receipts from being offered again as claim sources after the migration.
do $$
declare
  claim_rec record;
  source_rec record;
  covered_points integer;
begin
  for claim_rec in
    select rc.*
    from public.reward_claims rc
    where rc.status in ('pending', 'submitted', 'confirmed')
      and not exists (
        select 1
        from public.reward_claim_sources existing
        where existing.claim_id = rc.id
      )
    order by rc.created_at asc, rc.id asc
  loop
    covered_points := 0;

    for source_rec in
      select s.*
      from public.receipt_submissions s
      where s.user_id = claim_rec.user_id
        and s.status = 'verified'
        and s.points_total > 0
        and not exists (
          select 1
          from public.reward_claim_sources rcs
          join public.reward_claims rc on rc.id = rcs.claim_id
          where rcs.submission_id = s.id
            and rc.status in ('pending', 'submitted', 'confirmed')
        )
      order by s.created_at asc, s.id asc
    loop
      exit when covered_points >= claim_rec.points_claimed;

      insert into public.reward_claim_sources (
        claim_id,
        submission_id,
        points_total,
        receipt_fingerprint,
        dify_drink_list
      )
      values (
        claim_rec.id,
        source_rec.id,
        source_rec.points_total,
        source_rec.receipt_fingerprint,
        source_rec.dify_drink_list
      )
      on conflict do nothing;

      covered_points := covered_points + source_rec.points_total;
    end loop;
  end loop;
end $$;

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
